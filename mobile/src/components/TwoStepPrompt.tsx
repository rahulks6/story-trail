import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { Banner, Button } from "./Form";
import { Pressable } from "./Pressable";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { ApiError } from "../api/client";
import { t } from "../i18n";

/**
 * The second step of signing in, when two-step login is on: the 6-digit code from the
 * authenticator app, or one of the backup codes. Shown over the sign-in screen by AuthProvider
 * after any sign-in (password, Google, Apple, phone, password reset) answers with a challenge.
 */
export function TwoStepPrompt(): React.JSX.Element {
  const { verifyTwoStep, cancelTwoStep } = useAuth();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = backup ? code.replace(/[^a-z2-7]/gi, "").length === 10 : /^\d{6}$/.test(code);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTwoStep(code);
    } catch (e) {
      setError(e instanceof ApiError && e.message ? e.message : t("common.checkYourConnectionAndTry"));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={cancelTwoStep}>
      <KeyboardAvoider style={styles.screen}>
        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">{t("twoStep.title")}</Text>
          <Text style={styles.lead}>{backup ? t("twoStep.backupLead") : t("twoStep.lead")}</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(backup ? v.toUpperCase() : v.replace(/\D/g, "").slice(0, 6))}
            keyboardType={backup ? "default" : "number-pad"}
            autoCapitalize="characters"
            autoComplete={backup ? "off" : "one-time-code"}
            textContentType="oneTimeCode"
            autoFocus
            maxLength={backup ? 11 : 6}
            placeholder={backup ? undefined : "123456"}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, !backup && styles.digits]}
            accessibilityLabel={backup ? t("twoStep.backupCode") : t("twoStep.code")}
            onSubmitEditing={() => void submit()}
          />
          {error ? <Banner text={error} /> : null}
          <Button label={t("twoStep.continue")} onPress={() => void submit()} disabled={!ready} busy={busy} />
          <Pressable onPress={() => { setBackup((b) => !b); setCode(""); setError(null); }} accessibilityRole="button" style={styles.link}>
            <Text style={styles.linkLabel}>{backup ? t("twoStep.useApp") : t("twoStep.useBackup")}</Text>
          </Pressable>
          <Pressable onPress={cancelTwoStep} accessibilityRole="button" style={styles.link}>
            <Text style={styles.cancel}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  title: { ...typography.title, textAlign: "center" },
  lead: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  input: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, textAlign: "center", fontSize: 20 },
  digits: { letterSpacing: 8, fontSize: 28, fontWeight: "700" },
  link: { alignSelf: "center", paddingVertical: spacing.xs },
  linkLabel: { ...typography.body, color: colors.accentText, fontWeight: "700" },
  cancel: { ...typography.body, color: colors.textSecondary },
});
