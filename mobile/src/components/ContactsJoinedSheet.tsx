import React, { useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "./Pressable";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";
import { useAuth } from "../state/AuthContext";
import { newContactsOnKatkee } from "../state/contactsWatch";
import { followUser } from "../api/users";
import type { ContactMatch } from "../api/growth";
import { mediaColors as colors, radii, spacing, mediaTypography as typography } from "../theme";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

/** Most people listed in one go; the rest are in Settings > Contacts on Katkee. */
const SHOW = 5;

/**
 * "Priya joined Katkee 🎉": on Home, for someone who turned on "Tell me when more contacts join"
 * (state/contactsWatch.ts). Checks quietly when Home opens, at most twice a day; shows only when
 * someone new from your contacts is on Katkee and not followed yet. Follow straight from here.
 */
export function ContactsJoinedSheet({ onOpenProfile, onFollowed }: { onOpenProfile: (username: string) => void; onFollowed?: () => void }): React.JSX.Element | null {
  const { user, accessToken } = useAuth();
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<ContactMatch[]>([]);
  const [followed, setFollowed] = useState<Record<string, "busy" | "following" | "requested">>({});

  useEffect(() => {
    if (!user || !accessToken) return;
    let alive = true;
    void newContactsOnKatkee(user.id, accessToken).then((fresh) => { if (alive && fresh.length) setPeople(fresh); });
    return () => { alive = false; };
    // Once per account signing in (a refreshed token isn't a new chance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!people.length) return null;
  const close = () => setPeople([]);
  const follow = async (person: ContactMatch) => {
    if (!accessToken || followed[person.username]) return;
    setFollowed((f) => ({ ...f, [person.username]: "busy" }));
    try {
      const result = await followUser(person.username, accessToken);
      tapFeedback("success");
      setFollowed((f) => ({ ...f, [person.username]: result.status === "requested" ? "requested" : "following" }));
      onFollowed?.();
    } catch {
      setFollowed((f) => { const next = { ...f }; delete next[person.username]; return next; });
    }
  };
  const first = people[0]!;
  const title = people.length === 1
    ? t("contactsJoined.oneJoined", { name: first.displayName || first.username })
    : t("contactsJoined.manyJoined", { name: first.displayName || first.username, count: people.length - 1 });

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <Pressable pressEffect="none" style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <Text style={styles.body}>{t("contactsJoined.fromYourContacts")}</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {people.slice(0, SHOW).map((person) => {
            const state = followed[person.username];
            return (
              <View key={person.id} style={styles.row}>
                <Pressable onPress={() => { close(); onOpenProfile(person.username); }} style={styles.who} accessibilityRole="button" accessibilityLabel={`${person.displayName}, @${person.username}`}>
                  <Avatar username={person.username} displayName={person.displayName} avatarMediaId={person.avatarMediaId ?? null} size={44} />
                  <View style={styles.names}>
                    <VerifiedName name={person.displayName} verified={person.verified} style={styles.name} />
                    <Text style={styles.handle} numberOfLines={1}>@{person.username}</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => void follow(person)}
                  disabled={!!state}
                  style={[styles.follow, state && state !== "busy" && styles.followDone]}
                  accessibilityRole="button"
                  accessibilityLabel={state === "following" ? t("common.following") : state === "requested" ? t("common.requested") : t("common.follow")}
                >
                  <Text style={[styles.followLabel, state && state !== "busy" && styles.followDoneLabel]}>
                    {state === "following" ? t("common.following") : state === "requested" ? t("common.requested") : t("common.follow")}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
        <Pressable onPress={close} style={styles.done} accessibilityRole="button">
          <Text style={styles.doneLabel}>{t("common.done")}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.xs, maxHeight: "75%" },
  emoji: { fontSize: 40, textAlign: "center" },
  title: { ...typography.title, textAlign: "center" },
  body: { ...typography.caption, color: colors.textSecondary, textAlign: "center", marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  who: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  names: { flex: 1 },
  name: { ...typography.body, fontWeight: "700" },
  handle: { ...typography.caption, color: colors.textSecondary },
  follow: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.accent },
  followDone: { backgroundColor: colors.surfaceElevated },
  followLabel: { fontSize: 14, fontWeight: "800", color: colors.onAccent },
  followDoneLabel: { color: colors.textPrimary },
  done: { marginTop: spacing.sm, alignSelf: "stretch", alignItems: "center", paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  doneLabel: { ...typography.body, fontWeight: "700" },
});
