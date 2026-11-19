import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "./Pressable";
import { useAuth } from "../state/AuthContext";
import { getProfile } from "../api/users";
import { getFoundingSpots } from "../api/growth";
import { shareInvite } from "../state/invites";
import { formatCount } from "../utils/formatCount";
import { mediaColors as colors, spacing, mediaTypography as typography } from "../theme";
import { t } from "../i18n";

const seenKey = (userId: string) => `katkee.founding.seen.v1.${userId}`;
/** Shown a moment after Home opens, not over the first frame. */
const SHOW_AFTER_MS = 1500;

/**
 * Once per account: "You're Founding member #60", with how many of the 1,000 spots are left and
 * an Invite friends button, so the badge gives people a reason to bring their friends now. Only
 * for founding members, never again after it's closed.
 */
export function FoundingWelcome(): React.JSX.Element | null {
  const { user, accessToken } = useAuth();
  const [info, setInfo] = useState<{ number: number; left: number } | null>(null);
  useEffect(() => {
    if (!user || !accessToken) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        if (await AsyncStorage.getItem(seenKey(user.id)).catch(() => "unreadable")) return;
        const { profile } = await getProfile(user.username, accessToken);
        if (!profile.foundingNumber) return;
        const spots = await getFoundingSpots(accessToken);
        if (alive) setInfo({ number: profile.foundingNumber, left: spots.left });
      })().catch(() => undefined);
    }, SHOW_AFTER_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [user, accessToken]);
  if (!info || !user) return null;
  const close = () => {
    setInfo(null);
    void AsyncStorage.setItem(seenKey(user.id), "1").catch(() => undefined);
  };
  const invite = () => {
    close();
    void shareInvite("home", accessToken, user.id);
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="founding-welcome" accessibilityViewIsModal>
          <Text style={styles.party} accessibilityElementsHidden importantForAccessibility="no">🎉</Text>
          <Text style={styles.title} accessibilityRole="header">{t("founding.youreFoundingMember", { number: info.number })}</Text>
          <Text style={styles.body}>{t("founding.onlyTheFirst1000")}</Text>
          {info.left > 0 ? <Text style={styles.left}>{t("founding.spotsLeft", { count: info.left, left: formatCount(info.left) })}</Text> : null}
          <Pressable onPress={invite} style={styles.invite} accessibilityRole="button" testID="founding-invite">
            <Text style={styles.inviteLabel}>{t("common.inviteFriends")}</Text>
          </Pressable>
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button" testID="founding-close">
            <Text style={styles.close}>{t("founding.gotIt")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  sheet: { width: "100%", maxWidth: 380, alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(255,200,0,0.45)" },
  party: { fontSize: 48 },
  title: { ...typography.title, textAlign: "center", fontWeight: "900" },
  body: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  left: { ...typography.body, color: colors.accentText, fontWeight: "800", textAlign: "center" },
  invite: { alignSelf: "stretch", alignItems: "center", marginTop: spacing.sm, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.accent },
  inviteLabel: { fontSize: 16, fontWeight: "800", color: colors.onAccent },
  close: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.xs },
});
