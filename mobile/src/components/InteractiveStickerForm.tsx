import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { checkStickerLink } from "../api/stickers";
import { ApiError } from "../api/client";
import { serverDate } from "../utils/serverTime";
import {
  MAX_COUNTDOWN_TITLE_LENGTH,
  MAX_OPTIONS,
  MAX_OPTION_LENGTH,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS,
  normalizeLinkInput,
  type InteractiveProperties,
  type InteractiveType,
  type Overlay,
} from "../models/storyDraft";
import { localeTag, t } from "../i18n";

/** The six interactive stickers, in the order Instagram's tray puts them. */
const KINDS: Array<{ type: InteractiveType; label: string; icon: "check" | "help" | "comment" | "timer" | "attach" | "add"; hint: string }> = [
  { type: "poll", get label() { return t("common.poll"); }, icon: "check", get hint() { return t("interactiveStickerForm.askAQuestionWith2"); } },
  { type: "quiz", get label() { return t("common.quiz"); }, icon: "help", get hint() { return t("interactiveStickerForm.aQuestionWithOneRight"); } },
  { type: "question", get label() { return t("interactiveStickerForm.questions"); }, icon: "comment", get hint() { return t("interactiveStickerForm.letPeopleSendYouAnswers"); } },
  { type: "countdown", get label() { return t("interactiveStickerForm.countdown"); }, icon: "timer", get hint() { return t("interactiveStickerForm.countDownToAMoment"); } },
  { type: "link", get label() { return t("interactiveStickerForm.link"); }, icon: "attach", get hint() { return t("interactiveStickerForm.aLinkPeopleCanOpen"); } },
  { type: "addYours", get label() { return t("interactiveStickerForm.addYours"); }, icon: "add", get hint() { return t("interactiveStickerForm.startAPromptOthersPost"); } },
];

interface Props {
  /** The sticker being edited, its content prefilled; otherwise a new one is made. */
  editing?: Extract<Overlay, { type: InteractiveType }> | null;
  /** Kinds already on this Story (one of each, like Instagram). */
  usedTypes: string[];
  onDone: (type: InteractiveType, properties: InteractiveProperties) => void;
}

const inOneDay = () => {
  const d = new Date(Date.now() + 86_400_000);
  d.setMinutes(0, 0, 0);
  return d;
};

/**
 * The Interactive tab of the sticker sheet: a tray of the six stickers, then a short form for
 * the one chosen. Everything is checked here the way the server checks it (2-4 options, a quiz
 * answer, a countdown in the future, a link the safety policy allows), so a Story never fails
 * to post because of a sticker.
 */
export function InteractiveStickerForm({ editing, usedTypes, onDone }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [type, setType] = useState<InteractiveType | null>(editing?.type ?? null);
  const p = editing?.properties as Partial<Record<string, unknown>> | undefined;
  const [question, setQuestion] = useState<string>(typeof p?.question === "string" ? p.question : typeof p?.prompt === "string" ? p.prompt : "");
  const [options, setOptions] = useState<string[]>(Array.isArray(p?.options) ? (p!.options as string[]) : ["", ""]);
  const [correct, setCorrect] = useState<number>(typeof p?.correctIndex === "number" ? p.correctIndex : 0);
  const [title, setTitle] = useState<string>(typeof p?.title === "string" ? p.title : "");
  const [endsAt, setEndsAt] = useState<Date>(() => {
    const saved = typeof p?.endsAt === "string" ? serverDate(p.endsAt) : null;
    return saved && saved.getTime() > Date.now() ? saved : inOneDay();
  });
  const [url, setUrl] = useState<string>(typeof p?.url === "string" ? p.url : "");
  const [label, setLabel] = useState<string>(typeof p?.label === "string" ? p.label : "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: InteractiveType) => {
    setType(next);
    setError(null);
    if (next === "question" && !question) setQuestion(t("interactiveStickerForm.askMeAnything"));
  };

  const filledOptions = options.map((o) => o.trim());
  const optionsOk = filledOptions.length >= MIN_OPTIONS && filledOptions.every((o) => o.length > 0);
  const ready =
    type === "poll" ? optionsOk
    : type === "quiz" ? optionsOk && question.trim().length > 0
    : type === "question" || type === "addYours" ? question.trim().length > 0
    : type === "countdown" ? title.trim().length > 0 && endsAt.getTime() > Date.now()
    : type === "link" ? url.trim().length > 3
    : false;

  const submit = async () => {
    if (!type || !ready) return;
    setError(null);
    switch (type) {
      case "poll":
        return onDone(type, { question: question.trim(), options: filledOptions });
      case "quiz":
        return onDone(type, { question: question.trim(), options: filledOptions, correctIndex: Math.min(correct, filledOptions.length - 1) });
      case "question":
        return onDone(type, { prompt: question.trim() });
      case "addYours":
        return onDone(type, { prompt: question.trim() });
      case "countdown":
        return onDone(type, { title: title.trim(), endsAt: endsAt.toISOString() });
      case "link": {
        if (!accessToken) return;
        setChecking(true);
        try {
          // The same link-safety policy the publish applies: refused now, not after posting.
          const checked = await checkStickerLink(normalizeLinkInput(url), accessToken);
          onDone(type, { url: checked.url, label: label.trim() || null });
        } catch (e) {
          setError(e instanceof ApiError ? e.message : t("interactiveStickerForm.couldntCheckThatLinkCheck"));
        } finally {
          setChecking(false);
        }
      }
    }
  };

  const adjust = (unit: "day" | "hour" | "minute", delta: number) =>
    setEndsAt((d) => {
      const next = new Date(d);
      if (unit === "day") next.setDate(next.getDate() + delta);
      if (unit === "hour") next.setHours(next.getHours() + delta);
      if (unit === "minute") next.setMinutes(next.getMinutes() + delta * 5);
      return next;
    });

  if (!type) {
    return (
      <View style={styles.grid}>
        {KINDS.map((k) => {
          const used = usedTypes.includes(k.type);
          return (
            <Pressable
              key={k.type}
              onPress={used ? undefined : () => choose(k.type)}
              disabled={used}
              style={[styles.tile, used && styles.tileUsed]}
              accessibilityRole="button"
              accessibilityLabel={(used ? t("interactiveStickerForm.labelAlreadyOnThisStory", { label: k.label }) : `${k.label}. ${k.hint}`)}
              accessibilityState={{ disabled: used }}
            >
              <Icon name={k.icon} size={22} color={used ? colors.textDisabled : colors.accentText} />
              <Text style={[styles.tileLabel, used && styles.tileLabelUsed]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  const heading = KINDS.find((k) => k.type === type)!;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      <View style={styles.formHeader}>
        {!editing ? (
          <Pressable onPress={() => setType(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("interactiveStickerForm.backToStickers")}>
            <Icon name="back" size={20} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={typography.bodyStrong}>{heading.label}</Text>
      </View>

      {type === "poll" || type === "quiz" || type === "question" || type === "addYours" ? (
        <TextInput
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder={type === "poll" ? t("interactiveStickerForm.askAQuestionOptional") : type === "addYours" ? t("interactiveStickerForm.yourPromptLikeShowYour") : type === "quiz" ? t("interactiveStickerForm.askAQuestion") : t("interactiveStickerForm.askMeAnything")}
          placeholderTextColor={colors.textDisabled}
          accessibilityLabel={type === "addYours" ? t("interactiveStickerForm.prompt") : t("interactiveStickerForm.question")}
          autoFocus={!editing}
        />
      ) : null}

      {type === "poll" || type === "quiz" ? (
        <View style={styles.options}>
          {options.map((option, i) => (
            <View key={i} style={styles.optionRow}>
              {type === "quiz" ? (
                <Pressable
                  onPress={() => setCorrect(i)}
                  hitSlop={6}
                  style={[styles.radio, correct === i && styles.radioOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: correct === i }}
                  accessibilityLabel={t("interactiveStickerForm.markOptionValueAsThe", { value: i + 1 })}
                >
                  {correct === i ? <Icon name="check" size={14} color={colors.onAccent} /> : null}
                </Pressable>
              ) : null}
              <TextInput
                style={[styles.input, styles.optionInput]}
                value={option}
                onChangeText={(text) => setOptions((all) => all.map((o, j) => (j === i ? text : o)))}
                maxLength={MAX_OPTION_LENGTH}
                placeholder={t("interactiveStickerForm.optionValue", { value: i + 1 })}
                placeholderTextColor={colors.textDisabled}
                accessibilityLabel={t("interactiveStickerForm.optionValue", { value: i + 1 })}
              />
              {options.length > MIN_OPTIONS ? (
                <Pressable
                  onPress={() => {
                    setOptions((all) => all.filter((_, j) => j !== i));
                    setCorrect((c) => (c === i ? 0 : c > i ? c - 1 : c));
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t("interactiveStickerForm.removeOptionValue", { value: i + 1 })}
                >
                  <Icon name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {options.length < MAX_OPTIONS ? (
            <Pressable onPress={() => setOptions((all) => [...all, ""])} style={styles.addOption} accessibilityRole="button">
              <Icon name="add" size={16} color={colors.accentText} />
              <Text style={styles.addOptionLabel}>{t("interactiveStickerForm.addOption")}</Text>
            </Pressable>
          ) : null}
          {type === "quiz" ? <Text style={styles.hint}>{t("interactiveStickerForm.tapTheCircleBesideThe")}</Text> : null}
        </View>
      ) : null}

      {type === "countdown" ? (
        <View style={styles.options}>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            maxLength={MAX_COUNTDOWN_TITLE_LENGTH}
            placeholder={t("interactiveStickerForm.nameYourCountdown")}
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel={t("interactiveStickerForm.countdownName")}
            autoFocus={!editing}
          />
          <Text style={styles.when} accessibilityLiveRegion="polite">{t("interactiveStickerForm.endsAt", { date: endsAt.toLocaleDateString(localeTag(), { weekday: "short", month: "short", day: "numeric" }), time: endsAt.toLocaleTimeString(localeTag(), { hour: "numeric", minute: "2-digit" }) })}
          </Text>
          {(["day", "hour", "minute"] as const).map((unit) => (
            <View key={unit} style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>{unit === "day" ? t("common.day") : unit === "hour" ? t("common.hour") : t("common.minute")}</Text>
              <Pressable style={styles.stepper} onPress={() => adjust(unit, -1)} accessibilityRole="button" accessibilityLabel={(unit === "minute" ? t("interactiveStickerForm.earlierByOne5Minutes") : t("interactiveStickerForm.earlierByOneUnit", { unit }))}>
                <Icon name="minus" size={16} color={colors.textPrimary} />
              </Pressable>
              <Pressable style={styles.stepper} onPress={() => adjust(unit, 1)} accessibilityRole="button" accessibilityLabel={(unit === "minute" ? t("interactiveStickerForm.laterByOne5Minutes") : t("interactiveStickerForm.laterByOneUnit", { unit }))}>
                <Icon name="add" size={16} color={colors.textPrimary} />
              </Pressable>
            </View>
          ))}
          {endsAt.getTime() <= Date.now() ? <Text style={styles.error}>{t("interactiveStickerForm.pickATimeInThe")}</Text> : null}
        </View>
      ) : null}

      {type === "link" ? (
        <View style={styles.options}>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={(text) => { setUrl(text); setError(null); }}
            placeholder="https://"
            placeholderTextColor={colors.textDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel={t("interactiveStickerForm.webAddress")}
            autoFocus={!editing}
          />
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            maxLength={40}
            placeholder={t("interactiveStickerForm.stickerTextOptional")}
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel={t("interactiveStickerForm.stickerText")}
          />
          <Text style={styles.hint}>{t("interactiveStickerForm.peopleSeeWhereTheLink")}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Pressable
        onPress={() => void submit()}
        disabled={!ready || checking}
        style={[styles.done, (!ready || checking) && styles.doneDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready || checking, busy: checking }}
      >
        {checking ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.doneLabel}>{editing ? t("common.save") : t("common.addToStory")}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs },
  tile: { width: "31%", minHeight: 76, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  tileUsed: { opacity: 0.5 },
  tileLabel: { ...typography.label, color: colors.textPrimary },
  tileLabelUsed: { color: colors.textDisabled },
  form: { gap: spacing.sm, paddingBottom: spacing.md },
  formHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { color: colors.textPrimary, backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  options: { gap: spacing.sm },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  optionInput: { flex: 1 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: colors.success, borderColor: colors.success },
  addOption: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", paddingVertical: spacing.xs },
  addOptionLabel: { color: colors.accentText, fontWeight: "700" },
  hint: { ...typography.caption },
  when: { ...typography.bodyStrong, textAlign: "center" },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepperLabel: { color: colors.textSecondary, width: 60 },
  stepper: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, textAlign: "center" },
  done: { backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  doneDisabled: { opacity: 0.5 },
  doneLabel: { color: colors.onAccent, fontWeight: "700" },
});
