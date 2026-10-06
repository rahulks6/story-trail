/**
 * Typed HTTP client for the KATKEE backend. Response shapes here are kept in
 * lockstep with backend/src/modules/auth/auth.routes.ts and
 * backend/src/modules/auth/auth.service.ts (PublicUser, TokenPair) — there
 * is no shared package yet, so a backend response shape change must be
 * mirrored here by hand until Phase 1's tooling grows a shared types
 * package.
 */
import { appEnv } from "../config/env";

export const API_BASE_URL = appEnv.apiBaseUrl.replace(/\/+$/, "");

export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  bio: string;
  avatarMediaId: string | null;
  interests: string[];
  isPrivate: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    /** The parsed error body, for endpoints that return more than a message (e.g. `retryable`). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type SessionHandler = (rejectedToken: string) => Promise<string>;
let sessionHandler: SessionHandler | null = null;

export function setSessionHandler(handler: SessionHandler | null): void {
  sessionHandler = handler;
}

/** Bound the whole operation, including refresh and response-body reads. */
export async function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 30_000,
  externalSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(new ApiError(0, "Request cancelled."));
      controller.abort();
    };
    if (externalSignal?.aborted) { onAbort(); return; }
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      reject(new ApiError(408, "The request timed out. Check your connection and try again."));
      controller.abort();
    }, timeoutMs);
  });
  try {
    if (externalSignal?.aborted) return await interrupted;
    // Racing also releases the UI if a native transport fails to honour abort.
    return await Promise.race([interrupted, Promise.resolve().then(() => operation(controller.signal))]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) externalSignal?.removeEventListener("abort", onAbort);
  }
}

/** Proxies can return HTML; never show a JSON parse error or raw HTML to users. */
export async function readApiResponse<T>(res: Response): Promise<T> {
  if (res.status === 204 && res.ok) return undefined as T;
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; }
  catch {
    throw new ApiError(res.status, res.ok
      ? "The server returned an invalid response. Please try again."
      : "The service is temporarily unavailable. Please try again.");
  }
  if (!res.ok) {
    const message = typeof json?.message === "string" ? json.message
      : json?.error === "validation_error" ? "Please fix the highlighted fields."
      : "Something went wrong. Please try again.";
    throw new ApiError(res.status, message, json?.fields, json && typeof json === "object" ? json : undefined);
  }
  if (json === undefined || json === null) {
    throw new ApiError(res.status, "The server returned an empty response. Please try again.");
  }
  return json as T;
}

/** Set once at startup (index.js): lets the server count daily active people per platform. */
let clientPlatform: "android" | "ios" | "web" | null = null;
export function setClientPlatform(platform: "android" | "ios" | "web"): void {
  clientPlatform = platform;
}

/** Retry only authentication failures, once. The handler coalesces refreshes. */
export async function authenticatedFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (clientPlatform && url.startsWith(API_BASE_URL) && !headers.has("X-Katkee-Platform")) headers.set("X-Katkee-Platform", clientPlatform);
  const res = await fetch(url, { ...init, headers });
  const authorization = headers.get("Authorization");
  if (res.status !== 401 || !authorization?.startsWith("Bearer ") || !sessionHandler) return res;
  const token = await sessionHandler(authorization.slice(7));
  if (init.signal?.aborted) throw new ApiError(0, "Request cancelled.");
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return withRequestTimeout(async signal => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await authenticatedFetch(`${API_BASE_URL}${path}`, { ...init, signal, headers });
    return readApiResponse<T>(res);
  }, 30_000, init.signal);
}

/** `signal` cancels the request, e.g. when a newer search or check replaces it. */
export function apiGet<T>(path: string, accessToken?: string | null, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: "GET",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    signal,
  });
}

export function apiPost<T>(path: string, body?: unknown, accessToken?: string): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body?: unknown, accessToken?: string): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string, accessToken?: string): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

// A separate function, not an overload of apiDelete — apiDelete's 2nd
// param is accessToken at 5 existing call sites; reusing that slot for a
// body here would silently break all of them (the access token would be
// JSON-stringified as a request body instead of sent as a header).
export function apiDeleteWithBody<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
