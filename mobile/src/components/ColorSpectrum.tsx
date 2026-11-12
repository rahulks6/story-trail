import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { t } from "../i18n";

/** `hsl(h, s%, l%)` as `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100, light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Lightness along the shade bar: white at the left, the pure colour in the middle, black at the right. */
export const shadeLightness = (fraction: number) => 96 - Math.min(1, Math.max(0, fraction)) * 92;

const HUES = [0, 30, 60, 90, 120, 180, 210, 240, 270, 300, 330, 360];
const BAR_HEIGHT = 30;

/**
 * Any colour, as Instagram's long-press palette: drag along the rainbow for the colour, then along
 * the bar below for lighter or darker. Each move picks the colour at once.
 */
export function ColorSpectrum({ onChange }: { onChange: (hex: string) => void }): React.JSX.Element {
  const [hue, setHue] = useState(0);
  const [shade, setShade] = useState(0.5);
  const width = useRef(1);
  const latest = useRef({ hue: 0, shade: 0.5 });
  latest.current = { hue, shade };

  const pick = (nextHue: number, nextShade: number) => {
    setHue(nextHue);
    setShade(nextShade);
    onChange(hslToHex(nextHue, 95, shadeLightness(nextShade)));
  };
  const fractionAt = (x: number) => Math.min(1, Math.max(0, x / width.current));
  const bar = (which: "hue" | "shade") => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => move(which, e.nativeEvent.locationX),
    onPanResponderMove: (e) => move(which, e.nativeEvent.locationX),
  });
  const move = (which: "hue" | "shade", x: number) => {
    const f = fractionAt(x);
    if (which === "hue") pick(Math.round(f * 360) % 360, latest.current.shade);
    else pick(latest.current.hue, f);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hueBar = useMemo(() => bar("hue"), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shadeBar = useMemo(() => bar("shade"), []);
  const onLayout = (e: LayoutChangeEvent) => { width.current = Math.max(1, e.nativeEvent.layout.width); };
  const pure = hslToHex(hue, 95, 50);

  return (
    <View style={styles.wrap}>
      <View style={styles.bar} onLayout={onLayout} {...hueBar.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={t("textToolModal.colourHue")}
        accessibilityValue={{ min: 0, max: 360, now: hue }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => pick((hue + (e.nativeEvent.actionName === "increment" ? 20 : 340)) % 360, shade)}
      >
        <Svg width="100%" height={BAR_HEIGHT}>
          <Defs>
            <LinearGradient id="hue" x1="0" y1="0" x2="1" y2="0">
              {HUES.map((h) => <Stop key={h} offset={h / 360} stopColor={hslToHex(h, 95, 50)} />)}
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill="url(#hue)" />
        </Svg>
        <View pointerEvents="none" style={[styles.thumb, { left: `${(hue / 360) * 100}%` }]} />
      </View>
      <View style={styles.bar} {...shadeBar.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={t("textToolModal.colourShade")}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shade * 100) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => pick(hue, Math.min(1, Math.max(0, shade + (e.nativeEvent.actionName === "increment" ? 0.1 : -0.1))))}
      >
        <Svg width="100%" height={BAR_HEIGHT}>
          <Defs>
            <LinearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.5" stopColor={pure} />
              <Stop offset="1" stopColor="#000000" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill="url(#shade)" />
        </Svg>
        <View pointerEvents="none" style={[styles.thumb, { left: `${shade * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 10, paddingVertical: 6 },
  bar: { height: BAR_HEIGHT, justifyContent: "center" },
  thumb: { position: "absolute", top: -3, width: 14, height: BAR_HEIGHT + 6, marginLeft: -7, borderRadius: 7, borderWidth: 3, borderColor: "#FFFFFF", backgroundColor: "transparent" },
});
