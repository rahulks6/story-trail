import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { listCollabCandidates } from "../api/stickers";
import type { CollabPerson } from "../api/stories";
import { t } from "../i18n";

interface Props {
  visible: boolean;
  current: CollabPerson | null;
  onChoose: (person: CollabPerson | null) => void;
  onClose: () => void;
}

/**
 * "Invite collaborator" for a Collab Story: only people who follow you or whom you follow are
 * listed (the server decides, the same rule it applies when the Story is posted). They get an
 * invitation in Activity; once they accept, the Story shows to their followers too, with both
 * names on it.
 */
export function CollabPickerSheet({ visible, current, onChoose, onClose }: Props): React.JSX.Element {
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search, 250);
  const [people, setPeople] = useState<CollabPerson[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !accessToken) return;
    let cancelled = false;
    setFailed(false);
    listCollabCandidates(query.trim(), accessToken)
      .then(({ people: found }) => { if (!cancelled) setPeople(found); })
      .catch(() => { if (!cancelled) { setPeople([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [visible, query, accessToken]);

  const close = () => {
    setSearch("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable pressEffect="none" style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <KeyboardAvoider style={[styles.sheet, { paddingBottom: spacing.lg + bottomInset }]} behavior="padding">
        <View style={styles.handle} />
        <Text style={[typography.bodyStrong, styles.title]}>{t("collabPickerSheet.inviteACollaborator")}</Text>
        <Text style={[typography.caption, styles.subtitle]}>{t("collabPickerSheet.whenTheyAcceptYourStory")}</Text>
        {current ? (
          <View style={styles.currentRow}>
            <Avatar username={current.username} avatarMediaId={current.avatarMediaId} size={32} />
            <VerifiedName name={`@${current.username}`} verified={current.verified} style={typography.bodyStrong} containerStyle={styles.name} />
            <Pressable onPress={() => { onChoose(null); close(); }} style={styles.removeButton} accessibilityRole="button" accessibilityLabel={`Don't invite @${current.username}`}>
              <Text style={styles.removeLabel}>{t("common.remove")}</Text>
            </Pressable>
          </View>
        ) : null}
        <TextInput
          style={styles.input}
          value={search}
          onChangeText={setSearch}
          placeholder={t("collabPickerSheet.searchPeopleYouFollowOr")}
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("collabPickerSheet.searchPeopleToInvite")}
        />
        {people === null ? (
          <ActivityIndicator color={colors.accentText} style={styles.spinner} />
        ) : (
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={people}
            keyExtractor={(p) => p.id}
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => { onChoose(item); close(); }}
                accessibilityRole="button"
                accessibilityLabel={`Invite ${item.displayName}${item.verified ? ", verified" : ""}, @${item.username}`}
                accessibilityState={{ selected: current?.id === item.id }}
              >
                <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId} size={36} />
                <View style={styles.name}>
                  <VerifiedName name={item.displayName} verified={item.verified} style={typography.body} />
                  <Text style={typography.caption}>@{item.username}</Text>
                </View>
                {current?.id === item.id ? <Text style={styles.invited}>{t("collabPickerSheet.invited")}</Text> : null}
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={[typography.caption, styles.empty]}>
                {failed ? t("collabPickerSheet.couldntLoadPeopleCheckYour") : t("collabPickerSheet.noOneToInviteYet")}
              </Text>
            }
          />
        )}
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md, maxHeight: "75%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { textAlign: "center" },
  subtitle: { textAlign: "center", marginTop: spacing.xs, marginBottom: spacing.sm },
  currentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  removeButton: { marginLeft: "auto", paddingHorizontal: spacing.md, minHeight: 34, justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  removeLabel: { color: colors.textPrimary, fontWeight: "700" },
  input: { color: colors.textPrimary, backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  spinner: { marginVertical: spacing.lg },
  list: { maxHeight: 360 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  name: { flex: 1, flexShrink: 1 },
  invited: { color: colors.accentText, fontWeight: "700" },
  empty: { textAlign: "center", marginVertical: spacing.lg },
});
