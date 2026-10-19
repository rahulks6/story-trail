import React, { useRef } from "react";
import { StyleSheet } from "react-native";
import Video, { type VideoRef } from "react-native-video";
import { mediaSource } from "../api/media";

interface Props {
  /** The song's link: relative (this API, with the sign-in header) or a signed CDN link. */
  url: string;
  accessToken: string | null | undefined;
  startMs: number;
  durationMs: number;
  paused: boolean;
  muted?: boolean;
  /** Once the song can play (the Story's timer can start). */
  onReady?: () => void;
}

/**
 * Plays the chosen part of a song, over and over, with nothing on screen: the editor while a
 * Story is made, and the viewer while it's watched.
 */
export function MusicPlayer({ url, accessToken, startMs, durationMs, paused, muted = false, onReady }: Props): React.JSX.Element {
  const ref = useRef<VideoRef>(null);
  const start = startMs / 1000;
  const end = (startMs + durationMs) / 1000;
  return (
    <Video
      ref={ref}
      source={mediaSource(url, accessToken)}
      style={styles.hidden}
      paused={paused}
      muted={muted}
      repeat={false}
      playInBackground={false}
      ignoreSilentSwitch="ignore"
      progressUpdateInterval={200}
      onLoad={() => {
        ref.current?.seek(start);
        onReady?.();
      }}
      onProgress={({ currentTime }) => {
        if (currentTime >= end || currentTime < start - 0.5) ref.current?.seek(start);
      }}
      onEnd={() => ref.current?.seek(start)}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  hidden: { position: "absolute", width: 0, height: 0, opacity: 0 },
});
