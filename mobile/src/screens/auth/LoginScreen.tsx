import {ProviderEntry} from "./ProviderEntry";
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, type TextInput } from "react-native";
import { Banner, Button, TextField } from "../../components/Form";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/types";
import { colors, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useScreenInsets } from "../../hooks/useScreenInsets";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props): React.JSX.Element {
  const { login, error, fieldErrors, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const insets = useScreenInsets();
  const passwordInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const canSubmit = !submitting && !!email && !!password;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await login({ email, password });
    } catch {
      // error/fieldErrors surfaced via useAuth() state below
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Scrolls, and moves above the keyboard on iOS, so the fields and Log in stay reachable.
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Mixed-case wordmark, "Kat" off-white + "kee" amber — matches the brand logo (see ../../../BRAND.md). */}
        <Text style={[typography.displayLarge, styles.brand]} accessibilityRole="header">
          <Text style={styles.brandKat}>Kat</Text>
          <Text style={styles.brandKee}>kee</Text>
        </Text>
        <Text style={[typography.body, styles.subtitle]}>Story that connects.</Text>

        <ProviderEntry />
        <Pressable style={styles.linkButton} onPress={() => navigation.navigate("Appeals")} accessibilityRole="button">
          <Text style={typography.body}>Account restricted? Request a review</Text>
        </Pressable>

        {error ? <Banner text={error} /> : null}

        <TextField
          label="Email"
          error={fieldErrors?.email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="username"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordInput.current?.focus()}
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            clearError();
          }}
        />
        <TextField
          ref={passwordInput}
          label="Password"
          error={fieldErrors?.password}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            clearError();
          }}
        />
        <Pressable
          style={styles.forgot}
          onPress={() => navigation.navigate("ForgotPassword", email ? { email } : undefined)}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.linkAccent}>Forgot password?</Text>
        </Pressable>

        <Button label="Log in" onPress={() => void onSubmit()} disabled={!email || !password} busy={submitting} />

        <Pressable style={styles.linkButton} onPress={() => navigation.navigate("Signup")} accessibilityRole="button">
          <Text style={typography.body}>
            New to Katkee? <Text style={styles.linkAccent}>Create an account</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
  },
  brand: { textAlign: "center", letterSpacing: 1 },
  brandKat: { color: colors.textPrimary },
  brandKee: { color: colors.accent },
  subtitle: { textAlign: "center", color: colors.textSecondary, marginBottom: spacing.lg },
  linkButton: { marginTop: spacing.lg, alignItems: "center", minHeight: 44, justifyContent: "center" },
  forgot: { alignSelf: "flex-end", minHeight: 44, justifyContent: "center" },
  linkAccent: { color: colors.accent, fontWeight: "600" },
});
