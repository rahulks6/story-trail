import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { declineNearby, nearbyChoice, turnNearbyOn } from "../state/nearby";

const FACTS = [
  "Katkee uses an approximate area about the size of a city, never your exact location.",
  "Your area is never shown on your profile or to anyone.",
  "Turn it off anytime in Settings, under Privacy.",
];

/**
 * Nearby Stories (Phase 9): asked once, a few seconds after you first use Katkee signed in, never
 * at launch and never again after an answer. "Not now" sends nothing; Settings → Privacy can
 * still turn it on.
 */
export function NearbyPrompt({ delayMs = 6000 }: { delayMs?: number }): React.JSX.Element | null {
  const { status, user, accessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const userId = status === "signedIn" ? user?.id ?? null : null;
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!userId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void nearbyChoice(userId).then((choice) => {
        if (!cancelled && choice === null && AppState.currentState === "active") setVisible(true);
      });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, delayMs]);

  if (!userId || !visible) return null;

  const notNow = () => {
    if (busy) return;
    setVisible(false);
    void declineNearby(userId);
  };

  const turnOn = async () => {
    if (!accessToken || busy) return;
    setBusy(true);
    try {
      const result = await turnNearbyOn(userId, accessToken);
      // A refusal at the system prompt is an answer too: don't ask again here.
      if (result !== "on") await declineNearby(userId);
    } catch {
      await declineNearby(userId);
    } finally {
      setBusy(false);
      setVisible(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={notNow}>
      <View style={styles.fill}>
        {/* Tapping outside means "Not now", like the other sheets' backdrops. */}
        <Pressable style={styles.backdrop} onPress={notNow} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.rings} accessible={false}>
            <View style={[styles.ring, styles.ringOuter]} />
            <View style={[styles.ring, styles.ringMiddle]} />
            <View style={styles.dot} />
          </View>
          <Text style={[typography.title, styles.title]} accessibilityRole="header">See Stories from people near you</Text>
          <Text style={[typography.body, styles.lead]}>
            Turn on Nearby Stories to discover people around you, and let people nearby discover your public Stories.
          </Text>
          <View style={styles.facts}>
            {FACTS.map((fact) => (
              <View key={fact} style={styles.fact}>
                <View style={styles.bullet} />
                <Text style={[typography.caption, styles.factText]}>{fact}</Text>
              </View>
            ))}
          </View>
          <Pressable
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
            onPress={() => void turnOn()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Turn on Nearby Stories"
            accessibilityState={{ busy, disabled: busy }}
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryLabel}>Turn on</Text>}
          </Pressable>
          <Pressable style={styles.secondary} onPress={notNow} disabled={busy} accessibilityRole="button" accessibilityLabel="Not now">
            <Text style={typography.bodyStrong}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  rings: { alignSelf: "center", width: 88, height: 88, alignItems: "center", justifyContent: "center", marginVertical: spacing.md },
  ring: { position: "absolute", borderRadius: radii.pill, borderWidth: 2, borderColor: colors.accent },
  ringOuter: { width: 88, height: 88, opacity: 0.35 },
  ringMiddle: { width: 56, height: 56, opacity: 0.7 },
  dot: { width: 20, height: 20, borderRadius: radii.pill, backgroundColor: colors.accent },
  title: { textAlign: "center", marginBottom: spacing.sm },
  lead: { textAlign: "center", color: colors.textSecondary, marginBottom: spacing.md },
  facts: { gap: spacing.sm, marginBottom: spacing.lg },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 6 },
  factText: { flex: 1, color: colors.textPrimary },
  primary: { backgroundColor: colors.accent, borderRadius: radii.pill, minHeight: 48, alignItems: "center", justifyContent: "center" },
  primaryPressed: { backgroundColor: colors.accentPressed },
  primaryLabel: { color: colors.onAccent, fontSize: 16, fontWeight: "700" },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
});
