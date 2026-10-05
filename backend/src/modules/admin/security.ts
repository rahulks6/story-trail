import { createHash, randomBytes } from "node:crypto";
import type { KatkeeRequest } from "../../http/router";
import { query, queryOne } from "../../db/psql";
import { config } from "../../config/env";
import { HttpError } from "../../http/errors";
import { RateLimiter, clientIp } from "../../http/rateLimiter";
import { findUserByEmail, findUserById } from "../users/users.repository";
import { verifyPassword } from "../auth/password";
import { authorize, type Permission, type Principal } from "./policy";
export const adminLimiter = new RateLimiter(60000, 60);
const loginLimiter = new RateLimiter(15 * 60000, 10);
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export function enabled(): void { if (!config.features.admin)
    throw new HttpError(404, "Not found."); }
export function sameOrigin(req: KatkeeRequest): void { if (req.headers.origin !== config.admin.origin)
    throw new HttpError(403, "Invalid request origin."); }
export async function grant(userId: string): Promise<Principal | null> {
    const row = await queryOne(`SELECT g.role,g.permissions FROM admin_grants g JOIN users u ON u.id=g.user_id WHERE g.user_id=:'id' AND g.enabled AND u.is_active AND u.deleted_at IS NULL AND NOT g.mfa_required`, { id: userId });
    return row ? { userId, role: row.role as Principal["role"], permissions: JSON.parse(row.permissions as string) as string[] } : null;
}
export async function requireAdmin(req: KatkeeRequest, permission?: Permission, superOnly = false, recent = false): Promise<Principal> {
    enabled();
    const token = (req.headers.cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith("katkee_admin="))?.slice(13) ?? "";
    if (!/^[a-f0-9]{64}$/.test(token))
        throw new HttpError(401, "Admin sign-in required.");
    const tokenHash = hash(token);
    const row = await queryOne(`SELECT s.user_id,s.csrf_hash,s.reauthenticated_at,g.role,g.permissions FROM admin_sessions s JOIN admin_grants g ON g.user_id=s.user_id JOIN users u ON u.id=s.user_id WHERE s.token_hash=:'hash' AND s.expires_at>now() AND g.enabled AND NOT g.mfa_required AND u.is_active AND u.deleted_at IS NULL`, { hash: tokenHash });
    if (!row)
        throw new HttpError(401, "Admin session expired.");
    const principal: Principal = { userId: row.user_id as string, role: row.role as Principal["role"], permissions: JSON.parse(row.permissions as string) as string[], sessionHash: tokenHash, recent: Date.now() - new Date(row.reauthenticated_at as string).getTime() < 5 * 60000 };
    if (req.method !== "GET") {
        sameOrigin(req);
        if (hash(String(req.headers["x-csrf-token"] ?? "")) !== row.csrf_hash)
            throw new HttpError(403, "Invalid CSRF token.");
        adminLimiter.check(principal.userId);
    }
    try {
        if (permission)
            authorize(principal, permission, superOnly);
        if (recent && !principal.recent)
            throw new HttpError(403, "Please reauthenticate before this change.");
    }
    catch (error) {
        console.warn(JSON.stringify({ event: "admin_authorization_denied", actor: principal.userId, permission }));
        throw error;
    }
    return principal;
}
export async function adminLogin(req: KatkeeRequest, email: string, password: string) {
    enabled();
    sameOrigin(req);
    loginLimiter.check(`ip:${clientIp(req)}`);
    loginLimiter.check(`account:${hash(email.toLowerCase())}`);
    const user = await findUserByEmail(email);
    if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash)))
        throw new HttpError(401, "Invalid credentials.");
    const principal = await grant(user.id);
    if (!principal)
        throw new HttpError(403, "Admin access unavailable.");
    const token = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
    await query(`WITH session AS (INSERT INTO admin_sessions(token_hash,user_id,csrf_hash,expires_at) VALUES(:'hash',:'user',:'csrf',now()+interval '30 minutes') RETURNING user_id) INSERT INTO admin_audit(actor_id,action,target_id) SELECT user_id,'ADMIN_LOGIN',user_id FROM session`, { hash: hash(token), user: user.id, csrf: hash(csrf) });
    return { token, csrf, principal };
}
export async function reauthenticate(principal: Principal, password: string): Promise<void> {
    const user = await findUserById(principal.userId);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
        throw new HttpError(401, "Invalid credentials.");
    await query(`UPDATE admin_sessions SET reauthenticated_at=now() WHERE token_hash=:'hash'`, { hash: principal.sessionHash ?? "" });
}
export function cookie(token: string, maxAge = 1800): string { return `katkee_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.admin.origin.startsWith("https:") ? "; Secure" : ""}`; }
