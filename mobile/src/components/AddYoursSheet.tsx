import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";
import { FadeInImage } from "./FadeInImage";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { getAddYoursChain, type ChainStory } from "../api/stickers";
import { mediaFileUrl } from "../api/stories";
import { timeAgo } from "../utils/serverTime";
import { t } from "../i18n";

interface Props {
  visible: boolean;
  chainId: string | null;
  onClose: () => void;
  /** Open one of the chain's Stories. */
  onOpenStory: (username: string, storyId: string) => void;
  /** "Add yours" from here too: the camera, with this prompt on the new Story. */
  onAddYours: (chain: { id: string; prompt: string }) => void;
  /** The viewer's own Story is in the chain: no button to add another. */
  canAdd: boolean;
}

/**
 * An "Add Yours" chain: its prompt, how many have joined, and the Stories in it this person
 * may see (the server leaves out anyone blocked, private accounts they don't follow, and
 * audiences they aren't in). Tapping one opens it; the button starts your own.
 */
export function AddYoursSheet({ visible, chainId, onClose, onOpenStory, onAddYours, canAdd }: Props): React.JSX.Element {
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [chain, setChain] = useState<{ id: string; prompt: string; participants: number } | null>(null);
  const [stories, setStories] = useState<ChainStory[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !chainId || !accessToken) return;
    let cancelled = false;
    setChain(null);
    setError(null);
    getAddYoursChain(chainId, accessToken)
      .then((r) => { if (!cancelled) { setChain(r.chain); setStories(r.stories); } })
      .catch(() => { if (!cancelled) setError(t("addYoursSheet.thisAddYoursIsntAvailable")); });
    return () => { cancelled = true; };
  }, [visible, chainId, accessToken]);

  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <View style={[styles.sheet, { paddingBottom: spacing.lg + bottomInset }]}>
        <View style={styles.handle} />
        {error ? (
          <Text style={[typography.caption, styles.center]}>{error}</Text>
        ) : !chain ? (
          <ActivityIndicator color={colors.accentText} style={styles.spinner} />
        ) : (
          <>
            <View style={styles.badge}>
              <Icon name={ICONS.add} size={12} color={colors.onAccent} />
              <Text style={styles.badgeText}>{t("common.addYours2")}</Text>
            </View>
            <Text style={[typography.title, styles.center]}>{chain.prompt}</Text>
            <Text style={[typography.caption, styles.center]}>{chain.participants === 1 ? t("common.n1Participant") : t("addYoursSheet.participantsParticipants", { participants: chain.participants })}</Text>
            <FlatList
              data={stories}
              keyExtractor={(s) => s.storyId}
              numColumns={3}
              style={styles.grid}
              columnWrapperStyle={styles.gridRow}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.cell}
                  onPress={() => onOpenStory(item.owner.username, item.storyId)}
                  accessibilityRole="button"
                  accessibilityLabel={`@${item.owner.username}'s Story, ${timeAgo(item.createdAt)}`}
                >
                  <FadeInImage source={{ uri: mediaFileUrl(item.mediaId, "thumbnail"), headers }} style={styles.thumb} accessibilityIgnoresInvertColors />
                  <View style={styles.cellOwner}>
                    <Avatar username={item.owner.username} avatarMediaId={item.owner.avatarMediaId} size={18} />
                    <Text style={styles.cellName} numberOfLines={1}>{item.owner.username}</Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={<Text style={[typography.caption, styles.center]}>{t("addYoursSheet.noStoriesToShowRight")}</Text>}
            />
            {canAdd ? (
              <Pressable onPress={() => onAddYours({ id: chain.id, prompt: chain.prompt })} style={styles.addButton} accessibilityRole="button" accessibilityHint={t("addYoursSheet.opensTheCameraWithThis")}>
                <Icon name={ICONS.camera} size={18} color={colors.onAccent} />
                <Text style={styles.addLabel}>{t("common.addYours")}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md, maxHeight: "80%", gap: spacing.xs },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  center: { textAlign: "center" },
  spinner: { marginVertical: spacing.lg },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "center", backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { color: colors.onAccent, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  grid: { marginTop: spacing.sm, maxHeight: 420 },
  gridRow: { gap: spacing.xs, marginBottom: spacing.xs },
  cell: { flex: 1 / 3, aspectRatio: 9 / 16, borderRadius: radii.sm, overflow: "hidden", backgroundColor: colors.surfaceElevated },
  thumb: { ...StyleSheet.absoluteFill },
  cellOwner: { position: "absolute", left: 4, right: 4, bottom: 4, flexDirection: "row", alignItems: "center", gap: 4 },
  cellName: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", flexShrink: 1, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  addButton: { flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderRadius: radii.pill, minHeight: 46, marginTop: spacing.sm },
  addLabel: { color: colors.onAccent, fontWeight: "800", fontSize: 15 },
});
