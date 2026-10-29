import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Pressable } from "../../components/Pressable";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { Icon } from "../../components/Icon";
import { useAuth } from "../../state/AuthContext";
import { getMyArchivedStories, mediaFileUrl, type PublicStory } from "../../api/stories";
import { createHighlight, deleteHighlight, getHighlightDetail, setHighlightCover, updateHighlight } from "../../api/highlights";
import { ApiError } from "../../api/client";
import { DraggableGrid } from "../../components/DraggableGrid";
import { firstCharacter } from "../../utils/firstCharacter";

type Props = NativeStackScreenProps<RootStackParamList, "HighlightEditor">;

const MAX_TITLE_LENGTH = 30;
const SELECTED_STRIP_COLUMNS = 5;
const SELECTED_STRIP_GAP = spacing.xs;
const ARCHIVE_PAGE_SIZE = 50;

/**
 * Create (no `highlightId`) or edit (rename/replace items/delete) a
 * Highlight, picking from the Archive — every Story you've ever
 * published, expired or not (`GET /api/v1/stories/mine/archive`), which
 * is exactly the point of an Archive existing at all.
 */
export function HighlightEditorScreen({ route, navigation }: Props): React.JSX.Element {
  // The Save button stays above Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { highlightId, initialStoryIds, chooseCover } = route.params;
  const isEditing = highlightId !== undefined;
  const { accessToken } = useAuth();
  const { width: screenWidth } = useWindowDimensions();

  const [archive, setArchive] = useState<PublicStory[] | null>(null);
  // The media of the Highlight's own Stories, which may be further back in the Archive than has loaded.
  const [itemMedia, setItemMedia] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  // Selection order matters (it becomes the Highlight's item order), so this is an ordered array, not a Set.
  const [selected, setSelected] = useState<string[]>(initialStoryIds ?? []);
  // `undefined` means "use the default cover" (the first selected item) — only ever set explicitly once the owner picks one.
  const [coverStoryId, setCoverStoryId] = useState<string | undefined>(undefined);
  const [initialCoverStoryId, setInitialCoverStoryId] = useState<string | undefined>(undefined);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [archiveHasMore, setArchiveHasMore] = useState(true);
  const [archiveLoadingMore, setArchiveLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once Create has made the Highlight, so trying again never makes a second one.
  const createdId = useRef<string | null>(null);
  // What was there when the editor opened, so leaving with changes asks first.
  const [initial, setInitial] = useState<{ title: string; selected: string[] } | null>(isEditing ? null : { title: "", selected: initialStoryIds ?? [] });
  const [done, setDone] = useState<"saved" | "deleted" | null>(null);
  const dirty =
    !!initial && !done &&
    (cleanTitle(title) !== initial.title || selected.join() !== initial.selected.join() || coverStoryId !== initialCoverStoryId);
  // Back button, Android back and the iOS swipe all come through here while changes are unsaved.
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert("Discard changes?", isEditing ? "Your changes to this Highlight won't be saved." : "This Highlight won't be created.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  // Leave only once the guard above has seen the save.
  useEffect(() => {
    if (done === "saved") navigation.goBack();
    if (done === "deleted") {
      // Opened from the Highlight itself: go back past it too, it's gone.
      const routes = navigation.getState().routes;
      const opener = routes[routes.length - 2];
      if (opener?.name === "HighlightViewer") navigation.pop(2);
      else navigation.goBack();
    }
  }, [done, navigation]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ stories }, existing] = await Promise.all([
          getMyArchivedStories(accessToken, { limit: ARCHIVE_PAGE_SIZE }),
          isEditing ? getHighlightDetail(highlightId, accessToken) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setArchive(stories);
        setArchiveOffset(stories.length);
        setArchiveHasMore(stories.length === ARCHIVE_PAGE_SIZE);
        if (existing) {
          setTitle(existing.highlight.title);
          setSelected(existing.highlight.items.map((item) => item.storyId));
          setItemMedia(Object.fromEntries(existing.highlight.items.map((item) => [item.storyId, item.mediaId])));
          const currentCover = existing.highlight.items.find((item) => item.mediaId === existing.highlight.coverMediaId);
          setCoverStoryId(currentCover?.storyId);
          setInitialCoverStoryId(currentCover?.storyId);
          setInitial({ title: existing.highlight.title, selected: existing.highlight.items.map((item) => item.storyId) });
        }
      } catch {
        if (!cancelled) setError("Couldn't load your Stories — try again.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          // "Change cover" from the profile opens straight on the choice.
          if (chooseCover) setCoverPickerOpen(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, isEditing, highlightId]);

  const loadMoreArchive = useCallback(async () => {
    if (!accessToken || archiveLoadingMore || !archiveHasMore) return;
    setArchiveLoadingMore(true);
    try {
      const { stories } = await getMyArchivedStories(accessToken, { limit: ARCHIVE_PAGE_SIZE, offset: archiveOffset });
      setArchive((current) => [...(current ?? []), ...stories]);
      setArchiveOffset((current) => current + stories.length);
      setArchiveHasMore(stories.length === ARCHIVE_PAGE_SIZE);
    } finally {
      setArchiveLoadingMore(false);
    }
  }, [accessToken, archiveLoadingMore, archiveHasMore, archiveOffset]);

  const toggle = (storyId: string) => {
    setSelected((current) =>
      current.includes(storyId) ? current.filter((id) => id !== storyId) : [...current, storyId],
    );
    // A cover can't survive its own Story leaving the selection — fall back to the default (first item) rather than point at content that's no longer in the Highlight.
    setCoverStoryId((current) => (current === storyId ? undefined : current));
  };

  // Selected Stories, in order, with their media for the reorder strip's thumbnails. Every one is
  // shown, even those older than the part of the Archive loaded below, so reordering keeps them all.
  const selectedStories = selected
    .map((id) => ({ id, mediaId: itemMedia[id] ?? (archive ?? []).find((s) => s.id === id)?.mediaId }))
    .filter((s): s is { id: string; mediaId: string } => s.mediaId !== undefined);

  const onReorderSelected = (newOrder: Array<{ id: string }>) => {
    // Anything the strip couldn't show keeps its place at the end rather than being dropped.
    const shown = newOrder.map((s) => s.id);
    setSelected((current) => [...shown, ...current.filter((id) => !shown.includes(id))]);
  };

  const onSave = async () => {
    if (!accessToken || saving) return;
    const trimmedTitle = cleanTitle(title);
    if (!trimmedTitle || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (isEditing) {
        const coverChanged = coverStoryId !== initialCoverStoryId;
        await updateHighlight(
          highlightId,
          { title: trimmedTitle, storyIds: selected, ...(coverChanged ? { coverStoryId: coverStoryId ?? null } : {}) },
          accessToken,
        );
      } else if (createdId.current) {
        // Made on an earlier tap whose last step failed: finish that one.
        await updateHighlight(createdId.current, { title: trimmedTitle, storyIds: selected, coverStoryId: coverStoryId ?? null }, accessToken);
      } else {
        const { highlight } = await createHighlight({ title: trimmedTitle, storyIds: selected }, accessToken);
        createdId.current = highlight.id;
        // A new Highlight can't be given a cover in the same request; set it straight after.
        // It exists either way, so a failed cover doesn't hold the editor open.
        if (coverStoryId) {
          try {
            await setHighlightCover(highlight.id, coverStoryId, accessToken);
          } catch {
            Alert.alert("Highlight created", "Couldn't set the cover. You can change it from your profile.");
          }
        }
      }
      setDone("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = () => {
    if (!accessToken || !isEditing) return;
    Alert.alert("Delete Highlight?", "This removes the Highlight — the Stories in it stay in your Archive.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteHighlight(highlightId, accessToken);
            setDone("deleted");
          } catch {
            setError("Couldn't delete — try again.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  }

  const canSave = cleanTitle(title).length > 0 && selected.length > 0 && !saving;
  // Three archive columns that always fit: the grid's padding plus each cell's margin on both sides.
  const archiveThumbSize = Math.floor((screenWidth - spacing.md * 2 - spacing.xs * 3) / 3);
  const selectedThumbSize =
    (screenWidth - spacing.md * 2 - SELECTED_STRIP_GAP * (SELECTED_STRIP_COLUMNS - 1)) / SELECTED_STRIP_COLUMNS;

  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const coverStory = selectedStories.find((st) => st.id === coverStoryId) ?? selectedStories[0];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* The cover, as it shows on your profile: tap to choose which Story it is. */}
        <Pressable
          onPress={() => setCoverPickerOpen(true)}
          disabled={selectedStories.length === 0}
          style={styles.coverPreview}
          accessibilityRole="button"
          accessibilityLabel="Change cover"
        >
          {coverStory ? (
            <Image source={{ uri: mediaFileUrl(coverStory.mediaId, "thumbnail"), headers: authHeaders }} style={styles.coverPreviewImage} resizeMode="cover" />
          ) : (
            <View style={styles.coverPreviewEmpty}>
              {/* The name's first letter once there is one; until then, a hint to choose Stories. */}
              {firstCharacter(cleanTitle(title)) ? (
                <Text style={styles.coverPreviewInitial}>{firstCharacter(cleanTitle(title)).toUpperCase()}</Text>
              ) : (
                <>
                  <Icon name={ICONS.gallery} size={26} color={colors.textSecondary} />
                  <Text style={styles.coverPreviewHint}>Cover</Text>
                </>
              )}
            </View>
          )}
          {selectedStories.length > 0 ? (
            <View style={styles.coverPreviewBadge}>
              <Text style={styles.coverPreviewBadgeText}>Change cover</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={styles.headerFields}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.titleInput}
            placeholder="e.g. Travel"
            placeholderTextColor={colors.textDisabled}
            value={title}
            onChangeText={setTitle}
            onBlur={() => setTitle((t) => cleanTitle(t))}
            maxLength={MAX_TITLE_LENGTH}
            autoCapitalize="words"
            returnKeyType="done"
            accessibilityLabel="Highlight name"
          />
          <Text style={styles.counter}>{cleanTitle(title).length}/{MAX_TITLE_LENGTH}</Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {selectedStories.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>In this Highlight · hold and drag to reorder</Text>
          <View style={styles.selectedStrip}>
            <DraggableGrid
              data={selectedStories}
              keyExtractor={(s) => s.id}
              columns={SELECTED_STRIP_COLUMNS}
              itemWidth={selectedThumbSize}
              itemHeight={selectedThumbSize}
              gap={SELECTED_STRIP_GAP}
              onReorder={onReorderSelected}
              renderItem={(story) => (
                <View style={styles.selectedThumbWrapper}>
                  <Image
                    source={{ uri: mediaFileUrl(story.mediaId, "thumbnail"), headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }}
                    style={styles.selectedThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderBadgeText}>{selected.indexOf(story.id) + 1}</Text>
                  </View>
                </View>
              )}
            />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionLabel}>Your Archive</Text>
      <FlatList
        data={archive ?? []}
        numColumns={3}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.grid}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMoreArchive()}
        ListEmptyComponent={<Text style={typography.caption}>No Stories in your Archive yet.</Text>}
        ListFooterComponent={archiveLoadingMore ? <ActivityIndicator color={colors.accentText} style={styles.footerSpinner} /> : undefined}
        renderItem={({ item }) => {
          const order = selected.indexOf(item.id);
          const isSelected = order !== -1;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={isSelected ? `Story ${order + 1} in this Highlight` : "Add Story"}
              style={styles.thumbWrapper}
              onPress={() => toggle(item.id)}
            >
              <Image
                source={{ uri: mediaFileUrl(item.mediaId, "thumbnail"), headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }}
                style={[styles.thumb, { width: archiveThumbSize, height: archiveThumbSize }, isSelected && styles.thumbSelected]}
                resizeMode="cover"
              />
              {isSelected ? (
                <View style={styles.orderBadge}>
                  <Text style={styles.orderBadgeText}>{order + 1}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      <Modal visible={coverPickerOpen} transparent animationType="slide" onRequestClose={() => setCoverPickerOpen(false)}>
        <Pressable pressEffect="none" style={styles.pickerBackdrop} onPress={() => setCoverPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.picker, { paddingBottom: spacing.lg + bottomInset }]}>
          <Text style={styles.pickerTitle} accessibilityRole="header">Choose a cover</Text>
          <Text style={styles.sectionHint}>Any Story in this Highlight can be its cover.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
            {selectedStories.map((story) => {
              const chosen = coverStory?.id === story.id;
              return (
                <Pressable
                  key={story.id}
                  onPress={() => {
                    setCoverStoryId(story.id);
                    setCoverPickerOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={chosen ? "Current cover" : "Use as cover"}
                  accessibilityState={{ selected: chosen }}
                >
                  <Image source={{ uri: mediaFileUrl(story.mediaId, "thumbnail"), headers: authHeaders }} style={[styles.pickerThumb, chosen && styles.pickerThumbChosen]} resizeMode="cover" />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <View style={[styles.footer, { paddingBottom: spacing.md + bottomInset }]}>
        {isEditing ? (
          <Pressable accessibilityRole="button" style={styles.deleteButton} onPress={onDelete}>
            <Text style={styles.deleteLabel}>Delete Highlight</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable accessibilityRole="button" style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} disabled={!canSave} onPress={onSave}>
          {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.saveLabel}>{isEditing ? "Save" : "Create"}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

/** A tidy name: no spaces at the ends, none doubled. */
function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  header: { flexDirection: "row", gap: spacing.md, marginHorizontal: spacing.md, alignItems: "flex-start" },
  coverPreview: { width: 84, height: 113, borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.surfaceElevated },
  coverPreviewImage: { width: "100%", height: "100%" },
  coverPreviewEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  coverPreviewInitial: { color: colors.textSecondary, fontSize: 28, fontWeight: "700" },
  coverPreviewHint: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 4 },
  coverPreviewBadge: { position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.6)" },
  coverPreviewBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", textAlign: "center" },
  headerFields: { flex: 1 },
  fieldLabel: { ...typography.label, marginBottom: spacing.xs },
  counter: { ...typography.caption, marginTop: spacing.xs },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  picker: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingTop: spacing.lg },
  pickerTitle: { ...typography.title, fontSize: 18, marginHorizontal: spacing.md, marginBottom: spacing.xs },
  pickerRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  pickerThumb: { width: 90, height: 121, borderRadius: radii.md, borderWidth: 3, borderColor: "transparent", backgroundColor: colors.surfaceElevated },
  pickerThumbChosen: { borderColor: colors.accentText },
  titleInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
  error: { color: colors.danger, marginHorizontal: spacing.md, marginTop: spacing.xs },
  sectionLabel: { ...typography.label, marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginHorizontal: spacing.md, marginBottom: spacing.xs },
  selectedStrip: { paddingHorizontal: spacing.md },
  selectedThumbWrapper: { flex: 1, borderRadius: radii.sm, overflow: "hidden", backgroundColor: colors.surfaceElevated },
  selectedThumb: { width: "100%", height: "100%" },
  grid: { paddingHorizontal: spacing.md, gap: spacing.xs },
  thumbWrapper: { margin: spacing.xs / 2 },
  thumb: {
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbSelected: { borderColor: colors.accentText, opacity: 0.85 },
  orderBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  orderBadgeText: { color: colors.onAccent, fontSize: 11, fontWeight: "700" },
  footerSpinner: { marginVertical: spacing.md },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  deleteButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  deleteLabel: { color: colors.danger, fontWeight: "600" },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    minWidth: 100,
    alignItems: "center",
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveLabel: { color: colors.onAccent, fontWeight: "700" },
});
