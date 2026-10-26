import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography, FORM_MAX_WIDTH } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { markOnboardingDone, useOnboarding } from "../../state/onboarding";
import { followUser, getSuggestions, unfollowUser, updateMyProfile, type SuggestedPerson } from "../../api/users";
import { ApiError } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { Banner, Button } from "../../components/Form";
import { suggestionReasonText } from "../search/SearchScreen";
import { tapFeedback } from "../../utils/haptics";

/** What people can pick from; the same words appear on profiles and in "Also into …". */
export const INTEREST_CHOICES = [
  "Festivals", "Food", "Travel", "Music", "Bollywood", "Cricket", "Fashion", "Dance",
  "Devotional", "Fitness", "Movies", "Photography", "Art", "Comedy", "Gaming", "Tech",
  "Books", "Nature", "Football", "Cars", "Pets", "Startups",
];
export const MAX_INTERESTS = 5;

type FollowState = "none" | "following" | "requested" | "busy";

/**
 * First run, after the email is verified: pick what you're into, then follow a few people, so
 * Home has Stories from day one. Either step can be skipped; it's shown once (state/onboarding).
 */
export function OnboardingScreen(): React.JSX.Element {
  const { user, accessToken, applyProfile } = useAuth();
  const { finish } = useOnboarding();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"interests" | "people">("interests");
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);
  const [follows, setFollows] = useState<Record<string, FollowState>>({});

  const done = useCallback(() => {
    if (user) void markOnboardingDone(user.id);
    finish();
  }, [user, finish]);

  const toggle = (interest: string) => {
    setError(null);
    setChosen((current) => {
      if (current.includes(interest)) return current.filter((i) => i !== interest);
      if (current.length >= MAX_INTERESTS) {
        setError(`Pick up to ${MAX_INTERESTS}.`);
        return current;
      }
      tapFeedback("select");
      return [...current, interest];
    });
  };

  const saveInterests = async () => {
    if (!accessToken || saving) return;
    if (chosen.length === 0) {
      setStep("people");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { user: updated } = await updateMyProfile({ interests: chosen }, accessToken);
      applyProfile(updated);
      setStep("people");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  // Suggestions are fetched after interests are saved, so "Also into …" can use them.
  useEffect(() => {
    if (step !== "people" || !accessToken) return;
    const controller = new AbortController();
    getSuggestions(accessToken, controller.signal)
      .then(({ suggestions }) => setPeople(suggestions))
      .catch(() => setPeople((current) => current ?? []));
    return () => controller.abort();
  }, [step, accessToken]);

  const toggleFollow = async (person: SuggestedPerson) => {
    if (!accessToken) return;
    const state = follows[person.username] ?? "none";
    if (state === "busy") return;
    setFollows((f) => ({ ...f, [person.username]: "busy" }));
    try {
      if (state === "none") {
        const result = await followUser(person.username, accessToken);
        tapFeedback("success");
        setFollows((f) => ({ ...f, [person.username]: result.status }));
      } else {
        await unfollowUser(person.username, accessToken);
        setFollows((f) => ({ ...f, [person.username]: "none" }));
      }
    } catch {
      setFollows((f) => ({ ...f, [person.username]: state }));
    }
  };

  const invite = () => {
    void Share.share({ message: "I'm on Katkee, a new place for Stories. Join me: https://katkee.com" }).catch(() => undefined);
  };

  const pad = { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg };

  if (step === "interests") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={[styles.content, pad]}>
          <Text style={styles.stepLabel}>Step 1 of 2</Text>
          <Text style={typography.displayLarge} accessibilityRole="header">What are you into?</Text>
          <Text style={styles.body}>Pick up to {MAX_INTERESTS}. We'll suggest people and Stories you'll like.</Text>
          {error ? <Banner text={error} /> : null}
          <View style={styles.chips}>
            {INTEREST_CHOICES.map((interest) => {
              const selected = chosen.includes(interest);
              return (
                <Pressable
                  key={interest}
                  onPress={() => toggle(interest)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={interest}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{interest}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button label={chosen.length ? `Next (${chosen.length})` : "Next"} onPress={() => void saveInterests()} busy={saving} disabled={chosen.length === 0} />
          <Button label="Skip" variant="secondary" onPress={() => setStep("people")} />
        </View>
      </View>
    );
  }

  const followedCount = Object.values(follows).filter((s) => s === "following" || s === "requested").length;
  return (
    <View style={styles.root}>
      <FlatList
        data={people ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[styles.content, pad]}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.stepLabel}>Step 2 of 2</Text>
            <Text style={typography.displayLarge} accessibilityRole="header">People to follow</Text>
            <Text style={styles.body}>Their Stories will show on your Home.</Text>
          </View>
        }
        ListEmptyComponent={
          people === null ? (
            <ActivityIndicator color={colors.accentText} style={styles.loading} accessibilityLabel="Finding people" />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>You're one of the first here</Text>
              <Text style={styles.body}>Invite friends to see their Stories, and post your own to get started.</Text>
              <Button label="Invite friends" variant="secondary" onPress={invite} />
            </View>
          )
        }
        renderItem={({ item }) => {
          const state = follows[item.username] ?? "none";
          const label = state === "following" ? "Following" : state === "requested" ? "Requested" : "Follow";
          const active = state === "following" || state === "requested";
          return (
            <View style={styles.row}>
              <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId} />
              <View style={styles.rowText}>
                <VerifiedName name={item.displayName || item.username} verified={item.verified} style={styles.name} />
                <Text style={styles.reason} numberOfLines={1}>{suggestionReasonText(item.reason)}</Text>
              </View>
              <Pressable
                onPress={() => void toggleFollow(item)}
                disabled={state === "busy"}
                style={[styles.follow, active ? styles.followQuiet : styles.followStrong]}
                accessibilityRole="button"
                accessibilityLabel={`${label} @${item.username}`}
              >
                {state === "busy" ? <ActivityIndicator color={colors.onAccent} /> : <Text style={[styles.followLabel, active && styles.followLabelQuiet]}>{label}</Text>}
              </Pressable>
            </View>
          );
        }}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button label={followedCount ? "Done" : "Start using Katkee"} onPress={done} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.md, width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  stepLabel: { ...typography.caption, color: colors.accentText, fontWeight: "700" },
  body: { ...typography.body, color: colors.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { ...typography.body, color: colors.textPrimary, fontWeight: "600" },
  chipLabelSelected: { color: colors.onAccent },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm, width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" },
  loading: { marginTop: spacing.xl },
  empty: { gap: spacing.md, marginTop: spacing.lg },
  emptyTitle: { ...typography.title, color: colors.textPrimary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  rowText: { flex: 1 },
  name: { ...typography.body, color: colors.textPrimary, fontWeight: "700" },
  reason: { ...typography.caption, color: colors.textSecondary },
  follow: { minWidth: 96, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  followStrong: { backgroundColor: colors.accent },
  followQuiet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  followLabel: { ...typography.body, color: colors.onAccent, fontWeight: "700" },
  followLabelQuiet: { color: colors.textPrimary },
});
