import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DMStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getFollowers, getFollowing, searchUsers } from "../../api/users";
import { addGroupMembers, createGroup, groupName, MAX_GROUP_MEMBERS, MAX_GROUP_TITLE, type PersonSummary } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { useHeaderHeight } from "@react-navigation/elements";
import { tapFeedback } from "../../utils/haptics";

type Props = NativeStackScreenProps<DMStackParamList, "NewGroup">;

/**
 * Choose people for a group chat: people you follow and who follow you come first, or search.
 * A new group needs at least two others and can be named (optional). With a `conversationId`
 * it adds people to that group instead. The server checks who may be added (a follow either way).
 */
export function NewGroupScreen({ navigation, route }: Props): React.JSX.Element {
  const adding = route.params?.conversationId;
  const { accessToken, user } = useAuth();
  const { bottom } = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const [suggested, setSuggested] = useState<PersonSummary[]>([]);
  const [results, setResults] = useState<PersonSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<PersonSummary[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: adding ? "Add people" : "New group" });
  }, [adding, navigation]);

  // People you're connected to, the ones a group can have.
  useEffect(() => {
    if (!accessToken || !user?.username) return;
    let cancelled = false;
    Promise.all([getFollowing(user.username, accessToken, { limit: 50 }), getFollowers(user.username, accessToken, { limit: 50 })])
      .then(([a, b]) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const people: PersonSummary[] = [];
        for (const p of [...a.following, ...b.followers]) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          people.push({ id: p.id, username: p.username, displayName: p.displayName, avatarMediaId: p.avatarMediaId ?? null });
        }
        setSuggested(people);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [accessToken, user?.username]);

  useEffect(() => {
    if (!search || !accessToken) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchUsers(search, accessToken)
      .then(({ results: found }) => { if (!cancelled) setResults(found.filter((p) => p.id !== user?.id).map((p) => ({ id: p.id, username: p.username, displayName: p.displayName, avatarMediaId: p.avatarMediaId ?? null }))); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, search, user?.id]);

  const chosenIds = useMemo(() => new Set(chosen.map((p) => p.id)), [chosen]);
  const limit = MAX_GROUP_MEMBERS - 1;
  const toggle = (person: PersonSummary) => {
    tapFeedback("select");
    setError(null);
    setChosen((current) => (current.some((p) => p.id === person.id) ? current.filter((p) => p.id !== person.id) : current.length >= limit ? current : [...current, person]));
  };

  const enough = adding ? chosen.length >= 1 : chosen.length >= 2;
  const done = async () => {
    if (!accessToken || !enough || saving) return;
    setSaving(true);
    setError(null);
    try {
      const usernames = chosen.map((p) => p.username);
      if (adding) {
        await addGroupMembers(adding, usernames, accessToken);
        navigation.goBack();
      } else {
        const { conversation } = await createGroup(usernames, title.trim() || null, accessToken);
        tapFeedback("success");
        const others = conversation.members.filter((m) => m.userId !== user?.id);
        navigation.replace("Conversation", { conversationId: conversation.id, group: true, title: groupName(conversation.title, others, others.length) });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't do that. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const list = results ?? suggested;
  return (
    // The Create button stays above the keyboard while you search or type the name.
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      {adding ? null : (
        <TextInput
          style={styles.title}
          placeholder="Group name (optional)"
          placeholderTextColor={colors.textDisabled}
          value={title}
          onChangeText={setTitle}
          maxLength={MAX_GROUP_TITLE}
          accessibilityLabel="Group name, optional"
        />
      )}
      <View style={styles.searchBox}>
        <Icon style={styles.searchIcon} name={ICONS.search} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search people"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search people"
        />
      </View>
      {chosen.length ? (
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {chosen.length} chosen{chosen.length >= limit ? ` (a group can have up to ${MAX_GROUP_MEMBERS} people)` : ""}
        </Text>
      ) : (
        <Text style={styles.count}>{adding ? "Choose people to add." : "Choose at least two people. You can add people you follow or who follow you."}</Text>
      )}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {loading ? <ActivityIndicator color={colors.accentText} style={styles.spinner} /> : null}
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={search && !loading ? <Text style={styles.empty}>No people match “{search}”.</Text> : undefined}
        renderItem={({ item }) => {
          const on = chosenIds.has(item.id);
          return (
            <Pressable
              style={styles.row}
              onPress={() => toggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${item.displayName}${item.verified ? ", verified" : ""}, @${item.username}`}
            >
              <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId ?? null} />
              <View style={styles.rowText}>
                <VerifiedName name={item.displayName} verified={item.verified} style={typography.bodyStrong} />
                <Text style={typography.caption} numberOfLines={1}>@{item.username}</Text>
              </View>
              <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name={ICONS.check} size={16} color={colors.onAccent} /> : null}</View>
            </Pressable>
          );
        }}
      />
      <View style={[styles.footer, { paddingBottom: spacing.sm + bottom }]}>
        <Button label={adding ? "Add" : "Create group"} onPress={() => void done()} disabled={!enough} busy={saving} />
      </View>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  title: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 16, marginBottom: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, gap: spacing.xs },
  searchIcon: { color: colors.textDisabled, fontSize: 16 },
  searchInput: { flex: 1, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 15 },
  count: { ...typography.caption, color: colors.textSecondary, marginVertical: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
  spinner: { marginVertical: spacing.sm },
  empty: { ...typography.caption, color: colors.textSecondary, textAlign: "center", padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 2 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  footer: { paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
