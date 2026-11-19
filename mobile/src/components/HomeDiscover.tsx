import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { ExploreGrid } from "./ExploreGrid";
import { ProfilePhotoNudge } from "./ProfilePhotoNudge";
import { FirstStoryNudge } from "./FirstStoryNudge";
import { DailyThemeCard } from "./DailyThemeCard";
import { useAuth } from "../state/AuthContext";
import { getExplore, type ExploreTile } from "../api/stories";
import { followUser, getSuggestions, unfollowUser, type SuggestedPerson } from "../api/users";
import { discoverHighlights, type DiscoverHighlight } from "../api/highlights";
import { mediaFileUrl } from "../api/stories";
import { FadeInImage } from "./FadeInImage";
import { mediaColors as colors, spacing, mediaTypography as typography } from "../theme";
import { t } from "../i18n";

/**
 * What a new person sees on Home before they follow anyone with a Story: people to follow, one tap
 * each, and popular Stories to watch, so Home is never an empty screen. Following someone tells
 * Home to load again, so their Stories appear at once.
 */
export function HomeDiscover({ accessToken, onFollowed, onOpenStories, onOpenProfile, onOpenHighlight, onPost, header }: {
  accessToken: string | null;
  /** Above everything (Home's "Watch new Stories" after following people here). */
  header?: React.ReactNode;
  /** A public Highlight to watch (people's Stories kept for good, so there's always more to see). */
  onOpenHighlight?: (highlight: DiscoverHighlight) => void;
  /** To the camera, for someone who hasn't posted yet (FirstStoryNudge). */
  onPost?: () => void;
  onFollowed: () => void;
  onOpenStories: (tiles: ExploreTile[], index: number) => void;
  onOpenProfile: (username: string) => void;
}): React.JSX.Element | null {
  const [people, setPeople] = useState<SuggestedPerson[]>([]);
  const [tiles, setTiles] = useState<ExploreTile[]>([]);
  const [highlights, setHighlights] = useState<DiscoverHighlight[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    getSuggestions(accessToken, controller.signal).then(({ suggestions }) => setPeople(suggestions.slice(0, 12))).catch(() => undefined);
    getExplore(accessToken, controller.signal).then(({ explore }) => setTiles(explore.slice(0, 9))).catch(() => undefined);
    if (onOpenHighlight) discoverHighlights(accessToken, controller.signal).then(({ highlights: list }) => setHighlights(list)).catch(() => undefined);
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
  if (!people.length && !tiles.length && !highlights.length && user?.avatarMediaId && !onPost) return null;
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  return (
    <View style={styles.root}>
      {header}
      {onPost ? <FirstStoryNudge onPost={onPost} /> : null}
      {onPost ? <DailyThemeCard onPost={onPost} /> : null}
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
      {highlights.length && onOpenHighlight ? (
        <>
          <Text style={[styles.heading, styles.headingSpaced]} accessibilityRole="header">{t("homeDiscover.highlightsToExplore")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people} testID="discover-highlights">
            {highlights.map((h) => (
              <Pressable key={h.id} onPress={() => onOpenHighlight(h)} style={styles.highlight} accessibilityRole="button" accessibilityLabel={t("homeDiscover.watchTitleByName", { title: h.title, name: h.owner.displayName })}>
                <View style={styles.highlightCover}>
                  <FadeInImage source={{ uri: mediaFileUrl(h.coverMediaId, "thumbnail"), headers: authHeaders }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </View>
                <Text style={styles.highlightTitle} numberOfLines={1}>{h.title}</Text>
                <Text style={styles.username} numberOfLines={1}>@{h.owner.username}</Text>
              </Pressable>
            ))}
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
  headingSpaced: { marginTop: spacing.lg },
  highlight: { width: 112, gap: 4 },
  highlightCover: { width: 112, height: 168, borderRadius: 14, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.07)" },
  highlightTitle: { ...typography.body, fontWeight: "700", maxWidth: 112 },
});
