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
  const chooseAppearance = async (next: AppearanceChoice) => {
    setAppearanceOpen(false);
    if (next === appearanceChoice()) return;
    // Android reloads the app in the new colours; iPhone applies them when Katkee is opened again.
    const restarted = await setAppearance(next);
    if (!restarted) Alert.alert("Appearance saved", "Close Katkee and open it again to see the new colours.");
  };
  const [togglingPrivacy, setTogglingPrivacy] = useState(false);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [pendingRequestCount, setPendingRequestCount] = useState<number | null>(null);
  const [nearbyOn, setNearbyOn] = useState<boolean | null>(null);
  const [togglingNearby, setTogglingNearby] = useState(false);

  useEffect(() => {
    setIsPrivate(user?.isPrivate ?? false);
  }, [user?.isPrivate]);

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
      Alert.alert("Couldn't update", "Try again.");
    } finally {
      setTogglingPrivacy(false);
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
        Alert.alert("Allow location for Nearby Stories", "Katkee needs your approximate location for this. You can allow it in your phone's Settings.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
        ]);
      } else {
        Alert.alert("Couldn't find your area", "Check that location services are on, then try again.");
      }
    } catch {
      setNearbyOn(!next);
      Alert.alert("Couldn't update", "Try again.");
    } finally {
      setTogglingNearby(false);
    }
  };

  const onClearData = () => {
    if (!draftCount) return;
    Alert.alert(
      `Clear ${draftCount} saved ${draftCount === 1 ? "draft" : "drafts"}?`,
      "Any Story you were mid-editing when the app closed will no longer be offered for restore.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
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
    Alert.alert("Log out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionHeader, styles.firstHeader]}>Account</Text>
      <View style={styles.card}>
        <ListRow label="Account and sign-in" icon={ICONS.profile} onPress={() => navigation.navigate("AccountSecurity")} />
        <ListRow label="Request verification" icon={ICONS.verified} onPress={() => navigation.navigate("Verification")} />
        <ListRow label="Notifications" icon={ICONS.notifications} onPress={() => navigation.navigate("NotificationSettings")} />
        <ListRow label="Appearance" icon={ICONS.settings} detail={APPEARANCE_LABELS[appearanceChoice()]} onPress={() => setAppearanceOpen(true)} />
      </View>
      <ActionSheet
        visible={appearanceOpen}
        title="Appearance"
        groups={[(["system", "light", "dark"] as AppearanceChoice[]).map((c) => ({
          label: APPEARANCE_LABELS[c],
          selected: c === appearanceChoice(),
          onPress: () => void chooseAppearance(c),
        }))]}
        onClose={() => setAppearanceOpen(false)}
      />

      <Text style={styles.sectionHeader}>Privacy</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={typography.body}>Private account</Text>
            <Text style={styles.switchHint}>Only followers you approve see your Stories.</Text>
          </View>
          {togglingPrivacy ? <ActivityIndicator color={colors.accentText} /> : <Switch value={isPrivate} onValueChange={onTogglePrivacy} accessibilityLabel="Private account" />}
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={typography.body}>Nearby Stories</Text>
            <Text style={styles.switchHint}>Uses your city-sized area, never your exact location.</Text>
          </View>
          {togglingNearby || nearbyOn === null ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Switch value={nearbyOn} onValueChange={(next) => void onToggleNearby(next)} accessibilityLabel="Nearby Stories" />
          )}
        </View>
        <ListRow
          label="Follow requests"
          icon={ICONS.following}
          detail={pendingRequestCount ? (pendingRequestCount >= REQUEST_COUNT_CAP ? `${REQUEST_COUNT_CAP}+` : String(pendingRequestCount)) : undefined}
          onPress={() => navigation.navigate("FollowRequests")}
        />
        <ListRow label="Close Friends" icon={ICONS.starFilled} onPress={() => navigation.navigate("CloseFriends")} />
        <ListRow label="Blocked accounts" icon={ICONS.privacy} onPress={() => navigation.navigate("BlockedAccounts")} />
        <ListRow label="Muted accounts" icon={ICONS.audioMuted} onPress={() => navigation.navigate("MutedAccounts")} />
      </View>

      <Text style={styles.sectionHeader}>Stories</Text>
      <View style={styles.card}>
        <ListRow label="Uploads" icon={ICONS.create} onPress={() => navigation.navigate("UploadQueue")} />
        <ListRow label="Your interests" icon={ICONS.like} onPress={() => navigation.navigate("YourInterests")} />
        <ListRow
          label="Clear saved drafts"
          icon={ICONS.trash}
          detail={draftCount === null ? "…" : String(draftCount)}
          onPress={onClearData}
          disabled={!draftCount}
        />
      </View>

      <Text style={styles.sectionHeader}>Support</Text>
      <View style={styles.card}>
        <ListRow label="Help" icon={ICONS.help} onPress={() => navigation.navigate("Help")} />
        <ListRow label="Send feedback" icon={ICONS.dm} onPress={() => navigation.navigate("Feedback")} />
        <ListRow label="Account status" icon={ICONS.about} onPress={() => navigation.navigate("Appeals")} />
        <ListRow label="About" icon={ICONS.about} onPress={() => navigation.navigate("About")} />
      </View>

      <View style={[styles.card, styles.lastCard]}>
        <ListRow label="Log out" icon={ICONS.logout} destructive onPress={onLogOut} />
        {/* One path for every account: it verifies with a password or Google/phone, so accounts without a password can delete too. */}
        <ListRow label="Delete account" icon={ICONS.trash} destructive onPress={() => navigation.navigate("AccountSecurity")} />
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

const APPEARANCE_LABELS: Record<AppearanceChoice, string> = { system: "Automatic", light: "Light", dark: "Dark" };
