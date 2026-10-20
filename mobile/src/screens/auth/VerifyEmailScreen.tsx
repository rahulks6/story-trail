import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../../navigation/types";
import { colors, spacing, typography, FORM_MAX_WIDTH } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { changeEmail, sendEmailCode, verifyEmail } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Banner, Button, TextField } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { tapFeedback } from "../../utils/haptics";

type Props = NativeStackScreenProps<RootStackParamList, "VerifyEmail">;

/** Seconds before "Send a new code" can be tapped again. */
const RESEND_SECONDS = 30;

/**
 * "Verify your email": the 6-digit code emailed at sign-up (or on request) confirms the account's
 * email address. A new account sees only this screen until the code is entered (RootNavigator),
 * with a way to fix a mistyped email or log out. Older accounts open it from the Profile banner,
 * and "Later" carries on into the app.
 */
export function VerifyEmailScreen({ navigation }: Props): React.JSX.Element {
  const { user, accessToken, applyProfile, logout } = useAuth();
  const required = !!user?.emailVerificationRequired;
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const sending = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace("Main", { screen: "Home" } as never);
  };

  const submit = async () => {
    if (!accessToken || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await verifyEmail(code, accessToken);
      applyProfile(updated);
      tapFeedback("success");
      // A required verification lifts the gate: the navigator swaps this screen for the app.
      if (!required) leave();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check the code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!accessToken || sending.current || cooldown > 0) return;
    sending.current = true;
    setError(null);
    setNotice(null);
    try {
      await sendEmailCode(accessToken);
      setCode("");
      setNotice(`We sent a new code to ${user?.email ?? "your email"}.`);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send a code. Check your connection and try again.");
    } finally {
      sending.current = false;
    }
  };

  const saveEmail = async () => {
    if (!accessToken || busy) return;
    const email = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { user: updated } = await changeEmail(email, accessToken);
      applyProfile(updated);
      setEditingEmail(false);
      setCode("");
      setNotice(`We sent a new code to ${updated.email ?? email}.`);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change your email. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (editingEmail) {
    return (
      <KeyboardAvoider style={styles.root}>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <Text style={typography.displayLarge} accessibilityRole="header">Change your email</Text>
          <Text style={styles.body}>We'll send a new code to this address.</Text>
          {error ? <Banner text={error} /> : null}
          <TextField
            label="Email"
            value={newEmail}
            onChangeText={setNewEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void saveEmail()}
          />
          <Button label="Send code" onPress={() => void saveEmail()} busy={busy} disabled={!newEmail.trim()} />
          <Button label="Cancel" onPress={() => { setEditingEmail(false); setError(null); }} variant="secondary" />
        </ScrollView>
      </KeyboardAvoider>
    );
  }

  return (
    <KeyboardAvoider style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={typography.displayLarge} accessibilityRole="header">Verify your email</Text>
        <Text style={styles.body}>
          We sent a 6-digit code to <Text style={styles.email}>{user?.email ?? "your email"}</Text>. {required ? "Enter it to finish creating your account." : "It keeps your account secure and lets you reset your password if you ever forget it."}
        </Text>
        {error ? <Banner text={error} /> : notice ? <Banner text={notice} tone="success" /> : null}
        <TextField
          label="6-digit code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <Button label="Verify" onPress={() => void submit()} busy={busy} disabled={code.length !== 6} />
        <View style={styles.row}>
          <Button
            label={cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"}
            onPress={() => void resend()}
            disabled={cooldown > 0}
            variant="secondary"
          />
        </View>
        <Text style={styles.hint}>Can't find it? Check your spam or promotions folder.</Text>
        {required ? (
          <>
            <Button label="Wrong email? Change it" onPress={() => { setNewEmail(user?.email ?? ""); setError(null); setNotice(null); setEditingEmail(true); }} variant="secondary" />
            <Button label="Log out" onPress={() => void logout()} variant="secondary" />
          </>
        ) : (
          <Button label="Later" onPress={leave} variant="secondary" accessibilityHint="Verify from your profile any time" />
        )}
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.md, width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" },
  body: { ...typography.body, color: colors.textSecondary },
  email: { color: colors.textPrimary, fontWeight: "700" },
  row: { gap: spacing.sm },
  hint: { ...typography.caption, textAlign: "center" },
});
