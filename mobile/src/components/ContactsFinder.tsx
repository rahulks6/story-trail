import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, SectionList, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { contactsWatchEnabled, disableContactsWatch, enableContactsWatch } from "../state/contactsWatch";
import { Pressable } from "./Pressable";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { checkContacts, requestContactsAccess, type InvitableContact } from "../state/contacts";
import { inviteContact, invitedContacts, invitedId, shareInvite, type InviteSource } from "../state/invites";
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

/** A number as people write it: "+91 98765 43210" for India, as stored for anywhere else. */
export function displayPhone(phone: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return india ? `+91 ${india[1]} ${india[2]}` : phone;
}

type Row = { kind: "person"; person: ContactMatch } | { kind: "contact"; contact: InvitableContact };

/** What happens, said before the system prompt: the explainer every entry point shows first. */
export function contactsExplainer(): string[] {
  return [t("contactsFinder.explainerChecks"), t("contactsFinder.explainerHashed"), t("contactsFinder.explainerForgotten"), t("contactsFinder.explainerOptOut")];
}

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
  // Contacts to invite, worked out on the phone (state/contacts.ts), and who was already sent one.
  const [invitable, setInvitable] = useState<InvitableContact[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // "Tell me when more contacts join" (state/contactsWatch.ts): off until switched on here.
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void contactsWatchEnabled(user.id).then((on) => { if (alive) setWatching(on); });
    return () => { alive = false; };
  }, [user]);
  const setWatch = (on: boolean) => {
    if (!user) return;
    setWatching(on);
    void (on ? enableContactsWatch(user.id, people) : disableContactsWatch(user.id));
  };

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
      const { people: found, invitable: others } = await checkContacts(accessToken, (done, total) => {
        if (total > 1) setProgress(t("contactsFinder.checkingDoneOfTotal", { done, total }));
      });
      setPeople(found);
      setInvitable(others);
      if (user) setInvited(await invitedContacts(user.id));
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

  const sendInvite = async (contact: InvitableContact) => {
    if (await inviteContact(contact.phone, accessToken, user?.id)) {
      tapFeedback("success");
      setInvited((before) => new Set(before).add(invitedId(contact.phone)));
    }
  };

  const shownContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invitable;
    const digits = q.replace(/\D/g, "");
    return invitable.filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.includes(digits)));
  }, [invitable, search]);

  const sections = useMemo(() => [
    { key: "people", data: people.map((person): Row => ({ kind: "person", person })) },
    ...(invitable.length > 0 ? [{ key: "invite", data: shownContacts.map((contact): Row => ({ kind: "contact", contact })) }] : []),
  ], [people, invitable.length, shownContacts]);

  const invite = <Button label={t("common.inviteFriends")} variant="secondary" onPress={() => void shareInvite(source === "onboarding" ? "onboarding" : "contacts", accessToken, user?.id)} />;

  const watchRow = (
    <View style={styles.watchRow}>
      <View style={styles.watchText}>
        <Text style={styles.watchTitle}>{t("contactsFinder.tellMeWhenContactsJoin")}</Text>
        <Text style={styles.watchBody}>{t("contactsFinder.tellMeWhenContactsJoinBody")}</Text>
      </View>
      <Switch
        value={watching}
        onValueChange={setWatch}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor="#FFFFFF"
        accessibilityLabel={t("contactsFinder.tellMeWhenContactsJoin")}
      />
    </View>
  );

  if (phase !== "results") {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="following" size={30} color={colors.textPrimary} />
          </View>
          {/* While it's on, it can be turned off here without checking contacts again. */}
          {watching && phase === "intro" ? watchRow : null}
          {phase === "intro" || phase === "checking" ? (
            <>
              <Text style={typography.displayLarge} accessibilityRole="header">{t("contactsFinder.findFriendsFromYourContacts")}</Text>
              <View style={styles.points}>
                {contactsExplainer().map((point) => (
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
      <SectionList<Row>
        sections={sections}
        keyExtractor={(row) => (row.kind === "person" ? row.person.id : row.contact.phone)}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {header}
            <Text style={typography.displayLarge} accessibilityRole="header">{t("common.contactsOnKatkee")}</Text>
            <Text style={styles.body}>
              {people.length === 0 ? t("contactsFinder.noneOfYourContactsAre") : t("contactsFinder.contactsHere", { count: people.length })}
            </Text>
            {watchRow}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.key === "invite" ? (
            <View style={styles.inviteHeader} testID="contacts-invite-section">
              <Text style={typography.title} accessibilityRole="header">{t("contactsFinder.inviteFriendsToKatkee")}</Text>
              <Text style={styles.body}>{t("contactsFinder.inviteFriendsToKatkeeBody")}</Text>
              {invitable.length > 8 ? (
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={t("contactsFinder.searchContacts")}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.search}
                  autoCorrect={false}
                  accessibilityLabel={t("contactsFinder.searchContacts")}
                  testID="contacts-invite-search"
                />
              ) : null}
              {shownContacts.length === 0 ? <Text style={styles.body}>{t("contactsFinder.noContactsMatch")}</Text> : null}
            </View>
          ) : people.length === 0 && invitable.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.body}>{t("contactsFinder.inviteThemAndTheirStories")}</Text>
            </View>
          ) : null
        }
        ListFooterComponent={<View style={styles.listFooter}>{invite}</View>}
        renderItem={({ item: row }) => {
          if (row.kind === "contact") {
            const { contact } = row;
            const sent = invited.has(invitedId(contact.phone));
            return (
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <View style={styles.initial} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Text style={styles.initialText}>{[...contact.name][0]?.toUpperCase()}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>{contact.name}</Text>
                    <Text style={styles.username} numberOfLines={1}>{displayPhone(contact.phone)}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => void sendInvite(contact)}
                  style={[styles.follow, sent ? styles.followQuiet : styles.followStrong]}
                  accessibilityRole="button"
                  accessibilityLabel={t("contactsFinder.inviteName", { name: contact.name })}
                  testID={`contact-invite-${contact.phone}`}
                >
                  <Text style={[styles.followLabel, sent && styles.followLabelQuiet]}>{sent ? t("contactsFinder.invited") : t("contactsFinder.invite")}</Text>
                </Pressable>
              </View>
            );
          }
          const item = row.person;
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
  watchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  watchText: { flex: 1, gap: 2 },
  watchTitle: { ...typography.body, fontWeight: "700" },
  watchBody: { ...typography.caption, color: colors.textSecondary },
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
  inviteHeader: { gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.xs },
  search: {
    ...typography.body,
    color: colors.textPrimary,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  initial: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceElevated },
  initialText: { ...typography.body, color: colors.textPrimary, fontWeight: "700" },
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
