import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/types";
import { colors, spacing, typography } from "../../theme";
import { forgotPassword } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Banner, Button, TextField } from "../../components/Form";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Step 1 of password recovery: ask for the account email; the server always answers the same way. */
export function ForgotPasswordScreen({ navigation, route }: Props): React.JSX.Element {
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter the email address you signed up with.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await forgotPassword(trimmed);
      navigation.navigate("ResetPassword", { email: trimmed });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.displayLarge} accessibilityRole="header">
          Reset your password
        </Text>
        <Text style={styles.body}>Enter the email you use for Katkee. We'll send a 6-digit code to set a new password.</Text>
        {error ? <Banner text={error} /> : null}
        <TextField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setError(undefined);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          autoFocus
        />
        <Button label="Send code" onPress={() => void submit()} busy={busy} disabled={!email.trim()} />
        <Button label="I already have a code" variant="secondary" onPress={() => navigation.navigate("ResetPassword", { email: email.trim().toLowerCase() })} />
        <Text style={styles.note}>Signed up with Google or your phone number? Go back and use that option instead — no password is needed.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  body: { ...typography.body, color: colors.textSecondary },
  note: { ...typography.caption, textAlign: "center", marginTop: spacing.sm },
});
