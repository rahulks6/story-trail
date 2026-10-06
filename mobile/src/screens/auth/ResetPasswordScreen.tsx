import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, type TextInput } from "react-native";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/types";
import { colors, spacing, typography } from "../../theme";
import { forgotPassword } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "../../state/AuthContext";
import { Banner, Button, TextField } from "../../components/Form";
import { newPasswordProblem } from "../../utils/passwordRules";

type Props = NativeStackScreenProps<AuthStackParamList, "ResetPassword">;

const RESEND_SECONDS = 60;

/**
 * Step 2 of password recovery: the emailed code plus a new password. Opened from the
 * email's katkee://reset-password link with both fields prefilled, or typed by hand.
 * Success signs this device in; every other device is signed out by the server.
 */
export function ResetPasswordScreen({ navigation, route }: Props): React.JSX.Element {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [code, setCode] = useState((route.params?.code ?? "").replace(/\D/g, "").slice(0, 6));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ text: string; tone: "error" | "success" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(route.params?.code ? 0 : RESEND_SECONDS);
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = "Enter the email address you signed up with.";
    if (!/^\d{6}$/.test(code)) next.code = "Enter the 6-digit code from the email.";
    const problem = newPasswordProblem(password, email.trim());
    if (problem) next.password = problem;
    else if (confirm !== password) next.confirm = "The passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setBanner(null);
    try {
      await resetPassword(email.trim().toLowerCase(), code, password);
      // Signed in: the root navigator switches to the app.
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) {
        setErrors({ ...(e.fieldErrors.code ? { code: e.fieldErrors.code } : {}), ...(e.fieldErrors.newPassword ? { password: e.fieldErrors.newPassword } : {}), ...(e.fieldErrors.email ? { email: e.fieldErrors.email } : {}) });
      } else {
        setBanner({ text: e instanceof ApiError ? e.message : "Couldn't reset your password. Check your connection and try again.", tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email.trim()) return navigation.navigate("ForgotPassword", { email });
    setResendIn(RESEND_SECONDS);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setBanner({ text: "If an account uses that email, a new code is on its way. Only the newest code works.", tone: "success" });
      setCode("");
    } catch (e) {
      setBanner({ text: e instanceof ApiError ? e.message : "Couldn't send a new code. Try again shortly.", tone: "error" });
    }
  };

  return (
    <KeyboardAvoider style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={typography.displayLarge} accessibilityRole="header">
          Enter your code
        </Text>
        <Text style={styles.body}>We emailed a 6-digit code{email ? ` to ${email}` : ""}. It expires in 15 minutes.</Text>
        {banner ? <Banner text={banner.text} tone={banner.tone} /> : null}
        {!route.params?.email ? (
          <TextField label="Email" value={email} onChangeText={setEmail} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        ) : null}
        <TextField
          label="6-digit code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          error={errors.code}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          autoFocus={!route.params?.code}
        />
        <TextField
          ref={passwordRef}
          label="New password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          hint="At least 8 characters. Avoid passwords you use elsewhere."
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          autoFocus={!!route.params?.code}
        />
        <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} error={errors.confirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={() => void submit()} />
        <Button label="Set new password" onPress={() => void submit()} busy={busy} disabled={!code || !password} />
        <Button
          label={resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
          variant="secondary"
          onPress={() => void resend()}
          disabled={resendIn > 0}
        />
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  body: { ...typography.body, color: colors.textSecondary },
});
