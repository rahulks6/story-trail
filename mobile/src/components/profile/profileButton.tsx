import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { Icon } from "../Icon";
import { colors, radii, spacing } from "../../theme";
import type { IconName } from "../../theme/icons";

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** "primary" (amber) for the page's main action, such as Follow. */
  variant?: "primary" | "secondary";
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/**
 * A creator-page button. Rendered by a function rather than a component so the button in the
 * tree is the pressable itself.
 */
export function profileButton({ label, onPress, variant = "secondary", busy = false, disabled = false, accessibilityLabel }: ButtonProps): React.JSX.Element {
  const primary = variant === "primary";
  const off = busy || disabled;
  return (
    <Pressable
      key={label}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        pressed && (primary ? styles.primaryPressed : styles.secondaryPressed),
        off && styles.dim,
      ]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: off }}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.textPrimary} />
      ) : (
        <Text style={primary ? styles.primaryLabel : styles.secondaryLabel} numberOfLines={1}>{label}</Text>
      )}
    </Pressable>
  );
}

/** A square icon button beside the others, such as More. */
export function profileIconButton({ icon, accessibilityLabel, onPress }: { icon: IconName; accessibilityLabel: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      key={accessibilityLabel}
      style={({ pressed }) => [styles.iconButton, pressed && styles.secondaryPressed]}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon name={icon} size={18} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flex: 1, minHeight: 36, borderRadius: radii.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  primary: { backgroundColor: colors.accent },
  primaryPressed: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: colors.surfaceElevated },
  secondaryPressed: { backgroundColor: colors.border },
  dim: { opacity: 0.6 },
  primaryLabel: { color: colors.onAccent, fontSize: 14, fontWeight: "700" },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  iconButton: { width: 36, minHeight: 36, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
});
