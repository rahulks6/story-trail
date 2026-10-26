import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getSequenceInsights, type StoryInsights } from "../../api/stories";
import { EmptyState } from "../../components/EmptyState";
import { Button } from "../../components/Form";

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={[typography.bodyStrong, styles.cardLabel]}>{label}</Text>
      <Text style={[typography.caption, styles.cardHint]}>{hint}</Text>
    </View>
  );
}

/**
 * "Per-sequence Insights" (spec): the same stats StoryInsightsSheet shows
 * for one Story, aggregated across every currently-active Story you own —
 * the whole run a viewer swipes through for you in one sitting
 * (StoryFeed.tsx). Reached from your own ProfileScreen. No viewer-identity
 * list here — that's real per-Story (StoryInsightsSheet), and an
 * aggregate cross-Story identity list is a genuinely separate feature
 * this pass doesn't add.
 */
export function SequenceInsightsScreen(): React.JSX.Element {
  const { accessToken } = useAuth();
  const [insights, setInsights] = useState<StoryInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setError(null);
    getSequenceInsights(accessToken)
      .then(({ insights: fetched }) => {
        if (!cancelled) setInsights(fetched);
      })
      .catch(() => {
        if (!cancelled) setError("Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, reload]);

  if (error) {
    return (
      <View style={styles.centered}>
        <EmptyState title="Couldn't load Insights" message={error}>
          <Button label="Try again" variant="secondary" onPress={() => setReload((n) => n + 1)} />
        </EmptyState>
      </View>
    );
  }

  if (insights === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  }

  if (insights.viewCount === 0) {
    return (
      <EmptyState
        title="No views yet"
        message="Once people watch your active Stories, Insights for the whole run will show up here."
      />
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[typography.caption, styles.subtitle]}>
        Your Stories from the last 24 hours
      </Text>
      <View style={styles.grid}>
        <StatCard label="Viewers" value={String(insights.viewCount)} hint="Watched at least one" />
        <StatCard label="Watched to the end" value={`${insights.completionRate}%`} hint="Of your viewers" />
        <StatCard label="Followers" value={`${insights.followingViewRate}%`} hint="Already follow you" />
        <StatCard label="New people" value={`${insights.discoveryViewRate}%`} hint="Don't follow you yet" />
        <StatCard label="Profile visits" value={`${insights.profileVisitRate}%`} hint="Then opened your profile" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  subtitle: { marginBottom: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: {
    width: "47%",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  cardValue: { color: colors.accentText, fontSize: 28, fontWeight: "700" },
  cardLabel: { marginTop: spacing.xs },
  cardHint: { color: colors.textDisabled },
});
