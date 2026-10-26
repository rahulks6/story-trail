import React from "react";
import { Modal, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Pressable } from "./Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { verificationCategoryLabel } from "../api/verification";
import { Icon } from "./Icon";

/**
 * The verified badge: a tick in a rosette, in the accent colour, about as tall as the text beside
 * it. With `onPress` it's a button (a profile's header opens what the badge means).
 */
export function VerifiedBadge({ size = 16, onPress, style }: { size?: number; onPress?: () => void; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const icon = <Icon name={ICONS.verified} size={size} color={colors.accentText} />;
  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={10} style={[styles.badge, style]} accessibilityRole="button" accessibilityLabel="Verified" accessibilityHint="Shows what the badge means">
        {icon}
      </Pressable>
    );
  }
  return <View style={[styles.badge, style]} accessible accessibilityRole="image" accessibilityLabel="Verified">{icon}</View>;
}

/**
 * A name on one line with the badge after it. The name shrinks and ends in "…" so the badge always
 * stays on the same line, right after the text.
 */
export function VerifiedName({
  name,
  verified,
  style,
  containerStyle,
  onPressBadge,
  onPress,
}: {
  name: string;
  verified?: boolean;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  onPressBadge?: () => void;
  /** For a name that's itself a link (a comment's author). */
  onPress?: () => void;
}): React.JSX.Element {
  const fontSize = StyleSheet.flatten(style)?.fontSize ?? 15;
  return (
    <View style={[styles.nameRow, containerStyle]}>
      <Text style={[style, styles.name]} numberOfLines={1} onPress={onPress}>{name}</Text>
      {verified ? <VerifiedBadge size={Math.round(fontSize * 1.05)} onPress={onPressBadge} /> : null}
    </View>
  );
}

/** What the badge means, from a profile: "Katkee confirmed this account belongs to the Creator it represents." */
export function VerifiedBadgeSheet({ visible, category, onClose }: { visible: boolean; category: string | null | undefined; onClose: () => void }): React.JSX.Element {
  const { bottom } = useSafeAreaInsets();
  const label = verificationCategoryLabel(category);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: spacing.md + bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.sheetIcon}>
            <Icon name={ICONS.verified} size={40} color={colors.accentText} />
          </View>
          <Text style={styles.title} accessibilityRole="header">Verified</Text>
          <Text style={styles.body}>
            {label
              ? `Katkee confirmed this account belongs to the ${label.toLowerCase()} it represents.`
              : "Katkee confirmed this account belongs to the person or organisation it represents."}
          </Text>
          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: { marginLeft: 4, flexShrink: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", minWidth: 0, maxWidth: "100%" },
  name: { flexShrink: 1 },
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  sheetIcon: { alignItems: "center", marginTop: spacing.sm },
  title: { ...typography.title, textAlign: "center", marginTop: spacing.sm },
  body: { ...typography.body, color: colors.textSecondary, textAlign: "center", marginTop: spacing.xs, paddingHorizontal: spacing.md },
  done: { marginTop: spacing.lg, minHeight: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  doneText: { color: colors.onAccent, fontSize: 16, fontWeight: "700" },
});
