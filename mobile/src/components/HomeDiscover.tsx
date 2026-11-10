import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { ExploreGrid } from "./ExploreGrid";
import { ProfilePhotoNudge } from "./ProfilePhotoNudge";
import { useAuth } from "../state/AuthContext";
import { getExplore, type ExploreTile } from "../api/stories";
import { followUser, getSuggestions, unfollowUser, type SuggestedPerson } from "../api/users";
import { mediaColors as colors, spacing, mediaTypography as typography } from "../theme";
import { t } from "../i18n";

/**
 * What a new person sees on Home before they follow anyone with a Story: people to follow, one tap
 * each, and popular Stories to watch, so Home is never an empty screen. Following someone tells
 * Home to load again, so their Stories appear at once.
 */
export function HomeDiscover({ accessToken, onFollowed, onOpenStories, onOpenProfile }: {
  accessToken: string | null;
  onFollowed: () => void;
  onOpenStories: (tiles: ExploreTile[], index: number) => void;
  onOpenProfile: (username: string) => void;
}): React.JSX.Element | null {
  const [people, setPeople] = useState<SuggestedPerson[]>([]);
  const [tiles, setTiles] = useState<ExploreTile[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    getSuggestions(accessToken, controller.signal).then(({ suggestions }) => setPeople(suggestions.slice(0, 12))).catch(() => undefined);
    getExplore(accessToken, controller.signal).then(({ explore }) => setTiles(explore.slice(0, 9))).catch(() => undefined);
    return () => controller.abort();
  }, [accessToken]);

  const toggle = useCallback(async (person: SuggestedPerson) => {
    if (!accessToken || busy.has(person.username)) return;
    const following = person.viewer.isFollowing || person.viewer.hasPendingRequestFromViewer;
    setBusy((b) => new Set(b).add(person.username));
    try {
      if (following) await unfollowUser(person.username, accessToken);
      else await followUser(person.username, accessToken);
      setPeople((list) => list.map((p) => p.username === person.username
        ? { ...p, viewer: { ...p.viewer, isFollowing: !following && !p.isPrivate, hasPendingRequestFromViewer: !following && p.isPrivate } }
        : p));
      if (!following) onFollowed();
    } catch {
      // The button stays as it was; a second tap tries again.
    } finally {
      setBusy((b) => { const next = new Set(b); next.delete(person.username); return next; });
    }
  }, [accessToken, busy, onFollowed]);

  const { user } = useAuth();
  if (!people.length && !tiles.length && user?.avatarMediaId) return null;
  return (
    <View style={styles.root}>
      <ProfilePhotoNudge />
      {people.length ? (
        <>
          <Text style={styles.heading} accessibilityRole="header">{t("homeDiscover.peopleToFollow")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
            {people.map((person) => {
              const following = person.viewer.isFollowing || person.viewer.hasPendingRequestFromViewer;
              const label = person.viewer.hasPendingRequestFromViewer ? t("homeDiscover.requested") : following ? t("homeDiscover.following") : t("homeDiscover.follow");
              return (
                <View key={person.id} style={styles.card}>
                  <Pressable onPress={() => onOpenProfile(person.username)} style={styles.cardTop} accessibilityRole="button" accessibilityLabel={`${person.displayName}, @${person.username}`}>
                    <Avatar username={person.username} displayName={person.displayName} avatarMediaId={person.avatarMediaId} size={64} />
                    <Text style={styles.name} numberOfLines={1}>{person.displayName}</Text>
                    <Text style={styles.username} numberOfLines={1}>@{person.username}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void toggle(person)}
                    disabled={busy.has(person.username)}
                    style={[styles.follow, following ? styles.followQuiet : null]}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} @${person.username}`}
                    accessibilityState={{ busy: busy.has(person.username) }}
                  >
                    <Text style={[styles.followLabel, following ? styles.followLabelQuiet : null]}>{label}</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : null}
      {tiles.length ? (
        <View style={styles.grid}>
          <ExploreGrid tiles={tiles} accessToken={accessToken} title={t("homeDiscover.popularStories")} titleColor={colors.textPrimary} onOpen={(index) => onOpenStories(tiles, index)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: spacing.md, paddingBottom: spacing.lg },
  heading: { ...typography.body, fontWeight: "800", paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  people: { gap: spacing.sm, paddingHorizontal: spacing.md },
  card: { width: 132, alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.07)" },
  cardTop: { alignItems: "center", gap: 2 },
  name: { ...typography.body, fontWeight: "700", marginTop: spacing.xs, maxWidth: 110 },
  username: { ...typography.caption, color: colors.textSecondary, maxWidth: 110 },
  follow: { alignSelf: "stretch", alignItems: "center", paddingVertical: 7, borderRadius: 10, backgroundColor: colors.accent },
  followQuiet: { backgroundColor: "rgba(255,255,255,0.12)" },
  followLabel: { fontSize: 14, fontWeight: "800", color: colors.onAccent },
  followLabelQuiet: { color: colors.textPrimary },
  grid: { paddingHorizontal: spacing.md, marginTop: spacing.md },
});
