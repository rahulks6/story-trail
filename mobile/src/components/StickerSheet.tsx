import { useSafeAreaInsets } from "react-native-safe-area-context";
import {Icon} from "./Icon";
import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Modal, PermissionsAndroid, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import Geolocation from "@react-native-community/geolocation";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { searchUsers, type SearchResult } from "../api/users";
import { STICKER_GLYPHS } from "./OverlayBody";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { VerifiedName } from "./VerifiedBadge";
import {
  STICKER_IDS,
  type Overlay,
  type EmojiOverlayProperties,
  type MentionOverlayProperties,
  type LocationOverlayProperties,
  type DateTimeOverlayProperties,
  type StickerOverlayProperties,
  type TextOverlayProperties,
  type InteractiveProperties,
  type InteractiveType,
  isInteractive,
} from "../models/storyDraft";
import { InteractiveStickerForm } from "./InteractiveStickerForm";
import { localeTag, t } from "../i18n";

/** Location was turned off for Katkee for good: only Settings can turn it back on. */
function offerLocationSettings(): void {
  Alert.alert(t("stickerSheet.locationIsOffForKatkee"), t("stickerSheet.toAddWhereYouAre"), [
    { text: t("common.notNow"), style: "cancel" },
    { text: t("common.openSettings"), onPress: () => void Linking.openSettings().catch(() => undefined) },
  ]);
}

export type StickerTab = "interactive" | "emoji" | "mention" | "location" | "datetime" | "stickers";

const TABS: { key: StickerTab; label: string }[] = [
  // Polls, quizzes, questions, countdowns, links and Add Yours (InteractiveStickerForm).
  { key: "interactive", get label() { return t("stickerSheet.interactive"); } },
  { key: "emoji", get label() { return t("stickerSheet.emoji"); } },
  { key: "mention", get label() { return t("stickerSheet.mention"); } },
  { key: "location", get label() { return t("stickerSheet.location2"); } },
  { key: "datetime", get label() { return t("stickerSheet.dateTime2"); } },
  { key: "stickers", get label() { return t("stickerSheet.stickers"); } },
];

const STICKER_NAMES: Record<string, string> = {
  get spark() { return t("stickerSheet.spark"); },
  get "heart-line"() { return t("stickerSheet.heartOutline"); },
  get "star-outline"() { return t("stickerSheet.starOutline"); },
  get wave() { return t("stickerSheet.wave"); },
  get flame() { return t("stickerSheet.flame"); },
  get confetti() { return t("stickerSheet.confetti"); },
  get ring() { return t("stickerSheet.ring"); },
  get bolt() { return t("stickerSheet.bolt"); },
};

const EMOJI_SET = ["😀", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😇", "🙂", "😉", "😋", "😜", "🤪", "🤗", "🤔", "😏", "😴", "😮", "😱", "😢", "😭", "😅", "😬", "🙄", "😤", "😡", "🤯", "🥺", "😈", "👀", "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "✌️", "🤞", "👋", "💯", "🔥", "✨", "⭐", "🌟", "🎉", "🎂", "🎁", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "💕", "☀️", "🌙", "🌈", "🌸", "🌹", "🍕", "☕", "🍫", "⚽", "🏏", "🎵", "📸", "✈️", "🏖️", "🚗", "🏠", "💼", "📚", "🎓", "💡"];

export type StickerAddPayload =
  | { type: "text"; properties: TextOverlayProperties }
  | { type: "emoji"; properties: EmojiOverlayProperties }
  | { type: "mention"; properties: MentionOverlayProperties }
  | { type: "location"; properties: LocationOverlayProperties }
  | { type: "datetime"; properties: DateTimeOverlayProperties }
  | { type: "sticker"; properties: StickerOverlayProperties }
  | { type: InteractiveType; properties: InteractiveProperties };

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (payload: StickerAddPayload) => void;
  /** Today's festival: its greeting and emoji lead the Emoji tab. */
  festival?: { name: string; emoji: string; greeting: string } | null;
  /**
   * When set, opening the sheet edits this overlay's content in place
   * (its existing position/scale/rotation untouched) instead of adding a
   * new one — the location/date-time counterpart to double-tapping text
   * to re-edit it (only "location" and "datetime" have re-editable
   * content; a mention or sticker has nothing to edit beyond geometry,
   * which OverlayAdjustSheet already covers).
   */
  editingOverlay?: Overlay | null;
  /** The tab it opens on (the editor's @ button opens straight on Mention). */
  initialTab?: StickerTab;
  onEditDone?: (id: string, properties: LocationOverlayProperties | DateTimeOverlayProperties | InteractiveProperties) => void;
  /** Interactive sticker kinds already on the Story: one of each. */
  usedInteractiveTypes?: string[];
}

/**
 * Everything except text (spec section 22): Emoji, Mention, Location,
 * Date, Time, and Katkee's own original stickers — no music tab, no song
 * search, nothing that resembles one (spec section 53's exhaustive "NO
 * MUSIC"). Each selection becomes a regular canvas object via the same
 * `onAdd` → DraggableCanvasObject path text already uses; this sheet only
 * ever hands back type-specific `properties`, never geometry.
 */
export function StickerSheet({ visible, onClose, onAdd, festival, editingOverlay, onEditDone, initialTab, usedInteractiveTypes = [] }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<StickerTab>("emoji");
  const [mentionQuery, setMentionQuery] = useState("");
  const debouncedMentionQuery = useDebouncedValue(mentionQuery, 300);
  const [mentionResults, setMentionResults] = useState<SearchResult[]>([]);
  const [mentionSearching, setMentionSearching] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    if (!editingOverlay && initialTab) setTab(initialTab);
    if (editingOverlay && isInteractive(editingOverlay)) setTab("interactive");
    if (editingOverlay?.type === "location") {
      setTab("location");
      setLocationLabel(editingOverlay.properties.label);
    } else if (editingOverlay?.type === "datetime") {
      setTab("datetime");
      // The sticker's own ISO value; an unreadable one (older or edited data) starts from now.
      const saved = new Date(editingOverlay.properties.value);
      setPickerDate(Number.isNaN(saved.getTime()) ? new Date() : saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingOverlay]);

  React.useEffect(() => {
    if (!visible || tab !== "mention" || !accessToken || debouncedMentionQuery.trim().length < 2) {
      setMentionResults([]);
      return;
    }
    let cancelled = false;
    setMentionSearching(true);
    searchUsers(debouncedMentionQuery.trim(), accessToken)
      .then(({ results }) => {
        if (!cancelled) setMentionResults(results);
      })
      .catch(() => {
        if (!cancelled) setMentionResults([]);
      })
      .finally(() => {
        if (!cancelled) setMentionSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, tab, accessToken, debouncedMentionQuery]);

  const close = () => {
    setMentionQuery("");
    setMentionResults([]);
    setLocationLabel("");
    setLocationError(null);
    onClose();
  };

  const addEmoji = (emoji: string) => {
    onAdd({ type: "emoji", properties: { emoji } });
    close();
  };

  const addMention = (user: SearchResult) => {
    onAdd({ type: "mention", properties: { userId: user.id, username: user.username, displayName: user.displayName } });
    close();
  };

  const addLocation = () => {
    const label = locationLabel.trim();
    if (!label) return;
    if (editingOverlay && onEditDone) {
      onEditDone(editingOverlay.id, { label });
    } else {
      onAdd({ type: "location", properties: { label } });
    }
    close();
  };

  // Device location is only ever requested here, in direct response to
  // this explicit tap (spec section 31) — never on the editor simply
  // opening, and never silently. Approximate location only, as everywhere
  // in Katkee (the Privacy Policy says it never accesses precise location;
  // iOS asks with reduced accuracy). There's no reverse-geocoding service
  // configured in this sandbox (no Maps/Places API key), so the result is
  // a coarse, rounded coordinate label the user can edit or discard before
  // it's ever added to the Story — never the raw, full-precision reading.
  const useCurrentLocation = async () => {
    setLocationError(null);
    setLocatingDevice(true);
    try {
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          // "Don't ask again": Android won't ask any more, so the only way back is Settings.
          if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) offerLocationSettings();
          setLocationError(t("stickerSheet.locationPermissionDenied"));
          setLocatingDevice(false);
          return;
        }
      }
      Geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude.toFixed(2);
          const lng = position.coords.longitude.toFixed(2);
          setLocationLabel(t("stickerSheet.nearLatLng", { lat, lng }));
          setLocatingDevice(false);
        },
        (error) => {
          // PERMISSION_DENIED (1): on iOS the system never asks twice; Settings is the way back.
          if (error?.code === 1) {
            offerLocationSettings();
            setLocationError(t("stickerSheet.locationPermissionDenied"));
          } else {
            setLocationError(t("stickerSheet.couldntGetYourLocation"));
          }
          setLocatingDevice(false);
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    } catch {
      setLocationError(t("stickerSheet.locationIsntAvailableOnThis"));
      setLocatingDevice(false);
    }
  };

  // A real picker (spec's own date/time sticker, not locked to "right
  // now"): +/- steppers on day/hour/minute, hand-rolled rather than a
  // native calendar widget — no such library is declared in this project,
  // and steppers are a reasonable, fully-functional stand-in for a Story
  // sticker (which only ever needs "some date", not scheduling precision).
  const [pickerDate, setPickerDate] = useState(() => new Date());
  const adjustPicker = (unit: "day" | "hour" | "minute", delta: number) => {
    setPickerDate((d) => {
      const next = new Date(d);
      if (unit === "day") next.setDate(next.getDate() + delta);
      if (unit === "hour") next.setHours(next.getHours() + delta);
      if (unit === "minute") next.setMinutes(next.getMinutes() + delta * 5);
      return next;
    });
  };

  const addDateTime = (mode: "date" | "time") => {
    const display =
      mode === "date"
        ? pickerDate.toLocaleDateString(localeTag(), { month: "short", day: "numeric", year: "numeric" })
        : pickerDate.toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" });
    const properties = { mode, value: pickerDate.toISOString(), display };
    if (editingOverlay && onEditDone) {
      onEditDone(editingOverlay.id, properties);
    } else {
      onAdd({ type: "datetime", properties });
    }
    close();
  };

  const addSticker = (stickerId: (typeof STICKER_IDS)[number]) => {
    onAdd({ type: "sticker", properties: { stickerId } });
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable pressEffect="none" style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      {/* Mention search's TextInput/FlatList sit inside this sheet — without
          keyboard avoidance, an opening keyboard would cover the results
          list the same way it used to cover TextToolModal's controls. */}
      <KeyboardAvoider style={[styles.sheet, { paddingBottom: spacing.xl + bottomInset }]} behavior="padding">
        <View style={styles.handle} />
        {editingOverlay ? (
          <Text style={styles.editingHeader}>{editingOverlay.type === "location" ? t("stickerSheet.editingLocation") : editingOverlay.type === "datetime" ? t("stickerSheet.editingDateTime") : t("stickerSheet.editingSticker")}</Text>
        ) : (
          <View style={styles.tabRow}>
            {TABS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => setTab(option.key)}
                style={[styles.tab, tab === option.key && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === option.key }}
              >
                <Text style={[styles.tabLabel, tab === option.key && styles.tabLabelActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.body}>
          {tab === "interactive" ? (
            <InteractiveStickerForm
              // A fresh form each time the sheet opens, or another sticker is edited.
              key={editingOverlay?.id ?? "new"}
              editing={editingOverlay && isInteractive(editingOverlay) ? (editingOverlay as Extract<Overlay, { type: InteractiveType }>) : null}
              usedTypes={usedInteractiveTypes}
              onDone={(type, properties) => {
                if (editingOverlay && onEditDone) onEditDone(editingOverlay.id, properties);
                else onAdd({ type, properties });
                close();
              }}
            />
          ) : null}
          {tab === "emoji" && festival ? (
            <View style={styles.festivalRow}>
              <Pressable
                style={styles.festivalGreeting}
                onPress={() => {
                  onAdd({ type: "text", properties: { text: `${festival.emoji} ${festival.greeting}`, style: "Bold", color: "#FFFFFF", backgroundColor: null, align: "center", fontSize: 0.055 } });
                  close();
                }}
                accessibilityRole="button"
                accessibilityLabel={t("stickerSheet.addGreeting", { greeting: festival.greeting })}
              >
                <Text style={styles.festivalGreetingLabel} numberOfLines={1}>{festival.emoji} {festival.greeting}</Text>
              </Pressable>
              <Pressable style={styles.festivalEmoji} onPress={() => addEmoji(festival.emoji)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.addNameEmoji", { name: festival.name })}>
                <Text style={styles.emojiGlyph}>{festival.emoji}</Text>
              </Pressable>
            </View>
          ) : null}
          {tab === "emoji" ? (
            <FlatList keyboardShouldPersistTaps="handled"
              data={EMOJI_SET}
              keyExtractor={(e) => e}
              numColumns={6}
              renderItem={({ item }) => (
                <Pressable style={styles.emojiCell} onPress={() => addEmoji(item)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.addItemEmoji", { item })}>
                  <Text style={styles.emojiGlyph}>{item}</Text>
                </Pressable>
              )}
            />
          ) : null}

          {tab === "mention" ? (
            <View>
              <TextInput
                style={styles.input}
                placeholder={t("stickerSheet.searchPeople")}
                placeholderTextColor={colors.textDisabled}
                value={mentionQuery}
                onChangeText={setMentionQuery}
                autoFocus
              />
              {mentionSearching ? <ActivityIndicator color={colors.accentText} style={styles.spinner} /> : null}
              <FlatList keyboardShouldPersistTaps="handled"
                data={mentionResults}
                keyExtractor={(u) => u.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.resultRow}
                    onPress={() => addMention(item)}
                    accessibilityRole="button"
                    accessibilityLabel={(item.verified ? t("stickerSheet.mentionDisplaynameVerifiedUsername", { displayName: item.displayName, username: item.username }) : t("stickerSheet.mentionDisplaynameUsername", { displayName: item.displayName, username: item.username }))}
                  >
                    <VerifiedName name={item.displayName} verified={item.verified} style={typography.body} />
                    <Text style={styles.resultUsername}>@{item.username}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  debouncedMentionQuery.trim().length >= 2 && !mentionSearching ? (
                    <Text style={styles.emptyText}>{t("stickerSheet.noOneFound")}</Text>
                  ) : undefined
                }
              />
            </View>
          ) : null}

          {tab === "location" ? (
            <View>
              <TextInput
                style={styles.input}
                placeholder={t("stickerSheet.addALocation")}
                placeholderTextColor={colors.textDisabled}
                value={locationLabel}
                onChangeText={setLocationLabel}
              />
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={useCurrentLocation} disabled={locatingDevice}>
                {locatingDevice ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.secondaryButtonLabel}>{t("stickerSheet.useCurrentLocation")}</Text>}
              </Pressable>
              {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
              <Pressable accessibilityRole="button" style={[styles.primaryButton, !locationLabel.trim() && styles.primaryButtonDisabled]} disabled={!locationLabel.trim()} onPress={addLocation}>
                <Text style={styles.primaryButtonLabel}>{editingOverlay ? t("common.save") : t("common.add")}</Text>
              </Pressable>
            </View>
          ) : null}

          {tab === "datetime" ? (
            <View style={styles.dateTimeRow}>
              <Text style={styles.dateTimePreview}>
                {pickerDate.toLocaleDateString(localeTag(), { month: "short", day: "numeric", year: "numeric" })}
                {"  ·  "}
                {pickerDate.toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" })}
              </Text>

              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>{t("common.day")}</Text>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("day", -1)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.previousDay")}>
                  <Icon style={styles.stepperIcon} name="minus"/>
                </Pressable>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("day", 1)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.nextDay")}>
                  <Icon style={styles.stepperIcon} name="add"/>
                </Pressable>
              </View>
              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>{t("common.hour")}</Text>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("hour", -1)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.decreaseHour")}>
                  <Icon style={styles.stepperIcon} name="minus"/>
                </Pressable>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("hour", 1)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.increaseHour")}>
                  <Icon style={styles.stepperIcon} name="add"/>
                </Pressable>
              </View>
              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>{t("common.minute")}</Text>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("minute", -1)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.decreaseMinuteBy5")}>
                  <Icon style={styles.stepperIcon} name="minus"/>
                </Pressable>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("minute", 1)} accessibilityRole="button" accessibilityLabel={t("stickerSheet.increaseMinuteBy5")}>
                  <Icon style={styles.stepperIcon} name="add"/>
                </Pressable>
              </View>

              {!editingOverlay || (editingOverlay.type === "datetime" && editingOverlay.properties.mode === "date") ? (
                <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => addDateTime("date")}>
                  <Text style={styles.primaryButtonLabel}>{editingOverlay ? t("stickerSheet.saveDate") : t("stickerSheet.addAsDateSticker")}</Text>
                </Pressable>
              ) : null}
              {!editingOverlay || (editingOverlay.type === "datetime" && editingOverlay.properties.mode === "time") ? (
                <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => addDateTime("time")}>
                  <Text style={styles.primaryButtonLabel}>{editingOverlay ? t("stickerSheet.saveTime") : t("stickerSheet.addAsTimeSticker")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {tab === "stickers" ? (
            <FlatList keyboardShouldPersistTaps="handled"
              data={STICKER_IDS}
              keyExtractor={(s) => s}
              numColumns={4}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.stickerCell}
                  onPress={() => addSticker(item)}
                  accessibilityRole="button"
                  accessibilityLabel={(STICKER_NAMES[item] != null ? t("stickerSheet.add", { value: STICKER_NAMES[item] }) : t("stickerSheet.addSticker"))}
                >
                  <Text style={styles.stickerGlyph}>{STICKER_GLYPHS[item]}</Text>
                </Pressable>
              )}
            />
          ) : null}
        </View>
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: "70%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  editingHeader: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.sm, textTransform: "capitalize" },
  tab: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabLabel: { color: colors.textSecondary, fontSize: 12 },
  tabLabelActive: { color: colors.onAccent, fontWeight: "700" },
  body: { minHeight: 220 },
  festivalRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  festivalGreeting: { flex: 1, minHeight: 48, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  festivalGreetingLabel: { ...typography.body, color: colors.onAccent, fontWeight: "700" },
  festivalEmoji: { width: 48, height: 48, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  emojiCell: { flex: 1 / 6, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  emojiGlyph: { fontSize: 26 },
  stickerCell: { flex: 1 / 4, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  stickerGlyph: { fontSize: 30, color: colors.accentText },
  input: {
    color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  spinner: { marginVertical: spacing.sm },
  resultRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  resultUsername: { color: colors.textSecondary, fontSize: 12 },
  emptyText: { color: colors.textSecondary, textAlign: "center", marginTop: spacing.md },
  secondaryButton: { paddingVertical: spacing.sm, alignItems: "center" },
  secondaryButtonLabel: { color: colors.accentText, fontWeight: "600" },
  errorText: { color: colors.danger, textAlign: "center", marginBottom: spacing.xs },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radii.md, paddingVertical: spacing.sm, alignItems: "center", marginTop: spacing.xs },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonLabel: { color: colors.onAccent, fontWeight: "700" },
  dateTimeRow: { gap: spacing.sm },
  dateTimePreview: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: spacing.xs },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepperLabel: { color: colors.textSecondary, width: 60 },
  stepperButton: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  stepperIcon: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
});
