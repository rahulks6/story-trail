import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useDM } from "../../state/DMContext";
import { searchUsers } from "../../api/users";
import { groupName, listConversations, MAX_MESSAGE_LENGTH, newClientMessageId, openConversation, sendMessage } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { GroupAvatar } from "../../components/GroupAvatar";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { showToast } from "../../components/Toast";
import { tapFeedback } from "../../utils/haptics";

type Props = NativeStackScreenProps<RootStackParamList, "SendStory">;

/** Someone to send to: an existing chat (1:1 or a group), or a person found by search. */
interface Target {
  key: string;
  name: string;
  /** A person with the verified badge (never a group). */
  verified?: boolean;
  detail: string;
  conversationId?: string;
  username?: string;
  picture: React.ReactNode;
}

/**
 * Send a Story to people on Katkee, over the Story (closing it returns to the same Story).
 * Recent chats and groups are listed first; search finds anyone else. Choose several, add a
 * message if you like, and Send. The server applies the Story's privacy and sharing rules.
 */
export function SendStoryScreen({ route, navigation }: Props): React.JSX.Element {
  const { storyId } = route.params;
  const { accessToken, user } = useAuth();
  const { refreshUnreadCount } = useDM();
  const { bottom } = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const [recent, setRecent] = useState<Target[] | null>(null);
  const [found, setFound] = useState<Target[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [chosen, setChosen] = useState<Map<string, Target>>(new Map());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per recipient until it goes through: a retry after a lost response can't send twice.
  const messageIds = useRef(new Map<string, string>());

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name={ICONS.close} size={22} color={colors.textPrimary} />
        </Pressable>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (!accessToken) return;
    listConversations(accessToken, { limit: 30 })
      .then(({ conversations }) =>
        setRecent(conversations.map((c): Target => {
          if (c.kind === "group" && c.group) {
            const name = groupName(c.group.title, c.group.members, c.group.memberCount - 1);
            return { key: `c:${c.id}`, name, detail: `${c.group.memberCount} people`, conversationId: c.id, picture: <GroupAvatar members={c.group.members} size={44} /> };
          }
          const p = c.otherUser!;
          return { key: `u:${p.username}`, name: p.displayName, verified: p.verified, detail: `@${p.username}`, conversationId: c.id, username: p.username, picture: <Avatar username={p.username} displayName={p.displayName} avatarMediaId={p.avatarMediaId ?? null} /> };
        })),
      )
      .catch(() => setRecent([]));
  }, [accessToken]);

  useEffect(() => {
    if (!search || !accessToken) {
      setFound(null);
      setSearchFailed(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchFailed(false);
    searchUsers(search, accessToken)
      .then(({ results }) => {
        if (!cancelled) setFound(results.filter((r) => r.id !== user?.id).map((r) => ({ key: `u:${r.username}`, name: r.displayName, verified: r.verified, detail: `@${r.username}`, username: r.username, picture: <Avatar username={r.username} displayName={r.displayName} avatarMediaId={r.avatarMediaId ?? null} /> })));
      })
      .catch(() => { if (!cancelled) { setFound([]); setSearchFailed(true); } })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [accessToken, search, user?.id]);

  const toggle = (target: Target) => {
    tapFeedback("select");
    setError(null);
    setChosen((current) => {
      const next = new Map(current);
      if (next.has(target.key)) next.delete(target.key);
      else next.set(target.key, target);
      return next;
    });
  };

  const send = async () => {
    if (!accessToken || !chosen.size || sending) return;
    setSending(true);
    setError(null);
    const text = note.trim();
    const failed = new Map<string, Target>();
    let lastError: string | null = null;
    for (const target of chosen.values()) {
      try {
        const conversationId = target.conversationId ?? (await openConversation(target.username!, accessToken)).conversation.id;
        const clientMessageId = messageIds.current.get(target.key) ?? newClientMessageId();
        messageIds.current.set(target.key, clientMessageId);
        await sendMessage(conversationId, { storyId, clientMessageId }, accessToken);
        messageIds.current.delete(target.key);
        if (text) await sendMessage(conversationId, { body: text, clientMessageId: newClientMessageId() }, accessToken);
      } catch (e) {
        failed.set(target.key, target);
        lastError = e instanceof ApiError ? e.message : "Check your connection and try again.";
      }
    }
    setSending(false);
    void refreshUnreadCount();
    if (!failed.size) {
      tapFeedback("success");
      showToast(chosen.size === 1 ? "Sent" : `Sent to ${chosen.size}`);
      navigation.goBack();
      return;
    }
    // What went is done; what didn't stays chosen for another try.
    setChosen(failed);
    setError(`Couldn't send to ${[...failed.values()].map((t) => t.name).join(", ")}. ${lastError ?? ""}`.trim());
  };

  const list = found ?? recent ?? [];
  const chosenNames = useMemo(() => [...chosen.values()].map((t) => t.name.split(" ")[0]).join(", "), [chosen]);
  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <View style={styles.searchBox}>
        <Icon style={styles.searchIcon} name={ICONS.search} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search people"
        />
      </View>
      {searching || recent === null ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
      {searchFailed ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText} accessibilityRole="alert">Couldn't search. Check your connection and try again.</Text>
        </View>
      ) : null}
      <FlatList
        data={list}
        keyExtractor={(t) => t.key}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={!found && recent?.length ? <Text style={styles.section}>Recent</Text> : undefined}
        ListEmptyComponent={
          search && !searching && !searchFailed ? <Text style={styles.empty}>No people match “{search}”.</Text>
            : recent && !recent.length && !search ? <Text style={styles.empty}>Search for someone to send this Story to.</Text> : undefined
        }
        renderItem={({ item }) => {
          const on = chosen.has(item.key);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${item.name}${item.verified ? ", verified" : ""}, ${item.detail}`}>
              {item.picture}
              <View style={styles.rowText}>
                <VerifiedName name={item.name} verified={item.verified} style={typography.bodyStrong} />
                <Text style={typography.caption} numberOfLines={1}>{item.detail}</Text>
              </View>
              <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name={ICONS.check} size={16} color={colors.onAccent} /> : null}</View>
            </Pressable>
          );
        }}
      />
      {chosen.size ? (
        <View style={[styles.footer, { paddingBottom: spacing.sm + bottom }]}>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <TextInput
            style={styles.note}
            placeholder="Add a message…"
            placeholderTextColor={colors.textDisabled}
            value={note}
            onChangeText={setNote}
            maxLength={MAX_MESSAGE_LENGTH}
            accessibilityLabel="Add a message, optional"
          />
          <Button label={chosen.size === 1 ? `Send to ${chosenNames}` : `Send to ${chosen.size}`} onPress={() => void send()} busy={sending} />
        </View>
      ) : null}
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, gap: spacing.xs },
  searchIcon: { color: colors.textDisabled, fontSize: 16 },
  searchInput: { flex: 1, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 15 },
  spinner: { marginVertical: spacing.md },
  notice: { paddingVertical: spacing.sm },
  noticeText: { ...typography.caption, color: colors.danger, textAlign: "center" },
  section: { ...typography.label, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  empty: { ...typography.caption, color: colors.textSecondary, textAlign: "center", padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 2 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  footer: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  note: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 15 },
  error: { color: colors.danger, fontSize: 13 },
});
