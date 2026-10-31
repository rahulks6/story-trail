import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { Icon } from "./Icon";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { checkStickerLink } from "../api/stickers";
import { ApiError } from "../api/client";
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

/** The six interactive stickers, in the order Instagram's tray puts them. */
const KINDS: Array<{ type: InteractiveType; label: string; icon: "check" | "help" | "comment" | "timer" | "attach" | "add"; hint: string }> = [
  { type: "poll", label: "Poll", icon: "check", hint: "Ask a question with 2 to 4 choices" },
  { type: "quiz", label: "Quiz", icon: "help", hint: "A question with one right answer" },
  { type: "question", label: "Questions", icon: "comment", hint: "Let people send you answers privately" },
  { type: "countdown", label: "Countdown", icon: "timer", hint: "Count down to a moment; people can get a reminder" },
  { type: "link", label: "Link", icon: "attach", hint: "A link people can open" },
  { type: "addYours", label: "Add Yours", icon: "add", hint: "Start a prompt others post their own Stories to" },
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
  const [endsAt, setEndsAt] = useState<Date>(() => (typeof p?.endsAt === "string" && Date.parse(p.endsAt) > Date.now() ? new Date(p.endsAt) : inOneDay()));
  const [url, setUrl] = useState<string>(typeof p?.url === "string" ? p.url : "");
  const [label, setLabel] = useState<string>(typeof p?.label === "string" ? p.label : "");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: InteractiveType) => {
    setType(next);
    setError(null);
    if (next === "question" && !question) setQuestion("Ask me anything");
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
          setError(e instanceof ApiError ? e.message : "Couldn't check that link. Check your connection and try again.");
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
              accessibilityLabel={`${k.label}. ${used ? "Already on this Story" : k.hint}`}
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
          <Pressable onPress={() => setType(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to stickers">
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
          placeholder={type === "poll" ? "Ask a question (optional)" : type === "addYours" ? "Your prompt, like \"Show your view\"" : type === "quiz" ? "Ask a question" : "Ask me anything"}
          placeholderTextColor={colors.textDisabled}
          accessibilityLabel={type === "addYours" ? "Prompt" : "Question"}
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
                  accessibilityLabel={`Mark option ${i + 1} as the right answer`}
                >
                  {correct === i ? <Icon name="check" size={14} color={colors.onAccent} /> : null}
                </Pressable>
              ) : null}
              <TextInput
                style={[styles.input, styles.optionInput]}
                value={option}
                onChangeText={(text) => setOptions((all) => all.map((o, j) => (j === i ? text : o)))}
                maxLength={MAX_OPTION_LENGTH}
                placeholder={`Option ${i + 1}`}
                placeholderTextColor={colors.textDisabled}
                accessibilityLabel={`Option ${i + 1}`}
              />
              {options.length > MIN_OPTIONS ? (
                <Pressable
                  onPress={() => {
                    setOptions((all) => all.filter((_, j) => j !== i));
                    setCorrect((c) => (c === i ? 0 : c > i ? c - 1 : c));
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove option ${i + 1}`}
                >
                  <Icon name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {options.length < MAX_OPTIONS ? (
            <Pressable onPress={() => setOptions((all) => [...all, ""])} style={styles.addOption} accessibilityRole="button">
              <Icon name="add" size={16} color={colors.accentText} />
              <Text style={styles.addOptionLabel}>Add option</Text>
            </Pressable>
          ) : null}
          {type === "quiz" ? <Text style={styles.hint}>Tap the circle beside the right answer.</Text> : null}
        </View>
      ) : null}

      {type === "countdown" ? (
        <View style={styles.options}>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            maxLength={MAX_COUNTDOWN_TITLE_LENGTH}
            placeholder="Name your countdown"
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel="Countdown name"
            autoFocus={!editing}
          />
          <Text style={styles.when} accessibilityLiveRegion="polite">
            Ends {endsAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at {endsAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </Text>
          {(["day", "hour", "minute"] as const).map((unit) => (
            <View key={unit} style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>{unit === "day" ? "Day" : unit === "hour" ? "Hour" : "Minute"}</Text>
              <Pressable style={styles.stepper} onPress={() => adjust(unit, -1)} accessibilityRole="button" accessibilityLabel={`Earlier by one ${unit === "minute" ? "5 minutes" : unit}`}>
                <Icon name="minus" size={16} color={colors.textPrimary} />
              </Pressable>
              <Pressable style={styles.stepper} onPress={() => adjust(unit, 1)} accessibilityRole="button" accessibilityLabel={`Later by one ${unit === "minute" ? "5 minutes" : unit}`}>
                <Icon name="add" size={16} color={colors.textPrimary} />
              </Pressable>
            </View>
          ))}
          {endsAt.getTime() <= Date.now() ? <Text style={styles.error}>Pick a time in the future.</Text> : null}
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
            accessibilityLabel="Web address"
            autoFocus={!editing}
          />
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            maxLength={40}
            placeholder="Sticker text (optional)"
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel="Sticker text"
          />
          <Text style={styles.hint}>People see where the link goes before it opens.</Text>
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
        {checking ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.doneLabel}>{editing ? "Save" : "Add to Story"}</Text>}
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
