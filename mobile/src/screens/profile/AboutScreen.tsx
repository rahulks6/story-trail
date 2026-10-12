import React from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import buildConfig from "../../../build-config.json";
import { BrandMark } from "../../components/BrandMark";
import { ListRow } from "../../components/ListRow";
import { appEnv } from "../../config/env";
import { colors, radii, spacing, typography } from "../../theme";

/** The public pages the stores also link to (build-config.json; published at katkee.com). */
const LINKS = [
  ["Privacy Policy", buildConfig.privacyPolicyUrl],
  ["Terms of Service", buildConfig.termsUrl],
  ["Help Center", buildConfig.supportUrl],
] as const;

export function openPublicPage(url: string): void {
  void Linking.openURL(url).catch(() => Alert.alert("Could not open link", "Please try again."));
}

/** The app's identity: the mark, its name and release version (build-config.json), and its public pages. */
export function AboutScreen(): React.JSX.Element {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <BrandMark height={72} />
        <Text style={[typography.title, styles.name]} accessibilityRole="header">Katkee</Text>
        <Text style={styles.version}>Version {appEnv.appVersion}</Text>
        <Text style={[typography.body, styles.tagline]}>Story that connects.</Text>
      </View>
      <View style={styles.card}>
        {LINKS.filter(([, url]) => !!url).map(([label, url]) => (
          <ListRow key={label} label={label} onPress={() => openPublicPage(url)} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  header: { alignItems: "center", paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xs },
  name: { marginTop: spacing.md },
  version: { ...typography.caption, color: colors.textSecondary },
  tagline: { marginTop: spacing.sm, textAlign: "center", color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
});
