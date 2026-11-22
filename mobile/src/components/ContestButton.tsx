import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { useAuth } from "../state/AuthContext";
import { contestDate, prizeAmount, useContest } from "../state/contest";
import { mediaColors as colors, spacing, mediaTypography as typography } from "../theme";
import { t } from "../i18n";

const introKey = (userId: string, slug: string) => `katkee.contest.intro.v1.${userId}.${slug}`;
/** After FoundingWelcome's moment, so the two never open together. */
const INTRO_AFTER_MS = 4000;

/**
 * Home's 🏆 while an invite contest is on (backend growth/contest.ts): opens the contest screen.
 * The first time someone sees it for a contest, a short intro explains the prize, once.
 */
export function ContestButton({ style, onOpen }: { style: StyleProp<ViewStyle>; onOpen: () => void }): React.JSX.Element | null {
  const { user } = useAuth();
  const { contest } = useContest();
  const [intro, setIntro] = useState(false);
  const running = contest?.state === "running";
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !contest || !running) return;
    let alive = true;
    const timer = setTimeout(() => {
      void AsyncStorage.getItem(introKey(userId, contest.slug)).then((seen) => { if (alive && !seen) setIntro(true); }, () => undefined);
    }, INTRO_AFTER_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [userId, contest, running]);
  if (!contest || !user || contest.state === "final" && !contest.winner) return null;
  const prize = prizeAmount(contest);
  const closeIntro = () => {
    setIntro(false);
    void AsyncStorage.setItem(introKey(user.id, contest.slug), "1").catch(() => undefined);
  };
  const open = () => {
    closeIntro();
    onOpen();
  };
  return (
    <>
      <Pressable onPress={open} hitSlop={8} style={style} accessibilityRole="button" accessibilityLabel={t("contest.openContest", { prize })} testID="contest-button">
        <Text style={styles.trophy}>🏆</Text>
        {contest.me.counted > 0 ? <View style={styles.badge}><Text style={styles.badgeLabel}>{contest.me.counted > 99 ? "99+" : contest.me.counted}</Text></View> : null}
      </Pressable>
      {intro ? (
        <Modal transparent animationType="fade" visible onRequestClose={closeIntro}>
          <View style={styles.backdrop}>
            <View style={styles.sheet} testID="contest-intro" accessibilityViewIsModal>
              <Text style={styles.big} accessibilityElementsHidden importantForAccessibility="no">🏆</Text>
              <Text style={styles.title} accessibilityRole="header">{t("contest.introTitle", { prize })}</Text>
              <Text style={styles.body}>{t("contest.introBody", { end: contestDate(contest.endsAt, true), days: contest.qualifyDays })}</Text>
              <Pressable onPress={open} style={styles.go} accessibilityRole="button" testID="contest-intro-open">
                <Text style={styles.goLabel}>{t("contest.letsGo")}</Text>
              </Pressable>
              <Pressable onPress={closeIntro} hitSlop={8} accessibilityRole="button" testID="contest-intro-later">
                <Text style={styles.later}>{t("contest.later")}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trophy: { fontSize: 20 },
  badge: { position: "absolute", top: -4, right: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  badgeLabel: { fontSize: 11, fontWeight: "900", color: colors.onAccent },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  sheet: { width: "100%", maxWidth: 380, alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(255,200,0,0.45)" },
  big: { fontSize: 52 },
  title: { ...typography.title, textAlign: "center", fontWeight: "900" },
  body: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  go: { alignSelf: "stretch", alignItems: "center", marginTop: spacing.sm, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.accent },
  goLabel: { fontSize: 16, fontWeight: "800", color: colors.onAccent },
  later: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.xs },
});
