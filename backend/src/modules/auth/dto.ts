/**
 * Hand-rolled request validation (no zod/class-validator — see package.json
 * networkSandboxLimitation). Each validator returns a typed, narrowed value
 * or throws ValidationError with a field-level message.
 */
import { EMAIL_RE, USERNAME_RE } from "../../shared/validation";

export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}

export interface SignupInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export function parseSignupInput(body: unknown): SignupInput {
  const errors: Record<string, string> = {};
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";

  if (!USERNAME_RE.test(username)) {
    errors.username = "Username must be 3-30 characters: lowercase letters, numbers, '.', or '_'.";
  }
  if (["admin", "katkee", "support", "moderator", "superadmin"].includes(username)) {
    errors.username = "That username is reserved.";
  }
  if (!EMAIL_RE.test(email)) {
    errors.email = "Must be a valid email address.";
  }
  const passwordProblem = newPasswordProblem(password, { email, username });
  if (passwordProblem) {
    errors.password = passwordProblem;
  }
  if (displayName.length < 1 || displayName.length > 60) {
    errors.displayName = "Display name must be 1-60 characters.";
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { username, email, password, displayName };
}

export interface LoginInput {
  email: string;
  password: string;
}

export function parseLoginInput(body: unknown): LoginInput {
  const errors: Record<string, string> = {};
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";

  if (!EMAIL_RE.test(email)) errors.email = "Must be a valid email address.";
  if (!password) errors.password = "Password is required.";

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { email, password };
}

export interface RefreshInput {
  refreshToken: string;
}

export function parseRefreshInput(body: unknown): RefreshInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const refreshToken = typeof b.refreshToken === "string" ? b.refreshToken : "";
  if (!refreshToken) throw new ValidationError({ refreshToken: "refreshToken is required." });
  return { refreshToken };
}

// The most common leaked passwords that still satisfy the length rule (NIST SP 800-63B
// recommends refusing known-compromised values). Compared case-insensitively.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "11111111",
  "00000000", "qwerty123", "qwertyuiop", "iloveyou", "sunshine", "princess", "football",
  "baseball", "welcome1", "abc12345", "abcd1234", "admin123", "letmein1", "trustno1",
  "passw0rd", "starwars", "whatever", "superman", "katkee123", "katkee1234", "india123",
  "1q2w3e4r", "qwerty12", "asdfghjkl", "zxcvbnm1", "monkey12", "dragon12", "michael1",
]);

/** Shared rule for every new password (signup keeps its original checks for compatibility). */
export function newPasswordProblem(password: string, context: { email?: string | null; username?: string } = {}): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is too common. Choose something harder to guess.";
  if (context.email && lower === context.email.toLowerCase()) return "Don't use your email address as your password.";
  if (context.username && lower === context.username.toLowerCase()) return "Don't use your username as your password.";
  return null;
}

function bodyObject(body: unknown): Record<string, unknown> {
  return (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
}

export function parseForgotPasswordInput(body: unknown): { email: string } {
  const b = bodyObject(body);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw new ValidationError({ email: "Enter the email address you signed up with." });
  return { email };
}

export function parseResetPasswordInput(body: unknown): { email: string; code: string; newPassword: string } {
  const b = bodyObject(body);
  const errors: Record<string, string> = {};
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const code = typeof b.code === "string" ? b.code.trim() : "";
  const newPassword = typeof b.newPassword === "string" ? b.newPassword : "";
  if (!EMAIL_RE.test(email)) errors.email = "Enter the email address you signed up with.";
  if (!/^[0-9]{6}$/.test(code)) errors.code = "Enter the 6-digit code from the email.";
  const problem = newPasswordProblem(newPassword, { email });
  if (problem) errors.newPassword = problem;
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { email, code, newPassword };
}

export function parseChangePasswordInput(body: unknown): { currentPassword: string; newPassword: string } {
  const b = bodyObject(body);
  const errors: Record<string, string> = {};
  const currentPassword = typeof b.currentPassword === "string" ? b.currentPassword : "";
  const newPassword = typeof b.newPassword === "string" ? b.newPassword : "";
  if (!currentPassword) errors.currentPassword = "Enter your current password.";
  const problem = newPasswordProblem(newPassword);
  if (problem) errors.newPassword = problem;
  else if (newPassword === currentPassword) errors.newPassword = "Choose a password you haven't used for this account.";
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { currentPassword, newPassword };
}
