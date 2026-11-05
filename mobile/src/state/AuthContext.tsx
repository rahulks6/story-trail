import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../components/Pressable";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as authApi from "../api/auth";
import { ApiError, setSessionHandler, type PublicUser } from "../api/client";
import { TwoStepPrompt } from "../components/TwoStepPrompt";
import { listSavedAccounts, saveAccount, takeAccount, type SavedAccount } from "./savedAccounts";
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from "./tokenStorage";
import { unregisterForPush } from "../push/pushNotifications";
import { clearOutbox } from "./dmOutbox";
import { clearMediaOutbox } from "../screens/dm/dmMediaOutbox";
import { colors, radii, spacing, typography } from "../theme";
import { t } from "../i18n";

/**
 * The last signed-in account from /auth/me, so a launch without a connection still opens
 * the app (the session is checked again once the network is back). Cleared on sign-out.
 */
const CACHED_USER_KEY = "katkee.lastUser.v1";
async function loadCachedUser(): Promise<PublicUser | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
    const user = raw ? JSON.parse(raw) : null;
    return user && typeof user.id === "string" && typeof user.username === "string" ? (user as PublicUser) : null;
  } catch {
    return null;
  }
}
function cacheUser(user: PublicUser | null): void {
  void Promise.resolve()
    .then(() => (user ? AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user)) : AsyncStorage.removeItem(CACHED_USER_KEY)))
    .catch(() => undefined);
}
/** Only the server saying no ends a session; timeouts and dropped connections never do. */
function sessionRejected(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
/** How long launch waits for the server before opening with the saved account. */
const CACHED_LAUNCH_WAIT_MS = 4000;
const RETRY_MAX_MS = 60_000;

/**
 * Sign-out housekeeping on this device: stop its pushes for the account and forget the
 * account's unsent messages and media. Bounded, so a dead network never holds sign-out up (the
 * server also disables the device's pushes when the sign-in ends).
 */
async function forgetDeviceState(userId: string | undefined, accessToken: string | null): Promise<void> {
  const work = Promise.allSettled([
    unregisterForPush(accessToken),
    userId ? clearOutbox(userId) : Promise.resolve(),
    // Unsent DM photos and voice notes don't stay on the phone either.
    userId ? clearMediaOutbox(userId) : Promise.resolve(),
  ]);
  await Promise.race([work, new Promise<void>((resolve) => setTimeout(() => resolve(), 3000))]);
}

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  user: PublicUser | null;
  accessToken: string | null;
}
interface AuthContextValue extends AuthState {
  acceptSession: (session:{user:PublicUser;tokens:StoredTokens}|authApi.TwoStepRequired)=>Promise<void>;
  signup: (input: authApi.SignupPayload) => Promise<void>;
  /** Set by sign-up in this app session: the app opens on "Verify your email" first. */
  justSignedUp: boolean;
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
  /** Set while the saved session couldn't be checked and there is no saved account to open with. */
  connectionError: string | null;
  /** Checks the saved session again now (also happens on its own, and when the app returns). */
  retryConnection: () => void;
  /** Other accounts signed in on this phone (state/savedAccounts.ts), most recent first. */
  savedAccounts: SavedAccount[];
  /** Opens another saved account; this one is kept, ready to switch back to. */
  switchAccount: (userId: string) => Promise<void>;
  /** Keeps this account and goes to sign-in for another one. */
  addAccount: () => Promise<void>;
  /** Set when a sign-in needs the two-step login code (components/TwoStepPrompt asks for it). */
  twoStep: { challenge: string; expiresAt: number } | null;
  /** Finishes the sign-in with a code from the authenticator app, or a backup code. */
  verifyTwoStep: (code: string) => Promise<void>;
  cancelTwoStep: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const signedOut: AuthState = { status: "signedOut", user: null, accessToken: null };

/**
 * Saves the session to the Keychain/Keystore. If secure storage refuses (an unsigned iOS build, a
 * locked or broken keystore), the sign-in still goes ahead for this launch instead of failing a
 * sign-up or login the server already accepted; the person signs in again next time.
 */
async function persistTokens(tokens: StoredTokens): Promise<void> {
  try {
    await saveTokens(tokens);
  } catch (err) {
    console.warn("Couldn't save the session securely; it lasts until Katkee closes.", err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>({ ...signedOut, status: "loading" });
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = state.user?.id;
  const tokensRef = useRef<StoredTokens | null>(null);
  const knownTokens = useRef(new Set<string>());
  const refreshInFlight = useRef<Promise<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  const [connectionError, setConnectionError] = useState<string | null>(null);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  /** Bumped whenever a different session takes over, so a stale launch check can't touch it. */
  const sessionGeneration = useRef(0);
  const verifyNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    let cancelled = false;
    setSessionHandler(async (rejectedToken) => {
      const current = tokensRef.current;
      if (!current || !knownTokens.current.has(rejectedToken)) throw new ApiError(401, t("authContext.pleaseSignInAgain"));
      if (current.accessToken !== rejectedToken) return current.accessToken;
      if (refreshInFlight.current) return refreshInFlight.current;
      const pending = (async () => {
        try {
          const { tokens } = await authApi.refresh(current.refreshToken);
          if (cancelled || tokensRef.current !== current) throw new ApiError(401, t("authContext.sessionChanged"));
          await persistTokens(tokens);
          if (cancelled || tokensRef.current !== current) throw new ApiError(401, t("authContext.sessionChanged"));
          tokensRef.current = tokens;
          knownTokens.current.add(tokens.accessToken);
          setState((previous) => ({ ...previous, accessToken: tokens.accessToken }));
          return tokens.accessToken;
        } catch (err) {
          // Only the server refusing the refresh token signs out. A timeout or dropped
          // connection keeps the session; the next request tries the refresh again.
          if (err instanceof ApiError && (err.status === 401 || err.status === 403) && tokensRef.current === current) {
            tokensRef.current = null;
            knownTokens.current.clear();
            await clearTokens();
            cacheUser(null);
            if (!cancelled) setState(signedOut);
            throw new ApiError(401, err.message);
          }
          throw err;
        }
      })();
      refreshInFlight.current = pending;
      try { return await pending; }
      finally { if (refreshInFlight.current === pending) refreshInFlight.current = null; }
    });

    // Launch check of the saved session, retried with backoff (and on return to the app)
    // until the server answers. Offline, the app opens with the saved account meanwhile.
    let verified = false;
    let verifying = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const openWithCachedUser = async (generation: number): Promise<boolean> => {
      const cached = await loadCachedUser();
      if (!cached || cancelled || verified || generation !== sessionGeneration.current || !tokensRef.current) return false;
      if (statusRef.current === "loading") {
        setConnectionError(null);
        setState({ status: "signedIn", user: cached, accessToken: tokensRef.current.accessToken });
      }
      return true;
    };
    const verify = async (): Promise<void> => {
      const tokens = tokensRef.current;
      if (cancelled || verified || verifying || !tokens) return;
      verifying = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      const generation = sessionGeneration.current;
      try {
        const { user } = await authApi.fetchMe(tokens.accessToken);
        if (cancelled || generation !== sessionGeneration.current || !tokensRef.current) return;
        verified = true;
        cacheUser(user);
        setConnectionError(null);
        setState({ status: "signedIn", user, accessToken: tokensRef.current.accessToken });
      } catch (err) {
        if (cancelled || generation !== sessionGeneration.current) return;
        if (sessionRejected(err)) {
          verified = true;
          tokensRef.current = null;
          knownTokens.current.clear();
          sessionGeneration.current += 1;
          await clearTokens().catch(() => undefined);
          cacheUser(null);
          setConnectionError(null);
          setError(t("authContext.yourSessionHasEndedPlease"));
          setState(signedOut);
          return;
        }
        if (statusRef.current === "loading" && !(await openWithCachedUser(generation)) && !cancelled) {
          setConnectionError(t("authContext.cantConnectToKatkeeCheck"));
        }
        if (cancelled) return;
        retryTimer = setTimeout(() => void verify(), Math.min(RETRY_MAX_MS, 5000 * 2 ** attempt));
        attempt += 1;
      } finally {
        verifying = false;
      }
    };
    verifyNow.current = () => {
      if (verified || cancelled) return;
      attempt = 0;
      void verify();
    };
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") verifyNow.current();
    });

    void (async () => {
      try {
        const stored = await loadTokens();
        if (cancelled) return;
        if (!stored) { verified = true; setState(signedOut); return; }
        tokensRef.current = stored;
        knownTokens.current.add(stored.accessToken);
        const generation = sessionGeneration.current;
        // A slow connection shouldn't hold launch on a spinner when the account is known.
        const slow = setTimeout(() => { if (!verified) void openWithCachedUser(generation); }, CACHED_LAUNCH_WAIT_MS);
        await verify();
        clearTimeout(slow);
      } catch {
        // Unreadable secure storage: there is no session to restore.
        if (!cancelled) { verified = true; setState(signedOut); }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      appState.remove();
      verifyNow.current = () => undefined;
      setSessionHandler(null);
    };
  }, []);

  const [twoStep, setTwoStep] = useState<{ challenge: string; expiresAt: number } | null>(null);
  const setSavedAccountsRef = useRef<(accounts: SavedAccount[]) => void>(() => undefined);
  const runAuthAction = useCallback(async (action: () => Promise<{ user: PublicUser; tokens: StoredTokens } | authApi.TwoStepRequired>) => {
    setError(null);
    setFieldErrors(undefined);
    try {
      // Finish any old session refresh before replacing its persisted tokens.
      if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
      const result = await action();
      // Two-step login on: the code screen comes up; the code finishes the sign-in.
      if ("twoStepRequired" in result) {
        setTwoStep({ challenge: result.challenge, expiresAt: Date.now() + result.expiresIn * 1000 });
        return;
      }
      setTwoStep(null);
      const { user, tokens } = result;
      // Now the active account: never also in the saved list.
      void takeAccount(user.id).then(() => listSavedAccounts()).then(setSavedAccountsRef.current).catch(() => undefined);
      await persistTokens(tokens);
      tokensRef.current = tokens;
      knownTokens.current = new Set([tokens.accessToken]);
      sessionGeneration.current += 1;
      cacheUser(user);
      setConnectionError(null);
      setState({ status: "signedIn", user, accessToken: tokens.accessToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("authContext.networkErrorCheckYourConnection"));
      setFieldErrors(err instanceof ApiError ? err.fieldErrors : undefined);
      throw err;
    }
  }, []);
  const acceptSession = useCallback((session:{user:PublicUser;tokens:StoredTokens}|authApi.TwoStepRequired) => runAuthAction(async()=>session), [runAuthAction]);
  const verifyTwoStep = useCallback(async (code: string) => {
    const pending = twoStep;
    if (!pending) return;
    try {
      await runAuthAction(() => authApi.verifyTwoStep(pending.challenge, code.trim()));
    } catch (err) {
      // Expired or too many tries: back to signing in from the start.
      if (err instanceof ApiError && /too long|too many|Sign in again/i.test(err.message)) setTwoStep(null);
      throw err;
    }
  }, [twoStep, runAuthAction]);
  const cancelTwoStep = useCallback(() => { setTwoStep(null); setError(null); }, []);
  const [justSignedUp, setJustSignedUp] = useState(false);
  const signup = useCallback(async (input: authApi.SignupPayload) => {
    // Set before the session lands, so the signed-in screens open on email verification.
    setJustSignedUp(true);
    try {
      await runAuthAction(() => authApi.signup(input));
    } catch (err) {
      setJustSignedUp(false);
      throw err;
    }
  }, [runAuthAction]);
  const login = useCallback((input: authApi.LoginPayload) => runAuthAction(() => authApi.login(input)), [runAuthAction]);
  const resetPassword = useCallback(
    (email: string, code: string, newPassword: string) => runAuthAction(() => authApi.resetPassword(email, code, newPassword)),
    [runAuthAction],
  );
  const adoptTokens = useCallback(async (tokens: StoredTokens) => {
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    await persistTokens(tokens);
    tokensRef.current = tokens;
    knownTokens.current = new Set([tokens.accessToken]);
    setState((current) => (current.status === "signedIn" ? { ...current, accessToken: tokens.accessToken } : current));
  }, []);
  const endLocalSession = useCallback(async () => {
    tokensRef.current = null;
    knownTokens.current.clear();
    sessionGeneration.current += 1;
    cacheUser(null);
    await clearTokens();
    setConnectionError(null);
    setState(signedOut);
  }, []);
  // Several accounts on one phone: the active one lives in tokenStorage, the others in savedAccounts.
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  setSavedAccountsRef.current = setSavedAccounts;
  const reloadSaved = useCallback(async () => { setSavedAccounts(await listSavedAccounts()); }, []);
  useEffect(() => { void reloadSaved(); }, [reloadSaved]);
  /** Puts the active account in the saved list (and stops its pushes on this phone). */
  const shelveActive = useCallback(async () => {
    const tokens = tokensRef.current;
    if (state.status !== "signedIn" || !state.user || !tokens) return;
    await saveAccount({ user: state.user, tokens });
    await unregisterForPush(tokens.accessToken).catch(() => undefined);
  }, [state.status, state.user]);
  /** Opens a saved account with fresh tokens (its own refresh token), or drops it if it no longer works. */
  const openSaved = useCallback(async (userId: string) => {
    const target = await takeAccount(userId);
    if (!target) return;
    try {
      await runAuthAction(async () => {
        const { tokens } = await authApi.refresh(target.tokens.refreshToken);
        const { user } = await authApi.fetchMe(tokens.accessToken);
        return { user, tokens };
      });
    } finally {
      await reloadSaved();
    }
  }, [runAuthAction, reloadSaved]);
  const switchAccount = useCallback(async (userId: string) => {
    if (userId === userIdRef.current) return;
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    await shelveActive();
    await openSaved(userId);
  }, [shelveActive, openSaved]);
  const addAccount = useCallback(async () => {
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    await shelveActive();
    // Signed out here only: the server session stays, so this account is one tap away.
    await endLocalSession();
    await reloadSaved();
  }, [shelveActive, endLocalSession, reloadSaved]);
  const logout = useCallback(async () => {
    if (refreshInFlight.current) await refreshInFlight.current.catch(() => undefined);
    const refreshToken = tokensRef.current?.refreshToken;
    await forgetDeviceState(userIdRef.current, tokensRef.current?.accessToken ?? null);
    await endLocalSession();
    if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined);
    // Another account on this phone: open it, as Instagram does, rather than the sign-in screen.
    const next = (await listSavedAccounts())[0];
    if (next) await openSaved(next.user.id).catch(() => undefined);
    else await reloadSaved();
  }, [endLocalSession, openSaved, reloadSaved]);
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
      cacheUser(user);
      setState((current) => current.status === "signedIn" ? { ...current, user } : current);
    } catch { /* The editing screen handles its request errors. */ }
  }, []);
  const applyProfile = useCallback((user: PublicUser) => {
    setState(current => {
      if (current.status !== "signedIn" || current.user?.id !== user.id) return current;
      cacheUser(user);
      return { ...current, user };
    });
  }, []);
  const retryConnection = useCallback(() => verifyNow.current(), []);
  const clearError = useCallback(() => { setError(null); setFieldErrors(undefined); }, []);
  const value = useMemo<AuthContextValue>(
    () => ({ ...state, justSignedUp, acceptSession, signup, login, resetPassword, adoptTokens, logout, deleteAccount, refreshUser, applyProfile, error, fieldErrors, clearError, connectionError, retryConnection, twoStep, verifyTwoStep, cancelTwoStep, savedAccounts, switchAccount, addAccount }),
    [state, justSignedUp, acceptSession, signup, login, resetPassword, adoptTokens, logout, deleteAccount, refreshUser, applyProfile, error, fieldErrors, clearError, connectionError, retryConnection, twoStep, verifyTwoStep, cancelTwoStep, savedAccounts, switchAccount, addAccount],
  );
  return (
    <AuthContext.Provider value={value}>
      {state.status === "loading" && connectionError ? <CantConnect message={connectionError} onRetry={retryConnection} /> : children}
      {twoStep && state.status !== "signedIn" ? <TwoStepPrompt /> : null}
    </AuthContext.Provider>
  );
}

/** Shown at launch when the saved session can't be checked and no saved account can open the app. */
function CantConnect({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <View style={styles.cantConnect}>
      <Text accessibilityRole="alert" style={[typography.body, styles.cantConnectText]}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.tryAgain")} onPress={onRetry} style={styles.retry}>
        <Text style={[typography.bodyStrong, styles.retryText]}>{t("common.tryAgain")}</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  cantConnect: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  cantConnectText: { textAlign: "center", color: colors.textSecondary },
  retry: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radii.pill, backgroundColor: colors.accent },
  retryText: { color: colors.onAccent },
});
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
