import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import Video from "react-native-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, ICONS } from "../../theme";
import { Icon } from "../../components/Icon";
import { FilterStrip } from "../../components/FilterStrip";
import { FILTER_PREVIEWS, type FilterKey } from "../../models/filterPreviews";
import { filterKey, type FilterName } from "../../models/storyDraft";
import { filteredPhotoUri, forgetFilteredPhoto } from "../../utils/filterPhoto";

/** Same edge the DM camera captures at, so a filtered photo loses nothing. */
const SEND_EDGE = 2048;
const PREVIEW_EDGE = 1080;

export interface Capture {
  uri: string;
  type?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * What the DM camera just took, full screen with the Story filters under it, like Instagram's
 * DM camera. A photo is sent with the filter baked in (worked out on the phone, as for a
 * Story); a video carries the filter's name and the server applies it while processing.
 */
export function CapturePreview({
  capture,
  onCancel,
  onSend,
}: {
  capture: Capture | null;
  onCancel: () => void;
  onSend: (capture: Capture, filter: string | undefined) => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterName>("Original");
  const [shown, setShown] = useState<{ filter: FilterName; uri: string } | null>(null);
  const [sending, setSending] = useState(false);
  const isVideo = !!capture?.type?.startsWith("video/");
  const uri = capture?.uri ?? "";

  useEffect(() => {
    setFilter("Original");
    setShown(null);
    setSending(false);
    if (!uri) return;
    return () => forgetFilteredPhoto(uri);
  }, [uri]);

  // A photo shows the filter's tint at once, then the exact picture once it's worked out.
  useEffect(() => {
    if (!uri || isVideo || filter === "Original") return;
    let cancelled = false;
    filteredPhotoUri(uri, filterKey(filter) as FilterKey, PREVIEW_EDGE)
      .then((next) => {
        if (!cancelled) setShown({ filter, uri: next });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filter, isVideo, uri]);

  const exact = filter === "Original" || (shown?.filter === filter && !isVideo);
  const tint = FILTER_PREVIEWS.find((f) => f.name === filter);

  const send = async () => {
    if (!capture || sending) return;
    if (isVideo || filter === "Original") {
      onSend(capture, isVideo && filter !== "Original" ? filterKey(filter) : undefined);
      return;
    }
    setSending(true);
    try {
      const filtered = await filteredPhotoUri(capture.uri, filterKey(filter) as FilterKey, SEND_EDGE);
      onSend({ ...capture, uri: filtered, type: "image/jpeg" }, undefined);
    } catch {
      onSend(capture, undefined); // this phone couldn't process it: send the photo as taken
    }
  };

  return (
    <Modal visible={capture !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onCancel}>
      <View style={styles.root}>
        {capture ? (
          isVideo ? (
            <Video source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" repeat muted={false} />
          ) : (
            <Image source={{ uri: filter !== "Original" && shown?.filter === filter ? shown.uri : uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          )
        ) : null}
        {!exact && tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint.overlayColor, opacity: tint.overlayOpacity }]} /> : null}
        <Pressable
          style={[styles.close, { top: insets.top + spacing.sm }]}
          onPress={onCancel}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Discard"
        >
          <Icon name={ICONS.close} size={24} color="#FFFFFF" />
        </Pressable>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
          {capture ? <FilterStrip kind={isVideo ? "video" : "photo"} mediaUri={uri} selected={filter} onSelect={setFilter} /> : null}
          <Pressable
            style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
            onPress={() => void send()}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel={isVideo ? "Send video" : "Send photo"}
            accessibilityState={{ busy: sending }}
          >
            {sending ? <ActivityIndicator color={colors.onAccent} /> : (
              <>
                <Text style={styles.sendLabel}>Send</Text>
                <Icon name={ICONS.send} size={18} color={colors.onAccent} />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  close: { position: "absolute", left: spacing.md, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, gap: spacing.md, paddingTop: spacing.md, backgroundColor: "rgba(0,0,0,0.45)" },
  send: { alignSelf: "flex-end", marginRight: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.accent },
  sendPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  sendLabel: { color: colors.onAccent, fontSize: 16, fontWeight: "700" },
});
