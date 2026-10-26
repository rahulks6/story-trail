import { Icon } from "./Icon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "./Pressable";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { deleteHighlight, listHighlightsForUser, reorderHighlights, type HighlightSummary } from "../api/highlights";
import { ActionSheet } from "./ActionSheet";
import { tapFeedback } from "../utils/haptics";
import { mediaFileUrl } from "../api/stories";
import { DraggableGrid } from "./DraggableGrid";
import { FadeInImage } from "./FadeInImage";
import { initialOf } from "../utils/initial";

interface Props {
  username: string;
  isOwner: boolean;
  /**
   * Called with `true` when the owner enters reorder mode, `false` when
   * they leave it — the caller (ProfileScreen.tsx/UserProfileScreen.tsx)
   * uses this to disable its own ScrollView's scrolling for exactly that
   * window. See DraggableGrid.tsx's own doc comment for why drag mode and
   * an ancestor's scroll can't both be live on the same grid at once.
   */
  onReorderModeChange?: (active: boolean) => void;
  /** How many Highlights there are once loaded, or null when they can't be shown (Phase 10's count). */
  onCountChange?: (count: number | null) => void;
  /** Changing this reloads the grid (the page was pulled to refresh). */
  refreshToken?: number;
}

const COLUMNS = 3;
/** On a tablet more Highlights fit in a row instead of each growing past this width. */
const MAX_CARD_WIDTH = 150;
const GAP = spacing.sm;
// Matches the horizontal padding both ProfileScreen and UserProfileScreen
// already apply to their container — this grid has none of its own, so
// its cards need to size against the space that padding actually leaves.
const CONTAINER_PADDING = spacing.lg;
const CARD_ASPECT_RATIO = 1.35; // portrait, not circular — spec section 62
/** The name sits under each cover, never on the photo, so it reads on any picture and in light or dark. */
const LABEL_HEIGHT = 22;

/**
 * The Highlights grid under a profile's bio (spec section 62): EXACTLY 3
 * per row, rectangular/portrait cards — explicitly not circular
 * Instagram-style bubbles, which is how this rendered before. A
 * Highlight's cover defaults to its first item's Story media, but the
 * owner can pin any of the Highlight's own items as the cover instead
 * (backend `cover_story_id`, migration 0019 — see
 * HighlightEditorScreen.tsx's star toggle). Still no separate cover-image
 * upload/crop flow: the override picks an existing item's media, not a
 * new upload.
 *
 * Your own grid can be reordered via an explicit "Reorder" toggle —
 * someone else's is always a plain grid, since only the owner's own
 * order can ever change. Drag is gated behind that toggle, not always
 * on, specifically so the profile page's own scroll still works from a
 * touch that starts on a Highlight card the rest of the time (see
 * DraggableGrid.tsx's `draggable` prop doc for the mechanics).
 */
export function HighlightsRow({ username, isOwner, onReorderModeChange, onCountChange, refreshToken }: Props): React.JSX.Element | null {
  const { accessToken } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: screenWidth } = useWindowDimensions();
  const [highlights, setHighlights] = useState<HighlightSummary[] | null>(null);
  const [reordering, setReordering] = useState(false);
  // The Highlight whose options (Edit, Delete) are open: a long press on your own, like Instagram.
  const [options, setOptions] = useState<HighlightSummary | null>(null);

  const countRef = useRef(onCountChange);
  countRef.current = onCountChange;

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { highlights: fetched } = await listHighlightsForUser(username, accessToken);
      setHighlights(fetched);
      countRef.current?.(fetched.length);
    } catch {
      setHighlights([]);
      countRef.current?.(null);
    }
  }, [accessToken, username]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (refreshToken) void load();
  }, [refreshToken, load]);

  const onReorder = useCallback(
    (newOrder: HighlightSummary[]) => {
      if (!accessToken) return;
      const previous = highlights;
      setHighlights(newOrder); // optimistic — matches what the grid already visually settled into on drop
      reorderHighlights(
        newOrder.map((h) => h.id),
        accessToken,
      ).catch(() => setHighlights(previous)); // the server's set didn't match (stale list, concurrent edit elsewhere) — fall back to what it actually has
    },
    [accessToken, highlights],
  );

  const confirmDelete = (highlight: HighlightSummary) => {
    Alert.alert(`Delete "${highlight.title}"?`, "The Stories in it stay in your Archive.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (!accessToken) return;
          setHighlights((current) => current?.filter((h) => h.id !== highlight.id) ?? current);
          deleteHighlight(highlight.id, accessToken)
            .then(() => tapFeedback("success"))
            .catch(() => {
              Alert.alert("Couldn't delete", "Check your connection and try again.");
              void load();
            });
        },
      },
    ]);
  };

  const toggleReordering = () => {
    const next = !reordering;
    setReordering(next);
    onReorderModeChange?.(next);
  };

  if (highlights === null) return null;
  if (highlights.length === 0 && !isOwner) return null;

  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const columns = Math.max(COLUMNS, Math.ceil((screenWidth - CONTAINER_PADDING * 2 + GAP) / (MAX_CARD_WIDTH + GAP)));
  const cardWidth = (screenWidth - CONTAINER_PADDING * 2 - GAP * (columns - 1)) / columns;
  const coverHeight = cardWidth * CARD_ASPECT_RATIO;
  const cardHeight = coverHeight + LABEL_HEIGHT;

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Highlights</Text>
        {isOwner && highlights.length > 0 ? (
          <Pressable
            style={styles.reorderToggle}
            onPress={toggleReordering}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={reordering ? "Done reordering Highlights" : "Reorder Highlights"}
          >
            <Text style={styles.reorderToggleLabel}>{reordering ? "Done" : "Reorder"}</Text>
          </Pressable>
        ) : null}
      </View>
      <DraggableGrid
        data={highlights}
        keyExtractor={(h) => h.id}
        columns={columns}
        itemWidth={cardWidth}
        itemHeight={cardHeight}
        gap={GAP}
        startIndex={isOwner ? 1 : 0}
        draggable={isOwner && reordering}
        onReorder={onReorder}
        itemAccessibilityLabel={(highlight) => `${highlight.title}, Highlight`}
        // Tapping a card opens it, except mid-reorder — nothing should
        // navigate away while you're in the middle of dragging cards around.
        onPress={reordering ? undefined : (highlight) => navigation.navigate("HighlightViewer", { highlightId: highlight.id, title: highlight.title })}
        onLongPress={isOwner && !reordering ? (highlight) => { tapFeedback("select"); setOptions(highlight); } : undefined}
        leadingChildren={
          isOwner ? (
            <Pressable
              style={[styles.newSlot, { width: cardWidth, height: cardHeight, left: 0, top: 0 }]}
              onPress={() => navigation.navigate("HighlightEditor", {})}
              accessibilityRole="button"
              accessibilityLabel="New Highlight"
            >
              <View style={[styles.newCard, { height: coverHeight }]}>
                <Icon style={styles.newGlyph} name={ICONS.add} />
              </View>
              <Text style={styles.label} numberOfLines={1}>New</Text>
            </Pressable>
          ) : null
        }
        renderItem={(highlight) => (
          <View style={styles.slot}>
            <View style={[styles.card, { height: coverHeight }]}>
              {highlight.coverMediaId ? (
                <FadeInImage
                  source={{ uri: mediaFileUrl(highlight.coverMediaId, "thumbnail"), headers: authHeaders }}
                  style={styles.coverImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.coverFallback}>
                  <Text style={styles.coverFallbackInitial}>{initialOf(highlight.title)}</Text>
                </View>
              )}
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {highlight.title}
            </Text>
          </View>
        )}
      />
      {isOwner && highlights.length > 0 ? (
        <Text style={styles.hint}>Press and hold a Highlight to edit or delete it.</Text>
      ) : null}
      <ActionSheet
        visible={options !== null}
        title={options?.title}
        groups={[
          [
            { label: "Edit Highlight", onPress: () => options && navigation.navigate("HighlightEditor", { highlightId: options.id }) },
            { label: "Change cover", onPress: () => options && navigation.navigate("HighlightEditor", { highlightId: options.id, chooseCover: true }) },
            { label: "Delete Highlight", destructive: true, onPress: () => options && confirmDelete(options) },
          ],
        ]}
        onClose={() => setOptions(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: "100%", marginTop: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sectionTitle: { ...typography.bodyStrong, fontSize: 16 },
  reorderToggle: { paddingVertical: spacing.xs },
  reorderToggleLabel: { ...typography.caption, color: colors.accentText, fontWeight: "700" },
  slot: { flex: 1 },
  card: {
    width: "100%",
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  coverImage: { width: "100%", height: "100%" },
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceElevated },
  coverFallbackInitial: { color: colors.textPrimary, fontWeight: "700", fontSize: 28 },
  label: { ...typography.bodyStrong, fontSize: 13, lineHeight: 18, height: LABEL_HEIGHT, paddingTop: 4, textAlign: "center" },
  newSlot: { position: "absolute" },
  newCard: {
    width: "100%",
    // A quiet filled tile, like the covers beside it, rather than a dashed outline.
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  newGlyph: { color: colors.accentText, fontSize: 28, fontWeight: "700" },
  hint: { ...typography.caption, marginTop: spacing.xs },
});
