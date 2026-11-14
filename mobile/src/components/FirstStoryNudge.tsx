import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { getProfile } from "../api/users";
import { colors, ICONS, radii, spacing, typography } from "../theme";
import { t } from "../i18n";

/** "Not now" keeps it away this long. */
export const FIRST_STORY_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const snoozeKey = (userId: string) => `katkee.firstStoryNudge.until.v1.${userId}`;

/**
 * On Today, for someone who has never posted: one line asking for their first Story, with a
 * button straight to the camera. Most people watch for a while before posting; a friendly ask
 * at the top of Today is the nudge that gets the first one. Gone for good once they have posted.
 */
export function FirstStoryNudge({ userId, username, accessToken, onPost, refreshKey }: {
  userId: string; username: string; accessToken: string; onPost: () => void; refreshKey?: unknown;
}): React.JSX.Element | null {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const until = await AsyncStorage.getItem(snoozeKey(userId)).catch(() => null);
      if (until && Number(until) > Date.now()) return;
      const { profile } = await getProfile(username, accessToken);
      // An older server without the count: say nothing rather than nag someone who posts.
      if (alive) setShow(profile.storyCount === 0);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [userId, username, accessToken, refreshKey]);
  if (!show) return null;
  const later = () => {
    setShow(false);
    void AsyncStorage.setItem(snoozeKey(userId), String(Date.now() + FIRST_STORY_SNOOZE_MS)).catch(() => undefined);
  };
  return (
    <View style={styles.card} testID="first-story-nudge">
      <View style={styles.text}>
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>{t("firstStory.title")}</Text>
        <Text style={styles.body} numberOfLines={2} maxFontSizeMultiplier={1.3}>{t("firstStory.body")}</Text>
      </View>
      <Pressable onPress={onPost} style={styles.post} accessibilityRole="button" accessibilityLabel={t("firstStory.post")} testID="first-story-post">
        <Icon name={ICONS.add} size={16} color={colors.onAccent} />
        <Text style={styles.postLabel} maxFontSizeMultiplier={1.2}>{t("firstStory.post")}</Text>
      </Pressable>
      <Pressable onPress={later} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.notNow")} testID="first-story-later">
        <Icon name={ICONS.close} size={16} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: 16, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  text: { flex: 1 },
  title: { ...typography.title, fontSize: 16, lineHeight: 21 },
  body: { ...typography.caption, color: colors.textSecondary },
  post: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.accent },
  postLabel: { fontSize: 14, fontWeight: "800", color: colors.onAccent },
});
