import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as authApi from "../api/auth";
import { ApiError, setSessionHandler, type PublicUser } from "../api/client";
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from "./tokenStorage";
import { unregisterForPush } from "../push/pushNotifications";
import { clearOutbox } from "./dmOutbox";

/**
 * Sign-out housekeeping on this device: stop its pushes for the account and forget the
 * account's unsent messages. Bounded, so a dead network never holds sign-out up (the
 * server also disables the device's pushes when the sign-in ends).
 */
async function forgetDeviceState(userId: string | undefined, accessToken: string | null): Promise<void> {
  const work = Promise.allSettled([unregisterForPush(accessToken), userId ? clearOutbox(userId) : Promise.resolve()]);
  await Promise.race([work, new Promise<void>((resolve) => setTimeout(() => resolve(), 3000))]);
}

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user: PublicUser | null;
  accessToken: string | null;
}
interface AuthContextValue extends AuthState {
  acceptSession: (session:{user:PublicUser;tokens:StoredTokens})=>Promise<void>;
  signup: (input: authApi.SignupPayload) => Promise<void>;
  login: (input: authApi.LoginPayload) => Promise<void>;
  /** Emailed-code reset; signs this device in on success. */
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  /** Replaces this device's tokens (after a password change ended every other session). */
  adoptTokens: (tokens: StoredTokens) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  applyProfile: (user: PublicUser) => void;
  error: string | null;
  fieldErrors: Record<string, string> | undefined;
  clearError: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const signedOut: AuthState = { status: "signedOut", user: null, accessToken: null };

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>({ ...signedOut, status: "loading" });
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = state.user?.id;
  const tokensRef = useRef<StoredTokens | null>(null);
  const knownTokens = useRef(new Set<string>());
  const refreshInFlight = useRef<Promise<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setSessionHandler(async (rejectedToken) => {
      const current = tokensRef.current;
      if (!current || !knownTokens.current.has(rejectedToken)) throw new ApiError(401, "Please sign in again.");
      if (current.accessToken !== rejectedToken) return current.accessToken;
      if (refreshInFlight.current) return refreshInFlight.current;
      const pending = (async () => {
        try {
          const { tokens } = await authApi.refresh(current.refreshToken);
          if (cancelled || tokensRef.current !== current) throw new ApiError(401, "Session changed.");
          await saveTokens(tokens);
          if (cancelled || tokensRef.current !== current) throw new ApiError(401, "Session changed.");
          tokensRef.current = tokens;
          knownTokens.current.add(tokens.accessToken);
          setState((previous) => ({ ...previous, accessToken: tokens.accessToken }));
          return tokens.accessToken;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401 && tokensRef.current === current) {
            tokensRef.current = null;
            knownTokens.current.clear();
            await clearTokens();
            if (!cancelled) setState(signedOut);
          }
          throw err;
        }
      })();
      refreshInFlight.current = pending;
      try { return await pending; }
      finally { if (refreshInFlight.current === pending) refreshInFlight.current = null; }
    });
    void (async () => {
      try {
        const stored = await loadTokens();
        if (cancelled) return;
        if (!stored) { setState(signedOut); return; }
        tokensRef.current = stored;
        knownTokens.current.add(stored.accessToken);
        const { user } = await authApi.fetchMe(stored.accessToken);
        if (!cancelled && tokensRef.current) {
          setState({ status: "signedIn", user, accessToken: tokensRef.current.accessToken });
        }
      } catch (err) {
        // Temporary network failures must not erase persisted credentials.
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't restore your session. Check your connection and sign in again.");
          setState(signedOut);
        }
      }
    })();
    return () => { cancelled = true; setSessionHandler(null); };
  }, []);

  const runAuthAction = useCallback(async (action: () => Promise<{ user: PublicUser; tokens: StoredTokens }>) => {
    setError(null);
    setFieldErrors(undefined);
    try {
      // Finish any old session refresh before replacing its persisted tokens.
      if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
      const { user, tokens } = await action();
      await saveTokens(tokens);
      tokensRef.current = tokens;
      knownTokens.current = new Set([tokens.accessToken]);
      setState({ status: "signedIn", user, accessToken: tokens.accessToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error - check your connection and try again.");
      setFieldErrors(err instanceof ApiError ? err.fieldErrors : undefined);
      throw err;
    }
  }, []);
  const acceptSession = useCallback((session:{user:PublicUser;tokens:StoredTokens}) => runAuthAction(async()=>session), [runAuthAction]);
  const signup = useCallback((input: authApi.SignupPayload) => runAuthAction(() => authApi.signup(input)), [runAuthAction]);
  const login = useCallback((input: authApi.LoginPayload) => runAuthAction(() => authApi.login(input)), [runAuthAction]);
  const resetPassword = useCallback(
    (email: string, code: string, newPassword: string) => runAuthAction(() => authApi.resetPassword(email, code, newPassword)),
    [runAuthAction],
  );
  const adoptTokens = useCallback(async (tokens: StoredTokens) => {
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    await saveTokens(tokens);
    tokensRef.current = tokens;
    knownTokens.current = new Set([tokens.accessToken]);
    setState((current) => (current.status === "signedIn" ? { ...current, accessToken: tokens.accessToken } : current));
  }, []);
  const endLocalSession = useCallback(async () => {
    tokensRef.current = null;
    knownTokens.current.clear();
    await clearTokens();
    setState(signedOut);
  }, []);
  const logout = useCallback(async () => {
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    const refreshToken = tokensRef.current?.refreshToken;
    await forgetDeviceState(userIdRef.current, tokensRef.current?.accessToken ?? null);
    await endLocalSession();
    if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined);
  }, [endLocalSession]);
  const deleteAccount = useCallback(async (password: string) => {
    if (!state.accessToken) return;
    await authApi.deleteMyAccount(password, state.accessToken);
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    await forgetDeviceState(userIdRef.current, null); // the account is gone; the server already disabled its devices
    await endLocalSession();
  }, [state.accessToken, endLocalSession]);
  const refreshUser = useCallback(async () => {
    const tokens = tokensRef.current;
    if (!tokens) return;
    try {
      const { user } = await authApi.fetchMe(tokens.accessToken);
      if (!knownTokens.current.has(tokens.accessToken)) return;
      setState((current) => current.status === "signedIn" ? { ...current, user } : current);
    } catch { /* The editing screen handles its request errors. */ }
  }, []);
  const applyProfile = useCallback((user: PublicUser) => {
    setState(current => current.status === "signedIn" && current.user?.id === user.id ? { ...current, user } : current);
  }, []);
  const clearError = useCallback(() => { setError(null); setFieldErrors(undefined); }, []);
  const value = useMemo<AuthContextValue>(
    () => ({ ...state, acceptSession, signup, login, resetPassword, adoptTokens, logout, deleteAccount, refreshUser, applyProfile, error, fieldErrors, clearError }),
    [state, acceptSession, signup, login, resetPassword, adoptTokens, logout, deleteAccount, refreshUser, applyProfile, error, fieldErrors, clearError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
