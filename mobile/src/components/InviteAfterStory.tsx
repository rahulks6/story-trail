import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { onStoryPublished } from "../state/storyChanges";
import { shareInvite } from "../state/invites";
import { t } from "../i18n";

const askedKey = (userId: string) => `katkee.invite.afterStory.${userId}`;
/** After the "Story shared" moment has been seen. */
const DELAY_MS = 2500;

/**
 * Right after a Story posts, once per account on a phone: "Your Story is live. Invite friends to
 * see it". The moment someone has just shared something is when they most want friends there.
 * "Not now" is an answer too: it never asks again.
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
          if (asked || AppState.currentState === "background") return;
          void AsyncStorage.setItem(askedKey(userId), String(Date.now()));
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

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.badge}><Icon name={ICONS.send} size={30} color={colors.onAccent} /></View>
          <Text style={[typography.title, styles.title]} accessibilityRole="header">{t("inviteAfterStory.title")}</Text>
          <Text style={[typography.body, styles.lead]}>{t("inviteAfterStory.lead")}</Text>
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]} onPress={invite} accessibilityRole="button">
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
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
});
