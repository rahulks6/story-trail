import { apiDelete, apiDeleteWithBody, apiGet, apiPost, type PublicUser, type TokenPair } from "./client";
import { getLanguage } from "../i18n";

export interface SignupPayload {
  username: string;
  email: string;
  password: string;
  displayName: string;
  /** YYYY-MM-DD (utils/birthDate.ts). */
  birthDate: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  user: PublicUser;
  tokens: TokenPair;
}

/** With two-step login on, sign-in answers with a challenge; the authenticator code finishes it. */
export interface TwoStepRequired {
  twoStepRequired: true;
  challenge: string;
  expiresIn: number;
}
export type SignInResponse = AuthResponse | TwoStepRequired;

export function verifyTwoStep(challenge: string, code: string): Promise<AuthResponse> {
  return apiPost<AuthResponse>("/api/v1/auth/two-step/verify", { challenge, code });
}

export interface TwoStepStatus { enabled: boolean; backupCodesLeft: number }
export function twoStepStatus(accessToken: string): Promise<TwoStepStatus> {
  return apiGet<TwoStepStatus>("/api/v1/auth/two-step", accessToken);
}
export function startTwoStep(reauthTicket: string, accessToken: string): Promise<{ secret: string; otpauthUrl: string; qrRows: string[] }> {
  return apiPost("/api/v1/auth/two-step/setup", { reauthTicket }, accessToken);
}
export function enableTwoStep(reauthTicket: string, code: string, accessToken: string): Promise<{ backupCodes: string[] }> {
  return apiPost("/api/v1/auth/two-step/enable", { reauthTicket, code }, accessToken);
}
export function disableTwoStep(reauthTicket: string, code: string, accessToken: string): Promise<void> {
  return apiPost("/api/v1/auth/two-step/disable", { reauthTicket, code }, accessToken);
}

export function signup(payload: SignupPayload): Promise<AuthResponse> {
  // The app's language, so the first verification email (sent straight away) is already in it.
  return apiPost<AuthResponse>("/api/v1/auth/signup", { ...payload, locale: getLanguage() });
}

export function login(payload: LoginPayload): Promise<SignInResponse> {
  return apiPost<SignInResponse>("/api/v1/auth/login", payload);
}

export function refresh(refreshToken: string): Promise<{ tokens: TokenPair }> {
  return apiPost<{ tokens: TokenPair }>("/api/v1/auth/refresh", { refreshToken });
}

export function logout(refreshToken: string): Promise<void> {
  return apiPost<void>("/api/v1/auth/logout", { refreshToken });
}

/** Emails a new 6-digit verification code to the signed-in account (the newest code replaces older ones). */
export function sendEmailCode(accessToken: string): Promise<void> {
  return apiPost<void>("/api/v1/auth/email/send-code", {}, accessToken);
}

/** Confirms the account's email with the emailed code; returns the updated account. */
export function verifyEmail(code: string, accessToken: string): Promise<{ user: PublicUser }> {
  return apiPost<{ user: PublicUser }>("/api/v1/auth/email/verify", { code }, accessToken);
}

/** Fixes a mistyped email before it's verified; a new code goes to the new address. */
export function changeEmail(email: string, accessToken: string): Promise<{ user: PublicUser }> {
  return apiPost<{ user: PublicUser }>("/api/v1/auth/email/change", { email }, accessToken);
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
export function resetPassword(email: string, code: string, newPassword: string): Promise<SignInResponse> {
  return apiPost<SignInResponse>("/api/v1/auth/password/reset", { email, code, newPassword });
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
