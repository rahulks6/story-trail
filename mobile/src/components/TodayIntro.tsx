import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { colors, ICONS, radii, spacing, typography } from "../theme";
import type { PublicUser } from "../api/client";
import { t } from "../i18n";

/** Once per phone: the Postcard look explained on Today, the first time it opens. */
export const TODAY_INTRO_KEY = "katkee.todayIntro.seen.v1";
const onboardingKey = (userId: string) => `katkee.onboarding.done.v1.${userId}`;
/** Onboarding finished longer ago than this: the person used Katkee before the new look. */
const JUST_JOINED_MS = 30 * 60 * 1000;

/**
 * Whether to show the card, and which title: someone who used the old Katkee hears it has a new
 * look; someone who just joined gets the same three tips as a welcome.
 */
export async function todayIntroFor(user: Pick<PublicUser, "id" | "interests">, now = Date.now()): Promise<"newLook" | "welcome" | null> {
  const seen = await AsyncStorage.getItem(TODAY_INTRO_KEY).catch(() => "error");
  if (seen !== null) return null;
  const onboarded = await AsyncStorage.getItem(onboardingKey(user.id)).catch(() => null);
  if (onboarded !== null) return now - Number(onboarded) > JUST_JOINED_MS ? "newLook" : "welcome";
  // Onboarded on another phone or before the onboarding was kept: an account from before.
  return (user.interests?.length ?? 0) > 0 ? "newLook" : "welcome";
}

export function markTodayIntroSeen(): void {
  void AsyncStorage.setItem(TODAY_INTRO_KEY, String(Date.now())).catch(() => undefined);
}

/** The card itself, over the bottom of Today; "Got it" puts it away for good. */
export function TodayIntro({ user, bottom }: { user: Pick<PublicUser, "id" | "interests"> | null; bottom: number }): React.JSX.Element | null {
  const [kind, setKind] = useState<"newLook" | "welcome" | null>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void todayIntroFor(user).then((k) => { if (alive) setKind(k); });
    return () => { alive = false; };
  }, [user]);
  if (!kind) return null;
  const close = () => { setKind(null); markTodayIntroSeen(); };
  const tips: Array<[(typeof ICONS)[keyof typeof ICONS], string]> = [
    [ICONS.up, t("todayIntro.swipeUp")],
    [ICONS.profile, t("todayIntro.tapAFriend")],
    [ICONS.starFilled, t("todayIntro.memories")],
  ];
  return (
    <View style={[styles.card, { bottom }]} testID="today-intro" accessibilityViewIsModal>
      <Text style={styles.title} accessibilityRole="header">{kind === "newLook" ? t("todayIntro.newLook") : t("todayIntro.welcome")}</Text>
      {tips.map(([icon, text]) => (
        <View key={text} style={styles.tip}>
          <View style={styles.tipIcon}><Icon name={icon} size={16} color={colors.onAccent} /></View>
          <Text style={styles.tipText}>{text}</Text>
        </View>
      ))}
      <Pressable onPress={close} style={styles.button} accessibilityRole="button" testID="today-intro-done">
        <Text style={styles.buttonLabel}>{t("todayIntro.gotIt")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute", left: spacing.md, right: spacing.md, padding: spacing.lg, gap: spacing.sm, borderRadius: 22,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    shadowColor: "#503800", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  title: { ...typography.title, marginBottom: spacing.xs },
  tip: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  tipIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  tipText: { ...typography.body, flex: 1 },
  button: { marginTop: spacing.sm, alignSelf: "stretch", alignItems: "center", paddingVertical: 12, borderRadius: radii.pill, backgroundColor: colors.textPrimary },
  buttonLabel: { ...typography.body, fontWeight: "800", color: colors.background },
});
