import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, type TextInput } from "react-native";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { Banner, Button, TextField } from "../../components/Form";
import { newPasswordProblem } from "../../utils/passwordRules";
import { birthDateFieldProblem, birthDateProblem, birthDateToIso, formatBirthDateInput } from "../../utils/birthDate";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/types";
import { colors, spacing, typography, FORM_MAX_WIDTH } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { usernameCheckText, usernameRefused, useUsernameAvailability } from "../../hooks/useUsernameAvailability";
import { TermsNotice } from "../../components/TermsNotice";
import { hasTickLikeCharacter, NAME_TICK_ERROR } from "../../api/verification";

type Props = NativeStackScreenProps<AuthStackParamList, "Signup">;

export function SignupScreen({ navigation }: Props): React.JSX.Element {
  const { signup, error, fieldErrors, clearError } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [birth, setBirth] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const insets = useScreenInsets();
  const usernameInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const emailInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const birthInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const passwordInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Checked as they type, so most problems show before a round trip (the server checks again).
  const passwordProblem = password ? newPasswordProblem(password, email, username) : undefined;
  const availability = useUsernameAvailability(username, null);
  const availabilityLine = usernameCheckText(availability);
  // Katkee is for people 18 and older; the server checks again (backend/src/modules/auth/age.ts).
  const birthDate = birthDateToIso(birth);
  const birthProblem = birthDateFieldProblem(birth);
  // A tick in a name would pass for the verified badge.
  const nameProblem = hasTickLikeCharacter(displayName) ? NAME_TICK_ERROR : undefined;
  const complete = !!displayName.trim() && !nameProblem && !!username && !!email && !!birthDate && !birthDateProblem(birthDate) && !!password &&
    !passwordProblem && !usernameRefused(availability);

  const onSubmit = async () => {
    if (!complete || submitting) return;
    setSubmitting(true);
    try {
      await signup({ displayName, username, email, password, birthDate: birthDate! });
    } catch {
      // error/fieldErrors surfaced via useAuth() state below
    } finally {
      setSubmitting(false);
    }
  };

  const change = (set: (v: string) => void) => (t: string) => {
    set(t);
    clearError();
  };

  return (
    <KeyboardAvoider style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[typography.title, styles.title]} accessibilityRole="header">Create your account</Text>
        {error ? <Banner text={error} /> : null}

        <TextField
          label="Display name"
          error={nameProblem ?? fieldErrors?.displayName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => usernameInput.current?.focus()}
          value={displayName}
          onChangeText={change(setDisplayName)}
        />
        <TextField
          ref={usernameInput}
          label="Username"
          error={fieldErrors?.username ?? (availabilityLine?.tone === "error" ? availabilityLine.text : undefined)}
          hint={availabilityLine && availabilityLine.tone !== "error" ? availabilityLine.text : "3–30 characters: lowercase letters, numbers, dots and underscores."}
          hintTone={availabilityLine?.tone === "success" ? "success" : availabilityLine ? "info" : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailInput.current?.focus()}
          value={username}
          onChangeText={change((t) => setUsername(t.toLowerCase()))}
        />
        <TextField
          ref={emailInput}
          label="Email"
          error={fieldErrors?.email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => birthInput.current?.focus()}
          value={email}
          onChangeText={change(setEmail)}
        />
        <TextField
          ref={birthInput}
          label="Date of birth"
          error={fieldErrors?.birthDate ?? birthProblem}
          hint="Day, month, then year (DD/MM/YYYY). It confirms your age and is never shown on your profile."
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          autoComplete="off"
          textContentType="none"
          maxLength={10}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordInput.current?.focus()}
          value={birth}
          onChangeText={change((t) => setBirth(formatBirthDateInput(t)))}
        />
        <TextField
          ref={passwordInput}
          label="Password"
          error={fieldErrors?.password ?? passwordProblem}
          hint="At least 8 characters."
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          value={password}
          onChangeText={change(setPassword)}
        />

        <Button label="Sign up" onPress={() => void onSubmit()} disabled={!complete} busy={submitting} />
        <TermsNotice action="signing up" />

        <Pressable style={styles.linkButton} onPress={() => navigation.navigate("Login")} accessibilityRole="button">
          <Text style={typography.body}>
            Already have an account? <Text style={styles.linkAccent}>Log in</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.sm,
    width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center",
  },
  title: { textAlign: "center", marginBottom: spacing.md },
  linkButton: { marginTop: spacing.lg, alignItems: "center", minHeight: 44, justifyContent: "center" },
  linkAccent: { color: colors.accentText, fontWeight: "600" },
});
