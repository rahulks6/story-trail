import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { deleteStickerResponse, listStickerResponses, type QuestionResponse, type StickerVoter } from "../api/stickers";
import { timeAgo } from "../utils/serverTime";
import { isInteractive, type Overlay } from "../models/storyDraft";

/**
 * The owner's view of their Story's interactive stickers, in Insights: each poll's and quiz's
 * results and who chose what, the answers to a question (each can be shared to a new Story,
 * without the name of who sent it, or cleared), reminders set on a countdown, and how many
 * joined an Add Yours.
 */
export function StickerResults({ storyId, overlays, onShareAnswer }: { storyId: string; overlays: Overlay[]; onShareAnswer?: (prompt: string, answer: string) => void }): React.JSX.Element | null {
  const stickers = overlays.filter(isInteractive);
  if (stickers.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={typography.label}>Sticker responses</Text>
      {stickers.map((overlay) => (
        <StickerBlock key={overlay.id} storyId={storyId} overlay={overlay} onShareAnswer={onShareAnswer} />
      ))}
    </View>
  );
}

function StickerBlock({ storyId, overlay, onShareAnswer }: { storyId: string; overlay: Overlay; onShareAnswer?: (prompt: string, answer: string) => void }): React.JSX.Element | null {
  const { accessToken } = useAuth();
  const [voters, setVoters] = useState<StickerVoter[] | null>(null);
  const [answers, setAnswers] = useState<QuestionResponse[] | null>(null);
  const [failed, setFailed] = useState(false);
  const listed = overlay.type === "poll" || overlay.type === "quiz" || overlay.type === "question";

  const load = useCallback(async () => {
    if (!accessToken || !listed) return;
    setFailed(false);
    try {
      const r = await listStickerResponses(storyId, overlay.id, accessToken);
      if (r.type === "question") setAnswers(r.responses);
      else setVoters(r.voters);
    } catch {
      setFailed(true);
    }
  }, [accessToken, listed, storyId, overlay.id]);
  useEffect(() => { void load(); }, [load]);

  const clear = (answer: QuestionResponse) =>
    Alert.alert("Delete this answer?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (!accessToken) return;
          setAnswers((all) => all?.filter((a) => a.id !== answer.id) ?? null);
          deleteStickerResponse(storyId, overlay.id, answer.id, accessToken).catch(() => void load());
        },
      },
    ]);

  switch (overlay.type) {
    case "poll":
    case "quiz": {
      const results = overlay.properties.results;
      const total = results?.total ?? 0;
      return (
        <View style={styles.block}>
          <Text style={typography.bodyStrong}>{overlay.type === "quiz" ? "Quiz" : "Poll"}{overlay.properties.question ? `: ${overlay.properties.question}` : ""}</Text>
          {overlay.properties.options.map((option, i) => {
            const n = results?.counts[i] ?? 0;
            const share = total ? Math.round((n / total) * 100) : 0;
            const right = overlay.type === "quiz" && overlay.properties.correctIndex === i;
            return (
              <View key={i} style={styles.resultRow} accessible accessibilityLabel={`${option}: ${n} ${n === 1 ? "vote" : "votes"}, ${share} percent${right ? ", the right answer" : ""}`}>
                <View style={[styles.resultFill, { width: `${share}%` }, right && styles.resultRight]} />
                <Text style={[typography.body, styles.resultText]} numberOfLines={1}>{option}{right ? " (right answer)" : ""}</Text>
                <Text style={typography.bodyStrong}>{share}%</Text>
              </View>
            );
          })}
          <Text style={typography.caption}>{total === 1 ? "1 vote" : `${total} votes`}</Text>
          {voters === null && !failed ? <ActivityIndicator color={colors.accentText} /> : null}
          {(voters ?? []).map((v) => (
            <View key={v.id} style={styles.person}>
              <Avatar username={v.username} displayName={v.displayName} avatarMediaId={v.avatarMediaId} size={28} />
              <VerifiedName name={`@${v.username}`} verified={v.verified} style={typography.bodyStrong} containerStyle={styles.name} />
              <Text style={[typography.caption, overlay.type === "quiz" && v.option === overlay.properties.correctIndex && styles.correct]} numberOfLines={1}>{overlay.properties.options[v.option] ?? ""}</Text>
            </View>
          ))}
        </View>
      );
    }
    case "question":
      return (
        <View style={styles.block}>
          <Text style={typography.bodyStrong}>Question: {overlay.properties.prompt}</Text>
          {answers === null && !failed ? <ActivityIndicator color={colors.accentText} /> : null}
          {answers?.length === 0 ? <Text style={typography.caption}>No answers yet.</Text> : null}
          {(answers ?? []).map((a) => (
            <View key={a.id} style={styles.answer}>
              <View style={styles.person}>
                <Avatar username={a.responder.username} displayName={a.responder.displayName} avatarMediaId={a.responder.avatarMediaId} size={24} />
                <VerifiedName name={`@${a.responder.username}`} verified={a.responder.verified} style={typography.label} containerStyle={styles.name} />
                <Text style={typography.caption}>{timeAgo(a.createdAt)}</Text>
              </View>
              <Text style={typography.body}>{a.body}</Text>
              <View style={styles.answerActions}>
                {onShareAnswer ? (
                  <Pressable onPress={() => onShareAnswer(overlay.properties.prompt, a.body)} style={[styles.smallButton, styles.smallPrimary]} accessibilityRole="button" accessibilityLabel="Share this answer to your Story" accessibilityHint="Your Story shows the question and the answer, not who sent it">
                    <Text style={styles.smallPrimaryLabel}>Share</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => clear(a)} style={styles.smallButton} accessibilityRole="button" accessibilityLabel={`Delete @${a.responder.username}'s answer`}>
                  <Text style={styles.smallLabel}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {failed ? <Text style={typography.caption}>Couldn't load answers.</Text> : null}
        </View>
      );
    case "countdown":
      return (
        <View style={styles.block}>
          <Text style={typography.bodyStrong}>Countdown: {overlay.properties.title}</Text>
          <Text style={typography.caption}>{(overlay.properties.reminderCount ?? 0) === 1 ? "1 person will be reminded" : `${overlay.properties.reminderCount ?? 0} people will be reminded`}</Text>
        </View>
      );
    case "addYours":
      return (
        <View style={styles.block}>
          <Text style={typography.bodyStrong}>Add Yours: {overlay.properties.prompt}</Text>
          <Text style={typography.caption}>{(overlay.properties.participants ?? 0) === 1 ? "1 participant" : `${overlay.properties.participants ?? 0} participants`}</Text>
        </View>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  block: { gap: spacing.xs, paddingVertical: spacing.xs },
  resultRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 34, paddingHorizontal: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated, overflow: "hidden" },
  resultFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.accent, opacity: 0.35 },
  resultRight: { backgroundColor: colors.success },
  resultText: { flex: 1 },
  person: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { flex: 1, flexShrink: 1 },
  correct: { color: colors.success },
  answer: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  answerActions: { flexDirection: "row", gap: spacing.xs, justifyContent: "flex-end" },
  smallButton: { minHeight: 32, paddingHorizontal: spacing.md, borderRadius: radii.sm, justifyContent: "center", backgroundColor: colors.surface },
  smallPrimary: { backgroundColor: colors.accent },
  smallLabel: { color: colors.textPrimary, fontWeight: "700", fontSize: 13 },
  smallPrimaryLabel: { color: colors.onAccent, fontWeight: "700", fontSize: 13 },
});
