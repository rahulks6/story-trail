import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { ApiError } from "../api/client";
import { answerQuestion } from "../api/stickers";
import { MAX_ANSWER_LENGTH } from "../models/storyDraft";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

interface Props {
  visible: boolean;
  storyId: string;
  /** The question sticker being answered; null while the sheet is closed. */
  sticker: { id: string; prompt: string } | null;
  ownerUsername: string;
  onClose: () => void;
  onSent: () => void;
}

/**
 * Answering a question sticker ("Ask me anything"). The answer goes to the Story's owner
 * alone, in their Insights — other viewers never see it — so the sheet says so.
 */
export function QuestionAnswerSheet({ visible, storyId, sticker, ownerUsername, onClose, onSent }: Props): React.JSX.Element {
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setError(null);
  }, [visible]);

  const send = async () => {
    const body = text.trim();
    if (!accessToken || !sticker || busy || !body) return;
    setBusy(true);
    setError(null);
    try {
      await answerQuestion(storyId, sticker.id, body, accessToken);
      setText("");
      tapFeedback("success");
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("questionAnswerSheet.couldntSendCheckYourConnection"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <KeyboardAvoider style={[styles.sheet, { paddingBottom: spacing.lg + bottomInset }]} behavior="padding">
        <View style={styles.handle} />
        <Text style={[typography.bodyStrong, styles.prompt]}>{sticker?.prompt ?? ""}</Text>
        <Text style={[typography.caption, styles.privacy]}>{t("questionAnswerSheet.onlyOwnerusernameSeesYourAnswer", { ownerUsername })}</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t("questionAnswerSheet.typeYourAnswer")}
          placeholderTextColor={colors.textDisabled}
          maxLength={MAX_ANSWER_LENGTH}
          multiline
          autoFocus
          accessibilityLabel={t("questionAnswerSheet.answerPrompt", { prompt: sticker?.prompt ?? "" })}
        />
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Pressable
          onPress={() => void send()}
          disabled={busy || text.trim().length === 0}
          style={[styles.send, (busy || text.trim().length === 0) && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || text.trim().length === 0, busy }}
        >
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.sendLabel}>{t("common.send")}</Text>}
        </Pressable>
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md, gap: spacing.sm },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  prompt: { textAlign: "center" },
  privacy: { textAlign: "center" },
  input: { color: colors.textPrimary, backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 80, textAlignVertical: "top" },
  error: { color: colors.danger, textAlign: "center" },
  send: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 44, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
  sendLabel: { color: colors.onAccent, fontWeight: "700" },
});
