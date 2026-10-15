import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { Icon } from "./Icon";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { useAuth } from "../state/AuthContext";
import { ApiError } from "../api/client";
import { STORY_REACTIONS, replyToStory, type StoryReplyKind } from "../api/conversations";
import { tapFeedback } from "../utils/haptics";

interface Props {
  visible: boolean;
  storyId: string;
  ownerUsername: string;
  onClose: () => void;
  /** Called after the owner's DMs received the reply or reaction. */
  onSent: (kind: StoryReplyKind) => void;
}

const newClientId = () => `reply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

/**
 * Reply to a Story (like Instagram): one tap sends a quick reaction, or write a message. Either
 * lands in the owner's DMs with the Story attached (POST /api/v1/stories/:id/replies).
 */
export function ReplySheet({ visible, storyId, ownerUsername, onClose, onSent }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per message, kept across retries of that message so a lost response never duplicates it.
  const pending = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    if (!visible) {
      setError(null);
      pending.current = null;
    }
  }, [visible]);

  const send = async (input: { body: string } | { reaction: string }, kind: StoryReplyKind) => {
    if (!accessToken || busy) return;
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, id: newClientId() };
    setBusy(true);
    setError(null);
    try {
      await replyToStory(storyId, input, accessToken, pending.current.id);
      pending.current = null;
      if (kind === "reply") setText("");
      tapFeedback("success");
      onSent(kind);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const trimmed = text.trim();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <KeyboardAvoider style={[styles.sheet, { paddingBottom: spacing.xl + bottomInset }]}>
        <View style={styles.handle} />
        <Text style={[typography.body, styles.title]}>Reply to @{ownerUsername}</Text>
        <View style={styles.reactions}>
          {STORY_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              disabled={busy}
              onPress={() => void send({ reaction: emoji }, "reaction")}
              style={({ pressed }) => [styles.reaction, pressed && styles.reactionPressed]}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
            >
              <Text style={styles.reactionGlyph}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={`Send a message to @${ownerUsername}`}
            placeholderTextColor={colors.textSecondary}
            maxLength={2000}
            multiline
            accessibilityLabel="Reply"
          />
          <Pressable
            onPress={() => void send({ body: trimmed }, "reply")}
            disabled={busy || !trimmed}
            style={[styles.sendButton, (!trimmed || busy) && styles.sendDisabled]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            accessibilityState={{ disabled: busy || !trimmed }}
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Icon name={ICONS.send} size={20} color={colors.onAccent} />}
          </Pressable>
        </View>
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { fontWeight: "700", marginBottom: spacing.sm },
  reactions: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md },
  reaction: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  reactionPressed: { backgroundColor: "rgba(255,255,255,0.12)", transform: [{ scale: 1.15 }] },
  reactionGlyph: { fontSize: 28 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    color: colors.textPrimary,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.4 },
  error: { color: colors.danger, marginTop: spacing.sm },
});
