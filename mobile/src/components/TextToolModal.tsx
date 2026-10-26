import React, { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Modal, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaColors as colors, radii, spacing, ICONS } from "../theme";
import { Icon } from "./Icon";
import { contrastOn, neonCore, neonRadius, STYLE_LABELS, TEXT_STYLES, textStyleLook, tightTextFits } from "./textLook";
import type { TextOverlayProperties, TextStyle } from "../models/storyDraft";
import { tapFeedback } from "../utils/haptics";

const COLORS = ["#FFFFFF", "#000000", "#F5B400", "#FF8A00", "#E4483C", "#FF5DA2", "#A45CFF", "#3E7BFF", "#2EC4E6", "#3FBF7F", "#9A6B4F", "#8E8E93"];
const ALIGNS: TextOverlayProperties["align"][] = ["center", "left", "right"];
/** Text size on the Story, as a fraction of its height. */
const MIN_SIZE = 0.025;
const MAX_SIZE = 0.1;
const DEFAULT_SIZE = 0.045;
/** The Neon chip glows pink whatever colour is chosen, so it always looks like neon. */
const NEON_CHIP_GLOW = "#FF3EA5";
const SLIDER_HEIGHT = 200;
/** The server keeps this much of a Story's text (stories/dto.ts): more would be cut off on the Story. */
const MAX_TEXT_LENGTH = 280;

interface Props {
  visible: boolean;
  initialText?: string;
  initialProperties?: TextOverlayProperties;
  onCancel: () => void;
  onDone: (text: string, properties: TextOverlayProperties) => void;
  /** The Story canvas's height, so the text is previewed at the size it will have on the photo. */
  canvasHeight?: number;
}

/**
 * Instagram's text tool, over the dimmed photo: the keyboard opens straight away; the styles sit
 * right above it (each name written in its own font); the colour button swaps them for colours;
 * the slider on the left sets the size; "A" puts the text on a label in the chosen colour. Tapping
 * anywhere outside the text, or Done, places it. Nothing typed just closes.
 */
export function TextToolModal({ visible, initialText, initialProperties, onCancel, onDone, canvasHeight }: Props): React.JSX.Element {
  const [text, setText] = useState(initialText ?? "");
  const [style, setStyle] = useState<TextStyle>(initialProperties?.style ?? "Clean");
  const hadBackground = initialProperties?.backgroundColor != null;
  // With a label, the chosen colour is the label's; the text is black or white on it.
  const [color, setColor] = useState(hadBackground ? initialProperties!.backgroundColor! : initialProperties?.color ?? COLORS[0]!);
  const [hasBackground, setHasBackground] = useState(hadBackground);
  const [align, setAlign] = useState<TextOverlayProperties["align"]>(initialProperties?.align ?? "center");
  const [size, setSize] = useState(initialProperties?.fontSize ?? DEFAULT_SIZE);
  const [picking, setPicking] = useState<"styles" | "colors">("styles");
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  const textColor = hasBackground ? contrastOn(color) : color;
  // Neon glows only without a label; on a label it is plain text, as on the Story.
  const neon = style === "Highlight" && !hasBackground;
  const done = () => {
    if (!text.trim()) {
      onCancel();
      return;
    }
    onDone(text, { text, style, color: textColor, backgroundColor: hasBackground ? color : null, align, fontSize: size });
  };

  // The size slider: drag up for bigger, down for smaller.
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const slider = useMemo(() => {
    let start = DEFAULT_SIZE;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start = sizeRef.current; },
      onPanResponderMove: (_e, g) => {
        const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, start - (g.dy / SLIDER_HEIGHT) * (MAX_SIZE - MIN_SIZE)));
        setSize(next);
      },
    });
  }, []);
  const sliderFraction = (size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);

  const nextAlign = () => setAlign((a) => ALIGNS[(ALIGNS.indexOf(a) + 1) % ALIGNS.length]!);
  const alignIcon = align === "left" ? ICONS.alignLeft : align === "right" ? ICONS.alignRight : ICONS.alignCenter;
  // The preview is the size it will be on a full-screen Story.
  const previewSize = Math.round(size * (canvasHeight && canvasHeight > 0 ? canvasHeight : 760));

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={done}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm, paddingBottom: Math.max(keyboard, insets.bottom) + spacing.xs }]}>
        <View style={styles.topBar}>
          <View style={styles.topTools}>
            <Pressable onPress={nextAlign} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel={`Alignment: ${align}`} accessibilityHint="Changes the text alignment">
              <Icon name={alignIcon} size={24} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={() => { setPicking((p) => (p === "colors" ? "styles" : "colors")); tapFeedback("select"); }}
              hitSlop={8}
              style={[styles.toolButton, picking === "colors" && styles.toolButtonOn]}
              accessibilityRole="button"
              accessibilityLabel={picking === "colors" ? "Show text styles" : "Show colours"}
            >
              <View style={[styles.colorDot, { backgroundColor: color }]} />
            </Pressable>
            <Pressable
              onPress={() => setHasBackground((v) => !v)}
              hitSlop={8}
              style={[styles.toolButton, hasBackground && styles.toolButtonOn]}
              accessibilityRole="switch"
              accessibilityLabel="Text background"
              accessibilityState={{ checked: hasBackground }}
            >
              <Icon name={ICONS.textBackground} size={24} color={hasBackground ? colors.background : colors.textPrimary} />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={done} hitSlop={12} style={styles.doneButton}>
            <Text style={styles.doneLabel}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.middle}>
          {/* Tapping the dimmed photo around the text places it, like Instagram. */}
          <Pressable pressEffect="none" style={StyleSheet.absoluteFill} onPress={done} accessible={false} accessibilityRole="button" accessibilityLabel="Place the text" />
          <View style={styles.slider} {...slider.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Text size"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(sliderFraction * 100) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => setSize((s) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, s + (e.nativeEvent.actionName === "increment" ? 0.01 : -0.01))))}
          >
            <View style={styles.sliderTrack} />
            <View style={[styles.sliderThumb, { top: (1 - sliderFraction) * (SLIDER_HEIGHT - 22) }]} />
          </View>
          <View style={[styles.inputBox, hasBackground && { backgroundColor: color, borderRadius: previewSize * 0.28, paddingHorizontal: previewSize * 0.35, paddingVertical: previewSize * 0.12 }, { alignSelf: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center" }]}>
            <TextInput
              allowFontScaling={false}
              autoFocus
              multiline
              // Previews the chosen style, colour and size as it will appear on the Story.
              style={[
                styles.input,
                { fontSize: previewSize },
                textStyleLook(style, textColor, previewSize),
                { color: neon ? neonCore(textColor) : textColor, textAlign: align, includeFontPadding: !tightTextFits(text) },
                // Room for the glow, which Android cuts off at the text's edges.
                neon && { padding: neonRadius(previewSize) },
                style === "Highlight" && !neon && { textShadowRadius: 0 },
              ]}
              placeholder="Type something…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={text}
              onChangeText={setText}
              maxLength={MAX_TEXT_LENGTH}
              // A see-through highlight, so selecting text never paints over a coloured label.
              cursorColor={textColor}
              selectionColor="rgba(255,255,255,0.35)"
              textAlignVertical="center"
              scrollEnabled={false}
            />
          </View>
        </View>

        {picking === "styles" ? (
          <ScrollView key="styles" horizontal style={styles.row} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.rowContent}>
            {TEXT_STYLES.map((s) => (
              <Pressable
                key={s}
                onPress={() => { setStyle(s); tapFeedback("select"); }}
                style={[styles.styleChip, style === s && styles.styleChipActive]}
                accessibilityRole="button"
                accessibilityLabel={`${STYLE_LABELS[s]} text style`}
                accessibilityState={{ selected: style === s }}
              >
                {/* Each name is written in its own style, so you see the look before choosing. */}
                <Text style={[styles.styleChipLabel, textStyleLook(s, s === "Highlight" ? NEON_CHIP_GLOW : style === s ? colors.background : colors.textPrimary, 15), s === "Highlight" && styles.neonChipLabel, style === s && styles.styleChipLabelActive]} numberOfLines={1}>
                  {STYLE_LABELS[s]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <ScrollView key="colors" horizontal style={styles.row} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.rowContent}>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => { setColor(c); tapFeedback("select"); }}
                hitSlop={4}
                style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
                accessibilityRole="button"
                accessibilityLabel={`Text colour ${c}`}
                accessibilityState={{ selected: color === c }}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/**
 * How far the keyboard covers the screen. The modal draws edge-to-edge on Android, where the
 * window isn't resized for the keyboard, so the controls are lifted by hand to sit right on it.
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: spacing.md },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 },
  topTools: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toolButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  toolButtonOn: { backgroundColor: colors.textPrimary },
  colorDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: "#FFFFFF" },
  doneButton: { paddingHorizontal: spacing.md, minHeight: 40, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.textPrimary, justifyContent: "center" },
  doneLabel: { color: colors.background, fontSize: 16, fontWeight: "700" },
  middle: { flex: 1, justifyContent: "center", paddingLeft: 36 },
  slider: { position: "absolute", left: -4, top: "50%", marginTop: -SLIDER_HEIGHT / 2, width: 36, height: SLIDER_HEIGHT, alignItems: "center" },
  sliderTrack: { position: "absolute", top: 8, bottom: 8, width: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.6)" },
  sliderThumb: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "rgba(0,0,0,0.2)" },
  inputBox: { maxWidth: "100%", paddingHorizontal: 6, paddingVertical: 2 },
  // Android pads text for accents above and below; without it the label hugs the words
  // (Latin text only, see tightTextFits: an emoji needs that room).
  input: { minWidth: 40, padding: 0 },
  // A horizontal list must not grow to fill the screen (it stretched the style buttons into tall ovals).
  row: { flexGrow: 0, flexShrink: 0 },
  rowContent: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "rgba(255,255,255,0.9)" },
  colorSwatchActive: { borderColor: colors.accentText, borderWidth: 3, transform: [{ scale: 1.15 }] },
  styleChip: { minHeight: 38, paddingVertical: 6, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: "rgba(0,0,0,0.45)" },
  styleChipActive: { backgroundColor: colors.textPrimary },
  styleChipLabel: { color: colors.textPrimary, fontSize: 15 },
  styleChipLabelActive: { color: colors.background },
  neonChipLabel: { textShadowRadius: 6 },
});
