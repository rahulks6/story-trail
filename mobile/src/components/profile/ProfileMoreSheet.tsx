import React, { useRef } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing } from "../../theme";

interface Props {
  visible: boolean;
  username: string;
  isMuted: boolean;
  onClose: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onToggleMute: () => void;
  onBlock: () => void;
  onReport: () => void;
}

/**
 * Another person's page, More (Phase 10): share or copy the profile link, mute, block or report,
 * in one place instead of a line of small links under the page. The chosen action runs once
 * the sheet has closed: iOS can't show an alert or another sheet while one is still closing.
 */
export function ProfileMoreSheet({ visible, username, isMuted, onClose, onShare, onCopyLink, onToggleMute, onBlock, onReport }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const action = pending.current;
    pending.current = null;
    action?.();
  };
  const choose = (action: () => void) => {
    pending.current = action;
    onClose();
    if (Platform.OS !== "ios") runPending();
  };
  const row = (label: string, action: () => void, destructive = false) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => choose(action)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={runPending}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: spacing.md + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={1}>@{username}</Text>
          <View style={styles.group}>
            {row("Share profile", onShare)}
            {row("Copy profile link", onCopyLink)}
            {row(isMuted ? "Unmute" : "Mute", onToggleMute)}
          </View>
          <View style={styles.group}>
            {row("Block", onBlock, true)}
            {row("Report", onReport, true)}
          </View>
          <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.rowLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: spacing.sm },
  title: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: spacing.xs },
  group: { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, overflow: "hidden" },
  row: {
    minHeight: 50,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.border },
  rowLabel: { color: colors.textPrimary, fontSize: 16, textAlign: "center" },
  destructive: { color: colors.danger, fontWeight: "600" },
  cancel: { minHeight: 50, justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
});
