import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useDM } from "../../state/DMContext";
import { MAX_MESSAGE_LENGTH, newClientMessageId, openConversation, sendMessage } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { showToast } from "../../components/Toast";
import { tapFeedback } from "../../utils/haptics";
import { RecipientPicker, type Recipient } from "./RecipientPicker";

type Props = NativeStackScreenProps<RootStackParamList, "SendStory">;

/**
 * Send a Story to people on Katkee, over the Story (closing it returns to the same Story).
 * Recent chats and groups are listed first; search finds anyone else. Choose several, add a
 * message if you like, and Send. The server applies the Story's privacy and sharing rules.
 */
export function SendStoryScreen({ route, navigation }: Props): React.JSX.Element {
  const { storyId } = route.params;
  const { accessToken } = useAuth();
  const { refreshUnreadCount } = useDM();
  const { bottom } = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [chosen, setChosen] = useState<Map<string, Recipient>>(new Map());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per recipient until it goes through: a retry after a lost response can't send twice.
  const messageIds = useRef(new Map<string, string>());

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name={ICONS.close} size={22} color={colors.textPrimary} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const toggle = (target: Recipient) => {
    tapFeedback("select");
    setError(null);
    setChosen((current) => {
      const next = new Map(current);
      if (next.has(target.key)) next.delete(target.key);
      else next.set(target.key, target);
      return next;
    });
  };

  const send = async () => {
    if (!accessToken || !chosen.size || sending) return;
    setSending(true);
    setError(null);
    const text = note.trim();
    const failed = new Map<string, Recipient>();
    let lastError: string | null = null;
    for (const target of chosen.values()) {
      try {
        const conversationId = target.conversationId ?? (await openConversation(target.username!, accessToken)).conversation.id;
        const clientMessageId = messageIds.current.get(target.key) ?? newClientMessageId();
        messageIds.current.set(target.key, clientMessageId);
        await sendMessage(conversationId, { storyId, clientMessageId }, accessToken);
        messageIds.current.delete(target.key);
        if (text) await sendMessage(conversationId, { body: text, clientMessageId: newClientMessageId() }, accessToken);
      } catch (e) {
        failed.set(target.key, target);
        lastError = e instanceof ApiError ? e.message : "Check your connection and try again.";
      }
    }
    setSending(false);
    void refreshUnreadCount();
    if (!failed.size) {
      tapFeedback("success");
      showToast(chosen.size === 1 ? "Sent" : `Sent to ${chosen.size}`);
      navigation.goBack();
      return;
    }
    // What went is done; what didn't stays chosen for another try.
    setChosen(failed);
    setError(`Couldn't send to ${[...failed.values()].map((t) => t.name).join(", ")}. ${lastError ?? ""}`.trim());
  };

  const chosenNames = useMemo(() => [...chosen.values()].map((t) => t.name.split(" ")[0]).join(", "), [chosen]);
  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <RecipientPicker chosen={chosen} onToggle={toggle} emptyHint="Search for someone to send this Story to." />
      {chosen.size ? (
        <View style={[styles.footer, { paddingBottom: spacing.sm + bottom }]}>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <TextInput
            style={styles.note}
            placeholder="Add a message…"
            placeholderTextColor={colors.textDisabled}
            value={note}
            onChangeText={setNote}
            maxLength={MAX_MESSAGE_LENGTH}
            accessibilityLabel="Add a message, optional"
          />
          <Button label={chosen.size === 1 ? `Send to ${chosenNames}` : `Send to ${chosen.size}`} onPress={() => void send()} busy={sending} />
        </View>
      ) : null}
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  footer: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  note: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 15 },
  error: { color: colors.danger, fontSize: 13 },
});
