import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Keyboard, Modal, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaColors as colors, radii, spacing, ICONS } from "../theme";
import { Icon } from "./Icon";
import { contrastOn, neonCore, neonRadius, TEXT_STYLES, textStyleLook, tightTextFits } from "./textLook";
import { BorderCopies, labelBox, lookProperties, MarkerLines, markerPad, outlineWidth, SOFT_ALPHA, TEXT_LOOKS, textLookOf, withAlpha, type TextLook } from "./TextDecorations";
import { TEXT_ANIMATIONS, type TextAnimation } from "./TextAnimation";
import { ColorSpectrum } from "./ColorSpectrum";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import type { TextOverlayProperties, TextStyle } from "../models/storyDraft";
import { tapFeedback } from "../utils/haptics";
import { TEXT_MAX_WIDTH_FRACTION } from "./OverlayBody";
import { t } from "../i18n";
import { textStyleLabel } from "../i18n/names";

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
  /** And its width, so lines break while typing exactly where they will on the Story. */
  canvasWidth?: number;
}

/**
 * Instagram's text tool, over the dimmed photo: the keyboard opens straight away; the styles sit
 * right above it (each name written in its own font); the colour button swaps them for colours;
 * the slider on the left sets the size; "A" puts the text on a label in the chosen colour. Tapping
 * anywhere outside the text, or Done, places it. Nothing typed just closes.
 */
export function TextToolModal({ visible, initialText, initialProperties, onCancel, onDone, canvasHeight, canvasWidth }: Props): React.JSX.Element {
  const [text, setText] = useState(initialText ?? "");
  const [style, setStyle] = useState<TextStyle>(initialProperties?.style ?? "Clean");
  // With a label or marker, the chosen colour is the background's; the text is black or white on it.
  const [color, setColor] = useState(initialProperties?.backgroundColor ?? initialProperties?.color ?? COLORS[0]!);
  const [look, setLook] = useState<TextLook>(initialProperties ? textLookOf(initialProperties) : "plain");
  // The look's name shows for a moment after the "A" button changes it.
  const [lookHint, setLookHint] = useState<string | null>(null);
  const [animation, setAnimation] = useState<TextAnimation | null>(initialProperties?.animation ?? null);
  // The rainbow picker in place of the colour swatches.
  const [spectrum, setSpectrum] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);
  const hasBackground = look === "label" || look === "soft" || look === "marker";
  const [align, setAlign] = useState<TextOverlayProperties["align"]>(initialProperties?.align ?? "center");
  const [size, setSize] = useState(initialProperties?.fontSize ?? DEFAULT_SIZE);
  const [picking, setPicking] = useState<"styles" | "colors">("styles");
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  const textColor = hasBackground ? contrastOn(color) : color;
  // Neon glows only on plain text; with a label, marker or border it is plain text, as on the Story.
  const neon = style === "Highlight" && look === "plain";
  const done = () => {
    if (!text.trim()) {
      onCancel();
      return;
    }
    onDone(text, { text, style, color: textColor, ...lookProperties(look, color), align, fontSize: size, ...(animation ? { animation } : {}) });
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

  const nextLook = () => {
    const next = TEXT_LOOKS[(TEXT_LOOKS.indexOf(look) + 1) % TEXT_LOOKS.length]!;
    setLook(next);
    showHint(lookName(next));
  };
  const showHint = (label: string) => {
    setLookHint(label);
    tapFeedback("select");
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setLookHint(null), 1400);
  };
  const nextAnimation = () => {
    const next = TEXT_ANIMATIONS[(TEXT_ANIMATIONS.indexOf(animation) + 1) % TEXT_ANIMATIONS.length] ?? null;
    setAnimation(next);
    showHint(animationName(next));
  };
  const nextAlign = () => setAlign((a) => ALIGNS[(ALIGNS.indexOf(a) + 1) % ALIGNS.length]!);
  const alignIcon = align === "left" ? ICONS.alignLeft : align === "right" ? ICONS.alignRight : ICONS.alignCenter;
  // The preview is the size it will be on a full-screen Story.
  const previewSize = Math.round(size * (canvasHeight && canvasHeight > 0 ? canvasHeight : 760));
  // The Story wraps text at this width (OverlayBody), label padding and Neon's glow room included.
  const wrapWidth = canvasWidth && canvasWidth > 0 ? canvasWidth * TEXT_MAX_WIDTH_FRACTION + (neon ? neonRadius(previewSize) * 2 : 0) : undefined;
  // The text's look while typing, shared with the border and marker drawn behind it.
  const inputTextStyle = [
    styles.input,
    { fontSize: previewSize },
    textStyleLook(style, textColor, previewSize),
    { color: neon ? neonCore(textColor) : textColor, textAlign: align, includeFontPadding: !tightTextFits(text) },
    // Room for the glow, which Android cuts off at the text's edges.
    neon && { padding: neonRadius(previewSize) },
    style === "Highlight" && !neon && { textShadowRadius: 0 },
    look === "border" && { textShadowRadius: 0 },
  ];

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={done}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.sm, paddingBottom: Math.max(keyboard, insets.bottom) + spacing.xs }]}>
        <View style={styles.topBar}>
          <View style={styles.topTools}>
            <Pressable onPress={nextAlign} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel={t("textToolModal.alignmentAlign", { align })} accessibilityHint={t("textToolModal.changesTheTextAlignment")}>
              <Icon name={alignIcon} size={24} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={() => { setPicking((p) => (p === "colors" ? "styles" : "colors")); tapFeedback("select"); }}
              hitSlop={8}
              style={[styles.toolButton, picking === "colors" && styles.toolButtonOn]}
              accessibilityRole="button"
              accessibilityLabel={picking === "colors" ? t("textToolModal.showTextStyles") : t("textToolModal.showColours")}
            >
              <View style={[styles.colorDot, { backgroundColor: color }]} />
            </Pressable>
            <Pressable
              onPress={nextLook}
              hitSlop={8}
              style={[styles.toolButton, look === "label" && styles.toolButtonOn]}
              accessibilityRole="button"
              accessibilityLabel={t("textToolModal.textLookValue", { look: lookName(look) })}
              accessibilityHint={t("textToolModal.changesHowTheTextStandsOut")}
            >
              <LookGlyph look={look} />
            </Pressable>
            <Pressable
              onPress={nextAnimation}
              hitSlop={8}
              style={[styles.toolButton, animation !== null && styles.toolButtonOn]}
              accessibilityRole="button"
              accessibilityLabel={t("textToolModal.animationValue", { animation: animationName(animation) })}
              accessibilityHint={t("textToolModal.changesHowTheTextAppears")}
            >
              <Text style={[styles.animGlyph, animation !== null && { color: colors.background }]}>A<Text style={styles.animGlyphLines}>⫶</Text></Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={done} hitSlop={12} style={styles.doneButton}>
            <Text style={styles.doneLabel}>{t("common.done")}</Text>
          </Pressable>
        </View>

        <View style={styles.middle}>
          {/* Tapping the dimmed photo around the text places it, like Instagram. */}
          <Pressable pressEffect="none" style={StyleSheet.absoluteFill} onPress={done} accessible={false} accessibilityRole="button" accessibilityLabel={t("textToolModal.placeTheText")} />
          <View style={styles.slider} {...slider.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={t("textToolModal.textSize")}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(sliderFraction * 100) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(e) => setSize((s) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, s + (e.nativeEvent.actionName === "increment" ? 0.01 : -0.01))))}
          >
            <View style={styles.sliderTrack} />
            <View style={[styles.sliderThumb, { top: (1 - sliderFraction) * (SLIDER_HEIGHT - 22) }]} />
          </View>
          {lookHint ? (
            <View style={styles.lookHint} pointerEvents="none" accessibilityLiveRegion="polite">
              <Text style={styles.lookHintLabel}>{lookHint}</Text>
            </View>
          ) : null}
          <View style={[
            styles.inputBox,
            wrapWidth !== undefined && { maxWidth: wrapWidth, paddingHorizontal: 0, paddingVertical: 0 },
            look === "label" && { backgroundColor: color, ...labelBox(previewSize) },
            look === "soft" && { backgroundColor: withAlpha(color, SOFT_ALPHA), ...labelBox(previewSize) },
            look === "marker" && { paddingHorizontal: markerPad(previewSize).x, paddingVertical: markerPad(previewSize).y },
            look === "border" && { padding: outlineWidth(previewSize) },
            { alignSelf: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center" },
          ]}>
            <View>
            {/* The border or marker, drawn behind the text exactly as the Story will show it. */}
            {text && look === "border" ? <BorderCopies text={text} textStyle={inputTextStyle} borderColor={contrastOn(textColor)} fontSize={previewSize} /> : null}
            {text && look === "marker" ? <MarkerLines text={text} textStyle={inputTextStyle} color={color} fontSize={previewSize} /> : null}
            <TextInput
              allowFontScaling={false}
              autoFocus
              multiline
              // Previews the chosen style, colour and size as it will appear on the Story.
              style={inputTextStyle}
              placeholder={t("common.typeSomething")}
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
        </View>

        {picking === "styles" ? (
          <ScrollView key="styles" horizontal style={styles.row} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.rowContent}>
            {TEXT_STYLES.map((s) => (
              <Pressable
                key={s}
                onPress={() => { setStyle(s); tapFeedback("select"); }}
                style={[styles.styleChip, style === s && styles.styleChipActive]}
                accessibilityRole="button"
                accessibilityLabel={t("textToolModal.valueTextStyle", { value: textStyleLabel(s) })}
                accessibilityState={{ selected: style === s }}
              >
                {/* Each name is written in its own style, so you see the look before choosing. */}
                <Text style={[styles.styleChipLabel, textStyleLook(s, s === "Highlight" ? NEON_CHIP_GLOW : style === s ? colors.background : colors.textPrimary, 15), s === "Highlight" && styles.neonChipLabel, style === s && styles.styleChipLabelActive]} numberOfLines={1}>
                  {textStyleLabel(s)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          spectrum ? (
            <View style={[styles.row, styles.spectrumRow]}>
              <Pressable onPress={() => setSpectrum(false)} hitSlop={8} style={styles.spectrumBack} accessibilityRole="button" accessibilityLabel={t("textToolModal.showSwatches")}>
                <View style={[styles.colorDot, { backgroundColor: color }]} />
              </Pressable>
              <ColorSpectrum onChange={setColor} />
            </View>
          ) : (
          <ScrollView key="colors" horizontal style={styles.row} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.rowContent}>
            {/* Any colour: a rainbow, then lighter or darker. */}
            <Pressable onPress={() => { setSpectrum(true); tapFeedback("select"); }} hitSlop={4} style={styles.rainbowSwatch} accessibilityRole="button" accessibilityLabel={t("textToolModal.moreColours")}>
              <Svg width={30} height={30}><Defs><SvgGradient id="rb" x1="0" y1="0" x2="1" y2="1">
                {["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#32ADE6", "#5856D6", "#AF52DE"].map((c, i) => <Stop key={c} offset={i / 6} stopColor={c} />)}
              </SvgGradient></Defs><Circle cx={15} cy={15} r={14} fill="url(#rb)" /></Svg>
            </Pressable>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => { setColor(c); tapFeedback("select"); }}
                hitSlop={4}
                style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
                accessibilityRole="button"
                accessibilityLabel={t("textToolModal.textColourC", { c })}
                accessibilityState={{ selected: color === c }}
              />
            ))}
          </ScrollView>
          )
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
    // Measured from the bottom of the screen (where the keyboard's top edge is), not its own
    // height: on Android that leaves out the navigation bar under it, which hid the style row.
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setHeight(Math.max(e.endCoordinates.height, Dimensions.get("screen").height - e.endCoordinates.screenY)));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

function animationName(animation: TextAnimation | null): string {
  switch (animation) {
    case "typewriter": return t("textToolModal.animTypewriter");
    case "pop": return t("textToolModal.animPop");
    case "fade": return t("textToolModal.animFade");
    case "bounce": return t("textToolModal.animBounce");
    default: return t("textToolModal.animNone");
  }
}

function lookName(look: TextLook): string {
  return look === "label" ? t("textToolModal.lookLabel") : look === "soft" ? t("textToolModal.lookSeeThrough") : look === "marker" ? t("textToolModal.lookHighlighter")
    : look === "border" ? t("textToolModal.lookBorder") : t("textToolModal.lookPlain");
}

/** The "A" button shows the look it's on: plain, on a label, highlighted, or with a border. */
function LookGlyph({ look }: { look: TextLook }): React.JSX.Element {
  if (look === "label") return <Text style={[styles.glyph, { color: colors.background }]}>A</Text>;
  if (look === "soft") {
    return (
      <View>
        <View style={styles.glyphSoft} />
        <Text style={styles.glyph}>A</Text>
      </View>
    );
  }
  if (look === "marker") {
    return (
      <View>
        <View style={styles.glyphMarker} />
        <Text style={[styles.glyph, { color: "#000000" }]}>A</Text>
      </View>
    );
  }
  if (look === "border") {
    return (
      <View>
        <BorderCopies text="A" textStyle={styles.glyph} borderColor="#FFFFFF" fontSize={20} />
        <Text style={[styles.glyph, { color: "#000000" }]}>A</Text>
      </View>
    );
  }
  return <Text style={styles.glyph}>A</Text>;
}

const styles = StyleSheet.create({
  glyphSoft: { position: "absolute", left: -3, right: -3, top: 1, bottom: 1, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.4)" },
  animGlyph: { color: colors.textPrimary, fontSize: 20, fontWeight: "900", fontStyle: "italic" },
  animGlyphLines: { fontSize: 14, fontWeight: "700", fontStyle: "normal" },
  rainbowSwatch: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  spectrumRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xs },
  spectrumBack: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  glyph: { color: colors.textPrimary, fontSize: 20, fontWeight: "900", textAlign: "center", paddingHorizontal: 3 },
  glyphMarker: { position: "absolute", left: -2, right: -2, top: 5, bottom: 4, borderRadius: 4, backgroundColor: "#FFD84D" },
  lookHint: { position: "absolute", top: spacing.sm, alignSelf: "center", paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.6)" },
  lookHintLabel: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
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
