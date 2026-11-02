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
import { serverDate } from "../../utils/serverTime";
import { t } from "../../i18n";

const EVENT_LABELS: Record<SecurityEvent["kind"], string> = {
  get login_succeeded() { return t("signInSecuritySection.signedIn"); },
  get login_failed() { return t("signInSecuritySection.wrongPasswordEntered"); },
  get login_new_device() { return t("signInSecuritySection.signedInOnANew"); },
  get login_locked() { return t("signInSecuritySection.signInPausedAfterRepeated"); },
  get password_reset_requested() { return t("signInSecuritySection.passwordResetCodeRequested"); },
  get password_reset_completed() { return t("signInSecuritySection.passwordReset"); },
  get password_changed() { return t("signInSecuritySection.passwordChanged"); },
  get session_revoked() { return t("signInSecuritySection.signedOutADevice"); },
  get sessions_revoked() { return t("signInSecuritySection.signedOutOfAllOther"); },
};

function when(iso: string): string {
  const date = serverDate(iso);
  if (!date) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t("signInSecuritySection.justNow");
  if (minutes < 60) return t("signInSecuritySection.minutesMinAgo", { minutes });
  if (minutes < 24 * 60) return t("signInSecuritySection.valueHAgo", { value: Math.round(minutes / 60) });
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
      setLoadError(error instanceof ApiError ? error.message : t("signInSecuritySection.couldntLoadYourDevicesCheck"));
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
      setNotice({ text: t("signInSecuritySection.passwordChangedOtherDevicesWere"), tone: "success" });
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setErrors({ current: error.message });
      else if (error instanceof ApiError && error.fieldErrors?.newPassword) setErrors({ next: error.fieldErrors.newPassword });
      else setNotice({ text: error instanceof ApiError ? error.message : t("signInSecuritySection.couldntChangeYourPasswordTry"), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const signOut = (session: SignInSession) =>
    Alert.alert(t("signInSecuritySection.signOutUseragent", { userAgent: deviceLabel(session.userAgent) }), t("signInSecuritySection.thatDeviceWillNeedTo"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("signInSecuritySection.signOut"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          setBusy(session.id);
          try {
            await endSession(session.id, accessToken);
            await load();
          } catch (error) {
            setNotice({ text: error instanceof ApiError ? error.message : t("signInSecuritySection.couldntSignThatDeviceOut"), tone: "error" });
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const signOutOthers = () =>
    Alert.alert(t("signInSecuritySection.signOutOfAllOther2"), t("signInSecuritySection.everyDeviceExceptThisOne"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("signInSecuritySection.signOutOthers"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          setBusy("others");
          try {
            const { ended } = await endOtherSessions(accessToken);
            setNotice({ text: ended ? `Signed out ${ended} other device${ended === 1 ? "" : "s"}.` : t("signInSecuritySection.noOtherDevicesWereSigned"), tone: "success" });
            await load();
          } catch (error) {
            setNotice({ text: error instanceof ApiError ? error.message : t("signInSecuritySection.couldntSignOutOtherDevices"), tone: "error" });
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
          <Text style={styles.heading} accessibilityRole="header">{t("signInSecuritySection.changePassword")}</Text>
          <TextField label={t("common.currentPassword")} value={current} onChangeText={setCurrent} error={errors.current} secureTextEntry autoComplete="current-password" textContentType="password" />
          <TextField label={t("common.newPassword")} value={next} onChangeText={setNext} error={errors.next} hint={t("common.atLeast8Characters")} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <TextField label={t("common.confirmNewPassword")} value={confirm} onChangeText={setConfirm} error={errors.confirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <Button label={t("signInSecuritySection.changePassword")} onPress={() => void submitPassword()} busy={busy === "password"} disabled={!current || !next} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">{t("signInSecuritySection.whereYoureSignedIn")}</Text>
        {loadError ? (
          <>
            <Banner text={loadError} />
            <Button label={t("common.tryAgain")} variant="secondary" onPress={() => void load()} />
          </>
        ) : sessions === null ? (
          <ActivityIndicator color={colors.accentText} accessibilityLabel={t("signInSecuritySection.loadingDevices")} />
        ) : (
          <>
            {sessions.map((session) => (
              <View key={session.id} style={styles.row} accessible accessibilityLabel={`${deviceLabel(session.userAgent)}${session.current ? ", this device" : ""}, last active ${when(session.lastUsedAt)}`}>
                <View style={styles.rowText}>
                  <Text style={typography.bodyStrong}>
                    {deviceLabel(session.userAgent)}
                    {session.current ? <Text style={styles.thisDevice}>{" "}{t("signInSecuritySection.thisDevice")}</Text> : null}
                  </Text>
                  <Text style={typography.caption}>{t("signInSecuritySection.lastActiveLastusedatSignedIn", { lastUsedAt: when(session.lastUsedAt), createdAt: when(session.createdAt) })}</Text>
                </View>
                {!session.current ? (
                  <View style={styles.rowAction}>
                    <Button label={t("signInSecuritySection.signOut")} variant="destructive" onPress={() => signOut(session)} busy={busy === session.id} />
                  </View>
                ) : null}
              </View>
            ))}
            {others.length ? <Button label={t("signInSecuritySection.signOutOfAllOther")} variant="destructive" onPress={signOutOthers} busy={busy === "others"} /> : null}
          </>
        )}
      </View>

      {events.length ? (
        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">{t("signInSecuritySection.recentSecurityActivity")}</Text>
          {events.map((event, index) => (
            <View key={`${event.createdAt}-${index}`} style={styles.event}>
              <Text style={[typography.body, event.kind === "login_new_device" || event.kind === "login_locked" ? styles.attention : null]}>{EVENT_LABELS[event.kind]}</Text>
              <Text style={typography.caption}>
                {when(event.createdAt)}
                {event.userAgent ? ` · ${deviceLabel(event.userAgent)}` : ""}
              </Text>
            </View>
          ))}
          <Text style={typography.caption}>{t("signInSecuritySection.dontRecognizeSomethingChangeYour")}</Text>
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
  thisDevice: { color: colors.accentText, fontSize: 13, fontWeight: "600" },
  event: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  attention: { color: colors.accentText },
});
