import { Icon } from "./Icon";
import type { IconName } from "../theme/icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

interface Props {
  label: string;
  icon?: IconName;
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** One tappable row in a settings-style list — icon, label, optional trailing detail/chevron. */
export function ListRow({ label, icon, detail, destructive, disabled, onPress }: Props): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <Icon style={[styles.icon, destructive && styles.destructiveIcon]} name={icon} size={22}/> : null}
      <Text style={[typography.body, styles.label, destructive && styles.destructiveLabel]}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {!destructive ? <Icon name="chevron" size={16} color={colors.textDisabled} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceElevated },
  rowDisabled: { opacity: 0.5 },
  icon: { width: 24, textAlign: "center", marginRight: spacing.md, color: colors.textPrimary },
  destructiveIcon: { color: colors.danger },
  label: { flex: 1 },
  destructiveLabel: { color: colors.danger },
  detail: { ...typography.caption, color: colors.textSecondary, marginRight: spacing.xs },
});
