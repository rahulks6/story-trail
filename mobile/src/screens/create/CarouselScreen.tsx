import React, { forwardRef, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Pressable } from "../../components/Pressable";
import { Icon } from "../../components/Icon";
import { MusicSheet, type ChosenMusic } from "../../components/MusicSheet";
import { loadStorySettings, DEFAULT_STORY_SETTINGS, type StorySettings } from "../../components/StorySettingsSheet";
import { mediaColors as colors, radii, spacing, ICONS } from "../../theme";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import { useAuth } from "../../state/AuthContext";
import { enqueueUpload } from "../../state/uploadQueue";
import { DEFAULT_CROP, filterKey, type FilterName } from "../../models/storyDraft";
import { FILTER_PREVIEWS, type FilterKey } from "../../models/filterPreviews";
import { filteredPhotoUri } from "../../utils/filterPhoto";
import { captureRef } from "react-native-view-shot";
import { initialFrame, isFramed } from "../../models/photoFrame";
import type { CreateStackParamList, RootStackParamList } from "../../navigation/types";
import { tapFeedback } from "../../utils/haptics";
import { filterLabel } from "../../i18n/names";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<CreateStackParamList, "Carousel">;
export type CarouselPhoto = CreateStackParamList["Carousel"]["photos"][number];

/** Most photos shared at once: the upload queue holds ten Stories waiting. */
export const MAX_CAROUSEL_PHOTOS = 10;
const CAPTION_MAX = 2200;

type Size = { width: number; height: number };
type ViewRef = React.ComponentRef<typeof View>;

/** A photo wider than a Story is shown whole on a blur of itself (nothing cut), like the editor. */
function fits(size: Size | undefined, frameW: number, frameH: number): boolean {
  return !!size && isFramed(initialFrame(frameW, frameH, size.width, size.height));
}

/** The photo as its Story will look: filling the frame, or whole on a blur when it's wider. */
function Composition({ uri, fit }: { uri: string; fit: boolean }): React.JSX.Element {
  if (!fit) return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />;
  return (
    <>
      <Image source={{ uri }} blurRadius={40} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.blurShade]} />
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityIgnoresInvertColors />
    </>
  );
}

/**
 * One photo of the carousel. The unfiltered composition underneath is what gets saved for a
 * wide photo (the server applies the filter); the filtered preview (the same colour transform
 * the server uses) is drawn over it.
 */
const Page = forwardRef<ViewRef, { photo: CarouselPhoto; filter: FilterName; width: number; height: number; size: Size | undefined; onSize: (size: Size) => void }>(
  function Page({ photo, filter, width, height, size, onSize }, shot) {
    const [uri, setUri] = useState(photo.uri);
    useEffect(() => {
      let alive = true;
      if (filter === "Original") {
        setUri(photo.uri);
        return;
      }
      filteredPhotoUri(photo.uri, filterKey(filter) as FilterKey, 1080)
        .then((filtered) => { if (alive) setUri(filtered); })
        .catch(() => { if (alive) setUri(photo.uri); });
      return () => { alive = false; };
    }, [photo.uri, filter]);
    const frameW = width - spacing.lg * 2;
    const fit = fits(size, frameW, height);
    return (
      <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
        <View style={[styles.frame, { width: frameW, height }]}>
          <View ref={shot} collapsable={false} style={StyleSheet.absoluteFill}>
            <Composition uri={photo.uri} fit={fit} />
          </View>
          {uri !== photo.uri ? <View style={StyleSheet.absoluteFill} pointerEvents="none"><Composition uri={uri} fit={fit} /></View> : null}
          {/* Measures the photo as decoded (the right way up). */}
          <Image source={{ uri: photo.uri }} style={styles.measure} onLoad={(e) => { const { width: w, height: h } = e.nativeEvent.source ?? {}; if (w && h && (size?.width !== w || size?.height !== h)) onSize({ width: w, height: h }); }} />
        </View>
      </View>
    );
  },
);

/**
 * Several photos shared at once as a run of Stories, one after another (Instagram's "select
 * multiple"). One filter and one song for all of them, a caption on the first; each photo is
 * its own Story, sent through the same upload queue as the editor, in the order shown.
 */
export function CarouselScreen({ navigation, route }: Props): React.JSX.Element {
  useMediaStatusBar();
  const insets = useScreenInsets();
  const { width, height } = useWindowDimensions();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, accessToken } = useAuth();
  const [photos, setPhotos] = useState<CarouselPhoto[]>(() => route.params.photos.slice(0, MAX_CAROUSEL_PHOTOS));
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState<FilterName>("Original");
  const [music, setMusic] = useState<ChosenMusic | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [settings, setSettings] = useState<StorySettings>(DEFAULT_STORY_SETTINGS);
  const [sharing, setSharing] = useState(false);
  const pager = useRef<FlatList<CarouselPhoto>>(null);
  const shots = useRef<Map<string, ViewRef>>(new Map());
  const [sizes, setSizes] = useState<Record<string, Size>>({});

  useEffect(() => { void loadStorySettings().then(setSettings); }, []);
  // Every photo removed: nothing left to share.
  useEffect(() => { if (photos.length === 0) navigation.goBack(); }, [photos.length, navigation]);

  const pageHeight = Math.max(240, height - insets.top - insets.bottom - 330);

  const remove = (at: number) => {
    tapFeedback("select");
    setPhotos((current) => current.filter((_, i) => i !== at));
    setIndex((i) => Math.max(0, Math.min(i, photos.length - 2)));
  };

  const share = async (audience: "public" | "followers" | "close_friends") => {
    if (sharing || photos.length === 0) return;
    if (!user || !accessToken) {
      Alert.alert(t("common.checkYourConnectionAndTry"));
      return;
    }
    setSharing(true);
    try {
      // In order, so the Stories post one after another as shown (the queue sends oldest first).
      for (const [i, photo] of photos.entries()) {
        // A wide photo is saved whole on its blur, exactly as shown; a tall one goes as it is.
        let uri = photo.uri, mimeType = photo.mimeType;
        const shot = shots.current.get(photo.uri);
        if (fits(sizes[photo.uri], width - spacing.lg * 2, pageHeight) && shot) {
          const file = await captureRef(shot, { format: "jpg", quality: 0.92, width: 1080, height: Math.round((1080 * pageHeight) / (width - spacing.lg * 2)), result: "tmpfile" });
          uri = file.startsWith("file://") ? file : `file://${file}`;
          mimeType = "image/jpeg";
        }
        await enqueueUpload(user.id, uri, "photo", mimeType, {
          caption: i === 0 ? caption.trim() : "",
          audience,
          allowComments: settings.allowComments,
          allowSharing: settings.allowSharing,
          overlays: [],
          drawing: [],
          filter: filterKey(filter),
          audioMuted: false,
          crop: DEFAULT_CROP,
          ...(music ? { music: { trackId: music.track.id, startMs: music.startMs, durationMs: music.durationMs } } : {}),
        });
      }
      tapFeedback("success");
      rootNavigation.reset({ index: 0, routes: [{ name: "Main" }] });
    } catch (err) {
      setSharing(false);
      Alert.alert(t("carousel.couldntShare"), err instanceof Error ? err.message : undefined);
    }
  };

  const yourStory = settings.visibility === "followers" ? "followers" : "public";

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.round} accessibilityRole="button" accessibilityLabel={t("common.close")}>
          <Icon name={ICONS.close} size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{t("carousel.title")}</Text>
        <Text style={styles.counter} accessibilityLabel={t("carousel.photoNOfCount", { n: index + 1, count: photos.length })}>{`${index + 1}/${photos.length}`}</Text>
      </View>

      <FlatList
        ref={pager}
        data={photos}
        keyExtractor={(p, i) => `${p.uri}-${i}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        initialNumToRender={MAX_CAROUSEL_PHOTOS}
        windowSize={MAX_CAROUSEL_PHOTOS * 2 + 1}
        removeClippedSubviews={false}
        renderItem={({ item }) => (
          <Page
            ref={(view) => { if (view) shots.current.set(item.uri, view); else shots.current.delete(item.uri); }}
            photo={item}
            filter={filter}
            width={width}
            height={pageHeight}
            size={sizes[item.uri]}
            onSize={(size) => setSizes((current) => ({ ...current, [item.uri]: size }))}
          />
        )}
        style={{ flexGrow: 0, height: pageHeight, marginTop: spacing.sm }}
      />

      {/* The photos in order: tap to see one, × to leave it out. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.strip}>
        {photos.map((p, i) => (
          <View key={`${p.uri}-${i}`}>
            <Pressable
              onPress={() => { setIndex(i); pager.current?.scrollToIndex({ index: i, animated: true }); }}
              style={[styles.thumb, i === index && styles.thumbOn]}
              accessibilityRole="button"
              accessibilityLabel={t("carousel.photoNOfCount", { n: i + 1, count: photos.length })}
              accessibilityState={{ selected: i === index }}
            >
              <Image source={{ uri: p.uri }} style={styles.thumbImage} />
            </Pressable>
            <Pressable onPress={() => remove(i)} hitSlop={8} style={styles.thumbRemove} accessibilityRole="button" accessibilityLabel={t("carousel.removePhotoN", { n: i + 1 })}>
              <Icon name={ICONS.close} size={12} color={colors.textPrimary} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      {/* One filter for every photo. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.filters} accessibilityRole="radiogroup" accessibilityLabel={t("carousel.filterForAll")}>
        {FILTER_PREVIEWS.map((f) => (
          <Pressable
            key={f.name}
            onPress={() => { tapFeedback("select"); setFilter(f.name); }}
            style={[styles.chip, filter === f.name && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: filter === f.name }}
            accessibilityLabel={filterLabel(f.name)}
          >
            <Text style={[styles.chipLabel, filter === f.name && styles.chipLabelOn]}>{filterLabel(f.name)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.row}>
        <Pressable onPress={() => setMusicOpen(true)} style={[styles.music, music && styles.musicOn]} accessibilityRole="button" accessibilityLabel={music ? t("carousel.songForAllTitle", { title: music.track.title }) : t("carousel.addSongForAll")}>
          <Icon name="music" size={18} color={music ? colors.onAccent : colors.textPrimary} />
          <Text style={[styles.musicLabel, music && styles.musicLabelOn]} numberOfLines={1}>{music ? music.track.title : t("carousel.addSongForAll")}</Text>
        </Pressable>
        {music ? (
          <Pressable onPress={() => setMusic(null)} hitSlop={8} style={styles.round} accessibilityRole="button" accessibilityLabel={t("storyEditor.removeMusic")}>
            <Icon name={ICONS.close} size={16} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      <TextInput
        style={styles.caption}
        value={caption}
        onChangeText={setCaption}
        maxLength={CAPTION_MAX}
        placeholder={t("carousel.captionOnFirst")}
        placeholderTextColor="rgba(255,255,255,0.55)"
        accessibilityLabel={t("carousel.captionOnFirst")}
      />

      <View style={styles.shareRow}>
        <Pressable onPress={() => void share("close_friends")} disabled={sharing} style={[styles.shareButton, styles.shareSecondary]} accessibilityRole="button" accessibilityLabel={t("carousel.shareCountToCloseFriends", { count: photos.length })}>
          <Text style={styles.shareSecondaryLabel}>{t("common.closeFriends")}</Text>
        </Pressable>
        <Pressable onPress={() => void share(yourStory)} disabled={sharing} style={[styles.shareButton, styles.sharePrimary]} accessibilityRole="button" accessibilityState={{ busy: sharing }} accessibilityLabel={t("carousel.shareCountToYourStory", { count: photos.length })}>
          {sharing ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.sharePrimaryLabel}>{t("carousel.shareCount", { count: photos.length })}</Text>}
        </Pressable>
      </View>

      <MusicSheet visible={musicOpen} current={music} onClose={() => setMusicOpen(false)} onChoose={(chosen) => { setMusic(chosen); setMusicOpen(false); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, minHeight: 44 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
  counter: { color: colors.textPrimary, fontSize: 15, fontWeight: "700", minWidth: 40, textAlign: "right", fontVariant: ["tabular-nums"] },
  frame: { borderRadius: radii.md, overflow: "hidden", backgroundColor: "#111111" },
  blurShade: { backgroundColor: "rgba(0,0,0,0.25)" },
  measure: { position: "absolute", width: 1, height: 1, opacity: 0 },
  stripScroll: { flexGrow: 0, marginTop: spacing.sm },
  strip: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: 6 },
  thumb: { width: 44, height: 64, borderRadius: 8, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  thumbOn: { borderColor: colors.accent },
  thumbImage: { width: "100%", height: "100%" },
  thumbRemove: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center" },
  filters: { gap: spacing.xs, paddingHorizontal: spacing.lg },
  chip: { paddingHorizontal: spacing.md, height: 34, borderRadius: radii.pill, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  chipOn: { backgroundColor: colors.accent },
  chipLabel: { color: colors.textPrimary, fontWeight: "600", fontSize: 14 },
  chipLabelOn: { color: colors.onAccent },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  music: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 40, borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: "rgba(255,255,255,0.12)" },
  musicOn: { backgroundColor: colors.accent },
  musicLabel: { color: colors.textPrimary, fontWeight: "600", flexShrink: 1 },
  musicLabelOn: { color: colors.onAccent },
  caption: { marginHorizontal: spacing.lg, marginTop: spacing.sm, height: 44, borderRadius: radii.md, paddingHorizontal: spacing.md, color: colors.textPrimary, backgroundColor: "rgba(255,255,255,0.1)" },
  shareRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  shareButton: { height: 50, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
  shareSecondary: { paddingHorizontal: spacing.lg, backgroundColor: "rgba(255,255,255,0.14)" },
  shareSecondaryLabel: { color: colors.textPrimary, fontWeight: "700" },
  sharePrimary: { flex: 1, backgroundColor: colors.accent },
  sharePrimaryLabel: { color: colors.onAccent, fontWeight: "800", fontSize: 16 },
});
