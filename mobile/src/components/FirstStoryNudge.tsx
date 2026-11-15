import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { useAuth } from "../state/AuthContext";
import { getProfile } from "../api/users";
import { mediaColors as colors, spacing, mediaTypography as typography, ICONS } from "../theme";
import { t } from "../i18n";

/** "Not now" keeps the card away this long. */
export const FIRST_STORY_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const snoozeKey = (userId: string) => `katkee.firstStoryNudge.until.v1.${userId}`;

/**
 * For someone who has never posted, where Home's Stories run out: a friendly ask for their first
 * Story, one tap to the camera. Most people watch for a while before they post; this is the moment
 * they've just seen everyone else's. Gone for good once they've posted.
 */
export function FirstStoryNudge({ onPost }: { onPost: () => void }): React.JSX.Element | null {
  const { user, accessToken } = useAuth();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!user || !accessToken) return;
    let alive = true;
    void (async () => {
      const until = await AsyncStorage.getItem(snoozeKey(user.id)).catch(() => null);
      if (until && Number(until) > Date.now()) return;
      const { profile } = await getProfile(user.username, accessToken);
      // A server without the count: say nothing rather than nag someone who posts.
      if (alive) setShow(profile.storyCount === 0);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [user, accessToken]);
  if (!show || !user) return null;
  const later = () => {
    setShow(false);
    void AsyncStorage.setItem(snoozeKey(user.id), String(Date.now() + FIRST_STORY_SNOOZE_MS)).catch(() => undefined);
  };
  return (
    <View style={styles.card} testID="first-story-nudge">
      <View style={styles.icon}><Icon name={ICONS.add} size={22} color={colors.onAccent} /></View>
      <View style={styles.text}>
        <Text style={styles.title}>{t("firstStory.yourTurn")}</Text>
        <Text style={styles.body} numberOfLines={2}>{t("firstStory.shareYourFirstStory")}</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={onPost} style={styles.post} accessibilityRole="button" accessibilityLabel={t("firstStory.postAStory")} testID="first-story-post">
          <Text style={styles.postLabel}>{t("firstStory.post")}</Text>
        </Pressable>
        <Pressable onPress={later} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.notNow")} testID="first-story-later">
          <Text style={styles.later}>{t("common.notNow")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.md, padding: spacing.md, borderRadius: 16, backgroundColor: "rgba(255,200,0,0.12)", borderWidth: 1, borderColor: "rgba(255,200,0,0.35)" },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  text: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: "800" },
  body: { ...typography.caption, color: colors.textSecondary },
  buttons: { alignItems: "center", gap: spacing.xs },
  post: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.accent },
  postLabel: { fontSize: 14, fontWeight: "800", color: colors.onAccent },
  later: { ...typography.caption, color: colors.textSecondary },
});
