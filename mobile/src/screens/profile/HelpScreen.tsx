import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import buildConfig from "../../../build-config.json";
import { ListRow } from "../../components/ListRow";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { openPublicPage } from "./AboutScreen";
import { t } from "../../i18n";

const FAQS: Array<{ question: string; answer: string }> = [
  {
    get question() { return t("help.whoCanSeeMyStories"); },
    get answer() { return t("help.publicAccountsAnyonePrivateAccounts"); },
  },
  {
    get question() { return t("help.howLongDoesAStory"); },
    get answer() { return t("help.n24HoursFromWhenYou"); },
  },
  {
    get question() { return t("help.howDoIAddA"); },
    get answer() { return t("help.openYourStoryAndTap"); },
  },
  {
    get question() { return t("help.howDoIStopGetting"); },
    get answer() { return t("help.settingsNotificationsLetsYouTurn"); },
  },
  {
    get question() { return t("help.canIGetMyAccount"); },
    get answer() { return t("help.noAccountDeletionInSettings"); },
  },
];

/**
 * The common questions, then the Help Center on the website (build-config.json supportUrl), which
 * answers more and gives the real support, privacy and grievance addresses.
 */
export function HelpScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <ListRow label={t("common.sendFeedback")} icon={ICONS.dm} onPress={() => navigation.navigate("Feedback")} />
      </View>
      {FAQS.map((faq) => (
        <View key={faq.question} style={styles.item}>
          <Text style={[typography.bodyStrong, styles.question]}>{faq.question}</Text>
          <Text style={[typography.body, styles.answer]}>{faq.answer}</Text>
        </View>
      ))}
      {buildConfig.supportUrl ? (
        <View style={styles.more}>
          <Text style={[typography.bodyStrong, styles.question]}>{t("help.needMoreHelp")}</Text>
          <Text style={[typography.body, styles.answer]}>{t("help.theHelpCenterHasMore")}</Text>
          <View style={styles.card}>
            <ListRow label={t("help.helpCenter")} onPress={() => openPublicPage(buildConfig.supportUrl)} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg },
  item: { gap: spacing.xs },
  question: {},
  answer: { color: colors.textSecondary },
  more: { gap: spacing.xs, marginTop: spacing.md },
  card: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
});
