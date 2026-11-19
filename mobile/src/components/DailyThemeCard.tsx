import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { useAuth } from "../state/AuthContext";
import { getTodayTheme, type TodayTheme } from "../api/growth";
import { getProfile } from "../api/users";
import { mediaColors as colors, spacing, mediaTypography as typography } from "../theme";
import { t } from "../i18n";

const hiddenKey = (userId: string) => `katkee.dailyTheme.hidden.v1.${userId}`;

/**
 * Today's theme on Home (backend themes/daily-themes.ts): one easy idea for a Story, the same for
 * everyone today, so there's always something to post. Only for someone who has posted before
 * (FirstStoryNudge asks for a first Story instead) and hasn't posted today. "Not today" hides it
 * until tomorrow's theme.
 */
export function DailyThemeCard({ onPost }: { onPost: () => void }): React.JSX.Element | null {
  const { user, accessToken } = useAuth();
  const [theme, setTheme] = useState<TodayTheme | null>(null);
  useEffect(() => {
    if (!user || !accessToken) return;
    let alive = true;
    const controller = new AbortController();
    void (async () => {
      const [today, hidden, { profile }] = await Promise.all([
        getTodayTheme(accessToken, controller.signal),
        AsyncStorage.getItem(hiddenKey(user.id)).catch(() => null),
        getProfile(user.username, accessToken),
      ]);
      if (alive && !today.postedToday && hidden !== today.date && (profile.storyCount ?? 0) > 0) setTheme(today);
    })().catch(() => undefined);
    return () => { alive = false; controller.abort(); };
  }, [user, accessToken]);
  if (!theme || !user) return null;
  const hide = () => {
    setTheme(null);
    void AsyncStorage.setItem(hiddenKey(user.id), theme.date).catch(() => undefined);
  };
  return (
    <View style={styles.card} testID="daily-theme">
      <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">{theme.emoji}</Text>
      <View style={styles.text}>
        <Text style={styles.label}>{t("dailyTheme.todaysTheme")}</Text>
        <Text style={styles.title} numberOfLines={2}>{theme.title}</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={onPost} style={styles.post} accessibilityRole="button" accessibilityLabel={t("dailyTheme.postForTheme", { theme: theme.title })} testID="daily-theme-post">
          <Text style={styles.postLabel}>{t("firstStory.post")}</Text>
        </Pressable>
        <Pressable onPress={hide} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("dailyTheme.notToday")} testID="daily-theme-hide">
          <Text style={styles.later}>{t("dailyTheme.notToday")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.md, padding: spacing.md, borderRadius: 16, backgroundColor: "rgba(255,200,0,0.12)", borderWidth: 1, borderColor: "rgba(255,200,0,0.35)" },
  emoji: { fontSize: 34, width: 44, textAlign: "center" },
  text: { flex: 1, gap: 2 },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  title: { ...typography.body, fontWeight: "800" },
  buttons: { alignItems: "center", gap: spacing.xs },
  post: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.accent },
  postLabel: { fontSize: 14, fontWeight: "800", color: colors.onAccent },
  later: { ...typography.caption, color: colors.textSecondary },
});
