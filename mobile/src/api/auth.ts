import { apiDelete, apiDeleteWithBody, apiGet, apiPost, type PublicUser, type TokenPair } from "./client";

export interface SignupPayload {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  user: PublicUser;
  tokens: TokenPair;
}

export function signup(payload: SignupPayload): Promise<AuthResponse> {
  return apiPost<AuthResponse>("/api/v1/auth/signup", payload);
}

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return apiPost<AuthResponse>("/api/v1/auth/login", payload);
}

export function refresh(refreshToken: string): Promise<{ tokens: TokenPair }> {
  return apiPost<{ tokens: TokenPair }>("/api/v1/auth/refresh", { refreshToken });
}

export function logout(refreshToken: string): Promise<void> {
  return apiPost<void>("/api/v1/auth/logout", { refreshToken });
}

export function fetchMe(accessToken: string): Promise<{ user: PublicUser }> {
  return apiGet<{ user: PublicUser }>("/api/v1/auth/me", accessToken);
}

/** Real, in-app account deletion (Phase 12 — App Store guideline 5.1.1(v) requires this exist). Password-confirmed since it's irreversible. */
export function deleteMyAccount(password: string, accessToken: string): Promise<void> {
  return apiDeleteWithBody<void>("/api/v1/users/me", { password }, accessToken);
}

/** Always resolves the same way whether or not the email has an account (server never reveals it). */
export function forgotPassword(email: string): Promise<{ message: string }> {
  return apiPost<{ message: string }>("/api/v1/auth/password/forgot", { email });
}

/** Sets a new password with the emailed 6-digit code; every other sign-in ends and this device is signed in. */
export function resetPassword(email: string, code: string, newPassword: string): Promise<AuthResponse> {
  return apiPost<AuthResponse>("/api/v1/auth/password/reset", { email, code, newPassword });
}

/** Returns a fresh token pair for this device; every other sign-in ends. */
export function changePassword(currentPassword: string, newPassword: string, accessToken: string): Promise<{ tokens: TokenPair }> {
  return apiPost<{ tokens: TokenPair }>("/api/v1/auth/password/change", { currentPassword, newPassword }, accessToken);
}

export interface SignInSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export function listSessions(accessToken: string): Promise<{ sessions: SignInSession[] }> {
  return apiGet<{ sessions: SignInSession[] }>("/api/v1/auth/sessions", accessToken);
}

export function endSession(sessionId: string, accessToken: string): Promise<void> {
  return apiDelete<void>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, accessToken);
}

export function endOtherSessions(accessToken: string): Promise<{ ended: number }> {
  return apiPost<{ ended: number }>("/api/v1/auth/sessions/revoke-others", {}, accessToken);
}

export type SecurityEventKind =
  | "login_succeeded" | "login_failed" | "login_new_device" | "login_locked"
  | "password_reset_requested" | "password_reset_completed" | "password_changed"
  | "session_revoked" | "sessions_revoked";

export interface SecurityEvent {
  kind: SecurityEventKind;
  userAgent: string | null;
  createdAt: string;
}

export function listSecurityEvents(accessToken: string): Promise<{ events: SecurityEvent[] }> {
  return apiGet<{ events: SecurityEvent[] }>("/api/v1/auth/security-events", accessToken);
}
