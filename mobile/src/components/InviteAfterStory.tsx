import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { onStoryPublished } from "../state/storyChanges";
import { myInviteUrl, shareInvite, shareTextToWhatsApp } from "../state/invites";
import { track } from "../analytics/analytics";
import { t } from "../i18n";

const askedKey = (userId: string) => `katkee.invite.afterStory.count.v2.${userId}`;
/** Asked after each of someone's first few Stories on a phone, then never again. */
export const ASK_AFTER_STORIES = 3;
/** After the "Story shared" moment has been seen. */
const DELAY_MS = 2500;

/**
 * Right after a Story posts (someone's first few, on this phone): "Your Story is live. Share it on
 * WhatsApp", with their invite link, or Invite friends. The moment someone has just shared
 * something is when they most want friends there; whoever installs from the link is credited to
 * them. "Not now" just closes it.
 */
export function InviteAfterStory(): React.JSX.Element | null {
  const { status, user, accessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const userId = status === "signedIn" ? user?.id ?? null : null;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = onStoryPublished(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void AsyncStorage.getItem(askedKey(userId)).then((asked) => {
          const times = Number(asked) || 0;
          if (times >= ASK_AFTER_STORIES || AppState.currentState === "background") return;
          void AsyncStorage.setItem(askedKey(userId), String(times + 1));
          setVisible(true);
        }).catch(() => undefined);
      }, DELAY_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [userId]);

  if (!userId || !visible) return null;
  const close = () => setVisible(false);
  const invite = () => {
    setVisible(false);
    void shareInvite("after_story", accessToken, userId);
  };
  const whatsApp = () => {
    setVisible(false);
    if (!accessToken) return;
    void myInviteUrl(accessToken, userId)
      .then((url) => shareTextToWhatsApp(t("inviteAfterStory.whatsAppMessage", { url })))
      .then((sent) => { if (sent) track("invite_shared", { from: "after_story" }); })
      .catch(() => undefined);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.badge}><Icon name={ICONS.send} size={30} color={colors.onAccent} /></View>
          <Text style={[typography.title, styles.title]} accessibilityRole="header">{t("inviteAfterStory.title")}</Text>
          <Text style={[typography.body, styles.lead]}>{t("inviteAfterStory.leadWhatsApp")}</Text>
          <Pressable style={({ pressed }) => [styles.primary, styles.whatsApp, pressed && styles.primaryPressed]} onPress={whatsApp} accessibilityRole="button">
            <Text style={[styles.primaryLabel, styles.whatsAppLabel]}>{t("inviteAfterStory.shareOnWhatsApp")}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.primary, styles.secondaryButton, pressed && styles.primaryPressed]} onPress={invite} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{t("common.inviteFriends")}</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={close} accessibilityRole="button" accessibilityLabel={t("common.notNow")}>
            <Text style={typography.bodyStrong}>{t("common.notNow")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.lg },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  badge: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, marginVertical: spacing.md },
  title: { textAlign: "center", marginBottom: spacing.sm },
  lead: { textAlign: "center", color: colors.textSecondary, marginBottom: spacing.lg },
  primary: { minHeight: 50, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  primaryPressed: { opacity: 0.85 },
  primaryLabel: { ...typography.bodyStrong, color: colors.onAccent },
  whatsApp: { backgroundColor: "#25D366" },
  whatsAppLabel: { color: "#0B1F14" },
  secondaryButton: { marginTop: spacing.sm },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
});
