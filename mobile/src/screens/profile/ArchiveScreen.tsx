import { AddToHighlightSheet } from "../../components/AddToHighlightSheet";
import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, SectionList, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { deleteStory, getMyArchivedStories, mediaFileUrl, type PublicStory } from "../../api/stories";
import { EmptyState } from "../../components/EmptyState";
import { LoadFailed } from "../../components/LoadFailed";
import { Button } from "../../components/Form";
import { ApiError } from "../../api/client";
import { serverDate } from "../../utils/serverTime";

type Props = NativeStackScreenProps<RootStackParamList, "Archive">;

const PAGE_SIZE = 50; // the server's page limit (backend/src/http/pagination.ts); more is refused
const COLUMNS = 3;
const GAP = spacing.xs;
const CONTAINER_PADDING = spacing.md;

interface MonthSection {
  key: string;
  title: string;
  data: PublicStory[][]; // rows of up to COLUMNS stories — SectionList has no numColumns of its own
}

function monthKey(iso: string): string {
  const d = serverDate(iso);
  return d ? `${d.getFullYear()}-${d.getMonth()}` : "unknown";
}

function monthTitle(iso: string): string {
  return serverDate(iso)?.toLocaleDateString(undefined, { month: "long", year: "numeric" }) ?? "Earlier";
}

function groupByMonth(stories: PublicStory[]): MonthSection[] {
  const sections: MonthSection[] = [];
  const byKey = new Map<string, PublicStory[]>();
  for (const story of stories) {
    const key = monthKey(story.createdAt);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      sections.push({ key, title: monthTitle(story.createdAt), data: [] });
    }
    byKey.get(key)!.push(story);
  }
  for (const section of sections) {
    const stories2 = byKey.get(section.key)!;
    const rows: PublicStory[][] = [];
    for (let i = 0; i < stories2.length; i += COLUMNS) rows.push(stories2.slice(i, i + COLUMNS));
    section.data = rows;
  }
  return sections;
}

/**
 * Every Story you've ever published, expired or not (spec: a dedicated
 * private Archive, grouped by month, with multi-select). A plain tap
 * opens full-screen playback (ArchivedStoryViewerScreen — works
 * regardless of expiry, since an owner already bypasses the normal 24h
 * check for their own content); a long-press, or a tap while already
 * mid-selection, toggles selection instead — same convention as a
 * Photos-app picker. Multi-select feeds into creating a Highlight or
 * bulk deletion.
 */
export function ArchiveScreen({ navigation }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const { width: screenWidth } = useWindowDimensions();

  const [stories, setStories] = useState<PublicStory[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // A failed next page waits for a tap on "Try again" rather than retrying on every scroll.
  const [moreFailed, setMoreFailed] = useState(false);

  const load = useCallback(
    async (nextOffset: number) => {
      if (!accessToken) return;
      const { stories: fetched } = await getMyArchivedStories(accessToken, { limit: PAGE_SIZE, offset: nextOffset });
      setStories((prev) => (nextOffset === 0 ? fetched : [...(prev ?? []), ...fetched]));
      setHasMore(fetched.length === PAGE_SIZE);
      setOffset(nextOffset + fetched.length);
    },
    [accessToken],
  );

  const loadFirst = useCallback(async () => {
    setLoadFailed(false);
    try {
      await load(0);
    } catch {
      setLoadFailed(true);
    }
  }, [load]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const onEndReached = useCallback(async (retry = false) => {
    if (loadingMore || !hasMore || !accessToken || (moreFailed && !retry)) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      await load(offset);
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, accessToken, load, offset, moreFailed]);

  const sections = useMemo(() => groupByMonth(stories ?? []), [stories]);
  const thumbSize = (screenWidth - CONTAINER_PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  const toggle = (storyId: string) => {
    setSelected((current) => (current.includes(storyId) ? current.filter((id) => id !== storyId) : [...current, storyId]));
  };

  // Add the selection to a Highlight you have, or start a new one.
  const [addOpen, setAddOpen] = useState(false);
  const onCreateHighlight = () => setAddOpen(true);

  const onDelete = () => {
    if (selected.length === 0 || !accessToken) return;
    Alert.alert(
      `Delete ${selected.length} ${selected.length === 1 ? "Story" : "Stories"}?`,
      "This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            const ids = selected;
            // Each one on its own: those that went through leave the list, the rest stay selected.
            // Already gone (404, e.g. deleted on another phone) counts as done.
            const results = await Promise.allSettled(ids.map((id) => deleteStory(id, accessToken)));
            const done = ids.filter((_, i) => {
              const result = results[i]!;
              return result.status === "fulfilled" || (result.reason instanceof ApiError && result.reason.status === 404);
            });
            setStories((prev) => (prev ?? []).filter((s) => !done.includes(s.id)));
            setSelected((current) => current.filter((id) => !done.includes(id)));
            setDeleting(false);
            const failed = ids.length - done.length;
            if (failed > 0) {
              Alert.alert(
                failed === ids.length ? "Couldn't delete" : `${failed} of ${ids.length} weren't deleted`,
                "They're still selected. Check your connection and tap Delete to try again.",
              );
            }
          },
        },
      ],
    );
  };

  if (stories === null) {
    if (loadFailed) return <LoadFailed message="Couldn't load your Archive. Check your connection and try again." onRetry={() => void loadFirst()} />;
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {stories.length === 0 ? (
        <EmptyState icon="archive" title="Your Archive is empty" message="Every Story you publish stays here, even after it expires." />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row, index) => `${row[0]?.id ?? index}-row`}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={() => void onEndReached()}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.accent} style={styles.footerSpinner} />
              : moreFailed ? <View style={styles.footerSpinner}><Button label="Couldn't load more. Try again" variant="secondary" onPress={() => void onEndReached(true)} /></View>
              : undefined
          }
          renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
          renderItem={({ item: row }) => (
            <View style={[styles.row, { gap: GAP }]}>
              {row.map((story) => {
                const isSelected = selected.includes(story.id);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Archived Story, ${serverDate(story.createdAt)?.toLocaleDateString() ?? ""}`}
                    accessibilityHint={selected.length > 0 ? undefined : "Long press to select"}
                    accessibilityState={{ selected: isSelected }}
                    key={story.id}
                    onPress={() => (selected.length > 0 ? toggle(story.id) : navigation.navigate("ArchivedStoryViewer", { storyId: story.id }))}
                    onLongPress={() => toggle(story.id)}
                    style={[styles.thumbWrapper, { width: thumbSize, height: thumbSize }]}
                  >
                    <Image source={{ uri: mediaFileUrl(story.mediaId, "thumbnail"), headers: authHeaders }} style={styles.thumb} resizeMode="cover" />
                    {isSelected ? (
                      <View style={styles.selectedOverlay}>
                        <View style={styles.selectedCheck}>
                          <Icon style={styles.selectedCheckGlyph} name={ICONS.check} />
                        </View>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        />
      )}

      {selected.length > 0 ? (
        <View style={styles.actionBar}>
          <Pressable accessibilityRole="button" onPress={() => setSelected([])} hitSlop={8}>
            <Text style={styles.actionCancel}>Cancel</Text>
          </Pressable>
          <Text style={typography.caption}>{selected.length} selected</Text>
          <View style={styles.actionButtons}>
            <Pressable accessibilityRole="button" onPress={onDelete} disabled={deleting} hitSlop={8} style={styles.actionButton}>
              {deleting ? <ActivityIndicator color={colors.danger} /> : <View style={{flexDirection:"row",alignItems:"center",gap:6}}><Icon name="trash" color={colors.danger}/><Text style={styles.actionDelete}>Delete</Text></View>}
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onCreateHighlight} hitSlop={8} style={styles.actionButton}>
              <View style={{flexDirection:"row",alignItems:"center",gap:6}}><Icon name="add" color={colors.onAccent}/><Text style={styles.actionCreate}>Add to Highlight</Text></View>
            </Pressable>
          </View>
        </View>
      ) : null}
      <AddToHighlightSheet
        visible={addOpen}
        storyIds={selected}
        onClose={() => setAddOpen(false)}
        onAdded={(title) => {
          setSelected([]);
          Alert.alert("Added", `Added to ${title}.`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  listContent: { paddingHorizontal: CONTAINER_PADDING, paddingBottom: spacing.xxl, paddingTop: spacing.sm },
  sectionHeader: { ...typography.bodyStrong, marginTop: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: "row", marginBottom: GAP },
  thumbWrapper: { borderRadius: radii.sm, overflow: "hidden", backgroundColor: colors.surfaceElevated },
  thumb: { width: "100%", height: "100%" },
  selectedOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedCheck: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedCheckGlyph: { color: colors.onAccent, fontWeight: "700" },
  footerSpinner: { marginVertical: spacing.md },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionCancel: { color: colors.textSecondary },
  actionButtons: { flexDirection: "row", gap: spacing.lg },
  actionButton: {},
  actionDelete: { color: colors.danger, fontWeight: "600" },
  actionCreate: { color: colors.accent, fontWeight: "700" },
});
