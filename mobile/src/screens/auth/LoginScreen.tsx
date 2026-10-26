import {ProviderEntry} from "./ProviderEntry";
import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type TextInput } from "react-native";
import { Pressable } from "../../components/Pressable";
import { BrandMark } from "../../components/BrandMark";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { Banner, Button, TextField } from "../../components/Form";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/types";
import { colors, spacing, FORM_MAX_WIDTH } from "../../theme";
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
    <KeyboardAvoider style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Simple, like Instagram: the logo, two fields, Log in; everything else is small, below. */}
        <View style={styles.top}>
          <View style={styles.mark}>
            <BrandMark height={56} />
          </View>
          {/* Mixed-case wordmark, "Kat" off-white + "kee" amber — matches the brand logo (see ../../../BRAND.md). */}
          <Text style={styles.brand} accessibilityRole="header">
            <Text style={styles.brandKat}>Kat</Text>
            <Text style={styles.brandKee}>kee</Text>
          </Text>
          <Text style={styles.subtitle}>Story that connects.</Text>

          {error ? <Banner text={error} /> : null}

          <TextField
            label="Email"
            placeholder="you@example.com"
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
            placeholder="Your password"
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

          <View style={styles.loginButton}>
            <Button label="Log in" onPress={() => void onSubmit()} disabled={!email || !password} busy={submitting} />
          </View>
          <Pressable
            style={styles.forgot}
            onPress={() => navigation.navigate("ForgotPassword", email ? { email } : undefined)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          <ProviderEntry />
        </View>

        <View style={styles.bottom}>
          <Pressable style={styles.signup} onPress={() => navigation.navigate("Signup")} accessibilityRole="button">
            <Text style={styles.signupText}>
              Don't have an account? <Text style={styles.linkAccent}>Sign up</Text>
            </Text>
          </Pressable>
          <Pressable style={styles.appeal} onPress={() => navigation.navigate("Appeals")} accessibilityRole="button" hitSlop={6}>
            <Text style={styles.appealText}>Account restricted? Request a review</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "space-between", paddingHorizontal: spacing.xl, backgroundColor: colors.background, width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" },
  top: { flexGrow: 1, justifyContent: "center", gap: spacing.md },
  mark: { alignItems: "center" },
  // The system's own font at ordinary weights: easy to read, nothing decorative.
  brand: { textAlign: "center", fontSize: 30, fontWeight: "700", marginTop: -spacing.xs },
  brandKat: { color: colors.textPrimary },
  brandKee: { color: colors.accentText },
  subtitle: { textAlign: "center", color: colors.textSecondary, fontSize: 15, fontWeight: "400", marginBottom: spacing.sm },
  loginButton: { marginTop: spacing.xs },
  forgot: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
  forgotText: { color: colors.textPrimary, fontSize: 14, fontWeight: "500" },
  bottom: { alignItems: "center", gap: spacing.xs, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  signup: { minHeight: 44, justifyContent: "center" },
  signupText: { color: colors.textPrimary, fontSize: 15, fontWeight: "400" },
  appeal: { minHeight: 36, justifyContent: "center" },
  appealText: { color: colors.textSecondary, fontSize: 12, fontWeight: "400" },
  linkAccent: { color: colors.accentText, fontWeight: "600" },
});
