import React, { useState } from "react";
import { ActivityIndicator, FlatList, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { findContactsOnKatkee, requestContactsAccess } from "../state/contacts";
import { shareInvite, type InviteSource } from "../state/invites";
import { followUser, unfollowUser } from "../api/users";
import type { ContactMatch } from "../api/growth";
import { ApiError } from "../api/client";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";
import { Banner, Button } from "./Form";
import { Icon } from "./Icon";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

type Phase = "intro" | "checking" | "results" | "denied" | "blocked" | "failed";
type FollowState = "none" | "following" | "requested" | "busy";

interface Props {
  /** Above everything (onboarding's "Step 3 of 3"). */
  header?: React.ReactNode;
  /** Under the list, outside it (onboarding's Done/Skip buttons). */
  footer?: React.ReactNode;
  /** Where this was opened, for the invite button's analytics. */
  source: InviteSource;
  /** Opens a profile from a row; rows aren't tappable without it (onboarding). */
  onOpenProfile?: (username: string) => void;
}

/** What happens, said before the system prompt: the explainer every entry point shows first. */
export const CONTACTS_EXPLAINER = [
  "Katkee checks which of your contacts already have an account, so you can follow them.",
  "Phone numbers and emails are turned into scrambled codes (hashed) on your phone before anything is sent. Names, photos and notes never leave your phone.",
  "Katkee doesn't keep your contacts. They're checked once and forgotten.",
  "Anyone can stop being found this way in Settings > Privacy.",
];

/**
 * Contacts on Katkee: the explainer, then (only on Continue) the system permission prompt, then
 * the people found, each with a Follow button. Used by Settings, Search and onboarding.
 */
export function ContactsFinder({ header, footer, source, onOpenProfile }: Props): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const [phase, setPhase] = useState<Phase>("intro");
  const [people, setPeople] = useState<ContactMatch[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [follows, setFollows] = useState<Record<string, FollowState>>({});

  const check = async () => {
    if (!accessToken) return;
    const access = await requestContactsAccess();
    if (access !== "granted") {
      setPhase(access);
      return;
    }
    setPhase("checking");
    setProgress(null);
    try {
      const found = await findContactsOnKatkee(accessToken, (done, total) => {
        if (total > 1) setProgress(t("contactsFinder.checkingDoneOfTotal", { done, total }));
      });
      setPeople(found);
      setFollows(Object.fromEntries(found.map((p) => [p.username, p.viewer.isFollowing ? "following" : p.viewer.hasPendingRequestFromViewer ? "requested" : "none"])));
      setPhase("results");
    } catch (error) {
      setFailure(error instanceof ApiError && error.status === 429 ? error.message : t("contactsFinder.checkYourConnectionAndTry"));
      setPhase("failed");
    }
  };

  const toggleFollow = async (person: ContactMatch) => {
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

  const invite = <Button label={t("common.inviteFriends")} variant="secondary" onPress={() => void shareInvite(source === "onboarding" ? "onboarding" : "contacts", accessToken, user?.id)} />;

  if (phase !== "results") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="following" size={30} color={colors.textPrimary} />
          </View>
          {phase === "intro" || phase === "checking" ? (
            <>
              <Text style={typography.displayLarge} accessibilityRole="header">{t("contactsFinder.findFriendsFromYourContacts")}</Text>
              <View style={styles.points}>
                {CONTACTS_EXPLAINER.map((point) => (
                  <View key={point} style={styles.point}>
                    <View style={styles.bullet} accessibilityElementsHidden importantForAccessibility="no" />
                    <Text style={styles.body}>{point}</Text>
                  </View>
                ))}
              </View>
              {phase === "checking" ? (
                <View style={styles.checking}>
                  <ActivityIndicator color={colors.accentText} accessibilityLabel={t("contactsFinder.checkingYourContacts2")} />
                  <Text style={styles.body}>{progress ?? t("contactsFinder.checkingYourContacts")}</Text>
                </View>
              ) : (
                <Button label={t("common.continue")} onPress={() => void check()} accessibilityHint={t("contactsFinder.asksToUseYourContacts")} />
              )}
            </>
          ) : phase === "failed" ? (
            <>
              <Text style={typography.displayLarge} accessibilityRole="header">{t("contactsFinder.couldntCheckYourContacts")}</Text>
              {failure ? <Banner text={failure} /> : null}
              <Button label={t("common.tryAgain")} onPress={() => void check()} />
            </>
          ) : (
            <>
              <Text style={typography.displayLarge} accessibilityRole="header">{t("contactsFinder.contactsAreOffForKatkee")}</Text>
              <Text style={styles.body}>
                {phase === "blocked"
                  ? t("contactsFinder.toFindFriendsFromYour")
                  : t("contactsFinder.thatsFineNothingWasRead")}
              </Text>
              {phase === "blocked" ? (
                <Button label={t("common.openSettings")} onPress={() => void Linking.openSettings().catch(() => undefined)} />
              ) : (
                <Button label={t("common.tryAgain")} variant="secondary" onPress={() => void check()} />
              )}
              {invite}
            </>
          )}
        </ScrollView>
        {footer}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {header}
            <Text style={typography.displayLarge} accessibilityRole="header">{t("common.contactsOnKatkee")}</Text>
            <Text style={styles.body}>
              {people.length === 0 ? t("contactsFinder.noneOfYourContactsAre") : people.length === 1 ? t("contactsFinder.n1OfYourContactsIs") : t("contactsFinder.lengthOfYourContactsAre", { length: people.length })}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.body}>{t("contactsFinder.inviteThemAndTheirStories")}</Text>
            {invite}
          </View>
        }
        ListFooterComponent={people.length > 0 ? <View style={styles.listFooter}>{invite}</View> : undefined}
        renderItem={({ item }) => {
          const state = follows[item.username] ?? "none";
          const label = state === "following" ? t("common.following") : state === "requested" ? t("common.requested") : t("common.follow");
          const active = state === "following" || state === "requested";
          const who = (
            <>
              <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId} />
              <View style={styles.rowText}>
                <VerifiedName name={item.displayName || item.username} verified={item.verified} style={styles.name} />
                <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
              </View>
            </>
          );
          return (
            <View style={styles.row}>
              {onOpenProfile ? (
                <Pressable style={styles.rowMain} onPress={() => onOpenProfile(item.username)} accessibilityRole="button" accessibilityLabel={`${item.displayName}, @${item.username}`}>
                  {who}
                </Pressable>
              ) : (
                <View style={styles.rowMain}>{who}</View>
              )}
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
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.xl, gap: spacing.md },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  points: { gap: spacing.sm, marginBottom: spacing.sm },
  point: { flexDirection: "row", gap: spacing.sm },
  // A drawn dot, not a glyph: icons and marks come from shapes (verification/icon-glyphs.cjs).
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9, backgroundColor: colors.accentText },
  body: { ...typography.body, color: colors.textSecondary, flex: 1 },
  checking: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  listHeader: { gap: spacing.sm, marginBottom: spacing.sm },
  listFooter: { marginTop: spacing.lg },
  empty: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  rowText: { flex: 1 },
  name: { ...typography.body, color: colors.textPrimary, fontWeight: "700" },
  username: { ...typography.caption, color: colors.textSecondary },
  follow: { minWidth: 96, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  followStrong: { backgroundColor: colors.accent },
  followQuiet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  followLabel: { ...typography.body, color: colors.onAccent, fontWeight: "700" },
  followLabelQuiet: { color: colors.textPrimary },
});
