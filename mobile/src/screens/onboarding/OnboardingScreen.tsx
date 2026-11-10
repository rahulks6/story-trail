import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography, FORM_MAX_WIDTH } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { markOnboardingDone, useOnboarding } from "../../state/onboarding";
import { followUser, getSuggestions, unfollowUser, type SuggestedPerson } from "../../api/users";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { Button } from "../../components/Form";
import { suggestionReasonText } from "../search/SearchScreen";
import { tapFeedback } from "../../utils/haptics";
import { TOPICS } from "../../models/topics";
import { ContactsFinder } from "../../components/ContactsFinder";
import { useAddProfilePhoto } from "../../components/AddProfilePhoto";
import { shareInvite } from "../../state/invites";
import { t } from "../../i18n";

/**
 * What people can pick from in Edit profile; the same words appear on profiles, in "Also into …"
 * and as Story topics. Onboarding no longer asks: Katkee learns what people like from the Stories
 * they watch, like and comment on (the AI topic on every Story), which is better than a guess on day one.
 */
export const INTEREST_CHOICES = TOPICS;
export const MAX_INTERESTS = 5;

type FollowState = "none" | "following" | "requested" | "busy";

/**
 * First run, after the email is verified: a profile photo (skipped when there is one), follow a
 * few people, then (optionally) find friends from your contacts, so Home has Stories from day
 * one and friends recognise you. Every step can
 * be skipped; it's shown once (state/onboarding). Contacts are read only if the person taps
 * Continue on that step's explainer.
 */
export function OnboardingScreen(): React.JSX.Element {
  const { user, accessToken } = useAuth();
  const { finish } = useOnboarding();
  const insets = useSafeAreaInsets();
  const askPhoto = useState(() => !user?.avatarMediaId)[0];
  const [step, setStep] = useState<"photo" | "people" | "contacts">(askPhoto ? "photo" : "people");
  const total = askPhoto ? 3 : 2;
  const stepLabel = (name: "photo" | "people" | "contacts") => t("onboarding.stepNOfTotal", { n: (askPhoto ? ["photo", "people", "contacts"] : ["people", "contacts"]).indexOf(name) + 1, total });
  const profilePhoto = useAddProfilePhoto(() => setStep("people"));
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);
  const [follows, setFollows] = useState<Record<string, FollowState>>({});

  const done = useCallback(() => {
    if (user) void markOnboardingDone(user.id);
    finish();
  }, [user, finish]);

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

  const invite = () => void shareInvite("onboarding", accessToken, user?.id);

  const pad = { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg };

  if (step === "photo") {
    return (
      <View style={[styles.root, pad]}>
        <View style={[styles.content, styles.photoStep]}>
          <Text style={styles.stepLabel}>{stepLabel("photo")}</Text>
          <Text style={typography.displayLarge} accessibilityRole="header">{t("onboarding.addAProfilePhoto")}</Text>
          <Text style={styles.body}>{t("onboarding.profilePhotoWhy")}</Text>
          <Pressable onPress={() => void profilePhoto.choose("library")} style={styles.photoCircle} accessibilityRole="button" accessibilityLabel={t("onboarding.choosePhoto")}>
            {profilePhoto.busy ? <ActivityIndicator color={colors.accentText} /> : user ? <Avatar username={user.username} displayName={user.displayName} avatarMediaId={user.avatarMediaId} size={132} /> : null}
            <View style={styles.photoPlus}><Text style={styles.photoPlusText}>+</Text></View>
          </Pressable>
          {profilePhoto.error ? <Text style={styles.photoError}>{profilePhoto.error}</Text> : null}
        </View>
        <View style={[styles.footer, { paddingBottom: spacing.md }]}>
          <Button label={t("onboarding.choosePhoto")} onPress={() => void profilePhoto.choose("library")} busy={profilePhoto.busy} />
          <Button label={t("onboarding.takeASelfie")} variant="secondary" onPress={() => void profilePhoto.choose("camera")} disabled={profilePhoto.busy} />
          <Button label={t("common.notNow")} variant="secondary" onPress={() => setStep("people")} disabled={profilePhoto.busy} />
        </View>
        {profilePhoto.element}
      </View>
    );
  }

  if (step === "contacts") {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ContactsFinder
          source="onboarding"
          header={<Text style={styles.stepLabel}>{stepLabel("contacts")}</Text>}
          footer={
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
              <Button label={t("onboarding.startUsingKatkee")} variant="secondary" onPress={done} />
            </View>
          }
        />
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
            <Text style={styles.stepLabel}>{stepLabel("people")}</Text>
            <Text style={typography.displayLarge} accessibilityRole="header">{t("onboarding.peopleToFollow")}</Text>
            <Text style={styles.body}>{t("onboarding.theirStoriesWillShowOn")}</Text>
          </View>
        }
        ListEmptyComponent={
          people === null ? (
            <ActivityIndicator color={colors.accentText} style={styles.loading} accessibilityLabel={t("onboarding.findingPeople")} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t("onboarding.youreOneOfTheFirst")}</Text>
              <Text style={styles.body}>{t("onboarding.inviteFriendsToSeeTheir")}</Text>
              <Button label={t("common.inviteFriends")} variant="secondary" onPress={invite} />
            </View>
          )
        }
        renderItem={({ item }) => {
          const state = follows[item.username] ?? "none";
          const label = state === "following" ? t("common.following") : state === "requested" ? t("common.requested") : t("common.follow");
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
        <Button label={followedCount ? t("onboarding.next") : t("onboarding.skip")} variant={followedCount ? "primary" : "secondary"} onPress={() => setStep("contacts")} />
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
  photoStep: { flexGrow: 1, alignItems: "flex-start" },
  photoCircle: { alignSelf: "center", marginTop: spacing.xl, width: 140, height: 140, borderRadius: 70, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.accent, borderStyle: "dashed" },
  photoPlus: { position: "absolute", right: 4, bottom: 4, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.background },
  photoPlusText: { color: colors.onAccent, fontSize: 22, fontWeight: "800", lineHeight: 26 },
  photoError: { ...typography.body, color: colors.danger, alignSelf: "center", textAlign: "center" },
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
