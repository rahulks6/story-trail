import React, { useState } from "react";
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { MAX_SAVED_ACCOUNTS } from "../state/savedAccounts";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

/**
 * Profile > tap your username: the accounts signed in on this phone (the one in use ticked), one tap
 * to switch, and Add account to sign in to another while keeping this one.
 */
export function AccountSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element {
  const { user, savedAccounts: saved, switchAccount, addAccount } = useAuth();
  const savedAccounts = saved ?? [];
  const { bottom } = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);
  const full = savedAccounts.length >= MAX_SAVED_ACCOUNTS;

  const open = async (userId: string) => {
    if (busy) return;
    setBusy(userId);
    try {
      await switchAccount(userId);
      tapFeedback("success");
      onClose();
    } catch {
      Alert.alert(t("accounts.couldntSwitch"), t("accounts.signInAgain"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">{t("accounts.title")}</Text>
          {user ? (
            <View style={styles.row} accessible accessibilityLabel={t("accounts.inUse", { username: user.username })}>
              <Avatar username={user.username} displayName={user.displayName} avatarMediaId={user.avatarMediaId} size={44} />
              <Text style={styles.name} numberOfLines={1}>{user.username}</Text>
              <View style={styles.tick}><Icon name={ICONS.check} size={14} color={colors.onAccent} /></View>
            </View>
          ) : null}
          {savedAccounts.map((account) => (
            <Pressable key={account.user.id} style={styles.row} onPress={() => void open(account.user.id)} accessibilityRole="button" accessibilityLabel={t("accounts.switchTo", { username: account.user.username })}>
              <Avatar username={account.user.username} displayName={account.user.displayName} avatarMediaId={account.user.avatarMediaId} size={44} />
              <Text style={styles.name} numberOfLines={1}>{account.user.username}</Text>
              {busy === account.user.id ? <ActivityIndicator color={colors.accentText} /> : null}
            </Pressable>
          ))}
          <Pressable
            style={styles.row}
            disabled={full || !!busy}
            onPress={() => { onClose(); void addAccount(); }}
            accessibilityRole="button"
            accessibilityState={{ disabled: full || !!busy }}
          >
            <View style={styles.add}><Icon name={ICONS.add} size={22} color={colors.textPrimary} /></View>
            <Text style={[styles.name, full && styles.muted]}>{t("accounts.add")}</Text>
          </Pressable>
          {full ? <Text style={styles.hint}>{t("accounts.full", { max: MAX_SAVED_ACCOUNTS + 1 })}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.xs },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  title: { ...typography.bodyStrong, textAlign: "center", marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  name: { ...typography.bodyStrong, flex: 1 },
  muted: { color: colors.textSecondary },
  tick: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  add: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
