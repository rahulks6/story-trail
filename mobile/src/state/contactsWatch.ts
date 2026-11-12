import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ContactMatch } from "../api/growth";
import { contactsAllowed, findContactsOnKatkee } from "./contacts";

/**
 * "Tell me when more contacts join": an opt-in, switched on from the contacts results
 * (ContactsFinder). While it's on, opening Katkee re-runs the same contacts check at most every
 * CHECK_EVERY_MS (hashed on the phone, compared and forgotten by the server, exactly as when you
 * tap Find friends), and anyone new shows on Home (ContactsJoinedCard). Nothing about it is kept
 * on the server: which accounts you've already been told about is kept on this phone only, per
 * account. Turning it off, or turning contacts off for Katkee, stops it.
 */
export const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
/** Enough to remember everyone found from a big address book. */
const MAX_KNOWN = 5000;

interface Saved { enabled: boolean; known: string[]; lastCheck: number }
const key = (userId: string) => `katkee.contactsWatch.v1.${userId}`;

async function load(userId: string): Promise<Saved> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    return {
      enabled: saved.enabled === true,
      known: Array.isArray(saved.known) ? saved.known.filter((id): id is string => typeof id === "string") : [],
      lastCheck: typeof saved.lastCheck === "number" ? saved.lastCheck : 0,
    };
  } catch {
    return { enabled: false, known: [], lastCheck: 0 };
  }
}

async function save(userId: string, saved: Saved): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify({ ...saved, known: saved.known.slice(-MAX_KNOWN) })).catch(() => undefined);
}

export async function contactsWatchEnabled(userId: string): Promise<boolean> {
  return (await load(userId)).enabled;
}

/** Turns it on with everyone already found, so only people who join after this are announced. */
export async function enableContactsWatch(userId: string, alreadyFound: ContactMatch[], now = Date.now()): Promise<void> {
  const saved = await load(userId);
  await save(userId, { enabled: true, known: [...new Set([...saved.known, ...alreadyFound.map((p) => p.id)])], lastCheck: now });
}

export async function disableContactsWatch(userId: string): Promise<void> {
  await AsyncStorage.removeItem(key(userId)).catch(() => undefined);
}

/**
 * Contacts who joined since the last check and aren't followed yet, or [] (off, too soon,
 * contacts not allowed, or offline). Everyone found is remembered, so each person is announced once.
 */
export async function newContactsOnKatkee(userId: string, accessToken: string, now = Date.now()): Promise<ContactMatch[]> {
  const saved = await load(userId);
  if (!saved.enabled || now - saved.lastCheck < CHECK_EVERY_MS) return [];
  if (!(await contactsAllowed())) return [];
  let found: ContactMatch[];
  try {
    found = await findContactsOnKatkee(accessToken);
  } catch {
    return [];
  }
  const known = new Set(saved.known);
  const fresh = found.filter((p) => !known.has(p.id) && !p.viewer.isFollowing && !p.viewer.hasPendingRequestFromViewer);
  await save(userId, { enabled: true, known: [...known, ...found.map((p) => p.id)], lastCheck: now });
  return fresh;
}
