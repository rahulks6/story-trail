import { useSafeAreaInsets } from "react-native-safe-area-context";
import {Icon} from "./Icon";
import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
} from "../models/storyDraft";

/** Location was turned off for Katkee for good: only Settings can turn it back on. */
function offerLocationSettings(): void {
  Alert.alert("Location is off for Katkee", "To add where you are, allow location in Settings. You can also type a place instead.", [
    { text: "Not now", style: "cancel" },
    { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
  ]);
}

type Tab = "emoji" | "mention" | "location" | "datetime" | "stickers";

const TABS: { key: Tab; label: string }[] = [
  { key: "emoji", label: "Emoji" },
  { key: "mention", label: "Mention" },
  { key: "location", label: "Location" },
  { key: "datetime", label: "Date/Time" },
  { key: "stickers", label: "Stickers" },
];

const STICKER_NAMES: Record<string, string> = {
  spark: "Spark",
  "heart-line": "Heart outline",
  "star-outline": "Star outline",
  wave: "Wave",
  flame: "Flame",
  confetti: "Confetti",
  ring: "Ring",
  bolt: "Bolt",
};

const EMOJI_SET = ["😀", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😇", "🙂", "😉", "😋", "😜", "🤪", "🤗", "🤔", "😏", "😴", "😮", "😱", "😢", "😭", "😅", "😬", "🙄", "😤", "😡", "🤯", "🥺", "😈", "👀", "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "✌️", "🤞", "👋", "💯", "🔥", "✨", "⭐", "🌟", "🎉", "🎂", "🎁", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "💕", "☀️", "🌙", "🌈", "🌸", "🌹", "🍕", "☕", "🍫", "⚽", "🏏", "🎵", "📸", "✈️", "🏖️", "🚗", "🏠", "💼", "📚", "🎓", "💡"];

export type StickerAddPayload =
  | { type: "text"; properties: TextOverlayProperties }
  | { type: "emoji"; properties: EmojiOverlayProperties }
  | { type: "mention"; properties: MentionOverlayProperties }
  | { type: "location"; properties: LocationOverlayProperties }
  | { type: "datetime"; properties: DateTimeOverlayProperties }
  | { type: "sticker"; properties: StickerOverlayProperties };

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
  onEditDone?: (id: string, properties: LocationOverlayProperties | DateTimeOverlayProperties) => void;
}

/**
 * Everything except text (spec section 22): Emoji, Mention, Location,
 * Date, Time, and Katkee's own original stickers — no music tab, no song
 * search, nothing that resembles one (spec section 53's exhaustive "NO
 * MUSIC"). Each selection becomes a regular canvas object via the same
 * `onAdd` → DraggableCanvasObject path text already uses; this sheet only
 * ever hands back type-specific `properties`, never geometry.
 */
export function StickerSheet({ visible, onClose, onAdd, festival, editingOverlay, onEditDone }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("emoji");
  const [mentionQuery, setMentionQuery] = useState("");
  const debouncedMentionQuery = useDebouncedValue(mentionQuery, 300);
  const [mentionResults, setMentionResults] = useState<SearchResult[]>([]);
  const [mentionSearching, setMentionSearching] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!visible) return;
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
          setLocationError("Location permission denied.");
          setLocatingDevice(false);
          return;
        }
      }
      Geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude.toFixed(2);
          const lng = position.coords.longitude.toFixed(2);
          setLocationLabel(`Near ${lat}, ${lng}`);
          setLocatingDevice(false);
        },
        (error) => {
          // PERMISSION_DENIED (1): on iOS the system never asks twice; Settings is the way back.
          if (error?.code === 1) {
            offerLocationSettings();
            setLocationError("Location permission denied.");
          } else {
            setLocationError("Couldn't get your location.");
          }
          setLocatingDevice(false);
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    } catch {
      setLocationError("Location isn't available on this device.");
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
        ? pickerDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : pickerDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      {/* Mention search's TextInput/FlatList sit inside this sheet — without
          keyboard avoidance, an opening keyboard would cover the results
          list the same way it used to cover TextToolModal's controls. */}
      <KeyboardAvoider style={[styles.sheet, { paddingBottom: spacing.xl + bottomInset }]} behavior="padding">
        <View style={styles.handle} />
        {editingOverlay ? (
          <Text style={styles.editingHeader}>Editing {editingOverlay.type === "location" ? "location" : "date/time"}</Text>
        ) : (
          <View style={styles.tabRow}>
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.tab, tab === t.key && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.key }}
              >
                <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.body}>
          {tab === "emoji" && festival ? (
            <View style={styles.festivalRow}>
              <Pressable
                style={styles.festivalGreeting}
                onPress={() => {
                  onAdd({ type: "text", properties: { text: `${festival.emoji} ${festival.greeting}`, style: "Bold", color: "#FFFFFF", backgroundColor: null, align: "center", fontSize: 0.055 } });
                  close();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${festival.greeting}`}
              >
                <Text style={styles.festivalGreetingLabel} numberOfLines={1}>{festival.emoji} {festival.greeting}</Text>
              </Pressable>
              <Pressable style={styles.festivalEmoji} onPress={() => addEmoji(festival.emoji)} accessibilityRole="button" accessibilityLabel={`Add ${festival.name} emoji`}>
                <Text style={styles.emojiGlyph}>{festival.emoji}</Text>
              </Pressable>
            </View>
          ) : null}
          {tab === "emoji" ? (
            <FlatList
              data={EMOJI_SET}
              keyExtractor={(e) => e}
              numColumns={6}
              renderItem={({ item }) => (
                <Pressable style={styles.emojiCell} onPress={() => addEmoji(item)} accessibilityRole="button" accessibilityLabel={`Add ${item} emoji`}>
                  <Text style={styles.emojiGlyph}>{item}</Text>
                </Pressable>
              )}
            />
          ) : null}

          {tab === "mention" ? (
            <View>
              <TextInput
                style={styles.input}
                placeholder="Search people…"
                placeholderTextColor={colors.textDisabled}
                value={mentionQuery}
                onChangeText={setMentionQuery}
                autoFocus
              />
              {mentionSearching ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
              <FlatList
                data={mentionResults}
                keyExtractor={(u) => u.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.resultRow}
                    onPress={() => addMention(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Mention ${item.displayName}${item.verified ? ", verified" : ""}, @${item.username}`}
                  >
                    <VerifiedName name={item.displayName} verified={item.verified} style={typography.body} />
                    <Text style={styles.resultUsername}>@{item.username}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  debouncedMentionQuery.trim().length >= 2 && !mentionSearching ? (
                    <Text style={styles.emptyText}>No one found.</Text>
                  ) : undefined
                }
              />
            </View>
          ) : null}

          {tab === "location" ? (
            <View>
              <TextInput
                style={styles.input}
                placeholder="Add a location…"
                placeholderTextColor={colors.textDisabled}
                value={locationLabel}
                onChangeText={setLocationLabel}
              />
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={useCurrentLocation} disabled={locatingDevice}>
                {locatingDevice ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.secondaryButtonLabel}>Use current location</Text>}
              </Pressable>
              {locationError ? <Text style={styles.errorText}>{locationError}</Text> : null}
              <Pressable accessibilityRole="button" style={[styles.primaryButton, !locationLabel.trim() && styles.primaryButtonDisabled]} disabled={!locationLabel.trim()} onPress={addLocation}>
                <Text style={styles.primaryButtonLabel}>{editingOverlay ? "Save" : "Add"}</Text>
              </Pressable>
            </View>
          ) : null}

          {tab === "datetime" ? (
            <View style={styles.dateTimeRow}>
              <Text style={styles.dateTimePreview}>
                {pickerDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {"  ·  "}
                {pickerDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </Text>

              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>Day</Text>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("day", -1)} accessibilityRole="button" accessibilityLabel="Previous day">
                  <Icon style={styles.stepperIcon} name="minus"/>
                </Pressable>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("day", 1)} accessibilityRole="button" accessibilityLabel="Next day">
                  <Icon style={styles.stepperIcon} name="add"/>
                </Pressable>
              </View>
              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>Hour</Text>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("hour", -1)} accessibilityRole="button" accessibilityLabel="Decrease hour">
                  <Icon style={styles.stepperIcon} name="minus"/>
                </Pressable>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("hour", 1)} accessibilityRole="button" accessibilityLabel="Increase hour">
                  <Icon style={styles.stepperIcon} name="add"/>
                </Pressable>
              </View>
              <View style={styles.stepperRow}>
                <Text style={styles.stepperLabel}>Minute</Text>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("minute", -1)} accessibilityRole="button" accessibilityLabel="Decrease minute by 5">
                  <Icon style={styles.stepperIcon} name="minus"/>
                </Pressable>
                <Pressable style={styles.stepperButton} onPress={() => adjustPicker("minute", 1)} accessibilityRole="button" accessibilityLabel="Increase minute by 5">
                  <Icon style={styles.stepperIcon} name="add"/>
                </Pressable>
              </View>

              {!editingOverlay || (editingOverlay.type === "datetime" && editingOverlay.properties.mode === "date") ? (
                <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => addDateTime("date")}>
                  <Text style={styles.primaryButtonLabel}>{editingOverlay ? "Save date" : "Add as date sticker"}</Text>
                </Pressable>
              ) : null}
              {!editingOverlay || (editingOverlay.type === "datetime" && editingOverlay.properties.mode === "time") ? (
                <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => addDateTime("time")}>
                  <Text style={styles.primaryButtonLabel}>{editingOverlay ? "Save time" : "Add as time sticker"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {tab === "stickers" ? (
            <FlatList
              data={STICKER_IDS}
              keyExtractor={(s) => s}
              numColumns={4}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.stickerCell}
                  onPress={() => addSticker(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${STICKER_NAMES[item] ?? "sticker"}`}
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
  stickerGlyph: { fontSize: 30, color: colors.accent },
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
  secondaryButtonLabel: { color: colors.accent, fontWeight: "600" },
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
