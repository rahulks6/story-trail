import React, { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, TextInput, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { Banner, Button } from "../../components/Form";
import { Pressable } from "../../components/Pressable";
import { showToast } from "../../components/Toast";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import { disableTwoStep, enableTwoStep, startTwoStep, twoStepStatus, type TwoStepStatus } from "../../api/auth";
import { tapFeedback } from "../../utils/haptics";
import { t } from "../../i18n";

/** The QR code the server drew as rows of "1" (dark) and "0" (light), drawn here as squares. */
function QrCode({ rows, size = 200 }: { rows: string[]; size?: number }): React.JSX.Element {
  const cell = size / (rows.length + 8);
  return (
    <View style={[styles.qr, { width: size, height: size, padding: cell * 4 }]} accessible accessibilityLabel={t("twoStep.scan")}>
      {rows.map((row, y) => (
        <View key={y} style={styles.qrRow}>
          {[...row].map((bit, x) => <View key={x} style={{ width: cell, height: cell, backgroundColor: bit === "1" ? "#000000" : "#FFFFFF" }} />)}
        </View>
      ))}
    </View>
  );
}

/**
 * Account security > Two-step login: turn it on with an authenticator app (scan the QR code, or
 * open the link on this phone, or type the key), confirm with its first code, then save the
 * backup codes. Turning it off asks for a code. Both need "Confirm it's you" above (`ticket`).
 */
export function TwoStepSection({ ticket, onTicketUsed }: { ticket: string | null; onTicketUsed: () => void }): React.JSX.Element {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrRows: string[] } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try { setStatus(await twoStepStatus(accessToken)); } catch { /* the rest of the page still works */ }
  }, [accessToken]);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(e instanceof ApiError && e.message ? e.message : t("common.checkYourConnectionAndTry")); } finally { setBusy(false); }
  };

  if (!status) return <View />;

  if (backupCodes) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{t("twoStep.backupTitle")}</Text>
        <Text style={styles.text}>{t("twoStep.backupHelp")}</Text>
        <View style={styles.codes}>{backupCodes.map((c) => <Text key={c} style={styles.code} selectable>{c}</Text>)}</View>
        <Button label={t("twoStep.copyCodes")} variant="secondary" onPress={() => { Clipboard.setString(backupCodes.join("\n")); showToast(t("twoStep.codesCopied")); }} />
        <Button label={t("twoStep.saved")} onPress={() => { setBackupCodes(null); void load(); }} />
      </View>
    );
  }

  if (setup) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{t("twoStep.sectionTitle")}</Text>
        <Text style={styles.text}>{t("twoStep.scan")}</Text>
        <View style={styles.center}><QrCode rows={setup.qrRows} /></View>
        <Button label={t("twoStep.openApp")} variant="secondary" onPress={() => void Linking.openURL(setup.otpauthUrl).catch(() => undefined)} />
        <Text style={styles.text}>{t("twoStep.key")}</Text>
        <Pressable onPress={() => { Clipboard.setString(setup.secret); showToast(t("twoStep.keyCopied")); }} accessibilityRole="button" accessibilityLabel={t("twoStep.copyKey")}>
          <Text style={styles.key} selectable>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</Text>
        </Pressable>
        <Text style={styles.text}>{t("twoStep.enterFirstCode")}</Text>
        <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} style={styles.input}
          placeholder="123456" placeholderTextColor={colors.textSecondary} accessibilityLabel={t("twoStep.code")} autoComplete="one-time-code" textContentType="oneTimeCode" />
        {error ? <Banner text={error} /> : null}
        <Button label={t("twoStep.confirm")} disabled={code.length !== 6 || !ticket} busy={busy} onPress={() => void run(async () => {
          const result = await enableTwoStep(ticket!, code, accessToken!);
          tapFeedback("success");
          setSetup(null);
          setCode("");
          onTicketUsed();
          setBackupCodes(result.backupCodes);
        })} />
        <Pressable onPress={() => { setSetup(null); setCode(""); setError(null); }} accessibilityRole="button" style={styles.link}><Text style={styles.muted}>{t("common.cancel")}</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t("twoStep.sectionTitle")}</Text>
      <Text style={styles.text}>{status.enabled ? t("twoStep.onHint", { left: status.backupCodesLeft }) : t("twoStep.offHint")}</Text>
      {error ? <Banner text={error} /> : null}
      {!ticket ? <Text style={styles.muted}>{t("twoStep.confirmFirst")}</Text> : null}
      {status.enabled ? (
        turningOff ? (
          <>
            <Text style={styles.text}>{t("twoStep.turnOffPrompt")}</Text>
            <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={11} style={styles.input} accessibilityLabel={t("twoStep.code")} placeholderTextColor={colors.textSecondary} />
            <Button label={t("twoStep.turnOff")} disabled={!code || !ticket} busy={busy} onPress={() => void run(async () => {
              await disableTwoStep(ticket!, code, accessToken!);
              setTurningOff(false);
              setCode("");
              onTicketUsed();
              showToast(t("twoStep.turnedOff"));
              await load();
            })} />
          </>
        ) : (
          <Button label={t("twoStep.turnOff")} variant="secondary" disabled={!ticket} onPress={() => setTurningOff(true)} />
        )
      ) : (
        <Button label={t("twoStep.turnOn")} disabled={!ticket} busy={busy} onPress={() => void run(async () => { setSetup(await startTwoStep(ticket!, accessToken!)); })} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  text: { ...typography.body, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textSecondary },
  center: { alignItems: "center" },
  qr: { backgroundColor: "#FFFFFF", borderRadius: radii.sm },
  qrRow: { flexDirection: "row" },
  key: { ...typography.body, fontFamily: "monospace", color: colors.textPrimary, backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: radii.sm, textAlign: "center", letterSpacing: 1 },
  input: { ...typography.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.md, fontSize: 22, letterSpacing: 6, textAlign: "center" },
  codes: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  code: { ...typography.body, fontFamily: "monospace", color: colors.textPrimary, backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.sm },
  link: { alignSelf: "center", paddingVertical: spacing.xs },
});
