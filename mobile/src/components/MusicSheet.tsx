import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { DEFAULT_CLIP_MS, formatClock, listMusic, MAX_CLIP_MS, MIN_CLIP_MS, type MusicTrack } from "../api/music";
import { Icon } from "./Icon";
import { MusicPlayer } from "./MusicPlayer";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { tapFeedback } from "../utils/haptics";

export interface ChosenMusic {
  track: MusicTrack;
  startMs: number;
  durationMs: number;
}

interface Props {
  visible: boolean;
  /** The song already on the Story: opens on choosing its part. */
  current?: ChosenMusic | null;
  onClose: () => void;
  onChoose: (music: ChosenMusic) => void;
}

const CLIP_LENGTHS = [10_000, 15_000, 30_000];
const BAR_WIDTH = 300;

/**
 * Instagram's music picker: search or pick a mood, tap a song to hear it, then choose which part
 * plays (drag the highlighted window along the song) and for how long. Every song is openly
 * licensed, and its credit shows on the Story.
 */
export function MusicSheet({ visible, current, onClose, onChoose }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [mood, setMood] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<ChosenMusic | null>(current ?? null);

  useEffect(() => {
    if (visible) setChoosing(current ?? null);
    else setPreviewId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !accessToken) return;
    let cancelled = false;
    const run = () => {
      listMusic(accessToken, { q: query, mood })
        .then((r) => {
          if (cancelled) return;
          setTracks(r.tracks);
          if (r.moods) setMoods(r.moods);
          setError(null);
        })
        .catch(() => { if (!cancelled) setError("Couldn't load songs. Check your connection."); });
    };
    // Typing waits for a pause; a mood or opening the sheet loads at once.
    const t = query ? setTimeout(run, 250) : null;
    if (!query) run();
    return () => { cancelled = true; if (t) clearTimeout(t); };
  }, [visible, accessToken, query, mood]);

  const pick = (track: MusicTrack) => {
    tapFeedback("select");
    setPreviewId(null);
    const durationMs = Math.min(DEFAULT_CLIP_MS, track.durationMs);
    // Start a little in, where most songs get going.
    const startMs = Math.min(Math.round(track.durationMs * 0.25), Math.max(0, track.durationMs - durationMs));
    setChoosing({ track, startMs, durationMs });
  };
  const preview = tracks?.find((t) => t.id === previewId) ?? null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => (choosing && !current ? setChoosing(null) : onClose())}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <KeyboardAvoider style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        {choosing ? (
          <ClipChooser
            music={choosing}
            onChange={setChoosing}
            onBack={() => setChoosing(null)}
            onDone={() => { onChoose(choosing); onClose(); }}
          />
        ) : (
          <>
            <Text style={[typography.bodyStrong, styles.title]} accessibilityRole="header">Music</Text>
            <TextInput
              style={styles.search}
              placeholder="Search songs or artists"
              placeholderTextColor={colors.textDisabled}
              value={query}
              onChangeText={setQuery}
              accessibilityLabel="Search music"
              returnKeyType="search"
            />
            {moods.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moods} contentContainerStyle={styles.moodsContent} keyboardShouldPersistTaps="handled">
                {["", ...moods].map((m) => (
                  <Pressable key={m || "all"} onPress={() => setMood(m)} style={[styles.mood, mood === m && styles.moodOn]} accessibilityRole="button" accessibilityState={{ selected: mood === m }} accessibilityLabel={m || "All moods"}>
                    <Text style={[styles.moodLabel, mood === m && styles.moodLabelOn]}>{m || "For you"}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {tracks === null && !error ? (
              <ActivityIndicator color={colors.accentText} style={styles.spinner} />
            ) : error ? (
              <Text style={styles.empty}>{error}</Text>
            ) : tracks!.length === 0 ? (
              <Text style={styles.empty}>{query || mood ? "No songs match." : "Songs are on their way. Check back soon."}</Text>
            ) : (
              <FlatList
                data={tracks!}
                keyExtractor={(t) => t.id}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable style={styles.row} onPress={() => pick(item)} accessibilityRole="button" accessibilityLabel={`${item.title} by ${item.artist}, ${formatClock(item.durationMs)}`} accessibilityHint="Adds it to your Story">
                    <View style={styles.cover}><Icon name={ICONS.music} size={20} color={colors.textPrimary} /></View>
                    <View style={styles.rowText}>
                      <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.trackMeta} numberOfLines={1}>{item.artist} · {formatClock(item.durationMs)}</Text>
                    </View>
                    <Pressable
                      onPress={() => setPreviewId((id) => (id === item.id ? null : item.id))}
                      hitSlop={10}
                      style={styles.playButton}
                      accessibilityRole="button"
                      accessibilityLabel={previewId === item.id ? `Stop ${item.title}` : `Play ${item.title}`}
                    >
                      <Icon name={previewId === item.id ? ICONS.pause : ICONS.play} size={18} color={colors.textPrimary} />
                    </Pressable>
                  </Pressable>
                )}
              />
            )}
            {preview ? (
              <MusicPlayer url={preview.url} accessToken={accessToken} startMs={Math.round(preview.durationMs * 0.25)} durationMs={30_000} paused={false} />
            ) : null}
          </>
        )}
      </KeyboardAvoider>
    </Modal>
  );
}

/** Which part of the song plays: drag the window along the song; choose how long. */
function ClipChooser({ music, onChange, onBack, onDone }: { music: ChosenMusic; onChange: (m: ChosenMusic) => void; onBack: () => void; onDone: () => void }): React.JSX.Element {
  const { accessToken } = useAuth();
  const { track, startMs, durationMs } = music;
  const latest = useRef(music);
  latest.current = music;
  const maxStart = Math.max(0, track.durationMs - durationMs);
  const pan = useMemo(() => {
    let from = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { from = latest.current.startMs; },
      onPanResponderMove: (_e, g) => {
        const m = latest.current;
        const next = Math.min(Math.max(0, from + (g.dx / BAR_WIDTH) * m.track.durationMs), Math.max(0, m.track.durationMs - m.durationMs));
        onChange({ ...m, startMs: Math.round(next / 250) * 250 });
      },
    });
  }, [onChange]);
  const windowLeft = (startMs / track.durationMs) * BAR_WIDTH;
  const windowWidth = Math.max(12, (durationMs / track.durationMs) * BAR_WIDTH);
  const step = (delta: number) => onChange({ ...music, startMs: Math.min(Math.max(0, startMs + delta), maxStart) });

  return (
    <View style={styles.chooser}>
      <View style={styles.chooserTop}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Choose another song">
          <Icon name={ICONS.back} size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.chooserTitle}>
          <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.trackMeta} numberOfLines={1}>{track.artist}</Text>
        </View>
        <Pressable onPress={onDone} style={styles.doneButton} accessibilityRole="button" accessibilityLabel="Add to Story">
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </View>

      <Text style={styles.clipTime} accessibilityLiveRegion="polite">{formatClock(startMs)} – {formatClock(startMs + durationMs)}</Text>
      <View
        style={styles.bar}
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Part of the song"
        accessibilityValue={{ text: `Starts at ${formatClock(startMs)}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 5_000 : -5_000)}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <View key={i} style={[styles.wave, { height: 10 + ((i * 37) % 26) }]} />
        ))}
        <View style={[styles.window, { left: windowLeft, width: windowWidth }]} />
      </View>
      <Text style={styles.hint}>Drag to choose the part that plays</Text>

      <View style={styles.lengths}>
        {CLIP_LENGTHS.filter((l) => l <= Math.max(track.durationMs, MIN_CLIP_MS)).map((l) => (
          <Pressable
            key={l}
            onPress={() => onChange({ ...music, durationMs: Math.min(Math.max(l, MIN_CLIP_MS), MAX_CLIP_MS, track.durationMs), startMs: Math.min(startMs, Math.max(0, track.durationMs - l)) })}
            style={[styles.mood, durationMs === l && styles.moodOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: durationMs === l }}
            accessibilityLabel={`${l / 1000} seconds`}
          >
            <Text style={[styles.moodLabel, durationMs === l && styles.moodLabelOn]}>{l / 1000}s</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.credit}>{track.attribution}</Text>
      <MusicPlayer url={track.url} accessToken={accessToken} startMs={startMs} durationMs={durationMs} paused={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { height: "75%", backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { textAlign: "center", marginBottom: spacing.sm },
  search: { backgroundColor: colors.surfaceElevated, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 15 },
  moods: { flexGrow: 0, flexShrink: 0, marginTop: spacing.sm },
  moodsContent: { gap: spacing.xs, paddingVertical: 2 },
  mood: { paddingHorizontal: spacing.md, minHeight: 34, paddingVertical: 6, justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  moodOn: { backgroundColor: colors.textPrimary },
  moodLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  moodLabelOn: { color: colors.background },
  spinner: { marginTop: spacing.xl },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: spacing.xl },
  list: { flex: 1, marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  cover: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  trackTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  trackMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  playButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  chooser: { flex: 1 },
  chooserTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  chooserTitle: { flex: 1 },
  doneButton: { backgroundColor: colors.textPrimary, borderRadius: radii.pill, paddingHorizontal: spacing.md, minHeight: 36, paddingVertical: 6, justifyContent: "center" },
  doneLabel: { color: colors.background, fontWeight: "700" },
  clipTime: { color: colors.textPrimary, fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: spacing.md, fontVariant: ["tabular-nums"] },
  bar: { width: BAR_WIDTH, height: 56, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  wave: { width: 3, borderRadius: 2, backgroundColor: colors.textSecondary },
  window: { position: "absolute", top: 0, bottom: 0, borderRadius: radii.sm, borderWidth: 3, borderColor: colors.accentText, backgroundColor: "rgba(128,128,128,0.18)" },
  hint: { color: colors.textSecondary, textAlign: "center", fontSize: 13, marginTop: spacing.sm },
  lengths: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginTop: spacing.lg },
  credit: { color: colors.textDisabled, fontSize: 12, textAlign: "center", marginTop: spacing.lg },
});
