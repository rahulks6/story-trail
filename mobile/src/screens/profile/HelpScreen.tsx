import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import buildConfig from "../../../build-config.json";
import { ListRow } from "../../components/ListRow";
import { colors, radii, spacing, typography } from "../../theme";
import { openPublicPage } from "./AboutScreen";

const FAQS: Array<{ question: string; answer: string }> = [
  {
    question: "Who can see my Stories?",
    answer:
      "Public accounts: anyone. Private accounts: only followers you've approved. You can change this any time in Settings > Privacy.",
  },
  {
    question: "How long does a Story last?",
    answer: "24 hours from when you publish it, unless you add it to a Highlight — Highlights never expire.",
  },
  {
    question: "How do I add a Story to a Highlight, or delete a Highlight?",
    answer:
      "Open your Story and tap Highlight to add it to one of your Highlights or start a new one; older Stories are in Profile > Archive. To edit or delete a Highlight, press and hold it on your profile, or open it and tap the options button at the top.",
  },
  {
    question: "How do I stop getting a certain kind of notification?",
    answer: "Settings > Notifications lets you turn off messages, likes, comments, follows, or mentions independently.",
  },
  {
    question: "Can I get my account back after deleting it?",
    answer: "No — account deletion in Settings is permanent and can't be undone.",
  },
];

/**
 * The common questions, then the Help Center on the website (build-config.json supportUrl), which
 * answers more and gives the real support, privacy and grievance addresses.
 */
export function HelpScreen(): React.JSX.Element {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {FAQS.map((faq) => (
        <View key={faq.question} style={styles.item}>
          <Text style={[typography.bodyStrong, styles.question]}>{faq.question}</Text>
          <Text style={[typography.body, styles.answer]}>{faq.answer}</Text>
        </View>
      ))}
      {buildConfig.supportUrl ? (
        <View style={styles.more}>
          <Text style={[typography.bodyStrong, styles.question]}>Need more help?</Text>
          <Text style={[typography.body, styles.answer]}>The Help Center has more answers, and how to contact us.</Text>
          <View style={styles.card}>
            <ListRow label="Help Center" onPress={() => openPublicPage(buildConfig.supportUrl)} />
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
