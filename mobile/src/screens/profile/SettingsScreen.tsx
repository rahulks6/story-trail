import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { updateMyProfile, listFollowRequests } from "../../api/users";
import { countPendingDrafts, clearAllPendingDrafts } from "../../state/draftStorage";
import { ListRow } from "../../components/ListRow";
import { ActionSheet } from "../../components/ActionSheet";
import { appearanceChoice, setAppearance, type AppearanceChoice } from "../../theme/appearance";
import { nearbyChoice, turnNearbyOff, turnNearbyOn } from "../../state/nearby";
import { professionalCategoryLabel } from "../../api/professional";
import { shareInvite } from "../../state/invites";
import { LANGUAGES, LANGUAGE_NAMES, setLanguage, t, useLanguage } from "../../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

/** The badge counts one page of requests; a full page shows as "50+". */
const REQUEST_COUNT_CAP = 50;

/**
 * The real settings hub the icon reference calls for: Privacy (backed by
 * the same `isPrivate` field Edit Profile's screen leaves alone), a link
 * into real per-type Notification toggles, a real "Data & Storage" (the
 * one thing this app actually caches on-device — crash-autosaved Story
 * drafts, see draftStorage.ts), static Help/About, Log Out (moved here
 * from the profile page itself, matching the reference), and account
 * deletion (moved here from ProfileScreen, same reasoning).
 */
export function SettingsScreen({ navigation }: Props): React.JSX.Element {
  const { user, accessToken, logout, applyProfile } = useAuth();
  const [isPrivate, setIsPrivate] = useState(user?.isPrivate ?? false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const language = useLanguage();
  const [languageOpen, setLanguageOpen] = useState(false);
  const chooseAppearance = async (next: AppearanceChoice) => {
    setAppearanceOpen(false);
    if (next === appearanceChoice()) return;
    // Android reloads the app in the new colours; iPhone applies them when Katkee is opened again.
    const restarted = await setAppearance(next);
    if (!restarted) Alert.alert(t("settings.appearanceSaved"), t("settings.closeKatkeeAndOpenIt"));
  };
  const [togglingPrivacy, setTogglingPrivacy] = useState(false);
  // A professional account stays public (the server refuses otherwise): switching back comes first.
  const professional = !!user?.professionalCategory;
  // Missing from older servers' answers: it has always been on there.
  const [findable, setFindable] = useState(user?.findableByContacts ?? true);
  const [togglingFindable, setTogglingFindable] = useState(false);
  const [onWeb, setOnWeb] = useState(user?.showOnWeb ?? true);
  const [togglingWeb, setTogglingWeb] = useState(false);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [pendingRequestCount, setPendingRequestCount] = useState<number | null>(null);
  const [nearbyOn, setNearbyOn] = useState<boolean | null>(null);
  const [togglingNearby, setTogglingNearby] = useState(false);

  useEffect(() => {
    setIsPrivate(user?.isPrivate ?? false);
  }, [user?.isPrivate]);
  useEffect(() => {
    setFindable(user?.findableByContacts ?? true);
  }, [user?.findableByContacts]);
  useEffect(() => {
    setOnWeb(user?.showOnWeb ?? true);
  }, [user?.showOnWeb]);

  useFocusEffect(
    useCallback(() => {
      if (user) void countPendingDrafts(user.id).then(setDraftCount);
      if (user) void nearbyChoice(user.id).then((choice) => setNearbyOn(choice === "on"));
      if (accessToken) {
        // A count-only fetch, capped at one page — this only needs to show
        // a badge, not the full list (FollowRequestsScreen does that).
        void listFollowRequests(accessToken, { limit: REQUEST_COUNT_CAP })
          .then(({ requests }) => setPendingRequestCount(requests.length))
          .catch(() => setPendingRequestCount(null));
      }
    }, [accessToken, user?.id]),
  );

  const onTogglePrivacy = async (next: boolean) => {
    if (!accessToken || togglingPrivacy) return;
    setTogglingPrivacy(true);
    setIsPrivate(next); // optimistic
    try {
      const { user: saved } = await updateMyProfile({ isPrivate: next }, accessToken);
      applyProfile(saved);
    } catch {
      setIsPrivate(!next); // the PATCH failed — revert to what the server actually has
      Alert.alert(t("common.couldntUpdate"), t("common.tryAgain2"));
    } finally {
      setTogglingPrivacy(false);
    }
  };

  // Off: contact matching never returns this account, whoever has your email or number.
  const onToggleFindable = async (next: boolean) => {
    if (!accessToken || togglingFindable) return;
    setTogglingFindable(true);
    setFindable(next);
    try {
      const { user: saved } = await updateMyProfile({ findableByContacts: next }, accessToken);
      applyProfile(saved);
    } catch {
      setFindable(!next);
      Alert.alert(t("common.couldntUpdate"), t("common.tryAgain2"));
    } finally {
      setTogglingFindable(false);
    }
  };

  // Off: katkee.com/u/<username> shows the same minimal "Open in Katkee" page as a private account.
  const onToggleWeb = async (next: boolean) => {
    if (!accessToken || togglingWeb) return;
    setTogglingWeb(true);
    setOnWeb(next);
    try {
      const { user: saved } = await updateMyProfile({ showOnWeb: next }, accessToken);
      applyProfile(saved);
    } catch {
      setOnWeb(!next);
      Alert.alert(t("common.couldntUpdate"), t("common.tryAgain2"));
    } finally {
      setTogglingWeb(false);
    }
  };

  // Nearby Stories (Phase 9): on asks for approximate location and sends only a city-sized
  // area; off clears it on the server. The switch shows what the server ends up with.
  const onToggleNearby = async (next: boolean) => {
    if (!user || !accessToken || togglingNearby) return;
    setTogglingNearby(true);
    setNearbyOn(next);
    try {
      if (!next) {
        await turnNearbyOff(user.id, accessToken);
        return;
      }
      const result = await turnNearbyOn(user.id, accessToken);
      if (result === "on") return;
      setNearbyOn(false);
      if (result === "denied") {
        Alert.alert(t("settings.allowLocationForNearbyStories"), t("settings.katkeeNeedsYourApproximateLocation"), [
          { text: t("common.notNow"), style: "cancel" },
          { text: t("common.openSettings"), onPress: () => void Linking.openSettings().catch(() => undefined) },
        ]);
      } else {
        Alert.alert(t("settings.couldntFindYourArea"), t("settings.checkThatLocationServicesAre"));
      }
    } catch {
      setNearbyOn(!next);
      Alert.alert(t("common.couldntUpdate"), t("common.tryAgain2"));
    } finally {
      setTogglingNearby(false);
    }
  };

  const onClearData = () => {
    if (!draftCount) return;
    Alert.alert(
      t("settings.clearSavedDrafts2", { count: draftCount }),
      t("settings.anyStoryYouWereMid"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.clear"),
          style: "destructive",
          onPress: async () => {
            if (user) await clearAllPendingDrafts(user.id);
            setDraftCount(0);
          },
        },
      ],
    );
  };

  const onLogOut = () => {
    Alert.alert(t("settings.logOut"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.logOut"), style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionHeader, styles.firstHeader]}>{t("settings.account")}</Text>
      <View style={styles.card}>
        <ListRow label={t("settings.accountAndSignIn")} icon={ICONS.profile} onPress={() => navigation.navigate("AccountSecurity")} />
        <ListRow
          label={professional ? t("common.professionalAccount") : t("settings.switchToProfessionalAccount")}
          icon={ICONS.insights}
          detail={professional ? professionalCategoryLabel(user?.professionalCategory) ?? undefined : undefined}
          onPress={() => navigation.navigate("ProfessionalAccount")}
        />
        <ListRow label={t("common.requestVerification")} icon={ICONS.verified} onPress={() => navigation.navigate("Verification")} />
        <ListRow label={t("common.notifications")} icon={ICONS.notifications} onPress={() => navigation.navigate("NotificationSettings")} />
        <ListRow label={t("settings.appearance")} icon={ICONS.settings} detail={APPEARANCE_LABELS[appearanceChoice()]} onPress={() => setAppearanceOpen(true)} />
        <ListRow label={t("settings.language")} icon={ICONS.settings} detail={LANGUAGE_NAMES[language]} onPress={() => setLanguageOpen(true)} />
      </View>
      <ActionSheet
        visible={languageOpen}
        title={t("settings.language")}
        groups={[LANGUAGES.map((option) => ({
          // Each language in its own script, so anyone can find theirs.
          label: LANGUAGE_NAMES[option],
          selected: option === language,
          onPress: () => {
            setLanguageOpen(false);
            // The app switches at once (the screens remount on this one); the server hears it
            // from useLocaleSync, for pushes and emails.
            if (option !== language) void setLanguage(option);
          },
        }))]}
        onClose={() => setLanguageOpen(false)}
      />
      <ActionSheet
        visible={appearanceOpen}
        title={t("settings.appearance")}
        groups={[(["system", "light", "dark"] as AppearanceChoice[]).map((c) => ({
          label: APPEARANCE_LABELS[c],
          selected: c === appearanceChoice(),
          onPress: () => void chooseAppearance(c),
        }))]}
        onClose={() => setAppearanceOpen(false)}
      />

      <Text style={styles.sectionHeader}>{t("settings.privacy")}</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={typography.body}>{t("common.privateAccount")}</Text>
            <Text style={styles.switchHint}>
              {professional ? t("settings.professionalAccountsArePublicSwitch") : t("settings.onlyFollowersYouApproveSee")}
            </Text>
          </View>
          {togglingPrivacy ? <ActivityIndicator color={colors.accentText} /> : (
            <Switch value={isPrivate} onValueChange={onTogglePrivacy} disabled={professional && !isPrivate} accessibilityLabel={t("common.privateAccount")} accessibilityHint={professional ? t("settings.unavailableForAProfessionalAccount") : undefined} />
          )}
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={typography.body}>{t("settings.nearbyStories")}</Text>
            <Text style={styles.switchHint}>{t("settings.usesYourCitySizedArea")}</Text>
          </View>
          {togglingNearby || nearbyOn === null ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Switch value={nearbyOn} onValueChange={(next) => void onToggleNearby(next)} accessibilityLabel={t("settings.nearbyStories")} />
          )}
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={typography.body}>{t("settings.letPeopleFindMeFrom")}</Text>
            <Text style={styles.switchHint}>{t("settings.peopleWhoHaveYourVerified")}</Text>
          </View>
          {togglingFindable ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Switch value={findable} onValueChange={(next) => void onToggleFindable(next)} accessibilityLabel={t("settings.letPeopleFindMeFrom")} />
          )}
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={typography.body}>{t("settings.showMyProfileOnThe")}</Text>
            <Text style={styles.switchHint}>
              {isPrivate
                ? t("settings.privateAccountsNeverShowOn")
                : t("settings.anyoneWithYourLinkCan")}
            </Text>
          </View>
          {togglingWeb ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Switch value={onWeb && !isPrivate} onValueChange={(next) => void onToggleWeb(next)} disabled={isPrivate} accessibilityLabel={t("settings.showMyProfileOnThe")} accessibilityHint={isPrivate ? t("settings.unavailableForAPrivateAccount") : undefined} />
          )}
        </View>
        <ListRow
          label={t("common.followRequests")}
          icon={ICONS.following}
          detail={pendingRequestCount ? (pendingRequestCount >= REQUEST_COUNT_CAP ? `${REQUEST_COUNT_CAP}+` : String(pendingRequestCount)) : undefined}
          onPress={() => navigation.navigate("FollowRequests")}
        />
        <ListRow label={t("common.closeFriends")} icon={ICONS.starFilled} onPress={() => navigation.navigate("CloseFriends")} />
        <ListRow label={t("common.blockedAccounts")} icon={ICONS.privacy} onPress={() => navigation.navigate("BlockedAccounts")} />
        <ListRow label={t("common.mutedAccounts")} icon={ICONS.audioMuted} onPress={() => navigation.navigate("MutedAccounts")} />
      </View>

      <Text style={styles.sectionHeader}>{t("settings.friends")}</Text>
      <View style={styles.card}>
        <ListRow label={t("common.contactsOnKatkee")} icon={ICONS.following} onPress={() => navigation.navigate("ContactsOnKatkee", { from: "settings" })} />
        <ListRow label={t("common.inviteFriends")} icon={ICONS.share} onPress={() => void shareInvite("settings", accessToken, user?.id)} />
      </View>

      <Text style={styles.sectionHeader}>{t("common.stories")}</Text>
      <View style={styles.card}>
        <ListRow label={t("settings.uploads")} icon={ICONS.create} onPress={() => navigation.navigate("UploadQueue")} />
        <ListRow label={t("common.yourInterests")} icon={ICONS.like} onPress={() => navigation.navigate("YourInterests")} />
        <ListRow
          label={t("settings.clearSavedDrafts")}
          icon={ICONS.trash}
          detail={draftCount === null ? "…" : String(draftCount)}
          onPress={onClearData}
          disabled={!draftCount}
        />
      </View>

      <Text style={styles.sectionHeader}>{t("settings.support")}</Text>
      <View style={styles.card}>
        <ListRow label={t("common.help")} icon={ICONS.help} onPress={() => navigation.navigate("Help")} />
        <ListRow label={t("common.sendFeedback")} icon={ICONS.dm} onPress={() => navigation.navigate("Feedback")} />
        <ListRow label={t("settings.downloadYourData")} icon={ICONS.archive} onPress={() => navigation.navigate("DataExport")} />
        <ListRow label={t("settings.accountStatus")} icon={ICONS.about} onPress={() => navigation.navigate("Appeals")} />
        <ListRow label={t("common.about")} icon={ICONS.about} onPress={() => navigation.navigate("About")} />
      </View>

      <View style={[styles.card, styles.lastCard]}>
        <ListRow label={t("common.logOut")} icon={ICONS.logout} destructive onPress={onLogOut} />
        {/* One path for every account: it verifies with a password or Google/phone, so accounts without a password can delete too. */}
        <ListRow label={t("common.deleteAccount")} icon={ICONS.trash} destructive onPress={() => navigation.navigate("AccountSecurity")} />
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionHeader: { ...typography.label, color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs },
  firstHeader: { marginTop: 0 },
  lastCard: { marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  switchLabelGroup: { flex: 1, marginRight: spacing.md, gap: spacing.xs / 2 },
  switchHint: { ...typography.caption, color: colors.textSecondary },
});

const APPEARANCE_LABELS: Record<AppearanceChoice, string> = { get system() { return t("settings.automatic"); }, get light() { return t("settings.light"); }, get dark() { return t("settings.dark"); } };
