import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, mediaColors, spacing, typography, mediaTypography } from "../theme";
import type { IconName } from "../theme/icons";
import { Icon } from "./Icon";

interface EmptyStateProps {
  title: string;
  message: string;
  /** "media" for screens that are always dark (Home's Story feed, viewers), whatever the app's scheme. */
  variant?: "app" | "media";
  /** An action under the message, e.g. a "Find people" button. */
  children?: React.ReactNode;
  /** A line icon in a soft circle above the title: what this screen is for, at a glance. */
  icon?: IconName;
}

/** Shared empty/not-yet-available state — every screen needs one; see spec section 54. */
export function EmptyState({ title, message, variant = "app", children, icon }: EmptyStateProps): React.JSX.Element {
  const media = variant === "media";
  const type = media ? mediaTypography : typography;
  return (
    <View style={[styles.container, media && styles.mediaContainer]}>
      {icon ? (
        <View style={[styles.badge, media && styles.mediaBadge]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name={icon} size={30} color={media ? mediaColors.textPrimary : colors.textPrimary} />
        </View>
      ) : null}
      <Text style={[type.title, styles.title]}>{title}</Text>
      <Text style={[type.body, styles.message, media && styles.mediaMessage]}>{message}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  mediaContainer: { backgroundColor: mediaColors.background },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mediaBadge: { backgroundColor: mediaColors.surface, borderColor: mediaColors.border },
  title: {
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    color: colors.textSecondary,
  },
  mediaMessage: { color: mediaColors.textSecondary },
});
