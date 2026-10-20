import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { query, queryOne } from "../../db/psql";
import { config } from "../../config/env";
import { HttpError } from "../../http/errors";

/**
 * The automated device walk-throughs (.github/workflows/*-e2e.yml) sign up throwaway accounts
 * and can't read the code email. Instead the workflow proves who it is with a GitHub Actions
 * OIDC token, signed by GitHub, for this repository and audience. It verifies only throwaway
 * support+e2e-… accounts less than an hour old, so it can't skip verification for anyone else.
 */
const ISSUER = "https://token.actions.githubusercontent.com";
export const CI_AUDIENCE = "katkee-e2e";
export const CI_EMAIL = /^support\+e2e-[a-z0-9-]{1,40}@katkee\.com$/;

type KeyLookup = (kid: string) => Promise<JsonWebKey | null>;

let cachedKeys: { at: number; keys: JsonWebKey[] } | null = null;
async function githubKey(kid: string): Promise<JsonWebKey | null> {
  if (!cachedKeys || Date.now() - cachedKeys.at > 3600_000 || !cachedKeys.keys.some((k) => k.kid === kid)) {
    const r = await fetch(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new HttpError(503, "Couldn't reach GitHub.");
    cachedKeys = { at: Date.now(), keys: ((await r.json()) as { keys: JsonWebKey[] }).keys };
  }
  return cachedKeys.keys.find((k) => k.kid === kid) ?? null;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Throws unless `token` is a current GitHub Actions OIDC token for the configured repository. */
export async function checkCiToken(token: string, lookup: KeyLookup = githubKey): Promise<void> {
  const denied = new HttpError(403, "Not allowed.");
  const repository = config.ciVerify.repository;
  if (!repository) throw denied;
  const parts = token.split(".");
  if (parts.length !== 3) throw denied;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodePart(parts[0] as string);
    claims = decodePart(parts[1] as string);
  } catch {
    throw denied;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw denied;
  const jwk = await lookup(header.kid);
  if (!jwk) throw denied;
  const signed = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2] as string, "base64url"),
  );
  const now = Date.now() / 1000;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !signed ||
    claims.iss !== ISSUER ||
    !audience.includes(CI_AUDIENCE) ||
    claims.repository !== repository ||
    typeof claims.exp !== "number" ||
    claims.exp < now ||
    (typeof claims.nbf === "number" && claims.nbf > now + 60)
  ) {
    throw denied;
  }
}

/** Marks a throwaway walk-through account's email verified (see above). */
export async function verifyCiAccount(userId: string, token: string, lookup?: KeyLookup): Promise<void> {
  await checkCiToken(token, lookup);
  const user = await queryOne(
    `SELECT email FROM users WHERE id = :'id' AND deleted_at IS NULL AND created_at > now() - interval '1 hour'`,
    { id: userId },
  );
  if (!user || !CI_EMAIL.test(String(user.email))) throw new HttpError(403, "Not allowed.");
  await query(`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = :'id'`, { id: userId });
}
