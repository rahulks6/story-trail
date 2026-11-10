import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { useAddProfilePhoto } from "./AddProfilePhoto";
import { useAuth } from "../state/AuthContext";
import { mediaColors as colors, spacing, mediaTypography as typography } from "../theme";
import { t } from "../i18n";

/** "Not now" keeps the card away this long. */
export const NUDGE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const snoozeKey = (userId: string) => `katkee.photoNudge.until.v1.${userId}`;

/**
 * A small card on Home for someone without a profile photo: friends recognise a face before a
 * username, in Stories, chats and search. Two taps to add one; "Not now" hides it for a week.
 */
export function ProfilePhotoNudge(): React.JSX.Element | null {
  const { user } = useAuth();
  const [snoozed, setSnoozed] = useState<boolean | null>(null);
  const photo = useAddProfilePhoto();

  useEffect(() => {
    if (!user) return;
    let alive = true;
    AsyncStorage.getItem(snoozeKey(user.id))
      .then((until) => { if (alive) setSnoozed(!!until && Number(until) > Date.now()); })
      .catch(() => { if (alive) setSnoozed(false); });
    return () => { alive = false; };
  }, [user]);

  if (!user || user.avatarMediaId || snoozed !== false) return photo.busy ? photo.element : null;

  const ask = () =>
    Alert.alert(t("profile.addProfilePhoto"), undefined, [
      { text: t("onboarding.choosePhoto"), onPress: () => void photo.choose("library") },
      { text: t("onboarding.takeASelfie"), onPress: () => void photo.choose("camera") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  const later = () => {
    setSnoozed(true);
    void AsyncStorage.setItem(snoozeKey(user.id), String(Date.now() + NUDGE_SNOOZE_MS)).catch(() => undefined);
  };

  return (
    <View style={styles.card}>
      <Avatar username={user.username} displayName={user.displayName} avatarMediaId={null} size={48} />
      <View style={styles.text}>
        <Text style={styles.title}>{t("profile.addProfilePhoto")}</Text>
        <Text style={styles.body} numberOfLines={2}>{photo.error ?? t("profile.friendsRecogniseYouFaster")}</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={ask} disabled={photo.busy} style={styles.add} accessibilityRole="button" accessibilityLabel={t("profile.addProfilePhoto")}>
          <Text style={styles.addLabel}>{photo.busy ? t("profile.saving") : t("profile.addPhoto")}</Text>
        </Pressable>
        <Pressable onPress={later} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.notNow")}>
          <Text style={styles.later}>{t("common.notNow")}</Text>
        </Pressable>
      </View>
      {photo.element}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.md, padding: spacing.md, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.07)" },
  text: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: "800" },
  body: { ...typography.caption, color: colors.textSecondary },
  buttons: { alignItems: "center", gap: spacing.xs },
  add: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.accent },
  addLabel: { fontSize: 14, fontWeight: "800", color: colors.onAccent },
  later: { ...typography.caption, color: colors.textSecondary },
});
