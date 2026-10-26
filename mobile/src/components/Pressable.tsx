import React, { forwardRef, useCallback, useRef } from "react";
import {
  Animated,
  Dimensions,
  Pressable as RNPressable,
  StyleSheet,

  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableProps as RNPressableProps,
  type PressableStateCallbackType,
} from "react-native";
import { colors } from "../theme";

/**
 * How a press shows:
 * - "scale": the thing springs down a little and back (buttons, icons, chips, avatars);
 * - "highlight": a soft tint over it (list rows and wide cards, which look wrong shrinking);
 * - "none": nothing (full-screen tap areas such as a Story's left/right halves, sheet backdrops).
 * "auto" picks from the size it was laid out at.
 */
export type PressEffect = "auto" | "scale" | "highlight" | "none";

export type PressableProps = RNPressableProps & { pressEffect?: PressEffect };

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

const PRESSED_SCALE = 0.95;

/** Wider than this (share of the screen) and it's a row or a card, not a button. */
const WIDE = 0.6;
/** Taller than this (share of the screen) as well, and it's a full-screen tap area. */
const TALL = 0.4;

function effectFor(size: { width: number; height: number } | null): Exclude<PressEffect, "auto"> {
  if (!size) return "scale";
  const screen = Dimensions.get("window");
  if (size.width > screen.width * WIDE && size.height > screen.height * TALL) return "none";
  if (size.width > screen.width * WIDE || size.height > 120) return "highlight";
  return "scale";
}

/**
 * The app's Pressable: React Native's, with a response to every press so a tap never feels
 * dead. Use it everywhere instead of react-native's (verification/press-feedback.cjs checks).
 * Disabled presses show nothing.
 */
export const Pressable = forwardRef<React.ComponentRef<typeof RNPressable>, PressableProps>(function Pressable(
  { pressEffect = "auto", style, children, onPressIn, onPressOut, onLayout, disabled, ...rest },
  ref,
) {
  const size = useRef<{ width: number; height: number } | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const tint = useRef(new Animated.Value(0)).current;
  const active = useRef<Exclude<PressEffect, "auto">>("scale");

  // A style function already draws its own pressed state; that Pressable is left as it is.
  const ownPressedStyle = typeof style === "function";
  const flat = ownPressedStyle ? null : StyleSheet.flatten(style);
  // Something already transformed (rotated, moved) keeps its own transform untouched.
  const hasOwnTransform = !!flat?.transform;

  const pressIn = useCallback(
    (event: GestureResponderEvent) => {
      const effect = ownPressedStyle ? "none" : pressEffect === "auto" ? effectFor(size.current) : pressEffect;
      active.current = effect === "scale" && hasOwnTransform ? "highlight" : effect;
      if (active.current === "scale") Animated.spring(scale, { toValue: PRESSED_SCALE, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
      if (active.current === "highlight") Animated.timing(tint, { toValue: 1, duration: 60, useNativeDriver: true }).start();
      onPressIn?.(event);
    },
    [ownPressedStyle, pressEffect, hasOwnTransform, scale, tint, onPressIn],
  );

  const pressOut = useCallback(
    (event: GestureResponderEvent) => {
      if (active.current === "scale") Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();
      if (active.current === "highlight") Animated.timing(tint, { toValue: 0, duration: 220, useNativeDriver: true }).start();
      onPressOut?.(event);
    },
    [scale, tint, onPressOut],
  );

  const layout = useCallback(
    (event: LayoutChangeEvent) => {
      size.current = event.nativeEvent.layout;
      onLayout?.(event);
    },
    [onLayout],
  );

  if (ownPressedStyle) {
    return <RNPressable ref={ref} {...rest} disabled={disabled} style={style} onPressIn={onPressIn} onPressOut={onPressOut} onLayout={onLayout}>{children}</RNPressable>;
  }

  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      disabled={disabled}
      onPressIn={disabled ? onPressIn : pressIn}
      onPressOut={disabled ? onPressOut : pressOut}
      onLayout={layout}
      style={hasOwnTransform ? style : [style, { transform: [{ scale }] }]}
    >
      {(state: PressableStateCallbackType) => (
        <>
          {typeof children === "function" ? children(state) : children}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: tintColor(), borderRadius: flat?.borderRadius ?? 0, opacity: tint }]}
          />
        </>
      )}
    </AnimatedPressable>
  );
});

/** The text colour at low strength: lightens on dark, darkens on light. */
function tintColor(): string {
  return colors.textPrimary === "#FFFFFF" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
}
