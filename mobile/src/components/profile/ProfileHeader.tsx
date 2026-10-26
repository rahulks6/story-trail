import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../Pressable";
import { Avatar } from "../Avatar";
import { Icon } from "../Icon";
import { VerifiedBadgeSheet, VerifiedName } from "../VerifiedBadge";
import { colors, radii, spacing, ICONS } from "../../theme";
import { countLabel, formatCount } from "../../utils/formatCount";

export interface ProfileStat {
  key: string;
  /** null while loading, or when it can't be known (a private account you don't follow). */
  value: number | null;
  singular: string;
  plural: string;
  onPress?: () => void;
}

interface Props {
  username: string;
  displayName: string;
  bio: string;
  interests: string[];
  avatarMediaId: string | null;
  isPrivate: boolean;
  /** The badge after the name; tapping it explains it, naming the category. */
  verified?: boolean;
  verifiedCategory?: string | null;
  /** An active Story: the amber ring shows, and tapping the photo opens it. */
  hasActiveStory: boolean;
  storyLabel: string;
  onOpenStory?: () => void;
  /** Your own page without an active Story: a "+" on the photo starts one. */
  onAddStory?: () => void;
  followsYou?: boolean;
  stats: ProfileStat[];
  /** The page's buttons, under the bio. */
  children?: React.ReactNode;
}

export const PHOTO_SIZE = 86;
const RING_WIDTH = 3;
const RING_GAP = 3;
const RING_SIZE = PHOTO_SIZE + (RING_WIDTH + RING_GAP) * 2;

/**
 * The top of a creator page (Phase 10), shared by your own page and other people's: the photo in
 * its Story ring, the counts, name, username, bio and interests, then the page's buttons.
 * Stories open only from the photo (spec sections 34 and 58); there is no grid of posts.
 */
export function ProfileHeader({
  username, displayName, bio, interests, avatarMediaId, isPrivate, verified, verifiedCategory, hasActiveStory, storyLabel,
  onOpenStory, onAddStory, followsYou, stats, children,
}: Props): React.JSX.Element {
  const [badgeSheetOpen, setBadgeSheetOpen] = useState(false);
  const photo = (
    <View style={[styles.ring, hasActiveStory && styles.ringActive]}>
      <Avatar username={username} displayName={displayName} avatarMediaId={avatarMediaId} size={PHOTO_SIZE} />
    </View>
  );
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View>
          {hasActiveStory && onOpenStory ? (
            <Pressable onPress={onOpenStory} hitSlop={4} accessibilityRole="button" accessibilityLabel={storyLabel}>
              {photo}
            </Pressable>
          ) : (
            <View accessible accessibilityLabel={`${displayName}, profile photo`}>
              {photo}
            </View>
          )}
          {!hasActiveStory && onAddStory ? (
            <Pressable style={styles.addBadge} onPress={onAddStory} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add to your Story">
              <Icon name={ICONS.add} size={14} color={colors.onAccent} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.stats}>
          {stats.map((stat) => {
            const label = stat.value === 1 ? stat.singular : stat.plural;
            const spoken = stat.value === null ? stat.plural : countLabel(stat.value, stat.singular.toLowerCase(), stat.plural.toLowerCase());
            const content = (
              <>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{stat.value === null ? "—" : formatCount(stat.value)}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
              </>
            );
            return stat.onPress && stat.value !== null ? (
              <Pressable key={stat.key} style={styles.stat} onPress={stat.onPress} accessibilityRole="button" accessibilityLabel={spoken}>
                {content}
              </Pressable>
            ) : (
              <View key={stat.key} style={styles.stat} accessible accessibilityLabel={spoken}>
                {content}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.identity}>
        <VerifiedName name={displayName} verified={verified} style={styles.displayName} onPressBadge={() => setBadgeSheetOpen(true)} />
        <View style={styles.handleRow}>
          <Text style={styles.handle} numberOfLines={1}>@{username}</Text>
          {isPrivate ? (
            <View accessible accessibilityLabel="Private account">
              <Icon name={ICONS.privacy} size={13} color={colors.textSecondary} />
            </View>
          ) : null}
          {followsYou ? <Text style={styles.followsYou}>Follows you</Text> : null}
        </View>
        {bio ? <Text style={styles.bio}>{bio}</Text> : null}
        {interests.length > 0 ? (
          <View style={styles.chips}>
            {interests.map((interest) => (
              <Text key={interest} style={styles.chip}>{interest}</Text>
            ))}
          </View>
        ) : null}
      </View>

      {children}
      {verified ? <VerifiedBadgeSheet visible={badgeSheetOpen} category={verifiedCategory} onClose={() => setBadgeSheetOpen(false)} /> : null}
    </View>
  );
}

/** What a creator page shows while it loads: its shape, without numbers that aren't known yet. */
export function ProfileSkeleton(): React.JSX.Element {
  return (
    <View style={styles.container} accessible accessibilityLabel="Loading profile">
      <View style={styles.topRow}>
        <View style={[styles.ring, styles.bone]} />
        <View style={styles.stats}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.stat}>
              <View style={[styles.bone, styles.boneValue]} />
              <View style={[styles.bone, styles.boneLabel]} />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.identity}>
        <View style={[styles.bone, styles.boneName]} />
        <View style={[styles.bone, styles.boneHandle]} />
      </View>
      <View style={styles.boneButtons}>
        <View style={[styles.bone, styles.boneButton]} />
        <View style={[styles.bone, styles.boneButton]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", gap: spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_WIDTH,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  ringActive: { borderColor: colors.accentText },
  addBadge: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  stats: { flex: 1, minWidth: 0, flexDirection: "row", justifyContent: "space-around" },
  // Each stat shares the row equally and may shrink, so small phones and large text never overflow.
  stat: { flex: 1, minWidth: 0, alignItems: "center", paddingVertical: spacing.xs, gap: 2 },
  statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
  statLabel: { color: colors.textSecondary, fontSize: 13 },
  identity: { gap: spacing.xs },
  displayName: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  handleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  handle: { color: colors.textSecondary, fontSize: 14, flexShrink: 1 },
  followsYou: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  bio: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    overflow: "hidden",
  },
  bone: { backgroundColor: colors.surfaceElevated, borderRadius: radii.sm },
  boneValue: { width: 34, height: 18 },
  boneLabel: { width: 56, height: 12, marginTop: 4 },
  boneName: { width: 140, height: 16 },
  boneHandle: { width: 100, height: 12 },
  boneButtons: { flexDirection: "row", gap: spacing.sm },
  boneButton: { flex: 1, height: 36 },
});
