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

type Props = NativeStackScreenProps<RootStackParamList, "ScheduledStories">;

const AUDIENCE_LABELS: Record<ScheduledStory["audience"], string> = { public: "Everyone", followers: "Followers", close_friends: "Close Friends" };

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
      showToast(`Rescheduled for ${scheduleText(at)}`);
    } catch (error) {
      setEditing(null);
      Alert.alert("Couldn't reschedule", error instanceof ApiError ? error.message : "Check your connection and try again.");
      if (error instanceof ApiError && error.status === 409) void load();
    } finally {
      setSaving(false);
    }
  };

  const onCancel = (item: ScheduledStory) => {
    const failedOne = item.state === "failed";
    Alert.alert(failedOne ? "Remove from this list?" : "Cancel this scheduled Story?", failedOne ? undefined : "It won't be posted.", [
      { text: "Keep", style: "cancel" },
      {
        text: failedOne ? "Remove" : "Cancel Story",
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await cancelScheduledStory(item.id, accessToken);
            setItems((current) => (current ?? []).filter((s) => s.id !== item.id));
            tapFeedback("success");
            if (!failedOne) showToast("Scheduled Story cancelled");
          } catch (error) {
            Alert.alert("Couldn't cancel", error instanceof ApiError ? error.message : "Check your connection and try again.");
            if (error instanceof ApiError && error.status === 409) void load();
          }
        },
      },
    ]);
  };

  if (items === null) {
    if (failed) return <LoadFailed message="Couldn't load your scheduled Stories. Check your connection and try again." onRetry={() => void load()} />;
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
          <EmptyState icon="timer" title="Nothing scheduled" message="In the Story editor, tap Schedule to choose when a Story posts. It shows up here until then." />
        }
        ListHeaderComponent={items.length ? <Text style={styles.header}>Only you can see these. Each posts by itself at its time, and its 24 hours start then.</Text> : undefined}
        renderItem={({ item }) => {
          const at = serverDate(item.publishAt);
          const failedOne = item.state === "failed";
          const when = at ? scheduleText(at) : "";
          return (
            <View style={styles.row} accessible={false}>
              <FadeInImage source={{ uri: mediaFileUrl(item.mediaId, "thumbnail"), headers: authHeaders }} style={styles.thumb} resizeMode="cover" />
              <View style={styles.info}>
                <Text style={[styles.when, failedOne && styles.failed]} accessibilityRole="text">
                  {failedOne ? "Couldn't be posted" : when}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {failedOne ? item.error ?? "Something went wrong." : `${AUDIENCE_LABELS[item.audience]}${item.caption ? ` · ${item.caption}` : ""}`}
                </Text>
                {item.media?.status === "processing" && !failedOne ? <Text style={styles.meta}>Still processing. It posts once it's ready.</Text> : null}
                <View style={styles.actions}>
                  {!failedOne ? (
                    <Pressable style={styles.action} onPress={() => setEditing(item)} accessibilityRole="button" accessibilityLabel={`Reschedule the Story for ${when}`}>
                      <Icon name={ICONS.timer} size={16} color={colors.textPrimary} />
                      <Text style={styles.actionLabel}>Reschedule</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.action} onPress={() => onCancel(item)} accessibilityRole="button" accessibilityLabel={failedOne ? "Remove from this list" : `Cancel the Story scheduled for ${when}`}>
                    <Icon name={ICONS.close} size={16} color={colors.danger} />
                    <Text style={[styles.actionLabel, styles.cancelLabel]}>{failedOne ? "Remove" : "Cancel"}</Text>
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
        title="Reschedule"
        confirmLabel="Save new time"
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
