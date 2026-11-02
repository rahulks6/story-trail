/**
 * The ICE servers a phone uses to reach the other one: STUN to find its own public address, and
 * TURN to relay the call when no direct path exists (mobile networks, strict NATs), which is
 * most calls between phones. Phones only ever get short-lived TURN credentials:
 *  - twilio: Network Traversal Service tokens (POST /Accounts/{sid}/Tokens.json), fetched with
 *    the account's API key or auth token, which never leave this server;
 *  - secret: your own TURN server (e.g. coturn with use-auth-secret): the TURN REST API's
 *    time-limited username `<expiry>:<user id>` and its HMAC-SHA1 under the shared secret.
 * Without a provider (development), STUN only: calls connect on friendly networks.
 */
import { createHmac } from "node:crypto";
import { config } from "../../config/env";

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceServers {
  iceServers: IceServer[];
  /** How long the credentials stay valid; the app asks again before reconnecting a call after that. */
  ttlSeconds: number;
}

interface TwilioToken {
  servers: IceServer[];
  expiresAtMs: number;
}

let twilioToken: TwilioToken | null = null;
let twilioPending: Promise<TwilioToken> | null = null;

/**
 * A token is shared by the calls that start within a few minutes of each other (it isn't bound
 * to a person: possession is what counts, like any TURN credential), so a busy evening costs a
 * handful of Twilio requests, and every phone still gets credentials with most of their life left.
 */
function reuseForMs(ttlSeconds: number): number {
  return Math.min(30 * 60, Math.floor(ttlSeconds / 4)) * 1000;
}

async function fetchTwilioToken(ttlSeconds: number): Promise<TwilioToken> {
  const t = config.calls.turn.twilio;
  const user = t.apiKeySid && t.apiKeySecret ? `${t.apiKeySid}:${t.apiKeySecret}` : `${t.accountSid}:${t.authToken}`;
  const res = await fetch(`${t.endpoint}/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Tokens.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(user).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Ttl: String(ttlSeconds) }).toString(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Twilio token request failed (${res.status})`);
  const body = (await res.json()) as { ice_servers?: Array<{ urls?: unknown; url?: unknown; username?: unknown; credential?: unknown }> };
  const servers: IceServer[] = [];
  for (const s of body.ice_servers ?? []) {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls ?? s.url]).filter((u): u is string => typeof u === "string" && /^(stun|stuns|turn|turns):/.test(u));
    if (!urls.length) continue;
    servers.push({
      urls,
      ...(typeof s.username === "string" ? { username: s.username } : {}),
      ...(typeof s.credential === "string" ? { credential: s.credential } : {}),
    });
  }
  if (!servers.some((s) => s.urls.some((u) => u.startsWith("turn")))) throw new Error("Twilio token had no TURN servers");
  return { servers, expiresAtMs: Date.now() + ttlSeconds * 1000 };
}

async function twilioServers(ttlSeconds: number): Promise<TwilioToken> {
  const now = Date.now();
  if (twilioToken && twilioToken.expiresAtMs - now > ttlSeconds * 1000 - reuseForMs(ttlSeconds)) return twilioToken;
  twilioPending ??= fetchTwilioToken(ttlSeconds)
    .then((token) => (twilioToken = token))
    .finally(() => { twilioPending = null; });
  try {
    return await twilioPending;
  } catch (error) {
    // Twilio unreachable for a moment: a token that's still valid for a while beats no relay.
    if (twilioToken && twilioToken.expiresAtMs - now > 10 * 60_000) return twilioToken;
    throw error;
  }
}

/** The TURN REST API credential (draft-uberti-behave-turn-rest), valid until `expiresAt`. */
export function sharedSecretCredential(secret: string, userId: string, expiresAtSeconds: number): { username: string; credential: string } {
  const username = `${expiresAtSeconds}:${userId}`;
  return { username, credential: createHmac("sha1", secret).update(username).digest("base64") };
}

/** STUN, plus TURN credentials for `userId` from the configured provider. */
export async function iceServersFor(userId: string): Promise<IceServers> {
  const turn = config.calls.turn;
  const stun: IceServer[] = config.calls.stunUrls.length ? [{ urls: config.calls.stunUrls }] : [];
  if (turn.provider === "secret") {
    const expiresAt = Math.floor(Date.now() / 1000) + turn.ttlSeconds;
    return { iceServers: [...stun, { urls: turn.urls, ...sharedSecretCredential(turn.secret, userId, expiresAt) }], ttlSeconds: turn.ttlSeconds };
  }
  if (turn.provider === "twilio") {
    try {
      const token = await twilioServers(turn.ttlSeconds);
      return { iceServers: token.servers, ttlSeconds: Math.max(60, Math.floor((token.expiresAtMs - Date.now()) / 1000)) };
    } catch (error) {
      // Calls still connect directly where the networks allow; the relay comes back with Twilio.
      console.warn(JSON.stringify({ ts: new Date().toISOString(), event: "turn_unavailable", provider: "twilio", error: (error as Error).message }));
      return { iceServers: stun, ttlSeconds: 300 };
    }
  }
  return { iceServers: stun, ttlSeconds: 24 * 3600 };
}

/** Tests only: forget the cached Twilio token. */
export function resetIceServerCache(): void {
  twilioToken = null;
  twilioPending = null;
}
