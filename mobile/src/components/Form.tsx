import React, { forwardRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, radii, spacing, typography } from "../theme";

interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string | undefined;
  /** Optional helper text under the field (hidden while an error is shown). */
  hint?: string;
  /** A hint that reports a live result (e.g. "Available."): announced, and green for success. */
  hintTone?: "info" | "success";
}

/**
 * Labelled input with an inline error and, for passwords, a show/hide toggle.
 * Errors are announced to screen readers via the field's accessibility label.
 */
export const TextField = forwardRef<React.ComponentRef<typeof TextInput>, TextFieldProps>(function TextField({ label, error, hint, hintTone, secureTextEntry, ...input }, ref) {
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, error ? styles.inputRowError : null]}>
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={colors.textDisabled}
          secureTextEntry={secureTextEntry && !revealed}
          accessibilityLabel={error ? `${label}. ${error}` : label}
          {...input}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={12}
            style={styles.reveal}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            <Text style={styles.revealText}>{revealed ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, hintTone === "success" && styles.hintSuccess]} accessibilityLiveRegion={hintTone ? "polite" : undefined}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary" | "destructive";
  accessibilityHint?: string;
}

/** 48 dp minimum touch target; shows a spinner (and stays labelled for screen readers) while busy. */
export function Button({ label, onPress, disabled, busy, variant = "primary", accessibilityHint }: ButtonProps): React.JSX.Element {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.primary : styles.secondary,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? colors.onAccent : colors.textPrimary} />
      ) : (
        <Text style={[styles.buttonLabel, variant === "primary" ? styles.primaryLabel : variant === "destructive" ? styles.destructiveLabel : styles.secondaryLabel]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Dismissable error/success banner for screen-level outcomes. */
export function Banner({ text, tone = "error" }: { text: string; tone?: "error" | "success" | "info" }): React.JSX.Element {
  return (
    <Text accessibilityRole={tone === "error" ? "alert" : "text"} style={[styles.banner, tone === "error" ? styles.bannerError : tone === "success" ? styles.bannerSuccess : styles.bannerInfo]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textPrimary },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  inputRowError: { borderColor: colors.danger },
  input: { flex: 1, color: colors.textPrimary, fontSize: 16, paddingVertical: spacing.sm },
  reveal: { paddingLeft: spacing.sm, minHeight: 44, justifyContent: "center" },
  revealText: { color: colors.accent, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
  hint: { ...typography.caption },
  hintSuccess: { color: colors.success },
  button: { minHeight: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  buttonLabel: { fontSize: 16, fontWeight: "700" },
  primaryLabel: { color: colors.onAccent },
  secondaryLabel: { color: colors.textPrimary },
  destructiveLabel: { color: colors.danger },
  banner: { borderRadius: radii.sm, padding: spacing.sm + 2, fontSize: 14, overflow: "hidden" },
  bannerError: { backgroundColor: "rgba(237,82,70,0.14)", color: colors.danger },
  bannerSuccess: { backgroundColor: "rgba(63,191,127,0.14)", color: colors.success },
  bannerInfo: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary },
});
