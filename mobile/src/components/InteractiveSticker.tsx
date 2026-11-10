import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";
import { mediaColors as colors, radii } from "../theme";
import { tapFeedback } from "../utils/haptics";
import { serverTimeMs } from "../utils/serverTime";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { linkHost, songProviderName, type Overlay, type VoteResults } from "../models/storyDraft";
import type { VoteOutcome } from "../api/stickers";
import { t } from "../i18n";

type InteractiveOverlay = Extract<Overlay, { type: "poll" | "quiz" | "question" | "countdown" | "link" | "addYours" | "song" }>;

/**
 * What a viewer can do with a Story's stickers. Given (StoryOverlayLayer while watching), the
 * stickers take taps; left out (the editor, a share card), they're a faithful still picture of
 * what will publish. The handlers talk to the server (StoryFeed); the sticker keeps its own
 * moment-to-moment state so a vote shows at once.
 */
export interface StickerInteraction {
  /** The Story's owner: results always showing, nothing to answer. */
  isOwner: boolean;
  onVote: (stickerId: string, option: number) => Promise<VoteOutcome | null>;
  onAnswer: (overlay: Extract<Overlay, { type: "question" }>) => void;
  onRemind: (stickerId: string, on: boolean) => Promise<boolean>;
  onOpenLink: (url: string) => void;
  onAddYours: (overlay: Extract<Overlay, { type: "addYours" }>) => void;
  onOpenChain: (chainId: string) => void;
}

/** Story stickers are drawn relative to the photo (390 points wide is 1), like text, so every phone shows the same picture. */
function unit(containerWidth: number): number {
  return Math.max(0.6, containerWidth / 390);
}

const percent = (results: VoteResults, i: number) => (results.total === 0 ? 0 : Math.round(((results.counts[i] ?? 0) / results.total) * 100));

/** A result bar that grows to its share once results arrive (instantly with Reduce Motion). */
function ResultBar({ share, color, u }: { share: number; color: string; u: number }): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const width = useRef(new Animated.Value(reducedMotion ? share : 0)).current;
  useEffect(() => {
    if (reducedMotion) width.setValue(share);
    else Animated.timing(width, { toValue: share, duration: 450, useNativeDriver: false }).start();
  }, [share, width, reducedMotion]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bar, { borderRadius: 12 * u, backgroundColor: color, width: width.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }]}
    />
  );
}

function PollOrQuiz({ overlay, u, interaction }: { overlay: Extract<Overlay, { type: "poll" | "quiz" }>; u: number; interaction?: StickerInteraction }): React.JSX.Element {
  const quiz = overlay.type === "quiz";
  const [outcome, setOutcome] = useState<{ results: VoteResults; correctIndex?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  // A fresh copy from the server (the Story's detail) replaces what was shown.
  useEffect(() => setOutcome(null), [overlay.properties.results]);

  const results = outcome?.results ?? overlay.properties.results ?? null;
  const correctIndex = outcome?.correctIndex ?? (quiz ? overlay.properties.correctIndex : undefined);
  // In the editor, a quiz shows its right answer (that's how the creator checks it); while
  // watching, only after answering.
  const revealed = !interaction ? quiz : !!results;
  const canVote = !!interaction && !interaction.isOwner && !results && !busy;

  const choose = async (option: number) => {
    if (!interaction || !canVote) return;
    setBusy(true);
    tapFeedback("select");
    const got = await interaction.onVote(overlay.id, option);
    setBusy(false);
    if (!got) return;
    setOutcome({ results: got.results, correctIndex: got.correctIndex });
    if (quiz) {
      if (got.correct) tapFeedback("success");
      else {
        tapFeedback("error");
        if (!reducedMotion) {
          Animated.sequence([10, -10, 7, -7, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 55, useNativeDriver: true }))).start();
        }
      }
    }
  };

  const question = overlay.properties.question;
  return (
    <Animated.View style={[styles.card, { width: 270 * u, padding: 12 * u, borderRadius: 18 * u, transform: [{ translateX: shake }] }]}>
      {quiz ? (
        <View style={[styles.quizBadge, { borderRadius: 8 * u, paddingHorizontal: 8 * u, paddingVertical: 2 * u, marginBottom: 8 * u }]}>
          <Text allowFontScaling={false} style={[styles.quizBadgeText, { fontSize: 11 * u }]}>{t("interactiveSticker.quiz")}</Text>
        </View>
      ) : null}
      {question ? <Text allowFontScaling={false} style={[styles.cardTitle, { fontSize: 17 * u, marginBottom: 10 * u }]}>{question}</Text> : null}
      <View style={{ gap: 8 * u }}>
        {overlay.properties.options.map((option, i) => {
          const share = results ? percent(results, i) : 0;
          const chosen = results?.viewerChoice === i;
          const right = revealed && correctIndex === i;
          const wrong = revealed && quiz && chosen && correctIndex !== i;
          const fill = right ? colors.success : wrong ? colors.danger : chosen ? colors.accent : "rgba(11,11,11,0.12)";
          const label = [
            option,
            results ? t("interactiveSticker.sharePercent", { share }) : null,
            right ? t("interactiveSticker.correctAnswer") : null,
            wrong ? t("interactiveSticker.yourAnswerWrong") : chosen ? t("interactiveSticker.yourAnswer") : null,
          ].filter(Boolean).join(", ");
          return (
            <Pressable
              key={i}
              onPress={canVote ? () => void choose(i) : undefined}
              disabled={!canVote}
              pressEffect={canVote ? "scale" : "none"}
              style={[styles.option, { minHeight: 40 * u, borderRadius: 12 * u, paddingHorizontal: 12 * u }, (right || wrong) && { borderColor: fill }]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !canVote, selected: chosen }}
            >
              {results ? <ResultBar share={share} color={fill} u={u} /> : null}
              <View style={styles.optionRow}>
                {quiz ? (
                  <View style={[styles.letter, { width: 22 * u, height: 22 * u, borderRadius: 11 * u }, right && { backgroundColor: colors.success }, wrong && { backgroundColor: colors.danger }]}>
                    {right ? <Icon name="check" size={13 * u} color={colors.onAccent} /> : wrong ? <Icon name="close" size={12 * u} color={colors.onAccent} /> : (
                      <Text allowFontScaling={false} style={[styles.letterText, { fontSize: 12 * u }]}>{String.fromCharCode(65 + i)}</Text>
                    )}
                  </View>
                ) : null}
                <Text allowFontScaling={false} style={[styles.optionText, { fontSize: 15 * u }]} numberOfLines={2}>{option}</Text>
                {results ? <Text allowFontScaling={false} style={[styles.percent, { fontSize: 14 * u }]}>{share}%</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {results && interaction?.isOwner ? (
        <Text allowFontScaling={false} style={[styles.meta, { fontSize: 12 * u, marginTop: 8 * u }]}>{t("common.votes", { count: results.total })}</Text>
      ) : null}
    </Animated.View>
  );
}

function QuestionCard({ overlay, u, interaction }: { overlay: Extract<Overlay, { type: "question" }>; u: number; interaction?: StickerInteraction }): React.JSX.Element {
  const owner = !!interaction?.isOwner;
  const answered = overlay.properties.viewerAnswered === true;
  const count = overlay.properties.responseCount ?? 0;
  return (
    <View style={[styles.card, styles.center, { width: 260 * u, padding: 14 * u, borderRadius: 18 * u }]}>
      <Text allowFontScaling={false} style={[styles.cardTitle, styles.centerText, { fontSize: 17 * u, marginBottom: 10 * u }]}>{overlay.properties.prompt}</Text>
      <Pressable
        onPress={interaction && !owner ? () => interaction.onAnswer(overlay) : undefined}
        disabled={!interaction || owner}
        pressEffect={interaction && !owner ? "scale" : "none"}
        style={[styles.answerField, { borderRadius: 12 * u, minHeight: 38 * u, paddingHorizontal: 12 * u }]}
        accessibilityRole="button"
        accessibilityLabel={owner ? t("interactiveSticker.countAnswersToPrompt", { count, prompt: overlay.properties.prompt }) : t("interactiveSticker.answerPrompt", { prompt: overlay.properties.prompt })}
      >
        <Text allowFontScaling={false} style={[styles.answerHint, { fontSize: 14 * u }]}>
          {owner ? t("interactiveSticker.answers", { count }) : answered ? t("interactiveSticker.sentAnswerAgain") : t("common.typeSomething")}
        </Text>
      </Pressable>
    </View>
  );
}

/** Days, hours, minutes and seconds left; zeros once it's over. */
export function timeLeft(endsAt: string, now: number): { days: number; hours: number; minutes: number; seconds: number; over: boolean } {
  // The end time comes from the server: read through utils/serverTime, like every timestamp.
  const end = serverTimeMs(endsAt);
  const ms = Number.isFinite(end) ? Math.max(0, end - now) : 0;
  const s = Math.floor(ms / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, over: ms === 0 };
}

function CountdownCard({ overlay, u, interaction }: { overlay: Extract<Overlay, { type: "countdown" }>; u: number; interaction?: StickerInteraction }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  const [reminded, setReminded] = useState(overlay.properties.viewerReminded === true);
  useEffect(() => setReminded(overlay.properties.viewerReminded === true), [overlay.properties.viewerReminded]);
  const left = timeLeft(overlay.properties.endsAt, now);
  // Ticks each second while it's counting (and on screen), never after it ends.
  useEffect(() => {
    if (left.over) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [left.over]);

  const toggle = async () => {
    if (!interaction) return;
    const next = !reminded;
    setReminded(next);
    tapFeedback(next ? "success" : "tap");
    if (!(await interaction.onRemind(overlay.id, next))) setReminded(!next);
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  const units: Array<[string, number]> = [["days", left.days], ["hours", left.hours], ["min", left.minutes], ["sec", left.seconds]];
  const owner = !!interaction?.isOwner;
  const spoken = left.over ? "ended" : t("interactiveSticker.daysDaysHoursHoursMinutes", { days: left.days, hours: left.hours, minutes: left.minutes });
  return (
    <View style={[styles.card, styles.center, { width: 270 * u, padding: 14 * u, borderRadius: 18 * u }]}>
      <Text allowFontScaling={false} style={[styles.cardTitle, styles.centerText, { fontSize: 17 * u, marginBottom: 8 * u }]}>{overlay.properties.title}</Text>
      <View style={[styles.digits, { gap: 6 * u }]} accessible accessibilityLabel={`${overlay.properties.title}: ${spoken}`}>
        {left.over ? (
          <Text allowFontScaling={false} style={[styles.ended, { fontSize: 22 * u }]}>{t("interactiveSticker.itsTime")}</Text>
        ) : units.map(([label, value]) => (
          <View key={label} style={[styles.digitBox, { borderRadius: 10 * u, paddingVertical: 6 * u, minWidth: 50 * u }]}>
            <Text allowFontScaling={false} style={[styles.digit, { fontSize: 24 * u }]}>{pad(value)}</Text>
            <Text allowFontScaling={false} style={[styles.digitLabel, { fontSize: 10 * u }]}>{label}</Text>
          </View>
        ))}
      </View>
      {owner ? (
        <Text allowFontScaling={false} style={[styles.meta, { fontSize: 12 * u, marginTop: 8 * u }]}>
          {t("interactiveSticker.remindersSet", { count: overlay.properties.reminderCount ?? 0 })}
        </Text>
      ) : !left.over ? (
        <Pressable
          onPress={interaction ? () => void toggle() : undefined}
          disabled={!interaction}
          style={[styles.remind, reminded && styles.remindOn, { borderRadius: radii.pill, marginTop: 10 * u, paddingHorizontal: 14 * u, minHeight: 34 * u }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: reminded }}
          accessibilityLabel={reminded ? t("interactiveSticker.reminderOnTapToTurn") : t("interactiveSticker.remindMeWhenItEnds")}
        >
          <Icon name={reminded ? "check" : "notifications"} size={15 * u} color={reminded ? colors.onAccent : colors.background} />
          <Text allowFontScaling={false} style={[styles.remindText, reminded && styles.remindTextOn, { fontSize: 14 * u }]}>{reminded ? t("interactiveSticker.reminderOn") : t("interactiveSticker.remindMe")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LinkChip({ overlay, u, interaction }: { overlay: Extract<Overlay, { type: "link" }>; u: number; interaction?: StickerInteraction }): React.JSX.Element {
  const host = linkHost(overlay.properties.url);
  const text = overlay.properties.label || host;
  return (
    <Pressable
      onPress={interaction ? () => interaction.onOpenLink(overlay.properties.url) : undefined}
      disabled={!interaction}
      style={[styles.link, { borderRadius: radii.pill, paddingHorizontal: 14 * u, minHeight: 36 * u, gap: 6 * u }]}
      accessibilityRole="link"
      accessibilityLabel={t("interactiveSticker.linkTextOpensHost", { text, host })}
    >
      <Icon name="attach" size={16 * u} color={colors.accentText} />
      <Text allowFontScaling={false} style={[styles.linkText, { fontSize: 15 * u }]} numberOfLines={1}>{text.toUpperCase()}</Text>
    </Pressable>
  );
}

/** A popular song: cover, title and artist, opening Spotify or YouTube on tap. Katkee never plays it. */
function SongCard({ overlay, u, interaction }: { overlay: Extract<Overlay, { type: "song" }>; u: number; interaction?: StickerInteraction }): React.JSX.Element {
  const { title, artist, artworkUrl, provider, url } = overlay.properties;
  const service = songProviderName(provider);
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = 56 * u;
  return (
    <Pressable
      onPress={interaction ? () => interaction.onOpenLink(url) : undefined}
      disabled={!interaction}
      pressEffect={interaction ? "scale" : "none"}
      style={[styles.card, styles.song, { width: 280 * u, padding: 10 * u, borderRadius: 18 * u, gap: 10 * u }]}
      accessibilityRole="link"
      accessibilityLabel={t("interactiveSticker.songOpensService", { title, artist, service })}
    >
      {artworkUrl && !coverFailed ? (
        <Image source={{ uri: artworkUrl }} onError={() => setCoverFailed(true)} style={{ width: cover, height: cover, borderRadius: 10 * u }} accessible={false} />
      ) : (
        <View style={[styles.songCoverEmpty, { width: cover, height: cover, borderRadius: 10 * u }]}>
          <Icon name="music" size={26 * u} color={colors.onAccent} />
        </View>
      )}
      <View style={styles.songText}>
        <Text allowFontScaling={false} style={[styles.songTitle, { fontSize: 15 * u }]} numberOfLines={1}>{title}</Text>
        {artist ? <Text allowFontScaling={false} style={[styles.songArtist, { fontSize: 13 * u }]} numberOfLines={1}>{artist}</Text> : null}
        <View style={[styles.songPlay, { marginTop: 5 * u, gap: 4 * u, paddingHorizontal: 8 * u, paddingVertical: 3 * u, borderRadius: radii.pill }]}>
          <Icon name="play" size={11 * u} color={colors.onAccent} />
          <Text allowFontScaling={false} style={[styles.songPlayText, { fontSize: 11 * u }]} numberOfLines={1}>{t("interactiveSticker.playOnService", { service })}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function AddYoursCard({ overlay, u, interaction }: { overlay: Extract<Overlay, { type: "addYours" }>; u: number; interaction?: StickerInteraction }): React.JSX.Element {
  const { prompt, participants, recent, chainId } = overlay.properties;
  const count = participants ?? 0;
  const pulse = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  // A gentle breath on the button, so the invitation reads as one.
  useEffect(() => {
    if (!interaction || interaction.isOwner || reducedMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.05, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [interaction, pulse, reducedMotion]);
  return (
    <View style={[styles.card, styles.center, { width: 260 * u, padding: 14 * u, borderRadius: 18 * u }]}>
      <View style={[styles.addYoursBadge, { borderRadius: radii.pill, paddingHorizontal: 10 * u, paddingVertical: 3 * u, marginBottom: 8 * u, gap: 4 * u }]}>
        <Icon name="add" size={12 * u} color={colors.onAccent} />
        <Text allowFontScaling={false} style={[styles.addYoursBadgeText, { fontSize: 11 * u }]}>{t("common.addYours2")}</Text>
      </View>
      <Text allowFontScaling={false} style={[styles.cardTitle, styles.centerText, { fontSize: 18 * u, marginBottom: 10 * u }]}>{prompt}</Text>
      <Pressable
        onPress={interaction && chainId ? () => interaction.onOpenChain(chainId) : undefined}
        disabled={!interaction || !chainId}
        pressEffect="scale"
        style={[styles.participants, { gap: 6 * u, marginBottom: 10 * u }]}
        accessibilityRole="button"
        accessibilityLabel={t("interactiveSticker.peopleAddedTheirsSeeTheir", { count })}
      >
        <View style={styles.faces}>
          {(recent ?? []).slice(0, 3).map((p, i) => (
            <View key={p.username} style={[styles.face, { marginLeft: i === 0 ? 0 : -8 * u, borderRadius: 13 * u }]}>
              <Avatar username={p.username} avatarMediaId={p.avatarMediaId} size={22 * u} />
            </View>
          ))}
        </View>
        <Text allowFontScaling={false} style={[styles.meta, { fontSize: 13 * u }]}>{count === 0 ? t("interactiveSticker.beTheFirst") : t("common.participants", { count })}</Text>
      </Pressable>
      {interaction && !interaction.isOwner ? (
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <Pressable
            onPress={() => interaction.onAddYours(overlay)}
            style={[styles.addYoursButton, { borderRadius: radii.pill, paddingHorizontal: 18 * u, minHeight: 38 * u, gap: 6 * u }]}
            accessibilityRole="button"
            accessibilityLabel={t("interactiveSticker.addYoursPrompt", { prompt })}
            accessibilityHint={t("interactiveSticker.opensTheCameraWithThis")}
          >
            <Icon name="camera" size={16 * u} color={colors.onAccent} />
            <Text allowFontScaling={false} style={[styles.addYoursButtonText, { fontSize: 15 * u }]}>{t("common.addYours")}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** One interactive sticker's body; placement (x/y/scale/rotation) is PlacedOverlay's. */
export function InteractiveSticker({ overlay, containerWidth, interaction }: { overlay: InteractiveOverlay; containerWidth: number; interaction?: StickerInteraction }): React.JSX.Element {
  const u = unit(containerWidth);
  switch (overlay.type) {
    case "poll":
    case "quiz":
      return <PollOrQuiz overlay={overlay} u={u} interaction={interaction} />;
    case "question":
      return <QuestionCard overlay={overlay} u={u} interaction={interaction} />;
    case "countdown":
      return <CountdownCard overlay={overlay} u={u} interaction={interaction} />;
    case "link":
      return <LinkChip overlay={overlay} u={u} interaction={interaction} />;
    case "addYours":
      return <AddYoursCard overlay={overlay} u={u} interaction={interaction} />;
    case "song":
      return <SongCard overlay={overlay} u={u} interaction={interaction} />;
  }
}

// A white card reads on any photo, like Instagram's stickers; dark text on it is the media
// palette's background colour.
const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  center: { alignItems: "center" },
  centerText: { textAlign: "center" },
  cardTitle: { color: colors.background, fontWeight: "800" },
  quizBadge: { alignSelf: "flex-start", backgroundColor: colors.background },
  quizBadgeText: { color: colors.textPrimary, fontWeight: "800", letterSpacing: 1 },
  option: { justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(11,11,11,0.12)", backgroundColor: "rgba(11,11,11,0.04)", overflow: "hidden" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.55 },
  optionText: { flex: 1, color: colors.background, fontWeight: "700" },
  percent: { color: colors.background, fontWeight: "800", fontVariant: ["tabular-nums"] },
  letter: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11,11,11,0.1)" },
  letterText: { color: colors.background, fontWeight: "800" },
  meta: { color: "#5C5F66", fontWeight: "600", textAlign: "center" },
  answerField: { alignSelf: "stretch", justifyContent: "center", backgroundColor: "rgba(11,11,11,0.06)" },
  answerHint: { color: "#5C5F66", fontWeight: "600", textAlign: "center" },
  digits: { flexDirection: "row", justifyContent: "center" },
  digitBox: { alignItems: "center", backgroundColor: colors.background },
  digit: { color: colors.textPrimary, fontWeight: "800", fontVariant: ["tabular-nums"] },
  digitLabel: { color: colors.textSecondary, fontWeight: "600" },
  ended: { color: colors.background, fontWeight: "800" },
  remind: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(11,11,11,0.08)" },
  remindOn: { backgroundColor: colors.accent },
  remindText: { color: colors.background, fontWeight: "700" },
  remindTextOn: { color: colors.onAccent },
  link: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", maxWidth: 300 },
  linkText: { color: "#8A5E00", fontWeight: "800", flexShrink: 1 },
  addYoursBadge: { flexDirection: "row", alignItems: "center", backgroundColor: colors.accent },
  addYoursBadgeText: { color: colors.onAccent, fontWeight: "800", letterSpacing: 1 },
  participants: { flexDirection: "row", alignItems: "center" },
  faces: { flexDirection: "row" },
  face: { borderWidth: 2, borderColor: "#FFFFFF", overflow: "hidden" },
  addYoursButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  addYoursButtonText: { color: colors.onAccent, fontWeight: "800" },
  song: { flexDirection: "row", alignItems: "center" },
  songCoverEmpty: { backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  songText: { flex: 1, minWidth: 0 },
  songTitle: { color: colors.background, fontWeight: "800" },
  songArtist: { color: "#5C5F66", fontWeight: "600" },
  songPlay: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.background },
  songPlayText: { color: colors.onAccent, fontWeight: "800" },
});
