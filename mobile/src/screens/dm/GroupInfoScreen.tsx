import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DMStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getConversation, leaveGroup, setConversationMuted, MAX_GROUP_MEMBERS, MAX_GROUP_TITLE, removeGroupMember, renameGroup, type GroupDetails } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { GroupAvatar } from "../../components/GroupAvatar";
import { ListRow } from "../../components/ListRow";
import { Banner } from "../../components/Form";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<DMStackParamList, "GroupInfo">;

/** A group's details: its name (anyone can change it), its people, Add people, and Leave. */
export function GroupInfoScreen({ navigation, route }: Props): React.JSX.Element {
  const { conversationId } = route.params;
  const { accessToken, user } = useAuth();
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { conversation } = await getConversation(conversationId, accessToken);
      if (conversation.kind !== "group") return;
      setGroup(conversation);
      setTitle(conversation.title ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? t("groupInfo.youreNoLongerInThis") : t("groupInfo.couldntLoadTheGroupCheck"));
    }
  }, [accessToken, conversationId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const fail = (e: unknown) => Alert.alert(t("groupInfo.couldntDoThat"), e instanceof ApiError ? e.message : t("groupInfo.checkYourConnectionAndTry"));

  const saveTitle = async () => {
    if (!accessToken || !group || saving || (title.trim() || null) === group.title) return;
    setSaving(true);
    try {
      setGroup((await renameGroup(conversationId, title.trim() || null, accessToken)).conversation);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = (member: GroupDetails["members"][number]) => {
    Alert.alert(t("groupInfo.removeUsername", { username: member.username }), t("groupInfo.theyWontSeeNewMessages"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            setGroup((await removeGroupMember(conversationId, member.userId, accessToken)).conversation);
          } catch (e) {
            fail(e);
          }
        },
      },
    ]);
  };

  const toggleMute = async (next: boolean) => {
    if (!accessToken || !group) return;
    setGroup({ ...group, muted: next });
    try {
      await setConversationMuted(conversationId, next, accessToken);
    } catch (e) {
      setGroup((current) => (current ? { ...current, muted: !next } : current));
      fail(e);
    }
  };

  const leave = () => {
    Alert.alert(t("groupInfo.leaveThisGroup"), t("groupInfo.youWontGetItsMessages"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("groupInfo.leave"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await leaveGroup(conversationId, accessToken);
            navigation.popToTop();
          } catch (e) {
            fail(e);
          }
        },
      },
    ]);
  };

  if (!group) {
    return (
      <View style={styles.centered}>
        {error ? <Text style={[typography.body, styles.muted]}>{error}</Text> : <ActivityIndicator color={colors.accentText} />}
      </View>
    );
  }

  const others = group.members.filter((m) => m.userId !== user?.id);
  const admin = group.role === "admin";
  return (
    <FlatList keyboardShouldPersistTaps="handled"
      style={styles.container}
      contentContainerStyle={styles.content}
      data={group.members}
      keyExtractor={(m) => m.userId}
      ListHeaderComponent={
        <View style={styles.header}>
          <GroupAvatar members={others} size={72} />
          <TextInput
            style={styles.title}
            value={title}
            onChangeText={setTitle}
            onEndEditing={() => void saveTitle()}
            onSubmitEditing={() => void saveTitle()}
            placeholder={t("groupInfo.nameThisGroup")}
            placeholderTextColor={colors.textDisabled}
            maxLength={MAX_GROUP_TITLE}
            returnKeyType="done"
            accessibilityLabel={t("groupInfo.groupName")}
            accessibilityHint={t("groupInfo.everyoneInTheGroupSees")}
          />
          {saving ? <ActivityIndicator color={colors.accentText} /> : null}
          <Text style={styles.muted}>{t("groupInfo.lengthOfUpToMax", { length: group.members.length, MAX_GROUP_MEMBERS })}</Text>
          <View style={styles.card}>
            {group.members.length < MAX_GROUP_MEMBERS ? (
              <ListRow label={t("common.addPeople")} icon={ICONS.add} onPress={() => navigation.navigate("NewGroup", { conversationId })} />
            ) : null}
            <View style={styles.switchRow}>
              <Text style={typography.body}>{t("common.muteNotifications")}</Text>
              <Switch value={!!group.muted} onValueChange={(next) => void toggleMute(next)} accessibilityLabel={t("common.muteNotifications")} />
            </View>
          </View>
          {error ? <Banner text={error} /> : null}
          <Text style={styles.section}>{t("groupInfo.people")}</Text>
        </View>
      }
      renderItem={({ item }) => {
        const me = item.userId === user?.id;
        return (
          <View style={styles.member}>
            <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId} size={40} />
            <View style={styles.memberText}>
              <VerifiedName name={me ? `${item.displayName} (you)` : item.displayName} verified={item.verified} style={typography.bodyStrong} />
              <Text style={typography.caption} numberOfLines={1}>@{item.username}{item.role === "admin" ? t("groupInfo.admin") : ""}</Text>
            </View>
            {admin && !me ? (
              <Pressable onPress={() => remove(item)} hitSlop={8} style={styles.remove} accessibilityRole="button" accessibilityLabel={t("groupInfo.removeUsername2", { username: item.username })}>
                <Text style={styles.removeText}>{t("common.remove")}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }}
      ListFooterComponent={
        <View style={[styles.card, styles.leave]}>
          <ListRow label={t("groupInfo.leaveGroup")} icon={ICONS.close} destructive onPress={leave} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  header: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  title: { alignSelf: "stretch", textAlign: "center", color: colors.textPrimary, fontSize: 20, fontWeight: "700", paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  muted: { color: colors.textSecondary, textAlign: "center" },
  section: { alignSelf: "flex-start", color: colors.textSecondary, fontSize: 13, fontWeight: "600", marginTop: spacing.md },
  card: { alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: spacing.md },
  member: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  memberText: { flex: 1, gap: 2 },
  remove: { minHeight: 36, paddingHorizontal: spacing.sm, justifyContent: "center" },
  removeText: { color: colors.danger, fontWeight: "600" },
  leave: { marginTop: spacing.lg },
});
