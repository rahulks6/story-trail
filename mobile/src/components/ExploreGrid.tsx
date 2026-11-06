import React, { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "./Pressable";
import { FadeInImage } from "./FadeInImage";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { mediaSource } from "../api/media";
import type { ExploreTile } from "../api/stories";
import { mediaColors, spacing, typography, colors, ICONS } from "../theme";
import { t } from "../i18n";

const COLUMNS = 3;
const GAP = 2;

/**
 * Explore: new people's Stories as a grid of tall tiles (the Search tab before you type), each with
 * the person's photo and name over the bottom. A tap opens their Stories; swiping on goes through
 * the rest of the grid, in order.
 */
export function ExploreGrid({ tiles, accessToken, onOpen }: { tiles: ExploreTile[]; accessToken: string | null; onOpen: (index: number) => void }): React.JSX.Element | null {
  // Three to a row across the space it's given (Search has side margins, so not the screen's width).
  // Search's side margins are the first guess; the grid's own measurement settles it.
  const screen = useWindowDimensions().width;
  const [measured, setWidth] = useState(0);
  const width = measured || screen - spacing.md * 2;
  if (!tiles.length) return null;
  const tileWidth = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);
  const tileHeight = Math.round((tileWidth * 4) / 3);
  return (
    <View>
      <Text style={[typography.label, styles.title]} accessibilityRole="header">{t("explore.title")}</Text>
      <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {tiles.map((tile, index) => {
          const url = tile.story.thumbnailUrl ?? tile.story.imageUrl;
          return (
            <Pressable
              key={tile.story.id}
              onPress={() => onOpen(index)}
              pressEffect="highlight"
              style={[styles.tile, { width: tileWidth, height: tileHeight }]}
              accessibilityRole="button"
              accessibilityLabel={tile.story.kind === "video" ? t("explore.openVideoStory", { name: tile.owner.displayName || tile.owner.username }) : t("explore.openStory", { name: tile.owner.displayName || tile.owner.username })}
            >
              {url ? <FadeInImage source={mediaSource(url, accessToken)} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
              {tile.story.kind === "video" ? <Icon name={ICONS.play} size={16} color="#FFFFFF" style={styles.videoBadge} /> : null}
              <View style={styles.owner}>
                <Avatar username={tile.owner.username} displayName={tile.owner.displayName} avatarMediaId={tile.owner.avatarMediaId} size={20} />
                <Text style={styles.name} numberOfLines={1}>{tile.owner.username}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.md, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, borderRadius: 10, overflow: "hidden" },
  tile: { backgroundColor: colors.surfaceElevated, overflow: "hidden" },
  videoBadge: { position: "absolute", top: 6, right: 6, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  owner: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 4, padding: 6, paddingTop: 14, backgroundColor: "rgba(0,0,0,0.3)" },
  name: { color: mediaColors.textPrimary, fontSize: 11, fontWeight: "700", flexShrink: 1 },
});
