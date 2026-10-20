import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { addCloseFriend, getFollowers, listCloseFriends, removeCloseFriend, searchUsers } from "../../api/users";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { ListSkeleton } from "../../components/Skeleton";
import { tapFeedback } from "../../utils/haptics";

interface Person {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId?: string | null;
}

const MAX_LIST = 1000;
/** The most the server returns in one request (backend/src/http/pagination.ts). */
const PAGE = 50;

/** Your whole list, a page at a time: asking for more than a page at once was refused. */
async function allCloseFriends(token: string): Promise<Person[]> {
  const all: Person[] = [];
  for (let offset = 0; offset < MAX_LIST; offset += PAGE) {
    const { closeFriends } = await listCloseFriends(token, { limit: PAGE, offset });
    all.push(...closeFriends);
    if (closeFriends.length < PAGE) break;
  }
  return all;
}

/**
 * Close Friends (Settings › Privacy): the people who see Stories shared with "Close Friends".
 * Only you see this list; nobody is told they were added or removed. Your current list comes
 * first, then your followers to add, or search for anyone.
 */
export function CloseFriendsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { accessToken, user } = useAuth();
  const username = user?.username;
  const userId = user?.id;
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [followers, setFollowers] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !username) return;
    try {
      const [list, mine] = await Promise.all([
        allCloseFriends(accessToken),
        getFollowers(username, accessToken, { limit: PAGE }).catch(() => ({ followers: [] as Person[] })),
      ]);
      setFriends(list);
      setFollowers(mine.followers);
      setError(null);
    } catch {
      setError("Couldn't load your Close Friends. Check your connection and try again.");
      setFriends((current) => current ?? []);
    }
  }, [accessToken, username]);

  useEffect(() => {
    void load();
  }, [load]);

  // Search anyone by name or username, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (!q || !accessToken) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchUsers(q, accessToken, { limit: 20, signal: controller.signal })
        .then((r) => setResults(r.results.filter((p) => p.id !== userId)))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, accessToken, userId]);

  const onList = useMemo(() => new Set((friends ?? []).map((f) => f.id)), [friends]);

  const toggle = async (person: Person) => {
    if (!accessToken || busy.has(person.id)) return;
    const adding = !onList.has(person.id);
    setBusy((b) => new Set(b).add(person.id));
    setError(null);
    try {
      if (adding) {
        await addCloseFriend(person.username, accessToken);
        setFriends((f) => [...(f ?? []), person].sort((a, b) => a.username.localeCompare(b.username)));
      } else {
        await removeCloseFriend(person.username, accessToken);
        setFriends((f) => (f ?? []).filter((x) => x.id !== person.id));
      }
      tapFeedback("select");
    } catch {
      setError(adding ? `Couldn't add @${person.username}. Try again.` : `Couldn't remove @${person.username}. Try again.`);
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(person.id);
        return next;
      });
    }
  };

  if (friends === null) return <ListSkeleton label="Loading Close Friends" />;

  const searching = query.trim().length > 0;
  const suggestions = followers.filter((f) => !onList.has(f.id));
  const sections: Array<{ key: string; title?: string; person?: Person }> = searching
    ? (results ?? []).map((p) => ({ key: `r-${p.id}`, person: p }))
    : [
        ...(friends.length ? [{ key: "h-list", title: `On your list · ${friends.length}` }] : []),
        ...friends.map((p) => ({ key: `f-${p.id}`, person: p })),
        ...(suggestions.length ? [{ key: "h-suggest", title: "Your followers" }] : []),
        ...suggestions.map((p) => ({ key: `s-${p.id}`, person: p })),
      ];

  return (
    <View style={styles.screen}>
      <Text style={[typography.caption, styles.intro]}>
        Only you can see this list. Stories you share with Close Friends are seen only by these people, and nobody is told when you add or remove them.
      </Text>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search people"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search people to add"
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <FlatList
        data={sections}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        // The last rows clear Android's navigation bar and the iPhone home indicator.
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }}
        renderItem={({ item }) => {
          if (item.title) return <Text style={styles.sectionTitle}>{item.title}</Text>;
          const person = item.person!;
          const listed = onList.has(person.id);
          const full = !listed && friends.length >= MAX_LIST;
          return (
            <View style={styles.row}>
              <Avatar username={person.username} displayName={person.displayName} avatarMediaId={person.avatarMediaId} size={44} />
              <View style={styles.names}>
                <Text style={styles.displayName} numberOfLines={1}>{person.displayName}</Text>
                <Text style={styles.username} numberOfLines={1}>@{person.username}</Text>
              </View>
              <Pressable
                onPress={() => void toggle(person)}
                disabled={busy.has(person.id) || full}
                style={[styles.button, listed ? styles.buttonRemove : styles.buttonAdd, (busy.has(person.id) || full) && styles.buttonBusy]}
                accessibilityRole="button"
                accessibilityLabel={listed ? `Remove @${person.username} from Close Friends` : `Add @${person.username} to Close Friends`}
              >
                <Text style={listed ? styles.buttonRemoveLabel : styles.buttonAddLabel}>{listed ? "Remove" : "Add"}</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          searching ? (
            results === null ? undefined : <EmptyState icon="search" title="No one found" message="Try a different name or username." />
          ) : (
            <EmptyState icon="starFilled" title="No Close Friends yet" message="Search for people to add. Stories you share with Close Friends go only to them." />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  intro: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  search: {
    margin: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  error: { color: colors.danger, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  names: { flex: 1 },
  displayName: { color: colors.textPrimary, fontWeight: "600" },
  username: { color: colors.textSecondary, fontSize: 13 },
  button: { minWidth: 84, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, alignItems: "center" },
  buttonAdd: { backgroundColor: colors.success },
  buttonRemove: { borderWidth: 1, borderColor: colors.border },
  buttonBusy: { opacity: 0.5 },
  buttonAddLabel: { color: colors.onAccent, fontWeight: "700" },
  buttonRemoveLabel: { color: colors.textPrimary, fontWeight: "600" },
});
