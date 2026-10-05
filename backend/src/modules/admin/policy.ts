import { HttpError } from "../../http/errors";
export const permissions = ["reports.read", "reports.review", "content.remove", "content.restore", "users.view", "users.restrict", "users.suspend", "moderation.history.read", "ads.create", "ads.edit", "ads.review", "ads.pause", "ads.analytics.read", "admins.read", "admins.create", "admins.update", "admins.disable", "audit.read"] as const;
export type Permission = typeof permissions[number];
export interface Principal {
    userId: string;
    role: "ADMIN" | "SUPER_ADMIN";
    permissions: string[];
    sessionHash?: string;
    recent?: boolean;
}
export function authorize(principal: Principal | null, permission: Permission, superOnly = false): asserts principal is Principal {
    if (!principal || (superOnly && principal.role !== "SUPER_ADMIN") || (principal.role !== "SUPER_ADMIN" && !principal.permissions.includes(permission)))
        throw new HttpError(403, "Permission denied.");
}
export function body(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(422, "Invalid request."); return value as Record<string, unknown>; }
export function text(value: unknown, max = 500): string { if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(422, "Invalid text field."); return value.trim(); }
export function uuid(value: unknown): string { const s = text(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
    throw new HttpError(422, "Invalid identifier."); return s; }
export function integer(value: unknown, min: number, max: number): number { if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new HttpError(422, "Invalid numeric field."); return value; }
export function confirmation(value: unknown): void { if (value !== true)
    throw new HttpError(422, "Explicit confirmation is required."); }

/** Passwords are exact strings: never normalize whitespace. */
export function password(value: unknown): string {
 if (typeof value !== 'string' || value.length === 0 || value.length > 1024) throw new HttpError(422, 'Invalid password.');
 return value;
}
