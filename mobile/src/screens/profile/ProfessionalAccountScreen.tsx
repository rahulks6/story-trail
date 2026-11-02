import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import {
  PROFESSIONAL_CATEGORIES, deviceTimeZone, getProfessionalStatus, professionalCategoryLabel, setProfessional, switchToPersonal,
  type ProfessionalCategory, type ProfessionalStatus,
} from "../../api/professional";
import { Pressable } from "../../components/Pressable";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Form";
import { LoadFailed } from "../../components/LoadFailed";
import { showToast } from "../../components/Toast";
import { tapFeedback } from "../../utils/haptics";

type Props = NativeStackScreenProps<RootStackParamList, "ProfessionalAccount">;

const PERKS = [
  "A dashboard of your reach, Story views, likes, replies and shares",
  "Followers gained and lost each day, and your top Stories",
  "When your followers are online, so you can post when they're around",
];

/**
 * Settings > Professional account: switch (free, any time), pick the category shown quietly
 * under your name, or switch back. A private account can't switch, and the screen says why
 * rather than hiding the option (the server holds the same rule).
 */
export function ProfessionalAccountScreen({ navigation }: Props): React.JSX.Element {
  const { user, accessToken, applyProfile } = useAuth();
  const [status, setStatus] = useState<ProfessionalStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState<ProfessionalCategory | null>(null);
  const [showCategory, setShowCategory] = useState(true);
  const [saving, setSaving] = useState<"save" | "personal" | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setFailed(false);
    try {
      const next = await getProfessionalStatus(accessToken);
      setStatus(next);
      setCategory(next.professional?.category ?? null);
      setShowCategory(next.professional?.showCategory ?? true);
    } catch {
      setFailed(true);
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  // Your account's copy updates at once, so your profile and its Insights button follow.
  const remember = (next: ProfessionalStatus) => {
    setStatus(next);
    if (user) applyProfile({ ...user, professionalCategory: next.professional?.category ?? null, professionalCategoryShown: next.professional?.showCategory ?? true });
  };

  const save = async () => {
    if (!accessToken || !category || saving) return;
    const switching = !status?.professional;
    setSaving("save");
    try {
      const next = await setProfessional({ category, showCategory, timeZone: deviceTimeZone() }, accessToken);
      remember(next);
      tapFeedback("success");
      if (switching) {
        showToast("You're now a professional account");
        navigation.replace("ProfessionalDashboard");
      } else {
        showToast("Saved");
      }
    } catch (error) {
      Alert.alert("Couldn't switch", error instanceof ApiError ? error.message : "Check your connection and try again.");
    } finally {
      setSaving(null);
    }
  };

  const backToPersonal = () => {
    Alert.alert("Switch to a personal account?", "Your dashboard and category go away. Your Stories, followers and everything else stay as they are. You can switch back any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Switch",
        onPress: async () => {
          if (!accessToken) return;
          setSaving("personal");
          try {
            const next = await switchToPersonal(accessToken);
            remember(next);
            setCategory(null);
            setShowCategory(true);
            tapFeedback("success");
            showToast("Switched to a personal account");
          } catch (error) {
            Alert.alert("Couldn't switch", error instanceof ApiError ? error.message : "Check your connection and try again.");
          } finally {
            setSaving(null);
          }
        },
      },
    ]);
  };

  if (!status) {
    if (failed) return <LoadFailed message="Couldn't load your account type. Check your connection and try again." onRetry={() => void load()} />;
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
      </View>
    );
  }

  const pro = status.professional;
  const blocked = !status.eligibility.eligible;
  const changed = !!pro && (pro.category !== category || pro.showCategory !== showCategory);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Icon name={ICONS.insights} size={22} color={colors.onAccent} />
        </View>
        <Text style={typography.title} accessibilityRole="header">{pro ? "Professional account" : "Switch to professional"}</Text>
        <Text style={styles.introText}>
          {pro
            ? `You're a professional account${professionalCategoryLabel(pro.category) ? ` (${professionalCategoryLabel(pro.category)})` : ""}. Your dashboard is behind the Insights button on your profile.`
            : "Free, for creators, artists, businesses and public figures. Who sees your Stories doesn't change, and you can switch back any time."}
        </Text>
      </View>

      {!pro ? (
        <View style={styles.perks}>
          {PERKS.map((perk) => (
            <View key={perk} style={styles.perk}>
              <Icon name={ICONS.check} size={16} color={colors.accentText} />
              <Text style={styles.perkText}>{perk}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {blocked ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Icon name={ICONS.privacy} size={18} color={colors.textPrimary} />
          <View style={styles.noticeText}>
            <Text style={typography.bodyStrong}>Your account is private</Text>
            <Text style={styles.caption}>
              {status.eligibility.reasons[0] ?? "Private accounts can't be professional."} A professional account is about reaching people, so its Stories and category need to be public. Turn off Private account in Settings to switch.
            </Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionHeader}>Category</Text>
      <View style={[styles.card, blocked && styles.dim]} accessibilityRole="radiogroup">
        {PROFESSIONAL_CATEGORIES.map((c) => {
          const on = category === c.value;
          return (
            <Pressable
              key={c.value}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={() => {
                tapFeedback("select");
                setCategory(c.value);
              }}
              disabled={blocked}
              accessibilityRole="radio"
              accessibilityLabel={`${c.label}. ${c.hint}`}
              accessibilityState={{ checked: on, disabled: blocked }}
            >
              <View style={styles.optionText}>
                <Text style={typography.body}>{c.label}</Text>
                <Text style={styles.caption}>{c.hint}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.card, styles.switchRow, blocked && styles.dim]}>
        <View style={styles.optionText}>
          <Text style={typography.body}>Show category on profile</Text>
          <Text style={styles.caption}>Shown quietly under your name, like "{professionalCategoryLabel(category ?? "creator")}".</Text>
        </View>
        <Switch value={showCategory} onValueChange={setShowCategory} disabled={blocked} accessibilityLabel="Show category on profile" />
      </View>

      {!pro ? (
        <Button label="Switch to professional account" onPress={() => void save()} disabled={blocked || !category} busy={saving === "save"} accessibilityHint={category ? undefined : "Choose a category first"} />
      ) : (
        <>
          {changed ? <Button label="Save" onPress={() => void save()} busy={saving === "save"} /> : null}
          <Button label="Open your dashboard" variant="secondary" onPress={() => navigation.navigate("ProfessionalDashboard")} />
          <Button label="Switch to personal account" variant="text" onPress={backToPersonal} busy={saving === "personal"} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  intro: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm },
  introIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  introText: { ...typography.caption, textAlign: "center", lineHeight: 19 },
  perks: { gap: spacing.sm, paddingHorizontal: spacing.sm },
  perk: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  perkText: { ...typography.body, flex: 1 },
  notice: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  noticeText: { flex: 1, gap: 2 },
  sectionHeader: { ...typography.label, marginBottom: -spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" },
  dim: { opacity: 0.5 },
  option: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, minHeight: 56 },
  optionPressed: { backgroundColor: colors.surfaceElevated },
  optionText: { flex: 1, gap: 2, marginRight: spacing.md },
  caption: { ...typography.caption },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textDisabled, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: colors.accentText },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accentText },
  switchRow: { flexDirection: "row", alignItems: "center", padding: spacing.md },
});
