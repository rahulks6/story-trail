import React from "react";
import { StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { colors, ICONS } from "../theme";

/** A group's picture: two of its people's photos, overlapping (like Instagram). */
export function GroupAvatar({ members, size = 48 }: { members: Array<{ username: string; displayName: string; avatarMediaId?: string | null }>; size?: number }): React.JSX.Element {
  const [first, second] = members;
  const small = Math.round(size * 0.68);
  if (!first) {
    return (
      <View style={[styles.empty, { width: size, height: size, borderRadius: size / 2 }]}>
        <Icon name={ICONS.dm} size={size / 2.4} color={colors.textSecondary} />
      </View>
    );
  }
  if (!second) return <Avatar username={first.username} displayName={first.displayName} avatarMediaId={first.avatarMediaId ?? null} size={size} />;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Avatar username={second.username} displayName={second.displayName} avatarMediaId={second.avatarMediaId ?? null} size={small} style={styles.back} />
      <View style={[styles.front, { borderRadius: small / 2 + 2 }]}>
        <Avatar username={first.username} displayName={first.displayName} avatarMediaId={first.avatarMediaId ?? null} size={small} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  back: { position: "absolute", top: 0, right: 0 },
  front: { position: "absolute", bottom: 0, left: 0, borderWidth: 2, borderColor: colors.background },
});
