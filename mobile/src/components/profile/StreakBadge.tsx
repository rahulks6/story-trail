import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";
import type { PostingStreak } from "../../api/festivals";

/**
 * "🔥 5-day streak" on a profile: consecutive days with a Story. On your own profile it also
 * reminds you to post today to keep it; others just see the count.
 */
export function StreakBadge({ streak, own }: { streak: PostingStreak | null | undefined; own: boolean }): React.JSX.Element | null {
  if (!streak || streak.days < 1) return null;
  const remind = own && !streak.postedToday;
  return (
    <View style={styles.badge} accessible accessibilityLabel={`${streak.days}-day posting streak${remind ? ". Post today to keep it" : ""}`}>
      <Text style={styles.label}>🔥 {streak.days}-day streak</Text>
      {remind ? <Text style={styles.hint}>Post today to keep it</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { ...typography.body, color: colors.textPrimary, fontWeight: "700" },
  hint: { ...typography.caption, color: colors.textSecondary },
});
