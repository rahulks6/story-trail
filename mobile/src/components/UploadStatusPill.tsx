import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { mediaColors as colors, radii, spacing, ICONS } from "../theme";
import { Icon } from "./Icon";
import { useAuth } from "../state/AuthContext";
import { cancelUpload, isDone, listUploads, needsAttention, removeUpload, subscribeUploads, uploadPreviewUri, uploadProgress, uploadRunning, type UploadJob } from "../state/uploadQueue";
import { cancelScheduledStory, deleteStory } from "../api/stories";
import { scheduleText } from "../models/schedule";
import { serverDate } from "../utils/serverTime";
import { storyPublished } from "../state/storyChanges";
import { t } from "../i18n";

/** How long "Shared" stays before the pill goes away. */
export const SHARED_NOTICE_MS = 5000;

/** What the pill says for a Story on its way. */
export function pillLabel(job: UploadJob, percent: number | undefined, running: boolean): string {
  if (job.status === "published") return t("uploadStatusPill.sharedToYourStory");
  if (job.status === "scheduled") return serverDate(job.payload.publishAt) ? t("uploadStatusPill.scheduledForPublishat", { publishAt: scheduleText(serverDate(job.payload.publishAt)!) }) : t("common.scheduled");
  if (job.status === "failed") return t("uploadStatusPill.couldntShareTapToRetry");
  if (job.status === "uploading" && percent !== undefined) return t("uploadStatusPill.sharingValue", { value: Math.round(percent * 100) });
  if (!running && job.status !== "queued" && job.status !== "processing") return t("uploadStatusPill.pausedTapToContinue");
  return job.status === "processing" ? t("uploadStatusPill.finishingUp") : t("uploadStatusPill.sharing");
}

/**
 * A small status at the top of Home while a Story shares (like Instagram), instead of a separate
 * page: a thumbnail, "Sharing… 42%", then "Shared to your Story". Tapping it opens the details,
 * where a failed Story can be retried.
 */
export function UploadStatusPill({ top }: { top: number }): React.JSX.Element | null {
  const { accessToken } = useAuth();
  const userId = useAuth().user?.id;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [job, setJob] = useState<UploadJob | null>(null);
  /** Stories waiting on the person (failed, or paused part-way): more than one shows a count. */
  const [attention, setAttention] = useState(0);
  const [, setTick] = useState(0);
  const [stopping, setStopping] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const jobs = await listUploads(userId).catch(() => [] as UploadJob[]);
    // The newest Story still on its way, or one that just posted.
    const latest = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    setJob(latest);
    setAttention(jobs.filter(needsAttention).length);
    setTick((tick) => tick + 1);
    if (latest && isDone(latest) && !dismissTimer.current) {
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

  // Stop a Story that is still on its way, or take back one that has just posted.
  const stop = (current: UploadJob) => {
    if (current.status === "scheduled") {
      Alert.alert(t("common.cancelThisScheduledStory"), t("uploadStatusPill.itWontBePostedYour"), [
        { text: t("uploadStatusPill.keepIt"), style: "cancel" },
        {
          text: t("common.cancelStory"),
          style: "destructive",
          onPress: async () => {
            try {
              if (current.scheduledId && accessToken) await cancelScheduledStory(current.scheduledId, accessToken);
              await removeUpload(current.ownerId, current.id).catch(() => undefined);
            } catch {
              Alert.alert(t("common.couldntCancel"), t("uploadStatusPill.openArchiveThenScheduledAnd"));
            }
          },
        },
      ]);
      return;
    }
    if (current.status === "published") {
      Alert.alert(t("common.deleteThisStory"), t("uploadStatusPill.itHasBeenSharedDeleting"), [
        { text: t("uploadStatusPill.keepIt"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              if (current.storyId && accessToken) await deleteStory(current.storyId, accessToken);
              await removeUpload(current.ownerId, current.id).catch(() => undefined);
              storyPublished(); // Home and your profile reload without it.
            } catch {
              Alert.alert(t("common.couldntDelete"), t("uploadStatusPill.openTheStoryTapMore"));
            }
          },
        },
      ]);
      return;
    }
    Alert.alert(t("uploadStatusPill.stopSharing2"), t("uploadStatusPill.thisStoryWontBePosted"), [
      { text: t("uploadStatusPill.keepSharing"), style: "cancel" },
      {
        text: t("uploadStatusPill.stop"),
        style: "destructive",
        onPress: async () => {
          setStopping(true);
          const stopped = await cancelUpload(current.ownerId, current.id, accessToken ?? null).catch(() => false);
          setStopping(false);
          if (!stopped) Alert.alert(t("uploadStatusPill.alreadyPosted"), t("uploadStatusPill.itFinishedJustNowOpen"));
        },
      },
    ]);
  };

  if (!job) return null;
  const percent = uploadProgress(job.ownerId, job.id);
  const running = uploadRunning(job.ownerId, job.id);
  const label = stopping ? t("uploadStatusPill.stopping") : job.cancelAfterPublish ? t("uploadStatusPill.removing") : pillLabel(job, percent, running);
  const othersLabel = attention > 1 ? t("uploadStatusPill.attentionStoriesNeedAttention", { attention }) : null;
  const preview = uploadPreviewUri(job);
  const shown = job.status === "uploading" && percent !== undefined ? percent : isDone(job) || job.status === "processing" ? 1 : 0.05;

  return (
    <Pressable
      onPress={() => navigation.navigate("UploadQueue")}
      style={[styles.pill, { top }]}
      accessibilityRole="button"
      accessibilityLabel={othersLabel ? `${label}. ${othersLabel}` : label}
      accessibilityHint={t("uploadStatusPill.opensYourStoryUploads")}
      accessibilityLiveRegion="polite"
    >
      {preview ? <Image source={{ uri: preview }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbVideo]}><Icon name={ICONS.create} size={14} color={colors.textPrimary} /></View>}
      <View style={styles.body}>
        <Text style={[styles.label, job.status === "failed" && styles.failed]} numberOfLines={1}>{label}</Text>
        {job.status !== "failed" && !isDone(job) ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(shown * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {othersLabel ? (
        <View style={styles.badge} accessibilityLabel={othersLabel}>
          <Text style={styles.badgeText}>{attention}</Text>
        </View>
      ) : null}
      {isDone(job) ? (
        <Pressable onPress={() => stop(job)} hitSlop={10} accessibilityRole="button" accessibilityLabel={job.status === "scheduled" ? "Undo, cancel this scheduled Story" : "Undo, delete this Story"}>
          <Text style={styles.undo}>{t("common.undo")}</Text>
        </Pressable>
      ) : !stopping && !job.cancelAfterPublish ? (
        <Pressable onPress={() => stop(job)} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={t("uploadStatusPill.stopSharing")}>
          <Icon name={ICONS.close} size={16} color={colors.textPrimary} />
        </Pressable>
      ) : null}
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
  undo: { color: colors.accentText, fontWeight: "700", fontSize: 13 },
  close: { padding: 2 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger },
  badgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  track: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", overflow: "hidden" },
  fill: { height: 3, backgroundColor: colors.accent },
});
