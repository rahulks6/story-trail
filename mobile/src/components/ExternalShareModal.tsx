import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { colors, radii, spacing } from "../theme";
import { ShareCancelled, ShareFailed, sharePhotoStory, shareVideoStory } from "../utils/shareStoryExternally";
import { StoryShareCard, type ShareCardHandle, type ShareCardStory } from "./StoryShareCard";

interface Props {
  visible: boolean;
  storyId: string;
  story: ShareCardStory;
  username: string;
  message: string;
  accessToken: string | null;
  /** Called once the share sheet was used (true) or closed without sharing (false). */
  onShared?: (sent: boolean) => void;
  onClose: () => void;
}

const PHOTO_LOAD_TIMEOUT_MS = 15_000;

/**
 * "Share to other apps" for your own Story: draws the share card (StoryShareCard) behind a small
 * progress panel, then hands the picture or video to the system share sheet. A video can take a
 * little while on the server, so the panel says so and offers Cancel; a failure says what
 * happened, calmly, with Try again.
 */
export function ExternalShareModal({ visible, storyId, story, username, message, accessToken, onShared, onClose }: Props): React.JSX.Element {
  const card = useRef<ShareCardHandle>(null);
  const [attempt, setAttempt] = useState(0);
  /** Bumped to load the photo again after it failed to load. */
  const [imageKey, setImageKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [imageState, setImageState] = useState<"loading" | "ready" | "failed">("loading");
  const controller = useRef<AbortController | null>(null);
  const isPhoto = story.kind === "photo";

  const close = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (isPhoto && imageState === "loading") return; // drawn once the photo has loaded
    if (isPhoto && imageState === "failed") {
      setError("Couldn't load this photo. Try again.");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    let live = true;
    // One frame for the card's text and stickers to lay out before it's captured.
    const timer = setTimeout(() => {
      const work = isPhoto
        ? sharePhotoStory(card, { storyId, message, signal: abort.signal })
        : shareVideoStory(card, { storyId, message, signal: abort.signal, accessToken: accessToken ?? "" });
      work.then(
        (sent) => {
          if (!live || abort.signal.aborted) return;
          onShared?.(sent);
          onClose();
        },
        (e: unknown) => {
          if (!live || e instanceof ShareCancelled || abort.signal.aborted) return;
          setError(e instanceof ShareFailed ? e.message : "We couldn't prepare your Story. Try again.");
        },
      );
    }, 50);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, attempt, imageState]);

  useEffect(() => {
    if (!visible) return;
    setImageState("loading");
  }, [visible, imageKey]);

  useEffect(() => {
    if (!visible || !isPhoto || imageState !== "loading") return;
    const timer = setTimeout(() => setImageState((s) => (s === "loading" ? "failed" : s)), PHOTO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [visible, isPhoto, imageState]);

  useEffect(() => () => controller.current?.abort(), []);

  const retry = () => {
    setError(null);
    if (isPhoto && imageState === "failed") setImageKey((n) => n + 1);
    else setAttempt((n) => n + 1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.fill}>
        {/* Drawn for the capture only: the panel and backdrop cover it. */}
        <View style={styles.cardHolder} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <StoryShareCard
            key={imageKey}
            ref={card}
            story={story}
            username={username}
            mode={isPhoto ? "photo" : "overlay"}
            onImageLoad={() => setImageState("ready")}
            onImageError={() => setImageState("failed")}
          />
        </View>
        <View style={styles.backdrop} />
        <View style={styles.panel} accessibilityViewIsModal accessibilityLiveRegion="polite">
          {error ? (
            <>
              <Text style={styles.title}>Couldn't share your Story</Text>
              <Text style={styles.message}>{error}</Text>
              <View style={styles.buttons}>
                <Pressable style={styles.secondary} onPress={close} accessibilityRole="button">
                  <Text style={styles.secondaryLabel}>Close</Text>
                </Pressable>
                <Pressable style={styles.primary} onPress={retry} accessibilityRole="button">
                  <Text style={styles.primaryLabel}>Try again</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.accentText} />
              <Text style={styles.title}>{isPhoto ? "Preparing photo…" : "Preparing video…"}</Text>
              {!isPhoto ? <Text style={styles.message}>This can take up to a minute.</Text> : null}
              <Pressable style={styles.secondary} onPress={close} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  cardHolder: { position: "absolute", top: 0, left: 0 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
  panel: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
  },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: "600", textAlign: "center" },
  message: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  primary: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, justifyContent: "center", backgroundColor: colors.accent },
  primaryLabel: { color: colors.onAccent, fontSize: 15, fontWeight: "600" },
  secondary: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radii.pill, justifyContent: "center", backgroundColor: colors.border },
  secondaryLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
});
