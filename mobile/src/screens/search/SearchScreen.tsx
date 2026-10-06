import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList, SearchStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import {
  followUser, getSuggestions, searchUsers, unfollowUser,
  type ListRelationship, type SearchResult, type SuggestedPerson, type SuggestionReason,
} from "../../api/users";
import { track } from "../../analytics/analytics";
import { ApiError } from "../../api/client";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { EmptyState } from "../../components/EmptyState";
import { Avatar } from "../../components/Avatar";

type Props = NativeStackScreenProps<SearchStackParamList, "SearchHome">;

type SearchFilter = "all" | "following";

/** Results per request; more load as the list scrolls. */
export const SEARCH_PAGE_SIZE = 20;

type Person = (SearchResult | SuggestedPerson) & { reason?: SuggestionReason };

/** The line under a suggestion: only what the person can already see. */
export function suggestionReasonText(reason: SuggestionReason): string {
  switch (reason.kind) {
    case "follows_you":
      return "Follows you";
    case "followed_by":
      return reason.others > 0 ? `Followed by @${reason.username} + ${reason.others} more` : `Followed by @${reason.username}`;
    case "shared_interest":
      return `Also into ${reason.interest}`;
    case "new":
      return "New to Katkee";
  }
}

function followLabel(relation: ListRelationship | undefined): string {
  if (relation?.isFollowing) return "Following";
  if (relation?.hasPendingRequestFromViewer) return "Requested";
  return relation?.isFollowedBy ? "Follow back" : "Follow";
}

/**
 * People-only search (spec sections 10 and 30): suggestions before typing, then results by
 * username, name or interest as people type. Every row can be followed in place. A newer query
 * cancels the request for an older one, and more results load as the list scrolls.
 */
export function SearchScreen({ navigation }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const countedQuery = useRef<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [suggestions, setSuggestions] = useState<SuggestedPerson[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Follow state changed here, by username, over what the server sent with the list.
  const [relations, setRelations] = useState<Record<string, ListRelationship>>({});
  const [pendingFollows, setPendingFollows] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const search = useRef<AbortController | null>(null);

  const loadSuggestions = useCallback(async (signal?: AbortSignal) => {
    if (!accessToken) return;
    try {
      const { suggestions: found } = await getSuggestions(accessToken, signal);
      if (!signal?.aborted) {
        setSuggestions(found);
        setRelations({});
      }
    } catch {
      if (!signal?.aborted) setSuggestions((current) => current ?? []);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSuggestions(controller.signal);
    return () => controller.abort();
  }, [loadSuggestions]);

  // Re-selecting the Search tab puts the cursor back in the box.
  useEffect(
    () => navigation.getParent<BottomTabNavigationProp<MainTabParamList>>()?.addListener("tabPress", () => input.current?.focus()),
    [navigation],
  );

  useEffect(() => {
    search.current?.abort();
    if (!debouncedQuery || !accessToken) {
      setResults([]);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    search.current = controller;
    setLoading(true);
    setError(null);
    // Admin analytics: one search per settled query (never the words searched for).
    if (countedQuery.current !== debouncedQuery) {
      countedQuery.current = debouncedQuery;
      track("search_performed");
    }
    searchUsers(debouncedQuery, accessToken, { following: filter === "following", limit: SEARCH_PAGE_SIZE, signal: controller.signal })
      .then(({ results: found }) => {
        if (controller.signal.aborted) return;
        setResults(found);
        setHasMore(found.length === SEARCH_PAGE_SIZE);
        setRelations({});
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResults([]);
        setHasMore(false);
        setError(err instanceof ApiError ? err.message : "Search failed — check your connection.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, accessToken, filter]);

  const loadMore = () => {
    const controller = search.current;
    if (!hasMore || loading || loadingMore || !accessToken || !debouncedQuery || !controller || controller.signal.aborted) return;
    setLoadingMore(true);
    searchUsers(debouncedQuery, accessToken, {
      following: filter === "following", limit: SEARCH_PAGE_SIZE, offset: results.length, signal: controller.signal,
    })
      .then(({ results: more }) => {
        if (controller.signal.aborted) return;
        setResults((current) => [...current, ...more.filter((p) => !current.some((c) => c.id === p.id))]);
        setHasMore(more.length === SEARCH_PAGE_SIZE);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHasMore(false);
        setError("Couldn't load more people. Search again to retry.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false);
      });
  };

  const relationOf = (person: Person): ListRelationship | undefined => relations[person.username] ?? person.viewer;

  const onFollowPress = async (person: Person) => {
    if (!accessToken || pendingFollows.has(person.username)) return;
    const current = relationOf(person);
    setPendingFollows((names) => new Set(names).add(person.username));
    setActionError(null);
    try {
      const base = { isFollowing: false, isFollowedBy: current?.isFollowedBy ?? false, hasPendingRequestFromViewer: false };
      if (current?.isFollowing || current?.hasPendingRequestFromViewer) {
        await unfollowUser(person.username, accessToken);
        setRelations((all) => ({ ...all, [person.username]: base }));
      } else {
        const { status } = await followUser(person.username, accessToken);
        setRelations((all) => ({
          ...all,
          [person.username]: { ...base, isFollowing: status === "following", hasPendingRequestFromViewer: status === "requested" },
        }));
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't go through — try again.");
    } finally {
      setPendingFollows((names) => {
        const next = new Set(names);
        next.delete(person.username);
        return next;
      });
    }
  };

  const renderPerson = ({ item }: { item: Person }) => {
    const relation = relationOf(item);
    const label = followLabel(relation);
    const active = !!relation?.isFollowing || !!relation?.hasPendingRequestFromViewer;
    const subtitle = item.reason ? suggestionReasonText(item.reason) : `@${item.username}`;
    return (
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.displayName}, @${item.username}`}
          style={styles.rowMain}
          onPress={() => navigation.navigate("UserProfile", { username: item.username })}
        >
          <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId ?? null} />
          <View style={styles.rowText}>
            <Text style={typography.bodyStrong} numberOfLines={1}>{item.displayName}</Text>
            <Text style={typography.caption} numberOfLines={1}>{subtitle}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} @${item.username}`}
          accessibilityState={{ busy: pendingFollows.has(item.username) }}
          disabled={pendingFollows.has(item.username)}
          hitSlop={4}
          style={[styles.followButton, active ? styles.followButtonQuiet : styles.followButtonStrong]}
          onPress={() => void onFollowPress(item)}
        >
          <Text style={[styles.followLabel, active ? styles.followLabelQuiet : styles.followLabelStrong]}>{label}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.inputWrapper}>
        <Icon style={styles.inputIcon} name={ICONS.search} />
        <TextInput
          ref={input}
          style={styles.input}
          placeholder="Search people"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Search people"
          value={query}
          onChangeText={setQuery}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon style={styles.inputIcon} name={ICONS.clear} />
          </Pressable>
        ) : null}
      </View>

      {debouncedQuery ? (
        <View style={styles.filterRow}>
          {(["all", "following"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === option }}
              style={[styles.filterChip, filter === option && styles.filterChipActive]}
              onPress={() => setFilter(option)}
            >
              <Text style={[styles.filterChipLabel, filter === option && styles.filterChipLabelActive]}>
                {option === "all" ? "All" : "Following"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {actionError ? <Text style={styles.error} accessibilityRole="alert">{actionError}</Text> : null}

      {!debouncedQuery ? (
        suggestions === null ? (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        ) : suggestions.length === 0 ? (
          <EmptyState title="Find people" message="Search by name, username or interest." />
        ) : (
          <FlatList
            data={suggestions as Person[]}
            keyExtractor={(item) => item.id}
            renderItem={renderPerson}
            ListHeaderComponent={<Text style={[typography.label, styles.sectionTitle]} accessibilityRole="header">Suggested for you</Text>}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadSuggestions();
              setRefreshing(false);
            }}
          />
        )
      ) : (
        <>
          {loading ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!loading && !error && results.length === 0 ? (
            <EmptyState
              title="No one found"
              message={filter === "following" ? `No one you follow matches "${debouncedQuery}".` : `No people match "${debouncedQuery}".`}
            />
          ) : (
            <FlatList
              data={results as Person[]}
              keyExtractor={(item) => item.id}
              renderItem={renderPerson}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : undefined}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  inputIcon: { color: colors.textDisabled, fontSize: 16 },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
  },
  filterRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.sm },
  filterChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 64,
    alignItems: "center",
  },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterChipLabel: { ...typography.caption, fontWeight: "600", color: colors.textSecondary },
  filterChipLabelActive: { color: colors.onAccent },
  sectionTitle: { marginTop: spacing.xs, marginBottom: spacing.xs },
  spinner: { marginTop: spacing.md },
  error: { color: colors.danger, marginTop: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  rowText: { flex: 1, gap: 2 },
  followButton: {
    minHeight: 36,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  followButtonStrong: { backgroundColor: colors.accent },
  followButtonQuiet: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  followLabel: { fontSize: 14, fontWeight: "700" },
  followLabelStrong: { color: colors.onAccent },
  followLabelQuiet: { color: colors.textPrimary },
});
