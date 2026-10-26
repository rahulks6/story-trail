import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import Video, { type VideoRef } from "react-native-video";
import { colors, radii, spacing, ICONS } from "../theme";
import { Icon } from "./Icon";
import { mediaSource } from "../api/media";
import { formatClock } from "../api/music";

interface BubbleProps {
  /** The voice note's link (relative: this API with the sign-in header), or a local file while it sends. */
  url: string;
  accessToken: string | null | undefined;
  durationMs: number | null;
  mine: boolean;
  /** Only one voice note plays at a time: the screen says which. */
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  sending?: boolean;
  label: string;
  onLongPress?: () => void;
}

const BARS = 28;

/**
 * A voice note in a chat, like WhatsApp and Instagram: play or pause, a bar that fills as it
 * plays, and the time left. Sound comes from the same player as videos.
 */
export function VoiceNoteBubble({ url, accessToken, durationMs, mine, playing, onPlay, onStop, sending, label, onLongPress }: BubbleProps): React.JSX.Element {
  const ref = useRef<VideoRef>(null);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(durationMs ?? 0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (playing) setLoading(true);
  }, [playing]);
  const fraction = length > 0 ? Math.min(1, position / length) : 0;
  const ink = mine ? colors.onAccent : colors.textPrimary;

  return (
    <Pressable
      onPress={sending ? undefined : playing ? onStop : onPlay}
      onLongPress={onLongPress}
      style={[styles.bubble, mine ? styles.mine : styles.theirs]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Voice message, ${formatClock(length)}`}
      accessibilityState={{ busy: !!sending }}
      accessibilityHint={playing ? "Pauses it" : "Plays it"}
    >
      <View style={[styles.play, { borderColor: ink }]}>
        {sending || (playing && loading) ? (
          <ActivityIndicator size="small" color={ink} />
        ) : (
          <Icon name={playing ? ICONS.pause : ICONS.play} size={16} color={ink} />
        )}
      </View>
      <View style={styles.wave}>
        {Array.from({ length: BARS }, (_, i) => (
          <View
            key={i}
            style={[styles.bar, { height: 6 + ((i * 37 + 11) % 17), backgroundColor: ink, opacity: i / BARS < fraction ? 1 : 0.35 }]}
          />
        ))}
      </View>
      <Text style={[styles.time, { color: ink }]}>{formatClock(playing || position > 0 ? Math.max(0, length - position) : length)}</Text>
      {playing ? (
        <Video
          ref={ref}
          source={mediaSource(url, accessToken)}
          paused={false}
          playInBackground={false}
          ignoreSilentSwitch="ignore"
          progressUpdateInterval={100}
          style={styles.hidden}
          onLoad={(meta) => { setLoading(false); if (meta.duration > 0) setLength(Math.round(meta.duration * 1000)); }}
          onProgress={({ currentTime }) => setPosition(Math.round(currentTime * 1000))}
          onEnd={() => { setPosition(0); onStop(); }}
          onError={() => { setLoading(false); onStop(); }}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.lg, minWidth: 220 },
  mine: { backgroundColor: colors.accent },
  theirs: { backgroundColor: colors.surfaceElevated },
  play: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  wave: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 26 },
  bar: { width: 2.5, borderRadius: 2 },
  time: { fontSize: 12, fontVariant: ["tabular-nums"], minWidth: 34, textAlign: "right" },
  hidden: { position: "absolute", width: 0, height: 0, opacity: 0 },
});
