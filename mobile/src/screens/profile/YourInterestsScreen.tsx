import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { RootStackParamList } from "../../navigation/types";
import { Pressable } from "../../components/Pressable";
import { Icon } from "../../components/Icon";
import { LoadFailed } from "../../components/LoadFailed";
import { showToast } from "../../components/Toast";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getMyInterests, removeLearnedInterest, type MyInterests } from "../../api/interests";
import { t } from "../../i18n";
import { topicLabel } from "../../i18n/names";

type Props = NativeStackScreenProps<RootStackParamList, "YourInterests">;

const STRENGTH_LABELS = { get high() { return t("yourInterests.strong"); }, get medium() { return t("yourInterests.some"); } } as const;

/**
 * Settings > Your interests: what Home orders your Stories by. The topics Katkee has learned you
 * like from what you watch (only you can see them; removing one keeps it out for 30 days), and
 * the interests you chose, which you change in Edit profile.
 */
export function YourInterestsScreen({ navigation }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [interests, setInterests] = useState<MyInterests | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoadFailed(false);
    try {
      setInterests(await getMyInterests(accessToken));
    } catch {
      setLoadFailed(true);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRemove = async (topic: string) => {
    if (!accessToken || removing) return;
    setRemoving(topic);
    try {
      await removeLearnedInterest(topic, accessToken);
      setInterests((current) => (current ? { ...current, learned: current.learned.filter((l) => l.topic !== topic) } : current));
      showToast(t("yourInterests.removedTopic", { topic }));
    } catch {
      Alert.alert(t("yourInterests.couldntRemoveThat"), t("yourInterests.checkYourConnectionAndTry"));
    } finally {
      setRemoving(null);
    }
  };

  if (interests === null) {
    if (loadFailed) return <LoadFailed message={t("yourInterests.couldntLoadYourInterestsCheck")} onRetry={() => void load()} />;
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionHeader, styles.firstHeader]} accessibilityRole="header">{t("yourInterests.whatKatkeeThinksYouLike")}</Text>
      <Text style={styles.hint}>{t("yourInterests.learnedFromTheStoriesYou")}</Text>
      {interests.learned.length === 0 ? (
        <Text style={styles.empty}>{t("yourInterests.nothingYetTopicsYouEnjoy")}</Text>
      ) : (
        <View style={styles.chips}>
          {interests.learned.map(({ topic, strength }) => (
            <View key={topic} style={styles.chip}>
              <Text style={styles.chipLabel}>{topicLabel(topic)}</Text>
              <Text style={styles.chipDetail}>{STRENGTH_LABELS[strength]}</Text>
              {removing === topic ? (
                <ActivityIndicator size="small" color={colors.accentText} />
              ) : (
                <Pressable onPress={() => void onRemove(topic)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("yourInterests.removeTopic", { topic })}>
                  <Icon name={ICONS.close} size={16} color={colors.textSecondary} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionHeader} accessibilityRole="header">{t("yourInterests.interestsYouChose")}</Text>
      {interests.chosen.length === 0 ? (
        <Text style={styles.empty}>{t("yourInterests.youHaventChosenAnyInterests")}</Text>
      ) : (
        <View style={styles.chips}>
          {interests.chosen.map((topic) => (
            <View key={topic} style={styles.chip}>
              <Text style={styles.chipLabel}>{topicLabel(topic)}</Text>
            </View>
          ))}
        </View>
      )}
      <Pressable style={styles.link} onPress={() => navigation.navigate("EditProfile")} accessibilityRole="button">
        <Text style={styles.linkText}>{t("yourInterests.editInEditProfile")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionHeader: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.xs },
  firstHeader: { marginTop: 0 },
  hint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  empty: { ...typography.body, color: colors.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipLabel: { ...typography.body, color: colors.textPrimary, fontWeight: "600" },
  chipDetail: { ...typography.caption, color: colors.textSecondary },
  link: { marginTop: spacing.md, minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  linkText: { ...typography.body, color: colors.accentText, fontWeight: "600" },
});
