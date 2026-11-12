import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

/**
 * How text on a Story comes in, like Instagram's "animate" button: typed out letter by letter,
 * popping in, fading up, or bouncing gently the whole time. It plays each time the Story shows
 * (and once when placed in the editor). Someone who asked their phone to reduce motion sees the
 * text still. A shared video or picture of the Story has the text still, as it ends.
 */
export type TextAnimation = "typewriter" | "pop" | "fade" | "bounce";
export const TEXT_ANIMATIONS: (TextAnimation | null)[] = [null, "typewriter", "pop", "fade", "bounce"];

/** Typing speed, and the longest a whole text takes to type out. */
const PER_CHARACTER_MS = 55;
const MAX_TYPING_MS = 1800;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (alive) setReduce(on); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return reduce;
}

/** The part of `text` typed so far: all of it unless the animation is "typewriter". */
export function useTypedText(text: string, animation: TextAnimation | null | undefined): string {
  const reduce = useReduceMotion();
  const typing = animation === "typewriter" && !reduce;
  // Whole characters (an emoji or a Devanagari letter with its marks is never cut in half).
  const characters = useRef<string[]>([]);
  characters.current = Array.from(text);
  const [shown, setShown] = useState(typing ? 0 : characters.current.length);
  useEffect(() => {
    if (!typing) {
      setShown(characters.current.length);
      return;
    }
    setShown(0);
    const total = characters.current.length;
    const step = Math.max(16, Math.min(PER_CHARACTER_MS, MAX_TYPING_MS / Math.max(1, total)));
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setShown(count);
      if (count >= total) clearInterval(timer);
    }, step);
    return () => clearInterval(timer);
  }, [typing, text]);
  return typing ? characters.current.slice(0, shown).join("") : text;
}

/** Wraps the text's box: pops it in, fades it up, or keeps it bouncing. */
export function AnimatedTextBox({ animation, style, children }: { animation: TextAnimation | null | undefined; style?: StyleProp<ViewStyle>; children: React.ReactNode }): React.JSX.Element {
  const reduce = useReduceMotion();
  const kind = reduce ? null : animation ?? null;
  const progress = useRef(new Animated.Value(kind === "pop" || kind === "fade" ? 0 : 1)).current;
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let running: Animated.CompositeAnimation | null = null;
    if (kind === "pop") {
      progress.setValue(0);
      running = Animated.spring(progress, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true });
    } else if (kind === "fade") {
      progress.setValue(0);
      running = Animated.timing(progress, { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    } else if (kind === "bounce") {
      progress.setValue(1);
      running = Animated.loop(Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]));
    } else {
      progress.setValue(1);
      bounce.setValue(0);
    }
    running?.start();
    return () => running?.stop();
  }, [kind, progress, bounce]);

  const transform = kind === "pop"
    ? [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]
    : kind === "fade"
      ? [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }]
      : kind === "bounce"
        ? [{ translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) }]
        : [];
  const opacity = kind === "pop" || kind === "fade" ? progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] }) : 1;
  return <Animated.View testID={kind ? `text-animation-${kind}` : undefined} style={[style, { opacity, transform }]}>{children}</Animated.View>;
}
