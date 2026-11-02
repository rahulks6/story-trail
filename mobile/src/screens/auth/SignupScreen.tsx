import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, type TextInput } from "react-native";
import { Pressable } from "../../components/Pressable";
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
import { hasTickLikeCharacter, nameTickError } from "../../api/verification";
import { usePendingInviter } from "../../state/invites";
import { t } from "../../i18n";

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
  // Opened a friend's invite link first: say whose, so the sign-up feels like theirs.
  const inviter = usePendingInviter();
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
  const nameProblem = hasTickLikeCharacter(displayName) ? nameTickError() : undefined;
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

  const change = (set: (v: string) => void) => (text: string) => {
    set(text);
    clearError();
  };

  return (
    <KeyboardAvoider style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[typography.title, styles.title]} accessibilityRole="header">{t("common.createYourAccount")}</Text>
        {inviter ? <Banner tone="info" text={t("signup.displaynameUsernameInvitedYouTo", { displayName: inviter.displayName, username: inviter.username })} /> : null}
        {error ? <Banner text={error} /> : null}

        <TextField
          label={t("common.displayName")}
          error={nameProblem ?? fieldErrors?.displayName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          maxLength={60}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => usernameInput.current?.focus()}
          value={displayName}
          onChangeText={change(setDisplayName)}
        />
        <TextField
          ref={usernameInput}
          label={t("common.username")}
          error={fieldErrors?.username ?? (availabilityLine?.tone === "error" ? availabilityLine.text : undefined)}
          hint={availabilityLine && availabilityLine.tone !== "error" ? availabilityLine.text : t("signup.n330CharactersLowercaseLetters")}
          hintTone={availabilityLine?.tone === "success" ? "success" : availabilityLine ? "info" : undefined}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          maxLength={30}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailInput.current?.focus()}
          value={username}
          onChangeText={change((text) => setUsername(text.toLowerCase()))}
        />
        <TextField
          ref={emailInput}
          label={t("common.email")}
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
          label={t("signup.dateOfBirth")}
          error={fieldErrors?.birthDate ?? birthProblem}
          hint={t("signup.dayMonthThenYearDd")}
          placeholder={t("signup.ddMmYyyy")}
          keyboardType="number-pad"
          autoComplete="off"
          textContentType="none"
          maxLength={10}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordInput.current?.focus()}
          value={birth}
          onChangeText={change((text) => setBirth(formatBirthDateInput(text)))}
        />
        <TextField
          ref={passwordInput}
          label={t("common.password")}
          error={fieldErrors?.password ?? passwordProblem}
          hint={t("common.atLeast8Characters")}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          value={password}
          onChangeText={change(setPassword)}
        />

        <Button label={t("common.signUp")} onPress={() => void onSubmit()} disabled={!complete} busy={submitting} />
        <TermsNotice action="signup" />

        <Pressable style={styles.linkButton} onPress={() => navigation.navigate("Login")} accessibilityRole="button">
          <Text style={typography.body}>{t("signup.alreadyHaveAnAccount")}{" "}<Text style={styles.linkAccent}>{t("common.logIn")}</Text>
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
