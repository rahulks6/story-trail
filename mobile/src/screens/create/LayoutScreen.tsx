import React, { useRef, useState } from "react";
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { launchImageLibrary } from "react-native-image-picker";
import { captureRef } from "react-native-view-shot";
import { Pressable } from "../../components/Pressable";
import { Icon } from "../../components/Icon";
import { mediaColors as colors, radii, spacing, ICONS } from "../../theme";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import { LAYOUTS, LAYOUT_OUTPUT, type StoryLayout } from "../../models/layouts";
import type { CreateStackParamList } from "../../navigation/types";
import { tapFeedback } from "../../utils/haptics";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<CreateStackParamList, "Layout">;

const GAP = 3;

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

/**
 * Camera > Layout: several photos in one Story. Choose a grid, tap each space to pick a photo from
 * the gallery (tap again to change it), then Next: the collage is saved as one 9:16 photo and
 * opens in the Story editor like any other photo, for text, stickers, music and the rest.
 */
export function LayoutScreen({ navigation }: Props): React.JSX.Element {
  useMediaStatusBar();
  const insets = useScreenInsets();
  const { width, height } = useWindowDimensions();
  const [layout, setLayout] = useState<StoryLayout>(LAYOUTS[0]!);
  const [photos, setPhotos] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<React.ComponentRef<typeof View>>(null);

  // The 9:16 frame, as large as fits between the top bar and the layout chooser.
  const frameHeight = Math.min(height - insets.top - insets.bottom - 190, ((width - spacing.lg * 2) * 16) / 9);
  const frameWidth = (frameHeight * 9) / 16;
  const filled = layout.cells.every((_, i) => !!photos[i]);

  const choose = (next: StoryLayout) => {
    tapFeedback("select");
    setLayout(next);
    // Photos already chosen keep their places in the new layout, as far as it has room.
    setPhotos((current) => current.slice(0, next.cells.length));
  };

  const pick = async (index: number) => {
    const result = await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, assetRepresentationMode: "compatible", maxWidth: 2048, maxHeight: 2048, quality: 0.9 });
    if (result.errorCode === "permission") {
      Alert.alert(t("common.allowPhotoAccess"), t("layout.allowPhotos"), [
        { text: t("common.notNow"), style: "cancel" },
        { text: t("common.openSettings"), onPress: () => void Linking.openSettings().catch(() => undefined) },
      ]);
      return;
    }
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;
    setPhotos((current) => {
      const next = [...current];
      next[index] = uri;
      return next;
    });
  };

  const next = async () => {
    if (!filled || saving || !canvas.current) return;
    setSaving(true);
    try {
      const file = await captureRef(canvas, { format: "jpg", quality: 0.92, width: LAYOUT_OUTPUT.width, height: LAYOUT_OUTPUT.height, result: "tmpfile" });
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.round} accessibilityRole="button" accessibilityLabel={t("common.close")}>
          <Icon name={ICONS.close} size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{t("layout.title")}</Text>
        <Pressable onPress={() => void next()} disabled={!filled || saving} style={[styles.next, (!filled || saving) && styles.nextOff]} accessibilityRole="button" accessibilityState={{ disabled: !filled || saving }}>
          <Text style={styles.nextLabel}>{t("layout.next")}</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <View ref={canvas} collapsable={false} style={[styles.frame, { width: frameWidth, height: frameHeight }]}>
          {layout.cells.map((cell, i) => {
            const photo = photos[i];
            return (
              <Pressable
                key={`${layout.id}-${i}`}
                onPress={() => void pick(i)}
                pressEffect="highlight"
                style={[styles.cell, { left: cell.x * frameWidth + GAP / 2, top: cell.y * frameHeight + GAP / 2, width: cell.w * frameWidth - GAP, height: cell.h * frameHeight - GAP }]}
                accessibilityRole="button"
                accessibilityLabel={photo ? t("layout.changePhoto", { n: i + 1 }) : t("layout.addPhoto", { n: i + 1 })}
              >
                {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Icon name={ICONS.add} size={28} color={colors.textPrimary} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chooser} accessibilityRole="radiogroup" accessibilityLabel={t("layout.chooseLayout")}>
        {LAYOUTS.map((option) => (
          <Pressable key={option.id} onPress={() => choose(option)} accessibilityRole="radio" accessibilityState={{ selected: option.id === layout.id }}
            accessibilityLabel={t("layout.photos", { count: option.cells.length })} hitSlop={6}>
            <LayoutIcon layout={option} selected={option.id === layout.id} />
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.hint}>{filled ? t("layout.readyHint") : t("layout.tapToAdd")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, minHeight: 44 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
  next: { paddingHorizontal: spacing.lg, height: 36, borderRadius: radii.pill, justifyContent: "center", backgroundColor: colors.accent },
  nextOff: { opacity: 0.4 },
  nextLabel: { color: colors.onAccent, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { backgroundColor: "#111111", borderRadius: radii.md, overflow: "hidden" },
  cell: { position: "absolute", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderRadius: 4 },
  chooser: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: "center", flexGrow: 1, justifyContent: "center" },
  layoutIcon: { borderRadius: 4, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.4)" },
  layoutIconOn: { borderColor: colors.accent },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center", marginTop: spacing.xs },
});
