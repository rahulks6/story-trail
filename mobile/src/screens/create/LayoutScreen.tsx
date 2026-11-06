import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, PanResponder, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { launchImageLibrary } from "react-native-image-picker";
import { captureRef } from "react-native-view-shot";
import { Pressable } from "../../components/Pressable";
import { Icon } from "../../components/Icon";
import { ActionSheet } from "../../components/ActionSheet";
import { mediaColors as colors, radii, spacing, ICONS } from "../../theme";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import { LAYOUTS, LAYOUT_OUTPUT, MAX_LAYOUT_PHOTOS, dragPhoto, layoutFor, photoFrame, type LayoutPhoto, type StoryLayout } from "../../models/layouts";
import type { CreateStackParamList } from "../../navigation/types";
import { tapFeedback } from "../../utils/haptics";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<CreateStackParamList, "Layout">;

const GAP = 3;
/** Room under the frame: the layout chooser, the main button and its hint. */
const BOTTOM_ROOM = 236;

/** A small drawing of a layout, for its chooser button. */
function LayoutIcon({ layout, selected }: { layout: StoryLayout; selected: boolean }): React.JSX.Element {
  const w = 30, h = 52;
  return (
    <View style={[styles.layoutIcon, { width: w, height: h }, selected && styles.layoutIconOn]}>
      {layout.cells.map((c, i) => (
        <View key={i} style={{ position: "absolute", left: c.x * w + 1, top: c.y * h + 1, width: c.w * w - 2, height: c.h * h - 2, borderRadius: 2, backgroundColor: selected ? colors.accent : "rgba(255,255,255,0.7)" }} />
      ))}
    </View>
  );
}

interface Box { left: number; top: number; width: number; height: number }

/**
 * One space of the layout. Empty: a + to choose its photo. Filled: the photo, which follows your
 * finger to show the part you want (a drag), or offers Replace and Remove (a tap).
 */
function Space({ index, box, photo, onEmpty, onFilled, onMoved }: {
  index: number; box: Box; photo: LayoutPhoto | null;
  onEmpty: (index: number) => void; onFilled: (index: number) => void; onMoved: (index: number, at: { x: number; y: number }) => void;
}): React.JSX.Element {
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ photo, box, onMoved });
  latest.current = { photo, box, onMoved };
  const pan = useMemo(() => PanResponder.create({
    // Taken from the tap once the finger really moves, and only on a photo that has room to move.
    onMoveShouldSetPanResponderCapture: (_, g) => {
      const { photo: p, box: b } = latest.current;
      return !!p && !!photoFrame(p, b.width, b.height) && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      const { photo: p, box: b } = latest.current;
      if (p) setLive(dragPhoto(p, g.dx, g.dy, b.width, b.height));
    },
    onPanResponderRelease: (_, g) => {
      const { photo: p, box: b, onMoved: done } = latest.current;
      if (p) done(index, dragPhoto(p, g.dx, g.dy, b.width, b.height));
      setLive(null);
    },
    onPanResponderTerminate: () => setLive(null),
  }), [index]);

  const shown = photo && live ? { ...photo, ...live } : photo;
  const frame = shown ? photoFrame(shown, box.width, box.height) : null;
  return (
    <View {...pan.panHandlers} collapsable={false} style={[styles.cell, box]}>
      <Pressable
        onPress={() => (photo ? onFilled(index) : onEmpty(index))}
        pressEffect="highlight"
        style={styles.cellFill}
        accessibilityRole="button"
        accessibilityLabel={photo ? t("layout.changePhoto", { n: index + 1 }) : t("layout.addPhoto", { n: index + 1 })}
      >
        {shown ? (
          <Image source={{ uri: shown.uri }} style={frame ? { position: "absolute", ...frame } : StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.addMark}><Icon name={ICONS.add} size={22} color={colors.textPrimary} /></View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Camera > Layout: several photos in one Story. "Add photos" picks up to six at once and chooses a
 * layout that fits them; the button below always says what's next ("Add 2 more photos", then
 * "Next"), so there is never a greyed-out button and no guessing. Drag a photo to frame it; tap
 * it to replace or remove it; change the layout below. Next saves the collage as one 9:16 photo
 * and opens it in the Story editor, where it's shared like any photo (Your Story / Close Friends).
 */
export function LayoutScreen({ navigation }: Props): React.JSX.Element {
  useMediaStatusBar();
  const insets = useScreenInsets();
  const { width, height } = useWindowDimensions();
  const [layout, setLayout] = useState<StoryLayout>(LAYOUTS[0]!);
  const [photos, setPhotos] = useState<(LayoutPhoto | null)[]>([]);
  const [options, setOptions] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<React.ComponentRef<typeof View>>(null);

  // The 9:16 frame, as large as fits between the top bar and the controls below.
  const frameHeight = Math.max(200, Math.min(height - insets.top - insets.bottom - BOTTOM_ROOM, ((width - spacing.lg * 2) * 16) / 9));
  const frameWidth = (frameHeight * 9) / 16;
  const empties = layout.cells.map((_, i) => i).filter((i) => !photos[i]);
  const filled = empties.length === 0;
  const none = empties.length === layout.cells.length;

  const pick = async (limit: number): Promise<LayoutPhoto[]> => {
    const result = await launchImageLibrary({ mediaType: "photo", selectionLimit: limit, assetRepresentationMode: "compatible", maxWidth: 2048, maxHeight: 2048, quality: 0.9 });
    if (result.errorCode === "permission") {
      Alert.alert(t("common.allowPhotoAccess"), t("layout.allowPhotos"), [
        { text: t("common.notNow"), style: "cancel" },
        { text: t("common.openSettings"), onPress: () => void Linking.openSettings().catch(() => undefined) },
      ]);
      return [];
    }
    return (result.assets ?? []).filter((a) => !!a.uri).slice(0, limit).map((a) => ({ uri: a.uri!, width: a.width, height: a.height, x: 0, y: 0 }));
  };

  /** Puts photos into the given spaces, in order. */
  const fill = (slots: number[], picked: LayoutPhoto[]) => {
    if (!picked.length) return;
    tapFeedback("select");
    setPhotos((current) => {
      const next = [...current];
      slots.forEach((slot, i) => { if (picked[i]) next[slot] = picked[i]!; });
      return next;
    });
  };

  // The one main button: add photos (choosing a layout for them), add the rest, or go on.
  const primary = async () => {
    if (saving) return;
    if (filled) return void next();
    if (none) {
      const picked = await pick(MAX_LAYOUT_PHOTOS);
      if (!picked.length) return;
      tapFeedback("select");
      const fitting = layoutFor(picked.length);
      setLayout(fitting);
      setPhotos(picked.slice(0, fitting.cells.length));
      return;
    }
    fill(empties, await pick(empties.length));
  };

  const choose = (option: StoryLayout) => {
    tapFeedback("select");
    setLayout(option);
    // Photos already chosen keep their places in the new layout, as far as it has room.
    setPhotos((current) => current.slice(0, option.cells.length));
  };

  const next = async () => {
    if (!filled || saving || !canvas.current) return;
    setSaving(true);
    try {
      const file = await captureRef(canvas, { format: "jpg", quality: 0.92, width: LAYOUT_OUTPUT.width, height: LAYOUT_OUTPUT.height, result: "tmpfile" });
      tapFeedback("success");
      navigation.replace("StoryEditor", {
        mediaUri: file.startsWith("file://") ? file : `file://${file}`,
        kind: "photo",
        mimeType: "image/jpeg",
        width: LAYOUT_OUTPUT.width,
        height: LAYOUT_OUTPUT.height,
      });
    } catch {
      Alert.alert(t("layout.couldntMake"), t("common.pleaseTryAgain"));
      setSaving(false);
    }
  };

  const primaryLabel = filled ? t("layout.next") : none ? t("layout.addPhotos") : t("layout.addMore", { count: empties.length });
  const hint = filled ? t("layout.dragHint") : none ? t("layout.pickUpTo") : t("layout.tapSpace");

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.round} accessibilityRole="button" accessibilityLabel={t("common.close")}>
          <Icon name={ICONS.close} size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{t("layout.title")}</Text>
        <View style={styles.round} />
      </View>

      <View style={styles.center}>
        <View ref={canvas} collapsable={false} style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
          {layout.cells.map((cell, i) => (
            <Space
              key={`${layout.id}-${i}`}
              index={i}
              photo={photos[i] ?? null}
              box={{ left: cell.x * frameWidth + GAP / 2, top: cell.y * frameHeight + GAP / 2, width: cell.w * frameWidth - GAP, height: cell.h * frameHeight - GAP }}
              onEmpty={(slot) => void pick(1).then((picked) => fill([slot], picked))}
              onFilled={setOptions}
              onMoved={(slot, at) => setPhotos((current) => current.map((p, j) => (j === slot && p ? { ...p, ...at } : p)))}
            />
          ))}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chooserScroll} contentContainerStyle={styles.chooser} accessibilityRole="radiogroup" accessibilityLabel={t("layout.chooseLayout")}>
        {LAYOUTS.map((option) => (
          <Pressable key={option.id} onPress={() => choose(option)} accessibilityRole="radio" accessibilityState={{ selected: option.id === layout.id }}
            accessibilityLabel={t("layout.photos", { count: option.cells.length })} hitSlop={6}>
            <LayoutIcon layout={option} selected={option.id === layout.id} />
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.bottom}>
        <Pressable onPress={() => void primary()} disabled={saving} style={[styles.primary, filled && styles.primaryReady]} accessibilityRole="button" accessibilityState={{ busy: saving }} accessibilityLabel={saving ? t("layout.making") : primaryLabel}>
          {saving ? <ActivityIndicator color={colors.onAccent} /> : <Icon name={filled ? ICONS.right : ICONS.gallery} size={20} color={filled ? colors.onAccent : colors.textPrimary} />}
          <Text style={[styles.primaryLabel, filled && styles.primaryLabelReady]}>{saving ? t("layout.making") : primaryLabel}</Text>
        </Pressable>
        <Text style={styles.hint}>{hint}</Text>
      </View>

      <ActionSheet
        visible={options !== null}
        title={options !== null ? t("layout.photoN", { n: options + 1 }) : undefined}
        groups={[[
          { label: t("layout.replacePhoto"), onPress: () => { const slot = options; if (slot !== null) void pick(1).then((picked) => fill([slot], picked)); } },
          { label: t("layout.removePhoto"), destructive: true, onPress: () => { const slot = options; if (slot !== null) setPhotos((current) => current.map((p, j) => (j === slot ? null : p))); } },
        ]]}
        onClose={() => setOptions(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, minHeight: 44 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { backgroundColor: "#111111", borderRadius: radii.md, overflow: "hidden" },
  cell: { position: "absolute", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 4 },
  cellFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  addMark: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)" },
  chooserScroll: { flexGrow: 0 },
  chooser: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center", flexGrow: 1, justifyContent: "center" },
  layoutIcon: { borderRadius: 4, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.4)" },
  layoutIconOn: { borderColor: colors.accent },
  bottom: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  primary: { flexDirection: "row", gap: spacing.sm, height: 52, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  primaryReady: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  primaryLabelReady: { color: colors.onAccent },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center", minHeight: 36 },
});
