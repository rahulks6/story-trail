/**
 * Other accounts signed in on this phone (Profile > tap your username): each with its own sign-in
 * kept in the Keychain/Keystore beside the active session (tokenStorage.ts), so switching needs no
 * password. The active account is never in this list; it moves here when another one is opened.
 */
import * as Keychain from "react-native-keychain";
import type { PublicUser } from "../api/client";
import type { StoredTokens } from "./tokenStorage";

const SERVICE = "com.katkee.accounts.v1";
/** Like Instagram: a handful of accounts on one phone. */
export const MAX_SAVED_ACCOUNTS = 4;

export interface SavedAccount {
  user: Pick<PublicUser, "id" | "username" | "displayName" | "avatarMediaId">;
  tokens: StoredTokens;
}

let pending: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => undefined);
  return result;
}

function valid(a: unknown): a is SavedAccount {
  const x = a as SavedAccount;
  return !!x && typeof x.user?.id === "string" && typeof x.user?.username === "string" && typeof x.tokens?.accessToken === "string" && typeof x.tokens?.refreshToken === "string";
}

async function read(): Promise<SavedAccount[]> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE });
    if (!credentials) return [];
    const parsed: unknown = JSON.parse(credentials.password);
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

async function write(accounts: SavedAccount[]): Promise<void> {
  if (!accounts.length) {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return;
  }
  const saved = await Keychain.setGenericPassword("accounts", JSON.stringify(accounts), { service: SERVICE, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  if (!saved) throw new Error("Secure storage is unavailable.");
}

export function listSavedAccounts(): Promise<SavedAccount[]> {
  return serialized(read);
}

/** Keeps an account (most recent first, one entry per person, at most MAX_SAVED_ACCOUNTS). */
export function saveAccount(account: SavedAccount): Promise<SavedAccount[]> {
  return serialized(async () => {
    const user = { id: account.user.id, username: account.user.username, displayName: account.user.displayName, avatarMediaId: account.user.avatarMediaId ?? null };
    const next = [{ user, tokens: account.tokens }, ...(await read()).filter((a) => a.user.id !== user.id)].slice(0, MAX_SAVED_ACCOUNTS);
    await write(next);
    return next;
  });
}

/** Takes an account out of the list (to open it, or because it signed out), returning it. */
export function takeAccount(userId: string): Promise<SavedAccount | null> {
  return serialized(async () => {
    const all = await read();
    const found = all.find((a) => a.user.id === userId) ?? null;
    if (found) await write(all.filter((a) => a.user.id !== userId));
    return found;
  });
}
