import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import { cancelScheduledStory, getScheduledStories, mediaFileUrl, rescheduleStory, type ScheduledStory } from "../../api/stories";
import { Pressable } from "../../components/Pressable";
import { Icon } from "../../components/Icon";
import { FadeInImage } from "../../components/FadeInImage";
import { EmptyState } from "../../components/EmptyState";
import { LoadFailed } from "../../components/LoadFailed";
import { ScheduleSheet } from "../../components/ScheduleSheet";
import { showToast } from "../../components/Toast";
import { scheduleText } from "../../models/schedule";
import { serverDate } from "../../utils/serverTime";
import { tapFeedback } from "../../utils/haptics";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "ScheduledStories">;

const AUDIENCE_LABELS: Record<ScheduledStory["audience"], string> = { get public() { return t("common.everyone"); }, get followers() { return t("common.followers"); }, get close_friends() { return t("common.closeFriends"); } };

/**
 * Archive > Scheduled (and katkee://scheduled, from a "couldn't be posted" push): Stories waiting
 * to post, soonest first, each with its time and who it's for; Reschedule and Cancel on each.
 * One that couldn't be posted stays a week with the reason, so it never just disappears.
 */
export function ScheduledStoriesScreen(_props: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<ScheduledStory[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<ScheduledStory | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { scheduled } = await getScheduledStories(accessToken);
      setItems(scheduled);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [accessToken]);

  // Each visit: one may have posted while you were away.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onReschedule = async (at: Date) => {
    if (!accessToken || !editing) return;
    setSaving(true);
    try {
      const { scheduled } = await rescheduleStory(editing.id, at.toISOString(), accessToken);
      setItems((current) => (current ?? []).map((s) => (s.id === scheduled.id ? scheduled : s)).sort((a, b) => a.publishAt.localeCompare(b.publishAt)));
      setEditing(null);
      tapFeedback("success");
      showToast(t("scheduledStories.rescheduledForAt", { at: scheduleText(at) }));
    } catch (error) {
      setEditing(null);
      Alert.alert(t("scheduledStories.couldntReschedule"), error instanceof ApiError ? error.message : t("scheduledStories.checkYourConnectionAndTry"));
      if (error instanceof ApiError && error.status === 409) void load();
    } finally {
      setSaving(false);
    }
  };

  const onCancel = (item: ScheduledStory) => {
    const failedOne = item.state === "failed";
    Alert.alert(failedOne ? t("scheduledStories.removeFromThisList") : t("common.cancelThisScheduledStory"), failedOne ? undefined : t("scheduledStories.itWontBePosted"), [
      { text: t("scheduledStories.keep"), style: "cancel" },
      {
        text: failedOne ? t("common.remove") : t("common.cancelStory"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await cancelScheduledStory(item.id, accessToken);
            setItems((current) => (current ?? []).filter((s) => s.id !== item.id));
            tapFeedback("success");
            if (!failedOne) showToast(t("scheduledStories.scheduledStoryCancelled"));
          } catch (error) {
            Alert.alert(t("common.couldntCancel"), error instanceof ApiError ? error.message : t("scheduledStories.checkYourConnectionAndTry"));
            if (error instanceof ApiError && error.status === 409) void load();
          }
        },
      },
    ]);
  };

  if (items === null) {
    if (failed) return <LoadFailed message={t("scheduledStories.couldntLoadYourScheduledStories")} onRetry={() => void load()} />;
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  }

  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.accentText} />}
        ListEmptyComponent={
          <EmptyState icon="timer" title={t("scheduledStories.nothingScheduled")} message={t("scheduledStories.inTheStoryEditorTap")} />
        }
        ListHeaderComponent={items.length ? <Text style={styles.header}>{t("scheduledStories.onlyYouCanSeeThese")}</Text> : undefined}
        renderItem={({ item }) => {
          const at = serverDate(item.publishAt);
          const failedOne = item.state === "failed";
          const when = at ? scheduleText(at) : "";
          return (
            <View style={styles.row} accessible={false}>
              <FadeInImage source={{ uri: mediaFileUrl(item.mediaId, "thumbnail"), headers: authHeaders }} style={styles.thumb} resizeMode="cover" />
              <View style={styles.info}>
                <Text style={[styles.when, failedOne && styles.failed]} accessibilityRole="text">
                  {failedOne ? t("scheduledStories.couldntBePosted") : when}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {failedOne ? item.error ?? t("scheduledStories.somethingWentWrong") : `${AUDIENCE_LABELS[item.audience]}${item.caption ? ` · ${item.caption}` : ""}`}
                </Text>
                {item.media?.status === "processing" && !failedOne ? <Text style={styles.meta}>{t("scheduledStories.stillProcessingItPostsOnce")}</Text> : null}
                <View style={styles.actions}>
                  {!failedOne ? (
                    <Pressable style={styles.action} onPress={() => setEditing(item)} accessibilityRole="button" accessibilityLabel={`Reschedule the Story for ${when}`}>
                      <Icon name={ICONS.timer} size={16} color={colors.textPrimary} />
                      <Text style={styles.actionLabel}>{t("scheduledStories.reschedule")}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.action} onPress={() => onCancel(item)} accessibilityRole="button" accessibilityLabel={failedOne ? "Remove from this list" : `Cancel the Story scheduled for ${when}`}>
                    <Icon name={ICONS.close} size={16} color={colors.danger} />
                    <Text style={[styles.actionLabel, styles.cancelLabel]}>{failedOne ? t("common.remove") : t("common.cancel")}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
      />
      <ScheduleSheet
        visible={!!editing}
        initial={editing ? serverDate(editing.publishAt) : null}
        title={t("scheduledStories.reschedule")}
        confirmLabel={t("scheduledStories.saveNewTime")}
        busy={saving}
        onConfirm={(at) => void onReschedule(at)}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.sm },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  header: { ...typography.caption, marginBottom: spacing.xs },
  row: { flexDirection: "row", gap: spacing.md, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  thumb: { width: 64, height: 104, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  info: { flex: 1, gap: 4, justifyContent: "center" },
  when: { ...typography.bodyStrong },
  failed: { color: colors.danger },
  meta: { ...typography.caption },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: spacing.sm + 2, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  actionLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  cancelLabel: { color: colors.danger },
});
