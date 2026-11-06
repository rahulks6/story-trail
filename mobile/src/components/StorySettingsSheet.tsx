import React from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Toggle } from "./Toggle";
import { Pressable } from "./Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { Icon } from "./Icon";
import { t } from "../i18n";
import { topicLabel } from "../i18n/names";

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
/** The longest picture description (the server's MAX_ALT_TEXT_LENGTH). */
export const MAX_ALT_TEXT_LENGTH = 500;

export function storySettingsSummary(s: StorySettings, festivalName?: string | null, topic?: string | null): string {
  const comments = s.allowComments === "everyone" ? t("storySettingsSheet.commentsOn") : s.allowComments === "followers" ? t("storySettingsSheet.commentsFollowers") : t("storySettingsSheet.commentsOff");
  return [s.visibility === "public" ? t("common.everyone") : t("storySettingsSheet.followersOnly"), comments, ...(festivalName ? [festivalName] : []), ...(topic ? [topicLabel(topic)] : [])].join(" · ");
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
 * who can comment, whether others can share it and (on a festival day) its festival ring. They
 * are remembered for the next Story. Nothing here needs filling in: a Story's topic and picture
 * description are worked out by the server (backend stories/story-ai.ts).
 */
export function StorySettingsSheet({
  visible,
  settings,
  onChange,
  onClose,
  festival,
  joinFestival,
  onJoinFestival,
}: {
  visible: boolean;
  settings: StorySettings;
  onChange: (next: StorySettings) => void;
  onClose: () => void;
  festival?: { name: string } | null;
  joinFestival?: boolean;
  onJoinFestival?: (join: boolean) => void;
}): React.JSX.Element {
  const { bottom } = useSafeAreaInsets();
  const set = (patch: Partial<StorySettings>) => onChange({ ...settings, ...patch });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { paddingBottom: spacing.md + bottom }]}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">{t("storySettingsSheet.storySettings")}</Text>
          <ScrollView>
            <Text style={styles.section}>{t("storySettingsSheet.whoCanSeeIt")}</Text>
            <View style={styles.card} accessibilityRole="radiogroup">
              <Choice label={t("common.everyone")} selected={settings.visibility === "public"} onPress={() => set({ visibility: "public" })} />
              <Choice label={t("storySettingsSheet.followersOnly")} selected={settings.visibility === "followers"} onPress={() => set({ visibility: "followers" })} />
            </View>
            <Text style={styles.section}>{t("storySettingsSheet.whoCanComment")}</Text>
            <View style={styles.card} accessibilityRole="radiogroup">
              <Choice label={t("storySettingsSheet.everyoneWhoCanSeeIt")} selected={settings.allowComments === "everyone"} onPress={() => set({ allowComments: "everyone" })} />
              <Choice label={t("common.followers")} selected={settings.allowComments === "followers"} onPress={() => set({ allowComments: "followers" })} />
              <Choice label={t("storySettingsSheet.noOne")} selected={settings.allowComments === "disabled"} onPress={() => set({ allowComments: "disabled" })} />
            </View>
            <View style={[styles.card, styles.spaced]}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={typography.body}>{t("storySettingsSheet.allowSharing")}</Text>
                  <Text style={styles.hint}>{t("storySettingsSheet.othersCanSendItTo")}</Text>
                </View>
                <Toggle value={settings.allowSharing} onValueChange={(v) => set({ allowSharing: v })} accessibilityLabel={t("storySettingsSheet.allowSharing")} />
              </View>
              {festival && onJoinFestival && settings.visibility === "public" ? (
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={typography.body}>{t("storySettingsSheet.addToNameStories", { name: festival.name })}</Text>
                    <Text style={styles.hint}>{t("storySettingsSheet.itShowsInTheFestivals")}</Text>
                  </View>
                  <Toggle value={!!joinFestival} onValueChange={onJoinFestival} accessibilityLabel={t("storySettingsSheet.addToNameStories", { name: festival.name })} />
                </View>
              ) : null}
            </View>
          </ScrollView>
          <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>{t("common.done")}</Text>
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
  done: { marginTop: spacing.md, minHeight: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  doneText: { color: colors.onAccent, fontSize: 16, fontWeight: "700" },
});
