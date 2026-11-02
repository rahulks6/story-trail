import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { redeemInvite, type Inviter, type RedeemStatus } from "../../api/growth";
import { followUser } from "../../api/users";
import { ApiError } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { EmptyState } from "../../components/EmptyState";
import { Button } from "../../components/Form";
import { track } from "../../analytics/analytics";
import { tapFeedback } from "../../utils/haptics";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "InviteLink">;

/**
 * katkee.com/i/<code> (and katkee://invite/<code>) opened while signed in. A brand-new account is
 * credited to the inviter (backend growth/invites.ts); anyone else just meets the person who
 * invited them, with a Follow button.
 */
export function InviteLinkScreen({ navigation, route }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [result, setResult] = useState<{ status: RedeemStatus; inviter: Inviter } | null>(null);
  const [problem, setProblem] = useState<"invalid" | "offline" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [follow, setFollow] = useState<"none" | "busy" | "following" | "requested">("none");

  useEffect(() => {
    track("invite_link_opened", { signedIn: true });
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setProblem(null);
    redeemInvite(route.params.code, accessToken)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setProblem(e instanceof ApiError && e.status === 404 ? "invalid" : "offline"); });
    return () => { cancelled = true; };
  }, [accessToken, route.params.code, attempt]);

  const close = () => (navigation.canGoBack() ? navigation.goBack() : navigation.replace("Main", { screen: "Home" }));

  if (problem) {
    return (
      <View style={styles.root}>
        <EmptyState
          title={problem === "invalid" ? t("inviteLink.thisInviteLinkDoesntWork") : t("inviteLink.couldntOpenThisInvite")}
          message={problem === "invalid" ? t("inviteLink.askYourFriendToSend") : t("inviteLink.checkYourConnectionAndTry")}
        />
        <View style={styles.actions}>
          {problem === "offline" ? <Button label={t("common.tryAgain")} onPress={() => setAttempt((n) => n + 1)} /> : null}
          <Button label={t("common.close")} variant="secondary" onPress={close} />
        </View>
      </View>
    );
  }
  if (!result) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} size="large" accessibilityLabel={t("inviteLink.openingInvite")} />
      </View>
    );
  }

  const { inviter, status } = result;
  if (status === "own") {
    return (
      <View style={styles.root}>
        <EmptyState icon="share" title={t("inviteLink.thisIsYourInviteLink")} message={t("inviteLink.sendItToFriendsWhen")} />
        <View style={styles.actions}><Button label={t("common.done")} onPress={close} /></View>
      </View>
    );
  }
  const onFollow = async () => {
    if (!accessToken || follow !== "none") return;
    setFollow("busy");
    try {
      const r = await followUser(inviter.username, accessToken);
      tapFeedback("success");
      setFollow(r.status);
    } catch {
      setFollow("none");
    }
  };
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Avatar username={inviter.username} displayName={inviter.displayName} avatarMediaId={inviter.avatarMediaId ?? null} size={88} />
        <VerifiedName name={inviter.displayName || inviter.username} verified={inviter.verified} style={typography.title} />
        <Text style={styles.username}>@{inviter.username}</Text>
        <Text style={styles.message} accessibilityRole="header">
          {status === "redeemed" ? t("inviteLink.youJoinedFromDisplaynameS", { displayName: inviter.displayName }) : t("inviteLink.displaynameInvitedYouToKatkee", { displayName: inviter.displayName })}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          label={follow === "following" ? t("common.following") : follow === "requested" ? t("common.requested") : t("inviteLink.followUsername", { username: inviter.username })}
          busy={follow === "busy"}
          disabled={follow === "following" || follow === "requested"}
          onPress={() => void onFollow()}
        />
        <Button label={t("common.viewProfile")} variant="secondary" onPress={() => navigation.replace("Main", { screen: "Search", params: { screen: "UserProfile", initial: false, params: { username: inviter.username } } })} />
        <Button label={t("common.done")} variant="text" onPress={close} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: "center" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  card: { alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xl },
  username: { ...typography.body, color: colors.textSecondary },
  message: { ...typography.body, color: colors.textPrimary, textAlign: "center", marginTop: spacing.md },
  actions: { padding: spacing.xl, gap: spacing.sm },
});
