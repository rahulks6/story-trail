import { PermissionsAndroid, Platform } from "react-native";
import { matchContacts, type ContactMatch } from "../api/growth";
import { batches, hashesForContacts, normalizePhone, type DeviceContact } from "../utils/contactHashes";
import { track } from "../analytics/analytics";

/**
 * Contacts on Katkee: reads the address book only when the person taps Continue on the explainer
 * (components/ContactsFinder.tsx), or, if they switched on "Tell me when more contacts join",
 * when they open Katkee (at most twice a day, state/contactsWatch.ts). Never in the background.
 * The system permission prompt comes after that explainer, so nobody meets it cold.
 *
 * react-native-contacts (8.0.10, a TurboModule for the new architecture) reads the contacts. It's
 * required here rather than imported so this file only describes the two calls Katkee uses: it
 * never writes, edits or deletes a contact, and never reads photos or notes.
 */
interface NativeContacts {
  checkPermission(): Promise<"authorized" | "denied" | "undefined" | "limited">;
  requestPermission(): Promise<"authorized" | "denied" | "undefined" | "limited">;
  getAllWithoutPhotos(): Promise<Array<{
    displayName?: string; givenName?: string; familyName?: string;
    emailAddresses?: Array<{ email?: string }>; phoneNumbers?: Array<{ number?: string }>;
  }>>;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Contacts: NativeContacts = require("react-native-contacts").default ?? require("react-native-contacts");

export type ContactsAccess = "granted" | "denied" | "blocked";

/** Whether contacts can be read now, without asking. */
export async function contactsAllowed(): Promise<boolean> {
  try {
    if (Platform.OS === "android") return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
    const status = await Contacts.checkPermission();
    // iOS 18 "limited": the person picked some contacts; those are the ones we read.
    return status === "authorized" || status === "limited";
  } catch {
    return false;
  }
}

/**
 * Shows the system prompt (only after the explainer). "blocked" means the phone won't ask again
 * (Android's "Don't ask again", or an earlier no on iPhone): only Settings can change it.
 */
export async function requestContactsAccess(): Promise<ContactsAccess> {
  try {
    if (Platform.OS === "android") {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted";
      return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
    }
    const before = await Contacts.checkPermission();
    if (before === "authorized" || before === "limited") return "granted";
    // iOS asks once; after a no, requestPermission answers "denied" without a prompt.
    if (before === "denied") return "blocked";
    const after = await Contacts.requestPermission();
    return after === "authorized" || after === "limited" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * The emails and numbers (hashed before anything is sent), and the name, which never leaves the
 * phone: it only labels the invite list. Everything else about a contact stays where it is.
 */
export async function readDeviceContacts(): Promise<DeviceContact[]> {
  const all = await Contacts.getAllWithoutPhotos();
  return all.map((c) => ({
    name: (c.displayName || [c.givenName, c.familyName].filter(Boolean).join(" ")).trim(),
    emails: (c.emailAddresses ?? []).map((e) => e.email ?? "").filter(Boolean),
    phones: (c.phoneNumbers ?? []).map((p) => p.number ?? "").filter(Boolean),
  }));
}

/** Someone in the address book who can be sent an invite: a name and one number (E.164). */
export interface InvitableContact {
  name: string;
  phone: string;
}

/**
 * Contacts to offer "Invite" for, worked out on the phone and never sent anywhere: each named
 * contact once, with their first number that can be placed (an Indian one must be a mobile, the
 * only kind WhatsApp and texts reach), each number once, sorted by name.
 */
export function invitableContacts(contacts: DeviceContact[]): InvitableContact[] {
  const seen = new Set<string>();
  const out: InvitableContact[] = [];
  for (const contact of contacts) {
    const name = (contact.name ?? "").trim();
    if (!name || !/\p{L}/u.test(name)) continue;
    for (const raw of contact.phones) {
      const phone = normalizePhone(raw);
      if (!phone || (phone.startsWith("+91") && !/^\+91[6-9]\d{9}$/.test(phone))) continue;
      if (!seen.has(phone)) {
        seen.add(phone);
        out.push({ name, phone });
      }
      break;
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Hashes the address book and asks the server who's on Katkee, a batch at a time. Results from
 * every batch are merged (one person can match by email and by phone). The hashes exist only
 * while this runs. Also returns who can be invited, from the same read.
 */
export async function checkContacts(
  accessToken: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ people: ContactMatch[]; invitable: InvitableContact[] }> {
  const contacts = await readDeviceContacts();
  const hashes = hashesForContacts(contacts);
  const found = new Map<string, ContactMatch>();
  const parts = batches(hashes);
  for (let i = 0; i < parts.length; i++) {
    const { matches } = await matchContacts(parts[i]!, accessToken);
    for (const match of matches) found.set(match.id, match);
    onProgress?.(i + 1, parts.length);
  }
  const people = [...found.values()];
  // Not yet followed first, then by name: who you might want to follow is at the top.
  people.sort((a, b) => Number(a.viewer.isFollowing) - Number(b.viewer.isFollowing) || a.displayName.localeCompare(b.displayName));
  track("contacts_checked", { found: Math.min(people.length, 10_000) });
  return { people, invitable: invitableContacts(contacts) };
}

/** Who's on Katkee from the address book (see checkContacts). */
export async function findContactsOnKatkee(accessToken: string, onProgress?: (done: number, total: number) => void): Promise<ContactMatch[]> {
  return (await checkContacts(accessToken, onProgress)).people;
}
