import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "../../api/notifications";
import { LoadFailed } from "../../components/LoadFailed";
import { pushPermission, registerForPush, requestPushPermission, type PushPermission } from "../../push/pushNotifications";

type Row = { key: keyof NotificationPreferences; label: string };

const PUSH_ROWS: Row[] = [
  { key: "pushEnabled", label: "Push notifications" },
  { key: "messagesEnabled", label: "New messages" },
];

const ACTIVITY_ROWS: Row[] = [
  { key: "likesEnabled", label: "Likes" },
  { key: "commentsEnabled", label: "Comments" },
  { key: "followsEnabled", label: "Follows" },
  { key: "mentionsEnabled", label: "Mentions" },
];

const STORY_ROWS: Row[] = [
  { key: "storiesEnabled", label: "New Stories from people you follow" },
  { key: "milestonesEnabled", label: "Views on your Stories" },
  { key: "remindersEnabled", label: "Festivals, streaks and reminders" },
];

const DEFAULTS: NotificationPreferences = {
  likesEnabled: true, commentsEnabled: true, followsEnabled: true, mentionsEnabled: true, messagesEnabled: true, pushEnabled: true,
  storiesEnabled: true, milestonesEnabled: true, remindersEnabled: true,
};

/**
 * Real notification settings, backed by `GET/PATCH /api/v1/notifications/preferences`.
 * Activity toggles suppress that notification type at creation time, not just a
 * client-side filter. Push toggles are checked by the server when each push is sent,
 * so they apply to every device at once. Follow requests aren't listed: they're an
 * actionable pending request, not a muteable broadcast (see notifications.repository
 * .ts's isTypeEnabled). The phone's own permission is shown too: when it's off, the
 * server can't reach this device whatever these switches say.
 */
export function NotificationSettingsScreen(): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [pending, setPending] = useState<Set<keyof NotificationPreferences>>(new Set());
  const [permission, setPermission] = useState<PushPermission | null>(null);
  // Never show made-up settings: after a failed load, say so and offer Try again.
  const [loadFailed, setLoadFailed] = useState(false);
  /** The switch whose change didn't save, shown under it. */
  const [toggleError, setToggleError] = useState<keyof NotificationPreferences | null>(null);

  const checkPermission = useCallback(() => {
    void pushPermission().then(setPermission);
  }, []);

  const load = useCallback(() => {
    if (!accessToken) return;
    setLoadFailed(false);
    getNotificationPreferences(accessToken)
      .then(({ preferences }) => setPrefs({ ...DEFAULTS, ...preferences }))
      .catch(() => setLoadFailed(true));
  }, [accessToken]);
  useEffect(load, [load]);

  // Coming back from the phone's settings may have changed the permission.
  useEffect(() => {
    checkPermission();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") checkPermission();
    });
    return () => subscription.remove();
  }, [checkPermission]);

  const onToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!accessToken || !prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value }); // optimistic
    setPending((current) => new Set(current).add(key));
    setToggleError((current) => (current === key ? null : current));
    try {
      let saved: NotificationPreferences;
      try {
        ({ preferences: saved } = await updateNotificationPreferences({ [key]: value }, accessToken));
      } catch {
        setPrefs(previous);
        setToggleError(key);
        return;
      }
      setPrefs({ ...DEFAULTS, ...saved });
      if (key === "pushEnabled" && value && user && permission === "undetermined" && (await requestPushPermission())) {
        // The setting is saved either way; this device signs up for pushes again on its next launch.
        await registerForPush(user.id, accessToken).catch(() => undefined);
        checkPermission();
      }
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  if (!prefs) {
    if (loadFailed) return <LoadFailed message="Couldn't load your notification settings. Check your connection and try again." onRetry={load} />;
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  }

  const renderRows = (rows: Row[], disabled = false) =>
    rows.map((row, index) => (
      <View key={row.key} style={[styles.row, index === rows.length - 1 && styles.rowLast]}>
        <View style={styles.rowMain}>
          <Text style={[typography.body, disabled && styles.disabledLabel]}>{row.label}</Text>
          {pending.has(row.key) ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Switch
              value={prefs[row.key]}
              disabled={disabled}
              onValueChange={(value) => void onToggle(row.key, value)}
              accessibilityLabel={row.label}
            />
          )}
        </View>
        {toggleError === row.key ? (
          <Text accessibilityRole="alert" style={styles.rowError}>Couldn't save that change. Check your connection and try again.</Text>
        ) : null}
      </View>
    ));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>Push notifications</Text>
      {permission === "denied" && prefs.pushEnabled ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Notifications are turned off for Katkee in your phone's settings.</Text>
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.noticeAction}>Open settings</Text>
          </Pressable>
        </View>
      ) : null}
      {permission === "unavailable" ? (
        <Text style={styles.hint}>This build of the app can't receive push notifications. Activity and messages still update while the app is open.</Text>
      ) : null}
      <View style={styles.card}>
        {renderRows(PUSH_ROWS.slice(0, 1))}
      </View>
      <View style={[styles.card, styles.cardSpacing]}>
        {renderRows(PUSH_ROWS.slice(1), !prefs.pushEnabled)}
      </View>
      <Text style={styles.hint}>Message notifications say who wrote to you, never what they wrote.</Text>

      <Text style={styles.sectionTitle}>Stories</Text>
      <View style={styles.card}>{renderRows(STORY_ROWS, !prefs.pushEnabled)}</View>
      <Text style={styles.hint}>At most one notification a day for each person you follow, and never more than five a day in all.</Text>

      <Text style={styles.sectionTitle}>Activity</Text>
      <Text style={styles.hint}>Choose which activity on your Stories and comments notifies you.</Text>
      <View style={styles.card}>{renderRows(ACTIVITY_ROWS)}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md, marginTop: spacing.xs },
  sectionTitle: { ...typography.bodyStrong, marginBottom: spacing.sm, marginTop: spacing.md },
  cardSpacing: { marginTop: spacing.sm },
  disabledLabel: { color: colors.textDisabled },
  notice: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  noticeText: { ...typography.caption, color: colors.textPrimary },
  noticeAction: { color: colors.accentText, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  rowLast: { borderBottomWidth: 0 },
});
