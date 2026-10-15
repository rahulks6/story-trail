import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { colors, radii, spacing, ICONS } from "../theme";
import { Icon } from "./Icon";
import { useAuth } from "../state/AuthContext";
import { listUploads, removeUpload, subscribeUploads, uploadPreviewUri, uploadProgress, uploadRunning, type UploadJob } from "../state/uploadQueue";

/** How long "Shared" stays before the pill goes away. */
export const SHARED_NOTICE_MS = 3000;

/** What the pill says for a Story on its way. */
export function pillLabel(job: UploadJob, percent: number | undefined, running: boolean): string {
  if (job.status === "published") return "Shared to your Story";
  if (job.status === "failed") return "Couldn't share · Tap to retry";
  if (job.status === "uploading" && percent !== undefined) return `Sharing… ${Math.round(percent * 100)}%`;
  if (!running && job.status !== "queued" && job.status !== "processing") return "Paused · Tap to continue";
  return job.status === "processing" ? "Finishing up…" : "Sharing…";
}

/**
 * A small status at the top of Home while a Story shares (like Instagram), instead of a separate
 * page: a thumbnail, "Sharing… 42%", then "Shared to your Story". Tapping it opens the details,
 * where a failed Story can be retried.
 */
export function UploadStatusPill({ top }: { top: number }): React.JSX.Element | null {
  const userId = useAuth().user?.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [job, setJob] = useState<UploadJob | null>(null);
  const [, setTick] = useState(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const jobs = await listUploads(userId).catch(() => [] as UploadJob[]);
    // The newest Story still on its way, or one that just posted.
    const latest = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    setJob(latest);
    setTick((t) => t + 1);
    if (latest?.status === "published" && !dismissTimer.current) {
      dismissTimer.current = setTimeout(() => {
        dismissTimer.current = null;
        void removeUpload(latest.ownerId, latest.id).catch(() => undefined);
      }, SHARED_NOTICE_MS);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const stop = subscribeUploads(() => void refresh());
    return () => {
      stop();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };
  }, [refresh]);

  if (!job) return null;
  const percent = uploadProgress(job.ownerId, job.id);
  const running = uploadRunning(job.ownerId, job.id);
  const label = pillLabel(job, percent, running);
  const preview = uploadPreviewUri(job);
  const shown = job.status === "uploading" && percent !== undefined ? percent : job.status === "published" || job.status === "processing" ? 1 : 0.05;

  return (
    <Pressable
      onPress={() => navigation.navigate("UploadQueue")}
      style={[styles.pill, { top }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens your Story uploads"
      accessibilityLiveRegion="polite"
    >
      {preview ? <Image source={{ uri: preview }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbVideo]}><Icon name={ICONS.create} size={14} color={colors.textPrimary} /></View>}
      <View style={styles.body}>
        <Text style={[styles.label, job.status === "failed" && styles.failed]} numberOfLines={1}>{label}</Text>
        {job.status !== "failed" && job.status !== "published" ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(shown * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {job.status === "published" ? <Icon name="check" size={16} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.72)",
    maxWidth: 300,
  },
  thumb: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface },
  thumbVideo: { alignItems: "center", justifyContent: "center" },
  body: { gap: 4, flexShrink: 1, minWidth: 140 },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  failed: { color: colors.danger },
  track: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  fill: { height: 3, backgroundColor: colors.accent },
});
