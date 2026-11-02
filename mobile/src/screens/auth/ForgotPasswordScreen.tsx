import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "../../navigation/types";
import { colors, spacing, typography, FORM_MAX_WIDTH } from "../../theme";
import { forgotPassword } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Banner, Button, TextField } from "../../components/Form";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Step 1 of password recovery: ask for the account email; the server always answers the same way. */
export function ForgotPasswordScreen({ navigation, route }: Props): React.JSX.Element {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t("forgotPassword.enterTheEmailAddressYou"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await forgotPassword(trimmed);
      navigation.navigate("ResetPassword", { email: trimmed });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("forgotPassword.couldntSendTheCodeCheck"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoider style={styles.root}>
      {/* The header is see-through: keep the content clear of it and of the bottom inset. */}
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: headerHeight + spacing.md, paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={typography.displayLarge} accessibilityRole="header">{t("forgotPassword.resetYourPassword")}</Text>
        <Text style={styles.body}>{t("forgotPassword.enterTheEmailYouUse")}</Text>
        {error ? <Banner text={error} /> : null}
        <TextField
          label={t("common.email")}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
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
        <Button label={t("common.sendCode")} onPress={() => void submit()} busy={busy} disabled={!email.trim()} />
        <Button label={t("forgotPassword.iAlreadyHaveACode")} variant="secondary" onPress={() => navigation.navigate("ResetPassword", { email: email.trim().toLowerCase() })} />
        <Text style={styles.note}>{t("forgotPassword.signedUpWithGoogleOr")}</Text>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md, width: "100%", maxWidth: FORM_MAX_WIDTH, alignSelf: "center" },
  body: { ...typography.body, color: colors.textSecondary },
  note: { ...typography.caption, textAlign: "center", marginTop: spacing.sm },
});
