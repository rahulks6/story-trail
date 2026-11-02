import React from "react";
import { Alert, Linking, StyleSheet, Text } from "react-native";
import buildConfig from "../../build-config.json";
import { colors, typography } from "../theme";
import { t } from "../i18n";
import { richText } from "../i18n/rich";

/**
 * What creating an account agrees to (App Review 1.2: apps with user posts need terms with no
 * tolerance for objectionable content or abuse). Terms and Privacy Policy open the live pages
 * set in build-config.json; release builds can't be made without them (scripts/check-release.cjs).
 */
export function TermsNotice({ action }: { action: "signup" | "continue" }): React.JSX.Element {
  const link = (label: string, url: string) =>
    url ? (
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(url).catch(() => Alert.alert(t("common.couldntOpenTheLink"), t("common.tryAgain2")))}
      >
        {label}
      </Text>
    ) : (
      label
    );
  return (
    <Text style={styles.text}>
      {richText(t(action === "signup" ? "termsNotice.bySigningUp" : "termsNotice.byContinuing"), {
        terms: (label) => link(label, buildConfig.termsUrl),
        privacy: (label) => link(label, buildConfig.privacyPolicyUrl),
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { ...typography.caption, color: colors.textSecondary, textAlign: "center", lineHeight: 18 },
  link: { color: colors.accentText, fontWeight: "600" },
});
