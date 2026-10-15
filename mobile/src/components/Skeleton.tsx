import React, { createContext, useContext, useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { radii, spacing } from "../theme";
import { useReducedMotion } from "../hooks/useReducedMotion";

/**
 * Loading placeholders in the shape of the content that is coming (like Instagram), instead of a
 * spinner or "Loading…" text. Every block on a screen pulses together; with Reduce Motion on they
 * stay still. Screen readers hear one "Loading" for the whole placeholder.
 */

const Pulse = createContext<Animated.Value | null>(null);

function SkeletonRoot({ label, style, children }: { label: string; style?: StyleProp<ViewStyle>; children: React.ReactNode }): React.JSX.Element {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.45);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Pulse.Provider value={pulse}>
      <View style={style} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }}>
        {children}
      </View>
    </Pulse.Provider>
  );
}

export function SkeletonBlock({ width, height, radius = radii.sm, style }: { width: DimensionValue; height: DimensionValue; radius?: number; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const pulse = useContext(Pulse);
  return <Animated.View style={[styles.block, { width, height, borderRadius: radius, opacity: pulse ?? 0.45 }, style]} />;
}

/** A full-screen Story: progress bars, the action rail and the creator's footer. */
export function StorySkeleton({ label = "Loading Stories" }: { label?: string }): React.JSX.Element {
  return (
    <SkeletonRoot label={label} style={styles.story}>
      <View style={styles.storyProgress}>
        {[0, 1, 2].map((i) => <SkeletonBlock key={i} width="31%" height={3} radius={radii.pill} />)}
      </View>
      <View style={styles.storyRail}>
        {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} width={30} height={30} radius={15} />)}
      </View>
      <View style={styles.storyFooter}>
        <SkeletonBlock width={36} height={36} radius={18} />
        <View style={styles.lines}>
          <SkeletonBlock width={120} height={12} />
          <SkeletonBlock width={200} height={10} />
        </View>
      </View>
    </SkeletonRoot>
  );
}

/** Rows of people or notifications: a round photo and two lines of text. */
export function ListSkeleton({ rows = 8, label = "Loading" }: { rows?: number; label?: string }): React.JSX.Element {
  return (
    <SkeletonRoot label={label} style={styles.list}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonBlock width={44} height={44} radius={22} />
          <View style={styles.lines}>
            <SkeletonBlock width={i % 3 === 0 ? "55%" : "40%"} height={12} />
            <SkeletonBlock width={i % 2 === 0 ? "75%" : "60%"} height={10} />
          </View>
        </View>
      ))}
    </SkeletonRoot>
  );
}

/** A profile: photo, name, counts and the grid of Stories. */
export function ProfileSkeleton({ label = "Loading profile" }: { label?: string }): React.JSX.Element {
  return (
    <SkeletonRoot label={label} style={styles.profile}>
      <View style={styles.profileHeader}>
        <SkeletonBlock width={84} height={84} radius={42} />
        <View style={styles.counts}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.count}>
              <SkeletonBlock width={28} height={14} />
              <SkeletonBlock width={52} height={10} />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.lines}>
        <SkeletonBlock width={140} height={14} />
        <SkeletonBlock width="70%" height={10} />
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 9 }, (_, i) => <SkeletonBlock key={i} width="32.5%" height={150} radius={radii.sm} />)}
      </View>
    </SkeletonRoot>
  );
}

/** A conversation: message bubbles on both sides. */
export function ThreadSkeleton({ label = "Loading messages" }: { label?: string }): React.JSX.Element {
  const widths: DimensionValue[] = ["55%", "40%", "65%", "35%", "50%", "45%"];
  return (
    <SkeletonRoot label={label} style={styles.thread}>
      {widths.map((w, i) => (
        <SkeletonBlock key={i} width={w} height={36} radius={radii.lg} style={i % 2 ? styles.mine : styles.theirs} />
      ))}
    </SkeletonRoot>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: "rgba(255,255,255,0.14)" },
  story: { flex: 1, backgroundColor: "#000" },
  storyProgress: { position: "absolute", top: spacing.xxl, left: spacing.sm, right: spacing.sm, flexDirection: "row", justifyContent: "space-between" },
  storyRail: { position: "absolute", right: spacing.md, bottom: spacing.xl * 4, gap: spacing.lg },
  storyFooter: { position: "absolute", left: spacing.md, bottom: spacing.xl * 2, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  lines: { flex: 1, gap: spacing.xs },
  profile: { padding: spacing.md, gap: spacing.md },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  counts: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  count: { alignItems: "center", gap: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, justifyContent: "space-between", marginTop: spacing.sm },
  thread: { flex: 1, padding: spacing.md, gap: spacing.sm, justifyContent: "flex-end" },
  mine: { alignSelf: "flex-end" },
  theirs: { alignSelf: "flex-start" },
});
