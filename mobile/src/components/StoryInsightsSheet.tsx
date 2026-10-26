import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { colors, radii, spacing, typography } from "../theme";
import { timeAgo } from "../utils/serverTime";
import { useAuth } from "../state/AuthContext";
import { getStoryInsights, getStoryViewers, type StoryInsights, type StoryViewer } from "../api/stories";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";

interface Props {
  visible: boolean;
  storyId: string;
  onClose: () => void;
}

function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.statRow}>
      <Text style={[typography.caption, styles.statLabel]}>{label}</Text>
      <Text style={typography.bodyStrong}>{value}</Text>
    </View>
  );
}

/**
 * Owner-only Story Insights (spec): the real count and identities
 * (StoryFeed's small "eye" figure is visible to any viewer; who's behind
 * it, and everything in this sheet, is strictly owner-only — the backend
 * rejects both endpoints outright for anyone else). Completion rate,
 * following-vs-discovery split, and profile-visit rate all come from
 * real recorded events (see backend/src/modules/stories/stories.repository.ts's
 * getStoryInsights) — not invented numbers, but honestly-scoped
 * approximations where the schema genuinely can't be exact (see that
 * function's own comment on "following" meaning *current* relationship,
 * not relationship-at-view-time).
 */
export function StoryInsightsSheet({ visible, storyId, onClose }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [insights, setInsights] = useState<StoryInsights | null>(null);
  const [viewers, setViewers] = useState<StoryViewer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewersDone, setViewersDone] = useState(true);
  const loadingMore = useRef(false);
  // Viewers come a page at a time; more load as the list scrolls.
  const loadMoreViewers = useCallback(async () => {
    if (!accessToken || viewersDone || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const { viewers: more } = await getStoryViewers(storyId, accessToken, { limit: VIEWERS_PAGE, offset: viewers.length });
      setViewers((current) => [...current, ...more.filter((v) => !current.some((c) => c.id === v.id))]);
      setViewersDone(more.length < VIEWERS_PAGE);
    } catch {
      // Scrolling again retries.
    } finally {
      loadingMore.current = false;
    }
  }, [accessToken, storyId, viewers.length, viewersDone]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [{ insights: fetchedInsights }, { viewers: fetchedViewers }] = await Promise.all([
        getStoryInsights(storyId, accessToken),
        getStoryViewers(storyId, accessToken, { limit: VIEWERS_PAGE }),
      ]);
      setInsights(fetchedInsights);
      setViewers(fetchedViewers);
      setViewersDone(fetchedViewers.length < VIEWERS_PAGE);
    } catch {
      setError("Couldn't load Insights.");
    } finally {
      setLoading(false);
    }
  }, [storyId, accessToken]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + bottomInset }]}>
        <View style={styles.handle} />
        <Text style={[typography.bodyStrong, styles.title]}>Insights</Text>

        {loading ? (
          <ActivityIndicator color={colors.accentText} style={{ marginTop: spacing.lg }} />
        ) : error ? (
          <Text style={[typography.caption, styles.empty]}>{error}</Text>
        ) : !insights || insights.viewCount === 0 ? (
          <Text style={[typography.caption, styles.empty]}>No views yet.</Text>
        ) : (
          <>
            <View style={styles.stats}>
              <StatRow label="Views" value={String(insights.viewCount)} />
              <StatRow label="Completed" value={`${insights.completionRate}%`} />
              <StatRow label="Following" value={`${insights.followingViewRate}%`} />
              <StatRow label="Discovery" value={`${insights.discoveryViewRate}%`} />
              <StatRow label="Visited your profile" value={`${insights.profileVisitRate}%`} />
            </View>

            <Text style={[typography.label, styles.viewersHeader]}>Viewed by {Math.max(insights.viewCount, viewers.length)}</Text>
            <FlatList
              data={viewers}
              keyExtractor={(v) => v.id}
              onEndReachedThreshold={0.5}
              onEndReached={() => void loadMoreViewers()}
              style={styles.list}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId} size={28} />
                  <VerifiedName name={`@${item.username}`} verified={item.verified} style={typography.bodyStrong} containerStyle={styles.viewerName} />
                  <Text style={[typography.caption, styles.viewedAt]}>{timeAgo(item.viewedAt)}</Text>
                </View>
              )}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const VIEWERS_PAGE = 50;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: "75%",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { textAlign: "center", marginBottom: spacing.sm },
  empty: { textAlign: "center", marginVertical: spacing.lg },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statRow: { width: "30%", gap: 2 },
  statLabel: { color: colors.textSecondary },
  viewersHeader: { marginTop: spacing.sm, marginBottom: spacing.xs },
  list: { maxHeight: 280 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  viewedAt: { marginLeft: "auto", color: colors.textDisabled },
  viewerName: { flexShrink: 1 },
});
