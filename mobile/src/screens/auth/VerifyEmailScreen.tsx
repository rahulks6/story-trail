import React, { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { t } from "../../i18n";
import { richText } from "../../i18n/rich";

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
  const { user, accessToken, applyProfile, logout, refreshUser } = useAuth();
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

  // Coming back to the app (say, after verifying on another phone) checks again, so the screen
  // goes away by itself once the account is verified.
  useEffect(() => {
    if (!required) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshUser();
    });
    return () => subscription.remove();
  }, [required, refreshUser]);

  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace("Main", { screen: "Home" } as never);
  };

  const submit = async () => {
    if (!accessToken || busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError(t("verifyEmail.enterThe6DigitCode"));
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
      setError(err instanceof ApiError ? err.message : t("verifyEmail.couldntCheckTheCodeCheck"));
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
      setNotice((user?.email != null ? t("verifyEmail.weSentANewCode", { email: user?.email }) : t("verifyEmail.weSentANewCode2")));
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("verifyEmail.couldntSendACodeCheck"));
    } finally {
      sending.current = false;
    }
  };

  const saveEmail = async () => {
    if (!accessToken || busy) return;
    const email = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError(t("verifyEmail.enterAValidEmailAddress"));
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
      setNotice(t("verifyEmail.weSentANewCode", { email: updated.email ?? email }));
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("verifyEmail.couldntChangeYourEmailCheck"));
    } finally {
      setBusy(false);
    }
  };

  if (editingEmail) {
    return (
      <KeyboardAvoider style={styles.root}>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={typography.displayLarge} accessibilityRole="header">{t("verifyEmail.changeYourEmail")}</Text>
          <Text style={styles.body}>{t("verifyEmail.wellSendANewCode")}</Text>
          {error ? <Banner text={error} /> : null}
          <TextField
            label={t("common.email")}
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
          <Button label={t("common.sendCode")} onPress={() => void saveEmail()} busy={busy} disabled={!newEmail.trim()} />
          <Button label={t("common.cancel")} onPress={() => { setEditingEmail(false); setError(null); }} variant="text" />
        </ScrollView>
      </KeyboardAvoider>
    );
  }

  return (
    <KeyboardAvoider style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={typography.displayLarge} accessibilityRole="header">{t("common.verifyYourEmail")}</Text>
        <Text style={styles.body}>{richText(t("verifyEmail.weSentACodeTo", { email: user?.email ?? t("verifyEmail.yourEmail") }), { email: (email) => <Text style={styles.email}>{email}</Text> })}{" "}{required ? t("verifyEmail.enterItToFinishCreating") : t("verifyEmail.itKeepsYourAccountSecure")}
        </Text>
        {error ? <Banner text={error} /> : notice ? <Banner text={notice} tone="success" /> : null}
        <TextField
          label={t("common.n6DigitCode")}
          value={code}
          onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <Button label={t("common.verify")} onPress={() => void submit()} busy={busy} disabled={code.length !== 6} />
        {/* One clear action; everything else is a quiet link under it. */}
        <Text style={styles.hint}>{t("verifyEmail.cantFindItCheckYour")}</Text>
        <View style={styles.links}>
          <Button
            label={cooldown > 0 ? t("verifyEmail.sendANewCodeIn", { cooldown }) : t("common.sendANewCode")}
            onPress={() => void resend()}
            disabled={cooldown > 0}
            variant="text"
          />
          {required ? (
            <Button label={t("verifyEmail.changeEmail")} onPress={() => { setNewEmail(user?.email ?? ""); setError(null); setNotice(null); setEditingEmail(true); }} variant="text" />
          ) : null}
        </View>
        <View style={styles.footer}>
          {required ? (
            <Button label={t("common.logOut")} onPress={() => void logout()} variant="text" />
          ) : (
            <Button label={t("verifyEmail.later")} onPress={leave} variant="text" accessibilityHint={t("verifyEmail.verifyFromYourProfileAny")} />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.md, width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" },
  body: { ...typography.body, color: colors.textSecondary },
  email: { color: colors.textPrimary, fontWeight: "700" },
  links: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: spacing.md },
  footer: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  hint: { ...typography.caption, textAlign: "center" },
});
