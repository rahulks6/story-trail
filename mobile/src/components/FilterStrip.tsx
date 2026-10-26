import React, { memo, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme";
import { FILTER_PREVIEWS, type FilterKey, type FilterPreview } from "../models/filterPreviews";
import { filterKey, type FilterName } from "../models/storyDraft";
import { filteredPhotoUri } from "../utils/filterPhoto";

const THUMB_EDGE = 160;

/**
 * The editor's row of filters. For a photo, each tile is the photo itself with that filter
 * applied (the same arithmetic as the published Story, utils/filterPhoto.ts); for a video, a
 * colour swatch, since frames aren't processed on the phone.
 */
export const FilterStrip = memo(function FilterStrip({
  kind,
  mediaUri,
  selected,
  onSelect,
}: {
  kind: "photo" | "video";
  mediaUri: string;
  selected: FilterName;
  onSelect: (name: FilterName) => void;
}): React.JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
      {FILTER_PREVIEWS.map((f) => {
        const active = f.name === selected;
        return (
          <Pressable
            key={f.name}
            onPress={() => onSelect(f.name)}
            style={styles.item}
            accessibilityRole="button"
            accessibilityLabel={`${f.name} filter`}
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.thumbFrame, active && styles.thumbFrameActive]}>
              {kind === "photo" ? <PhotoThumb uri={mediaUri} filter={f.name} /> : <Swatch preview={f} />}
            </View>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {f.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

/** Memoised: a tile's photo is worked out once, not again each time the strip redraws. */
const PhotoThumb = memo(function PhotoThumb({ uri, filter }: { uri: string; filter: FilterName }): React.JSX.Element {
  const [thumb, setThumb] = useState<string | null>(filter === "Original" ? uri : null);
  useEffect(() => {
    let cancelled = false;
    filteredPhotoUri(uri, filterKey(filter) as FilterKey, THUMB_EDGE)
      .then((next) => {
        if (!cancelled) setThumb(next);
      })
      .catch(() => {
        if (!cancelled) setThumb(uri);
      });
    return () => {
      cancelled = true;
    };
  }, [uri, filter]);
  return thumb ? <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.loading]} />;
});

function Swatch({ preview }: { preview: FilterPreview }): React.JSX.Element {
  return (
    <View style={[styles.thumb, styles.swatchBase]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: preview.overlayColor, opacity: Math.min(1, preview.overlayOpacity * 2.5) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingBottom: spacing.sm },
  item: { alignItems: "center", width: 58 },
  thumbFrame: { borderRadius: radii.md, borderWidth: 2, borderColor: "transparent", padding: 2 },
  thumbFrameActive: { borderColor: colors.accentText },
  thumb: { width: 50, height: 66, borderRadius: radii.sm, overflow: "hidden" },
  loading: { backgroundColor: "rgba(255,255,255,0.12)" },
  swatchBase: { backgroundColor: "#5B6170" },
  label: { marginTop: 4, color: "rgba(255,255,255,0.8)", fontSize: 11 },
  labelActive: { color: colors.textPrimary, fontWeight: "700" },
});
