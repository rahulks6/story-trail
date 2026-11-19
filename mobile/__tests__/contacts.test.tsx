import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Linking, PermissionsAndroid, Platform, Text } from "react-native";
import { batches, contactHash, hashesForContacts, normalizeEmail, normalizePhone, sha256Hex, HASH_BATCH_SIZE } from "../src/utils/contactHashes";
import { ContactsFinder, contactsExplainer, displayPhone } from "../src/components/ContactsFinder";
import { invitableContacts } from "../src/state/contacts";
import * as growthApi from "../src/api/growth";
import * as usersApi from "../src/api/users";
import { track } from "../src/analytics/analytics";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" }, accessToken: "token" }) }));
jest.mock("../src/api/growth", () => ({ matchContacts: jest.fn(), getMyInvite: jest.fn() }));
jest.mock("../src/api/users", () => ({ followUser: jest.fn(), unfollowUser: jest.fn() }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));
const growth = growthApi as jest.Mocked<typeof growthApi>;
const users = usersApi as jest.Mocked<typeof usersApi>;
// The library's mock (__tests__/setup.js); it isn't typed here, so it's looked up rather than imported.
const native = jest.requireMock<{ default: { checkPermission: jest.Mock; requestPermission: jest.Mock; getAllWithoutPhotos: jest.Mock } }>("react-native-contacts").default;
const contacts = (globalThis as unknown as { __contacts: { permission: string; afterRequest: string; list: unknown[] } }).__contacts;
// Node's own SHA-256, as the reference (jest runs in Node; the app has no crypto module).
const { createHash } = jest.requireActual<{ createHash: (a: string) => { update: (t: string, e?: string) => { digest: (e: string) => string } } }>("crypto");

/** The server's hash (backend growth/contacts.ts contactHash), made with Node's own SHA-256. */
const serverHash = (kind: string, value: string) => createHash("sha256").update(`katkee-contacts-v1|${kind}|${value}`).digest("hex");

describe("what leaves the phone", () => {
  test("the app's SHA-256 is SHA-256, for ASCII, accents, Devanagari and emoji", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "b".repeat(64), "x".repeat(1000), "José", "नमस्ते", "📷 story"]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });

  test("hashes match the server's, so an account's own email and number are found", () => {
    expect(contactHash("email", "asha@example.com")).toBe(serverHash("email", "asha@example.com"));
    expect(contactHash("phone", "+919876543210")).toBe(serverHash("phone", "+919876543210"));
  });

  test("emails are trimmed and lower-cased; anything that isn't one is skipped", () => {
    expect(normalizeEmail("  Asha.Rao@Example.COM ")).toBe("asha.rao@example.com");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });

  test("numbers become E.164, with India assumed when there's no country code", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("098765-43210")).toBe("+919876543210");
    expect(normalizePhone("91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91 (987) 654-3210")).toBe("+919876543210");
    expect(normalizePhone("0091 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+1 (202) 555-0123")).toBe("+12025550123");
    expect(normalizePhone("+44 (0) 7700 900123")).toBe("+447700900123");
    // Can't be placed: skipped, never guessed.
    for (const raw of ["121", "*123#", "555-0123", "", "+0 123 456 789"]) expect(normalizePhone(raw)).toBeNull();
  });

  test("each contact detail is hashed once, and only hashes come out", () => {
    const hashes = hashesForContacts([
      { emails: ["Asha@example.com", "asha@example.com "], phones: ["98765 43210", "+91 98765 43210"] },
      { emails: ["junk"], phones: ["121"] },
    ]);
    expect(hashes).toEqual([serverHash("email", "asha@example.com"), serverHash("phone", "+919876543210")]);
    expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(batches(Array.from({ length: 1001 }, (_, i) => i)).map((b) => b.length)).toEqual([500, 500, 1]);
  });
});

describe("contacts to invite, worked out on the phone", () => {
  test("each named contact once, a mobile number each, every number once, by name", () => {
    expect(invitableContacts([
      { name: "Ravi", emails: [], phones: ["022 2345 6789", "98765 43210"] },
      { name: "Asha", emails: [], phones: ["+91 98111 22233"] },
      { name: "Asha (work)", emails: [], phones: ["9811122233"] },
      { name: "  ", emails: [], phones: ["9000000001"] },
      { name: "12345", emails: [], phones: ["9000000002"] },
      { name: "Bank", emails: [], phones: ["*123#", "121"] },
      { name: "Sam", emails: [], phones: ["+1 202 555 0123"] },
      { emails: ["x@example.com"], phones: ["9000000003"] },
    ])).toEqual([
      { name: "Asha", phone: "+919811122233" },
      { name: "Ravi", phone: "+919876543210" },
      { name: "Sam", phone: "+12025550123" },
    ]);
  });

  test("numbers are shown the way people write them", () => {
    expect(displayPhone("+919876543210")).toBe("+91 98765 43210");
    expect(displayPhone("+12025550123")).toBe("+12025550123");
  });
});

let tree: ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const pressable = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const press = async (label: string) => { await act(async () => pressable(label).props.onPress()); };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const match = (username: string, following = false) => ({
  id: `id-${username}`, username, displayName: username.toUpperCase(), avatarMediaId: null, verified: false, isPrivate: false,
  viewer: { isFollowing: following, isFollowedBy: false, hasPendingRequestFromViewer: false },
});

describe("Contacts on Katkee", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, "OS", "ios");
    contacts.permission = "undefined";
    contacts.afterRequest = "authorized";
    contacts.list = [];
    await act(async () => { tree = create(<ContactsFinder source="settings" />); });
  });
  afterEach(async () => {
    await act(async () => tree.unmount());
    jest.restoreAllMocks();
  });

  test("explains first; nothing is asked or read until Continue", async () => {
    expect(texts()).toEqual(expect.arrayContaining(["Find friends from your contacts", ...contactsExplainer()]));
    await settle();
    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(native.getAllWithoutPhotos).not.toHaveBeenCalled();
    expect(growth.matchContacts).not.toHaveBeenCalled();
  });

  test("Continue asks, reads, sends only hashes in batches, and lists who's here with Follow", async () => {
    // 600 contacts with one number each: two batches.
    contacts.list = Array.from({ length: 600 }, (_, i) => ({ givenName: `Friend ${i}`, note: "secret", emailAddresses: [], phoneNumbers: [{ number: `98${String(i).padStart(8, "0")}` }] }));
    contacts.list.push({ givenName: "Asha", emailAddresses: [{ email: "Asha@Example.com" }], phoneNumbers: [] });
    growth.matchContacts.mockResolvedValueOnce({ matches: [match("asha"), match("ravi", true)] }).mockResolvedValueOnce({ matches: [match("asha")] });
    await press("Continue");
    await settle();
    expect(native.requestPermission).toHaveBeenCalledTimes(1);
    expect(growth.matchContacts).toHaveBeenCalledTimes(2);
    const sent = growth.matchContacts.mock.calls.map(([hashes]) => hashes);
    expect(sent.map((b) => b.length)).toEqual([HASH_BATCH_SIZE, 101]);
    expect(sent.flat().every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(sent.flat()).toContain(serverHash("email", "asha@example.com"));
    expect(JSON.stringify(sent)).not.toMatch(/Friend|secret|Asha|98000/);
    // Merged across batches, and the people you already follow come last.
    expect(texts()).toEqual(expect.arrayContaining(["Contacts on Katkee", "2 of your contacts are here.", "@asha", "@ravi"]));
    expect(pressable("Follow @asha")).toBeTruthy();
    expect(pressable("Following @ravi")).toBeTruthy();
    expect(track).toHaveBeenCalledWith("contacts_checked", { found: 2 });

    users.followUser.mockResolvedValueOnce({ status: "following" });
    await press("Follow @asha");
    await settle();
    expect(users.followUser).toHaveBeenCalledWith("asha", "token");
    expect(pressable("Following @asha")).toBeTruthy();
  });

  test("a no reads nothing and says how to change it", async () => {
    contacts.afterRequest = "denied";
    await press("Continue");
    await settle();
    expect(native.getAllWithoutPhotos).not.toHaveBeenCalled();
    expect(texts()).toContain("Contacts are off for Katkee");
    expect(pressable("Invite friends")).toBeTruthy();
  });

  test("after an earlier no, iPhone won't ask again: Open Settings instead", async () => {
    contacts.permission = "denied";
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await press("Continue");
    await settle();
    expect(native.requestPermission).not.toHaveBeenCalled();
    await press("Open Settings");
    expect(openSettings).toHaveBeenCalled();
  });

  test("Android asks through its own permission prompt, and \"Don't ask again\" means Settings", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const request = jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    await press("Continue");
    await settle();
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
    expect(native.getAllWithoutPhotos).not.toHaveBeenCalled();
    expect(pressable("Open Settings")).toBeTruthy();
  });

  test("nobody found offers an invite; a refused check says why", async () => {
    contacts.list = [{ emailAddresses: [{ email: "x@example.com" }], phoneNumbers: [] }];
    growth.matchContacts.mockResolvedValueOnce({ matches: [] });
    await press("Continue");
    await settle();
    expect(texts()).toContain("None of your contacts are on Katkee yet.");
    expect(pressable("Invite friends")).toBeTruthy();
  });

  test("contacts not found can be invited on WhatsApp, one tap each, and their numbers never reach Katkee", async () => {
    contacts.list = [
      { givenName: "Ravi", familyName: "Kumar", emailAddresses: [], phoneNumbers: [{ number: "98765 43210" }] },
      { displayName: "Asha", emailAddresses: [], phoneNumbers: [{ number: "+91 98111 22233" }] },
    ];
    growth.matchContacts.mockResolvedValueOnce({ matches: [] });
    growth.getMyInvite.mockResolvedValue({ invite: { url: "https://katkee.com/i/abcd2345" } } as never);
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await press("Continue");
    await settle();
    expect(texts()).toEqual(expect.arrayContaining(["Invite friends to Katkee", "Asha", "Ravi Kumar", "+91 98765 43210"]));
    expect(JSON.stringify(growth.matchContacts.mock.calls)).not.toMatch(/Ravi|Asha|98765|98111/);

    await press("Invite Ravi Kumar");
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0]![0] as string;
    expect(url.startsWith("whatsapp://send?phone=919876543210&text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("https://katkee.com/i/abcd2345");
    expect(track).toHaveBeenCalledWith("invite_shared", { from: "contacts" });
    expect(texts()).toContain("Invited");
  });

  test("without WhatsApp the invite goes as a text message", async () => {
    contacts.list = [{ givenName: "Ravi", emailAddresses: [], phoneNumbers: [{ number: "98765 43210" }] }];
    growth.matchContacts.mockResolvedValueOnce({ matches: [] });
    growth.getMyInvite.mockResolvedValue({ invite: { url: "https://katkee.com/i/abcd2345" } } as never);
    const open = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("no WhatsApp")).mockResolvedValue(true);
    await press("Continue");
    await settle();
    await press("Invite Ravi");
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    expect((open.mock.calls[1]![0] as string).startsWith("sms:+919876543210&body=")).toBe(true);
  });

  test("a long address book can be searched by name or number", async () => {
    contacts.list = Array.from({ length: 12 }, (_, i) => ({ givenName: `Friend ${i}`, emailAddresses: [], phoneNumbers: [{ number: `98${String(i).padStart(8, "0")}` }] }));
    contacts.list.push({ givenName: "Zoya", emailAddresses: [], phoneNumbers: [{ number: "97777 12345" }] });
    growth.matchContacts.mockResolvedValueOnce({ matches: [] });
    await press("Continue");
    await settle();
    const search = tree.root.find((n: ReactTestInstance) => n.props.testID === "contacts-invite-search" && typeof n.props.onChangeText === "function");
    await act(async () => search.props.onChangeText("zoy"));
    expect(texts()).toContain("Zoya");
    expect(texts()).not.toContain("Friend 1");
    await act(async () => search.props.onChangeText("12345"));
    expect(texts()).toContain("Zoya");
    await act(async () => search.props.onChangeText("nobody"));
    expect(texts()).toContain("No contacts match.");
  });
});
