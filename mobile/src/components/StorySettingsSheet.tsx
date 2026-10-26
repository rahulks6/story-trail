import React from "react";
import { Modal, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { Icon } from "./Icon";
import { TOPICS } from "../models/topics";

export type StoryVisibility = "public" | "followers";
export type CommentSetting = "everyone" | "followers" | "disabled";

export interface StorySettings {
  visibility: StoryVisibility;
  allowComments: CommentSetting;
  allowSharing: boolean;
}

export const DEFAULT_STORY_SETTINGS: StorySettings = { visibility: "public", allowComments: "everyone", allowSharing: true };

const KEY = "katkee.storySettings.v1";

/** The settings you chose last time, for your next Story (per phone). */
export async function loadStorySettings(): Promise<StorySettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<StorySettings>) : {};
    return {
      visibility: saved.visibility === "followers" ? "followers" : "public",
      allowComments: saved.allowComments === "followers" || saved.allowComments === "disabled" ? saved.allowComments : "everyone",
      allowSharing: saved.allowSharing !== false,
    };
  } catch {
    return DEFAULT_STORY_SETTINGS;
  }
}

export function saveStorySettings(settings: StorySettings): void {
  AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => undefined);
}

/** One short line for the editor: "Everyone · Comments on · Food". */
export function storySettingsSummary(s: StorySettings, festivalName?: string | null, topic?: string | null): string {
  const comments = s.allowComments === "everyone" ? "Comments on" : s.allowComments === "followers" ? "Comments: followers" : "Comments off";
  return [s.visibility === "public" ? "Everyone" : "Followers only", comments, ...(festivalName ? [festivalName] : []), ...(topic ? [topic] : [])].join(" · ");
}

function TopicChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label === "None" ? "No topic" : label}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label}>
      <Text style={typography.body}>{label}</Text>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <Icon name={ICONS.check} size={14} color={colors.onAccent} /> : null}</View>
    </Pressable>
  );
}

/**
 * Story settings, behind one line in the editor so the canvas stays clear: who can see it,
 * who can comment, whether others can share it, (on a festival day) its festival ring, and its
 * topic, which helps it reach people into that topic. The topic is chosen for each Story; the
 * other settings are remembered for the next one.
 */
export function StorySettingsSheet({
  visible,
  settings,
  onChange,
  onClose,
  festival,
  joinFestival,
  onJoinFestival,
  topic = null,
  onTopicChange,
}: {
  visible: boolean;
  settings: StorySettings;
  onChange: (next: StorySettings) => void;
  onClose: () => void;
  festival?: { name: string } | null;
  joinFestival?: boolean;
  onJoinFestival?: (join: boolean) => void;
  topic?: string | null;
  onTopicChange?: (topic: string | null) => void;
}): React.JSX.Element {
  const { bottom } = useSafeAreaInsets();
  const set = (patch: Partial<StorySettings>) => onChange({ ...settings, ...patch });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: spacing.md + bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">Story settings</Text>
          <ScrollView>
            <Text style={styles.section}>Who can see it</Text>
            <View style={styles.card} accessibilityRole="radiogroup">
              <Choice label="Everyone" selected={settings.visibility === "public"} onPress={() => set({ visibility: "public" })} />
              <Choice label="Followers only" selected={settings.visibility === "followers"} onPress={() => set({ visibility: "followers" })} />
            </View>
            <Text style={styles.section}>Who can comment</Text>
            <View style={styles.card} accessibilityRole="radiogroup">
              <Choice label="Everyone who can see it" selected={settings.allowComments === "everyone"} onPress={() => set({ allowComments: "everyone" })} />
              <Choice label="Followers" selected={settings.allowComments === "followers"} onPress={() => set({ allowComments: "followers" })} />
              <Choice label="No one" selected={settings.allowComments === "disabled"} onPress={() => set({ allowComments: "disabled" })} />
            </View>
            <View style={[styles.card, styles.spaced]}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={typography.body}>Allow sharing</Text>
                  <Text style={styles.hint}>Others can send it to people or share its link.</Text>
                </View>
                <Switch value={settings.allowSharing} onValueChange={(v) => set({ allowSharing: v })} accessibilityLabel="Allow sharing" />
              </View>
              {festival && onJoinFestival && settings.visibility === "public" ? (
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={typography.body}>Add to {festival.name} Stories</Text>
                    <Text style={styles.hint}>It shows in the festival's ring on Home.</Text>
                  </View>
                  <Switch value={!!joinFestival} onValueChange={onJoinFestival} accessibilityLabel={`Add to ${festival.name} Stories`} />
                </View>
              ) : null}
            </View>
            {onTopicChange ? (
              <>
                <Text style={styles.section}>Topic</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Topic">
                  <TopicChip label="None" selected={topic === null} onPress={() => onTopicChange(null)} />
                  {TOPICS.map((t) => (
                    <TopicChip key={t} label={t} selected={topic === t} onPress={() => onTopicChange(t)} />
                  ))}
                </ScrollView>
                <Text style={[styles.hint, styles.topicHint]}>Helps people who like this topic find your Story.</Text>
              </>
            ) : null}
          </ScrollView>
          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { maxHeight: "85%", backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { ...typography.bodyStrong, textAlign: "center", marginBottom: spacing.sm },
  section: { ...typography.label, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, overflow: "hidden" },
  spaced: { marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: spacing.md, gap: spacing.md },
  rowText: { flex: 1, gap: 2, paddingVertical: spacing.sm },
  hint: { ...typography.caption, color: colors.textSecondary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { ...typography.body, color: colors.textPrimary, fontWeight: "600" },
  chipLabelSelected: { color: colors.onAccent },
  topicHint: { marginTop: spacing.xs },
  done: { marginTop: spacing.md, minHeight: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  doneText: { color: colors.onAccent, fontSize: 16, fontWeight: "700" },
});
