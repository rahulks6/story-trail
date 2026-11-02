import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { colors, radii, spacing, typography } from "../theme";
import { useAuth } from "../state/AuthContext";
import { createReport, reportDirectMessage, REPORT_REASONS, type ReportReason, type ReportTargetType } from "../api/moderation";
import { ApiError } from "../api/client";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { t } from "../i18n";

interface Props {
  visible: boolean;
  /** "message" reports a DM: `targetId` is the message, `conversationId` its thread. */
  targetType: ReportTargetType | "message";
  targetId: string;
  conversationId?: string;
  onClose: () => void;
}

/**
 * Shared reason-picker for reporting a Story, a comment, or a user
 * account (spec's "Report" affordance, real since Phase 10's moderation
 * queue exists to receive it). React Native's built-in `Alert` can't
 * reasonably list 7 reasons, so this is a small bottom-sheet Modal in the
 * same style as ShareSheet.tsx, not a new pattern.
 */
export function ReportSheet({ visible, targetType, targetId, conversationId, onClose }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { accessToken } = useAuth();
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelectedReason(null);
    setDetails("");
  };

  const onSubmit = async () => {
    if (!accessToken || !selectedReason || busy) return;
    setBusy(true);
    try {
      if (targetType === "message") {
        if (!conversationId) return;
        await reportDirectMessage(conversationId, { messageId: targetId, reason: selectedReason, details: details.trim() || undefined }, accessToken);
      } else {
        await createReport({ targetType, targetId, reason: selectedReason, details: details.trim() || undefined }, accessToken);
      }
      reset();
      onClose();
      Alert.alert(t("reportSheet.thanksForLettingUsKnow"), t("reportSheet.ourModerationTeamWillReview"));
    } catch (err) {
      Alert.alert(err instanceof ApiError ? err.message : t("reportSheet.thatDidntGoThroughTry"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <KeyboardAvoider style={styles.fill}>
        <Pressable
          pressEffect="none"
          style={styles.backdrop}
          onPress={() => {
            reset();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
        <View style={[styles.sheet, { paddingBottom: spacing.xl + bottomInset }]}>
          <View style={styles.handle} />
          <Text style={[typography.bodyStrong, styles.title]}>{t("common.report")}{" "}{targetType === "user" ? t("reportSheet.profile") : targetType}</Text>
          {targetType === "message" ? (
            <Text style={[typography.caption, styles.disclosure]}>{t("reportSheet.thisMessageAndThe9")}</Text>
          ) : null}

          {selectedReason === null ? (
            // Eleven reasons don't fit on small phones: they scroll inside the sheet.
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.reasons} bounces={false}>
              {REPORT_REASONS.map((reason) => (
                <Pressable key={reason.value} style={styles.row} onPress={() => setSelectedReason(reason.value)} accessibilityRole="button">
                  <Text style={typography.body}>{reason.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <>
              <Text style={[typography.caption, styles.selectedReason]}>
                {REPORT_REASONS.find((r) => r.value === selectedReason)?.label}
              </Text>
              <TextInput
                style={styles.detailsInput}
                accessibilityLabel={t("reportSheet.detailsOptional")}
                placeholder={t("reportSheet.anythingElseWeShouldKnow")}
                placeholderTextColor={colors.textDisabled}
                value={details}
                onChangeText={setDetails}
                multiline
              />
              <Pressable style={[styles.submitButton, busy && styles.submitButtonDisabled]} disabled={busy} onPress={onSubmit} accessibilityRole="button" accessibilityLabel={t("reportSheet.submitReport")} accessibilityState={{ busy, disabled: busy }}>
                {busy ? <ActivityIndicator color={colors.onDanger} /> : <Text style={styles.submitLabel}>{t("reportSheet.submitReport")}</Text>}
              </Pressable>
              <Pressable style={styles.backRow} onPress={() => setSelectedReason(null)} disabled={busy} accessibilityRole="button">
                <Text style={typography.caption}>{t("reportSheet.chooseADifferentReason")}</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  reasons: { flexGrow: 0, flexShrink: 1 },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { textAlign: "center", marginBottom: spacing.sm },
  disclosure: { color: colors.textSecondary, textAlign: "center", marginBottom: spacing.sm },
  row: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  selectedReason: { marginBottom: spacing.sm },
  detailsInput: {
    minHeight: 60,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    textAlignVertical: "top",
    marginBottom: spacing.md,
  },
  submitButton: {
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitLabel: { color: colors.onDanger, fontWeight: "700" },
  backRow: { paddingVertical: spacing.md, alignItems: "center" },
});
