import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { searchUsers } from "../../api/users";
import { groupName, listConversations } from "../../api/conversations";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { GroupAvatar } from "../../components/GroupAvatar";
import { Icon } from "../../components/Icon";

/** Someone to send to: an existing chat (1:1 or a group), or a person found by search. */
export interface Recipient {
  key: string;
  name: string;
  /** A person with the verified badge (never a group). */
  verified?: boolean;
  detail: string;
  conversationId?: string;
  /** A person (from a 1:1 chat or a search), never a group. */
  username?: string;
  userId?: string;
  picture: React.ReactNode;
}

interface Props {
  chosen: Map<string, Recipient>;
  onToggle: (recipient: Recipient) => void;
  /** Shown when there are no recent chats yet, e.g. "Search for someone to send this Story to." */
  emptyHint: string;
}

/**
 * Search and a list of people and chats to tick, recent chats and groups first: shared by
 * Send to (a Story) and Forward (a message). The screen around it owns what's chosen and Send.
 */
export function RecipientPicker({ chosen, onToggle, emptyHint }: Props): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const [recent, setRecent] = useState<Recipient[] | null>(null);
  const [found, setFound] = useState<Recipient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    listConversations(accessToken, { limit: 30 })
      .then(({ conversations }) =>
        setRecent(conversations.map((c): Recipient => {
          if (c.kind === "group" && c.group) {
            const name = groupName(c.group.title, c.group.members, c.group.memberCount - 1);
            return { key: `c:${c.id}`, name, detail: `${c.group.memberCount} people`, conversationId: c.id, picture: <GroupAvatar members={c.group.members} size={44} /> };
          }
          const p = c.otherUser!;
          return { key: `u:${p.username}`, name: p.displayName, verified: p.verified, detail: `@${p.username}`, conversationId: c.id, username: p.username, userId: p.id, picture: <Avatar username={p.username} displayName={p.displayName} avatarMediaId={p.avatarMediaId ?? null} /> };
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
        if (!cancelled) setFound(results.filter((r) => r.id !== user?.id).map((r) => ({ key: `u:${r.username}`, name: r.displayName, verified: r.verified, detail: `@${r.username}`, username: r.username, userId: r.id, picture: <Avatar username={r.username} displayName={r.displayName} avatarMediaId={r.avatarMediaId ?? null} /> })));
      })
      .catch(() => { if (!cancelled) { setFound([]); setSearchFailed(true); } })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [accessToken, search, user?.id]);

  const list = found ?? recent ?? [];
  return (
    <View style={styles.container}>
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
            : recent && !recent.length && !search ? <Text style={styles.empty}>{emptyHint}</Text> : undefined
        }
        renderItem={({ item }) => {
          const on = chosen.has(item.key);
          return (
            <Pressable style={styles.row} onPress={() => onToggle(item)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${item.name}${item.verified ? ", verified" : ""}, ${item.detail}`}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
});
