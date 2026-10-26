import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../../navigation/types";
import { colors, spacing, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useDM } from "../../state/DMContext";
import { forwardMessage, MAX_FORWARD_RECIPIENTS, type ForwardResult } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { showToast } from "../../components/Toast";
import { tapFeedback } from "../../utils/haptics";
import { RecipientPicker, type Recipient } from "./RecipientPicker";

type Props = NativeStackScreenProps<RootStackParamList, "ForwardMessage">;

/** How a recipient is named when a forward didn't reach them: @username, or the group's name. */
const nameFor = (r: Recipient) => (r.username ? `@${r.username}` : r.name);

/**
 * Forward a message (long-press it, then Forward): choose up to ten people and chats, then Send.
 * One request; the server applies the normal sending rules to each and says how each went.
 */
export function ForwardScreen({ route, navigation }: Props): React.JSX.Element {
  const { conversationId, messageId } = route.params;
  const { accessToken } = useAuth();
  const { refreshUnreadCount } = useDM();
  const { bottom } = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [chosen, setChosen] = useState<Map<string, Recipient>>(new Map());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!chosen.has(target.key) && chosen.size >= MAX_FORWARD_RECIPIENTS) {
      setError(`You can forward to up to ${MAX_FORWARD_RECIPIENTS} chats at a time.`);
      return;
    }
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
    const recipients = [...chosen.values()];
    // A chat you have goes by its id; someone found by search gets a 1:1 opened by the server.
    const conversationIds = recipients.flatMap((r) => (r.conversationId ? [r.conversationId] : []));
    const userIds = recipients.flatMap((r) => (!r.conversationId && r.userId ? [r.userId] : []));
    let results: ForwardResult[];
    try {
      ({ results } = await forwardMessage(conversationId, messageId, { userIds, conversationIds }, accessToken));
    } catch (e) {
      setSending(false);
      setError(e instanceof ApiError && e.status !== 0 ? e.message : "Couldn't send. Check your connection and try again.");
      return;
    }
    setSending(false);
    void refreshUnreadCount();
    const failed = new Map<string, Recipient>();
    let sent = 0;
    for (const r of recipients) {
      const result = results.find((x) => (r.conversationId ? x.conversationId === r.conversationId && !x.userId : x.userId === r.userId));
      if (result?.status === "sent") sent++;
      else failed.set(r.key, r);
    }
    const failedNames = [...failed.values()].map(nameFor).join(", ");
    if (sent === 0) {
      setChosen(failed);
      setError(`Couldn't send to ${failedNames}.`);
      return;
    }
    tapFeedback("success");
    const done = sent === 1 ? "Sent" : `Sent to ${sent} chats`;
    showToast(failed.size ? `${done}. Couldn't send to ${failedNames}.` : done);
    navigation.goBack();
  };

  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <RecipientPicker chosen={chosen} onToggle={toggle} emptyHint="Search for someone to forward this to." />
      {chosen.size || error ? (
        <View style={[styles.footer, { paddingBottom: spacing.sm + bottom }]}>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          {chosen.size ? <Button label={chosen.size === 1 ? "Send" : `Send to ${chosen.size}`} onPress={() => void send()} busy={sending} /> : null}
        </View>
      ) : null}
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  footer: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  error: { color: colors.danger, fontSize: 13 },
});
