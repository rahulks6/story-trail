import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, ICONS } from "../theme";
import { Icon } from "./Icon";
import type { TextOverlayProperties, TextStyle } from "../models/storyDraft";

const STYLES: TextStyle[] = ["Clean", "Bold", "Classic", "Modern", "Typewriter", "Outline", "Soft", "Highlight"];
const COLORS = ["#F5F3EF", "#000000", "#F5B400", "#FF8A00", "#E4483C", "#FF5DA2", "#A45CFF", "#3E7BFF", "#2EC4E6", "#3FBF7F", "#9A6B4F", "#8E8E93"];
const ALIGNS: TextOverlayProperties["align"][] = ["left", "center", "right"];
const FONT_SIZE_STEPS = [0.03, 0.04, 0.045, 0.055, 0.07, 0.09];

interface Props {
  visible: boolean;
  initialText?: string;
  initialProperties?: TextOverlayProperties;
  onCancel: () => void;
  onDone: (text: string, properties: TextOverlayProperties) => void;
}

/**
 * Text composer (spec section 20), over the dimmed photo: the keyboard opens straight away, the
 * text previews in its colour, size, alignment and background, and Done places it as a movable
 * overlay. Done with nothing typed just closes.
 */
export function TextToolModal({ visible, initialText, initialProperties, onCancel, onDone }: Props): React.JSX.Element {
  const [text, setText] = useState(initialText ?? "");
  const [style, setStyle] = useState<TextStyle>(initialProperties?.style ?? "Clean");
  const [color, setColor] = useState(initialProperties?.color ?? COLORS[0]);
  const [hasBackground, setHasBackground] = useState(initialProperties?.backgroundColor !== null && initialProperties?.backgroundColor !== undefined);
  const [align, setAlign] = useState<TextOverlayProperties["align"]>(initialProperties?.align ?? "center");
  const [fontSizeIndex, setFontSizeIndex] = useState(() => {
    const initial = initialProperties?.fontSize ?? FONT_SIZE_STEPS[2];
    let closest = 0;
    let closestDiff = Infinity;
    FONT_SIZE_STEPS.forEach((v, i) => {
      const diff = Math.abs(v - initial);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = i;
      }
    });
    return closest;
  });

  const insets = useSafeAreaInsets();
  const nextAlign = () => setAlign((a) => ALIGNS[(ALIGNS.indexOf(a) + 1) % ALIGNS.length]!);
  const alignIcon = align === "left" ? ICONS.alignLeft : align === "right" ? ICONS.alignRight : ICONS.alignCenter;
  const done = () => {
    if (!text.trim()) {
      onCancel();
      return;
    }
    onDone(text, { text, style, color, backgroundColor: hasBackground ? "#000000" : null, align, fontSize: FONT_SIZE_STEPS[fontSizeIndex] });
  };

  return (
    // The photo stays visible, dimmed, behind the text being written (like Instagram).
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onCancel}>
      {/*
        The keyboard opens straight away and every control sits above it, so it has to be
        avoided: `padding` shrinks this view on iOS; `height` on Android.
      */}
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12}>
            <Text style={styles.topAction}>Cancel</Text>
          </Pressable>
          <View style={styles.topTools}>
            <Pressable onPress={nextAlign} hitSlop={10} style={styles.toolButton} accessibilityRole="button" accessibilityLabel={`Alignment: ${align}`} accessibilityHint="Changes the text alignment">
              <Icon name={alignIcon} size={22} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={() => setHasBackground((v) => !v)}
              hitSlop={10}
              style={[styles.toolButton, hasBackground && styles.toolButtonOn]}
              accessibilityRole="switch"
              accessibilityLabel="Text background"
              accessibilityState={{ checked: hasBackground }}
            >
              <Icon name={ICONS.textBackground} size={22} color={hasBackground ? colors.onAccent : colors.textPrimary} />
            </Pressable>
            <Pressable onPress={() => setFontSizeIndex((i) => Math.max(0, i - 1))} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="Smaller text">
              <Text style={styles.sizeSmall}>A</Text>
            </Pressable>
            <Pressable onPress={() => setFontSizeIndex((i) => Math.min(FONT_SIZE_STEPS.length - 1, i + 1))} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="Larger text">
              <Text style={styles.sizeLarge}>A</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={done} hitSlop={12}>
            <Text style={[styles.topAction, styles.doneAction]}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.inputArea}>
          <View style={[styles.inputBox, hasBackground && styles.inputBoxOn, { alignSelf: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center" }]}>
            <TextInput
              autoFocus
              multiline
              style={[styles.input, { color, textAlign: align, fontSize: 18 + fontSizeIndex * 5 }]}
              placeholder="Type something…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={text}
              onChangeText={setText}
            />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.colorsRow}>
          {COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              hitSlop={4}
              style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
              accessibilityRole="button"
              accessibilityLabel={`Text colour ${c}`}
              accessibilityState={{ selected: color === c }}
            />
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.stylesRow}>
          {STYLES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setStyle(s)}
              style={[styles.styleChip, style === s && styles.styleChipActive]}
              accessibilityRole="button"
              accessibilityLabel={`${s} text style`}
              accessibilityState={{ selected: style === s }}
            >
              <Text style={[styles.styleChipLabel, style === s && styles.styleChipLabelActive]}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)", paddingHorizontal: spacing.md },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  topTools: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  toolButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  toolButtonOn: { backgroundColor: colors.textPrimary },
  sizeSmall: { color: colors.textPrimary, fontSize: 14, fontWeight: "700" },
  sizeLarge: { color: colors.textPrimary, fontSize: 22, fontWeight: "700" },
  topAction: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  doneAction: { color: colors.accent, fontWeight: "700" },
  inputArea: { flex: 1, justifyContent: "center" },
  inputBox: { maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.sm },
  inputBoxOn: { backgroundColor: "rgba(0,0,0,0.55)" },
  input: { fontWeight: "600", minWidth: 40 },
  colorsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  colorSwatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  colorSwatchActive: { borderColor: colors.accent, borderWidth: 3, transform: [{ scale: 1.15 }] },
  stylesRow: { flexDirection: "row", gap: spacing.xs, paddingBottom: spacing.xs },
  styleChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: "rgba(0,0,0,0.3)" },
  styleChipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  styleChipLabel: { color: colors.textPrimary, fontSize: 13 },
  styleChipLabelActive: { color: colors.background, fontWeight: "700" },
});
