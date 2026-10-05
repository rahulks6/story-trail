import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import {
  changePassword,
  endOtherSessions,
  endSession,
  listSecurityEvents,
  listSessions,
  type SecurityEvent,
  type SignInSession,
} from "../../api/auth";
import { Banner, Button, TextField } from "../../components/Form";
import { deviceLabel } from "../../utils/devices";

const EVENT_LABELS: Record<SecurityEvent["kind"], string> = {
  login_succeeded: "Signed in",
  login_failed: "Wrong password entered",
  login_new_device: "Signed in on a new device",
  login_locked: "Sign-in paused after repeated wrong passwords",
  password_reset_requested: "Password reset code requested",
  password_reset_completed: "Password reset",
  password_changed: "Password changed",
  session_revoked: "Signed out a device",
  sessions_revoked: "Signed out of all other devices",
};

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Password change, signed-in devices and recent security activity for Account security. */
export function SignInSecuritySection({ hasPassword }: { hasPassword: boolean }): React.JSX.Element {
  const { accessToken, adoptTokens } = useAuth();
  const [sessions, setSessions] = useState<SignInSession[] | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "success" } | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoadError("");
    try {
      const [s, e] = await Promise.all([listSessions(accessToken), listSecurityEvents(accessToken)]);
      setSessions(s.sessions);
      setEvents(e.events.slice(0, 10));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "Couldn't load your devices. Check your connection.");
    }
  }, [accessToken]);
  useEffect(() => void load(), [load]);

  const submitPassword = async () => {
    const problems: Record<string, string> = {};
    if (!current) problems.current = "Enter your current password.";
    if (next.length < 8) problems.next = "Use at least 8 characters.";
    else if (next === current) problems.next = "Choose a password you haven't used for this account.";
    else if (confirm !== next) problems.confirm = "The passwords don't match.";
    setErrors(problems);
    if (Object.keys(problems).length || !accessToken) return;
    setBusy("password");
    setNotice(null);
    try {
      const { tokens } = await changePassword(current, next, accessToken);
      await adoptTokens(tokens);
      setCurrent("");
      setNext("");
      setConfirm("");
      setNotice({ text: "Password changed. Other devices were signed out.", tone: "success" });
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setErrors({ current: error.message });
      else if (error instanceof ApiError && error.fieldErrors?.newPassword) setErrors({ next: error.fieldErrors.newPassword });
      else setNotice({ text: error instanceof ApiError ? error.message : "Couldn't change your password. Try again.", tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const signOut = (session: SignInSession) =>
    Alert.alert(`Sign out ${deviceLabel(session.userAgent)}?`, "That device will need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          setBusy(session.id);
          try {
            await endSession(session.id, accessToken);
            await load();
          } catch (error) {
            setNotice({ text: error instanceof ApiError ? error.message : "Couldn't sign that device out.", tone: "error" });
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const signOutOthers = () =>
    Alert.alert("Sign out of all other devices?", "Every device except this one will need to sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out others",
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          setBusy("others");
          try {
            const { ended } = await endOtherSessions(accessToken);
            setNotice({ text: ended ? `Signed out ${ended} other device${ended === 1 ? "" : "s"}.` : "No other devices were signed in.", tone: "success" });
            await load();
          } catch (error) {
            setNotice({ text: error instanceof ApiError ? error.message : "Couldn't sign out other devices.", tone: "error" });
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <View style={styles.root}>
      {notice ? <Banner text={notice.text} tone={notice.tone} /> : null}

      {hasPassword ? (
        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            Change password
          </Text>
          <TextField label="Current password" value={current} onChangeText={setCurrent} error={errors.current} secureTextEntry autoComplete="current-password" textContentType="password" />
          <TextField label="New password" value={next} onChangeText={setNext} error={errors.next} hint="At least 8 characters." secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} error={errors.confirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <Button label="Change password" onPress={() => void submitPassword()} busy={busy === "password"} disabled={!current || !next} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">
          Where you're signed in
        </Text>
        {loadError ? (
          <>
            <Banner text={loadError} />
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </>
        ) : sessions === null ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel="Loading devices" />
        ) : (
          <>
            {sessions.map((session) => (
              <View key={session.id} style={styles.row} accessible accessibilityLabel={`${deviceLabel(session.userAgent)}${session.current ? ", this device" : ""}, last active ${when(session.lastUsedAt)}`}>
                <View style={styles.rowText}>
                  <Text style={typography.bodyStrong}>
                    {deviceLabel(session.userAgent)}
                    {session.current ? <Text style={styles.thisDevice}>  This device</Text> : null}
                  </Text>
                  <Text style={typography.caption}>Last active {when(session.lastUsedAt)} · Signed in {when(session.createdAt)}</Text>
                </View>
                {!session.current ? (
                  <View style={styles.rowAction}>
                    <Button label="Sign out" variant="destructive" onPress={() => signOut(session)} busy={busy === session.id} />
                  </View>
                ) : null}
              </View>
            ))}
            {others.length ? <Button label="Sign out of all other devices" variant="destructive" onPress={signOutOthers} busy={busy === "others"} /> : null}
          </>
        )}
      </View>

      {events.length ? (
        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            Recent security activity
          </Text>
          {events.map((event, index) => (
            <View key={`${event.createdAt}-${index}`} style={styles.event}>
              <Text style={[typography.body, event.kind === "login_new_device" || event.kind === "login_locked" ? styles.attention : null]}>{EVENT_LABELS[event.kind]}</Text>
              <Text style={typography.caption}>
                {when(event.createdAt)}
                {event.userAgent ? ` · ${deviceLabel(event.userAgent)}` : ""}
              </Text>
            </View>
          ))}
          <Text style={typography.caption}>Don't recognize something? Change your password and sign out of all other devices.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  section: { gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
  heading: { ...typography.title, fontSize: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  rowText: { flex: 1, gap: 2 },
  rowAction: { minWidth: 110 },
  thisDevice: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  event: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  attention: { color: colors.accent },
});
