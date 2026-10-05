import { config } from "../../config/env";
import * as usersRepo from "../users/users.repository";
import * as refreshTokensRepo from "./refresh-tokens.repository";
import { hashPassword, verifyPassword } from "./password";
import { issueAccessToken, issueRefreshToken, verifyRefreshToken } from "./tokens";
import type { LoginInput, SignupInput } from "./dto";
import {
  assertLoginAllowed,
  consumePasswordResetCode,
  recordLoginFailure,
  recordLoginSuccess,
  recordSecurityEvent,
  requestPasswordReset,
  setPasswordAndRevokeSessions,
  type ClientContext,
} from "./account-security";
import { HttpError } from "../../http/errors";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

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

function toPublicUser(user: usersRepo.UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    avatarMediaId: user.avatarMediaId,
    interests: user.interests,
    isPrivate: user.isPrivate,
  };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** `sessionId` continues an existing sign-in (refresh rotation); omit it to start a new one. */
export async function issueTokenPair(userId: string, userAgent: string | null, sessionId?: string): Promise<TokenPair> {
  const inserted = await refreshTokensRepo.insertRefreshToken({
    userId,
    ...(sessionId ? { sessionId } : {}),
    expiresAt: new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000),
    userAgent,
  });
  const refreshToken = issueRefreshToken(userId, inserted.id);
  await refreshTokensRepo.finalizeRefreshToken(inserted.id, refreshToken);
  const accessToken = issueAccessToken(userId, inserted.sessionId);
  return { accessToken, refreshToken };
}

export async function signup(
  input: SignupInput,
  client: ClientContext,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const taken = await usersRepo.usernameOrEmailTaken(input.username, input.email);
  if (taken) {
    throw new AuthError("Username or email is already registered.", 409);
  }
  const passwordHash = await hashPassword(input.password);
  const user = await usersRepo.createUser({
    username: input.username,
    email: input.email,
    passwordHash,
    displayName: input.displayName,
  });
  const tokens = await issueTokenPair(user.id, client.userAgent);
  // The sign-up device becomes the account's first known device.
  await recordSecurityEvent(user.id, "login_succeeded", client);
  return { user: toPublicUser(user), tokens };
}

// Spent on unknown emails so response time doesn't reveal which emails have accounts.
let timingDecoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  timingDecoy ??= hashPassword("katkee-timing-decoy");
  return timingDecoy;
}

export async function login(
  input: LoginInput,
  client: ClientContext,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const user = await usersRepo.findUserByEmail(input.email);
  if (!user || !user.isActive) {
    await verifyPassword(input.password, await decoyHash());
    throw new AuthError("Invalid email or password.", 401);
  }
  await assertLoginAllowed(user.id);
  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    await recordLoginFailure(user.id, client);
    throw new AuthError("Invalid email or password.", 401);
  }
  const tokens = await issueTokenPair(user.id, client.userAgent);
  await recordLoginSuccess(user.id, user.email, client);
  return { user: toPublicUser(user), tokens };
}

export async function refresh(refreshToken: string, userAgent: string | null): Promise<TokenPair> {
  const claims = verifyRefreshToken(refreshToken);
  if (!claims) throw new AuthError("Invalid or expired refresh token.", 401);

  const record = await refreshTokensRepo.findActiveRefreshToken(claims.jti, refreshToken);
  if (!record) throw new AuthError("Invalid or expired refresh token.", 401);

  // Re-checked here, not just at login: a still-unexpired refresh token
  // from before a moderator suspension must not be usable to mint a fresh
  // access token — see moderation.service.ts's suspendUser, which revokes
  // every refresh token a suspended user already holds for exactly this
  // reason. Access tokens are rejected per request by server.ts.
  const user = await usersRepo.findUserById(record.userId);
  if (!user || !user.isActive) {
    throw new AuthError("Invalid or expired refresh token.", 401);
  }

  // Rotate: the presented refresh token is single-use; the sign-in session continues.
  if (!(await refreshTokensRepo.consumeRefreshToken(record.id, refreshToken))) {
    throw new AuthError("Invalid or expired refresh token.", 401);
  }
  return issueTokenPair(record.userId, userAgent, record.sessionId);
}

/** Ends the whole sign-in this refresh token belongs to, including its live access token. */
export async function logout(refreshToken: string): Promise<void> {
  const claims = verifyRefreshToken(refreshToken);
  if (!claims) return; // already invalid/expired — logout is idempotent
  const record = await refreshTokensRepo.findActiveRefreshToken(claims.jti, refreshToken);
  if (!record) return;
  await refreshTokensRepo.revokeSession(record.userId, record.sessionId);
}

export async function getPublicUserById(userId: string): Promise<PublicUser | null> {
  const user = await usersRepo.findUserById(userId);
  return user ? toPublicUser(user) : null;
}

export async function forgotPassword(email: string, client: ClientContext): Promise<void> {
  await requestPasswordReset(email, client);
}

/** Resets the password with an emailed code, ends every other sign-in, and signs this device in. */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
  client: ClientContext,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const userId = await consumePasswordResetCode(email, code);
  await setPasswordAndRevokeSessions(userId, await hashPassword(newPassword));
  await recordSecurityEvent(userId, "password_reset_completed", client);
  const user = await usersRepo.findUserById(userId);
  if (!user || !user.isActive) throw new HttpError(403, "Account unavailable.");
  const tokens = await issueTokenPair(userId, client.userAgent);
  await recordLoginSuccess(userId, user.email, client);
  return { user: toPublicUser(user), tokens };
}

/** Changes the password after verifying the current one; every other sign-in ends. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  client: ClientContext,
): Promise<TokenPair> {
  const user = await usersRepo.findUserById(userId);
  if (!user || !user.isActive) throw new HttpError(403, "Account unavailable.");
  await assertLoginAllowed(user.id);
  if (!user.passwordHash) throw new HttpError(409, "This account signs in with Google or phone. Add a password from Account security first.");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    await recordLoginFailure(user.id, client);
    throw new HttpError(401, "Your current password is incorrect.");
  }
  await setPasswordAndRevokeSessions(userId, await hashPassword(newPassword));
  await recordSecurityEvent(userId, "password_changed", client);
  return issueTokenPair(userId, client.userAgent);
}
