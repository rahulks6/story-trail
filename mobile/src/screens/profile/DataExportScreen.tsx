import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as RNFS from "@dr.pogodin/react-native-fs";
import Share from "react-native-share";
import { useFocusEffect } from "@react-navigation/native";
import { Banner, Button } from "../../components/Form";
import { colors, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { API_BASE_URL, ApiError } from "../../api/client";
import { getDataExport, requestDataExport, type DataExport } from "../../api/users";
import { serverDate } from "../../utils/serverTime";
import { t } from "../../i18n";

/** How often the page checks on an archive being made while it's open. */
export const DATA_EXPORT_POLL_MS = 5000;

const megabytes = (bytes: number) => Math.max(0.1, Math.round(bytes / 100_000) / 10);

/**
 * Settings > Download your data: a copy of everything you've put into Katkee (your account,
 * Stories with their photos and videos, comments, likes, follows and the messages you sent), made
 * on Katkee's server as one ZIP and kept for 7 days. Saved with the phone's share sheet (Files,
 * Drive, email to yourself). Katkee emails you when it's ready, so you can leave this page.
 */
export function DataExportScreen(): React.JSX.Element {
  const { accessToken } = useAuth();
  const [current, setCurrent] = useState<DataExport | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setCurrent((await getDataExport(accessToken)).export);
      setError(null);
    } catch {
      setError(t("dataExport.couldntLoad"));
    }
  }, [accessToken]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // While it's being made, look again every few seconds.
  const making = current?.status === "queued" || current?.status === "running";
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => void load(), DATA_EXPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [making, load]);

  const ask = async () => {
    if (!accessToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCurrent((await requestDataExport(accessToken)).export);
    } catch (e) {
      setError(e instanceof ApiError && e.message ? e.message : t("common.checkYourConnectionAndTry"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!accessToken || !current?.downloadUrl || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const file = `${RNFS.CachesDirectoryPath}/katkee-data.zip`;
    try {
      const download = RNFS.downloadFile({ fromUrl: `${API_BASE_URL}${current.downloadUrl}`, toFile: file, headers: { Authorization: `Bearer ${accessToken}` } });
      const { statusCode } = await download.promise;
      if (statusCode !== 200) throw new Error(String(statusCode));
      await Share.open({ url: `file://${file}`, type: "application/zip", filename: "katkee-data.zip", failOnCancel: false });
    } catch {
      setError(t("dataExport.couldntSave"));
    } finally {
      await RNFS.unlink(file).catch(() => undefined);
      saving.current = false;
      setBusy(false);
    }
  };

  const expires = serverDate(current?.expiresAt);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>{t("dataExport.lead")}</Text>
      <View style={styles.list}>
        {[t("dataExport.itemAccount"), t("dataExport.itemStories"), t("dataExport.itemActivity"), t("dataExport.itemMessages")].map((line) => (
          <View key={line} style={styles.row}>
            <View style={styles.dot} />
            <Text style={styles.item}>{line}</Text>
          </View>
        ))}
      </View>
      {error ? <Banner text={error} /> : null}
      {current === undefined ? null : making ? (
        <>
          <Banner tone="info" text={t("dataExport.making")} />
          <Button label={t("dataExport.preparing")} onPress={() => undefined} busy />
        </>
      ) : current?.status === "ready" ? (
        <>
          <Banner tone="success" text={t("dataExport.ready", { size: megabytes(current.byteSize), date: expires ? expires.toLocaleDateString() : "" })} />
          <Button label={t("dataExport.save")} onPress={() => void save()} busy={busy} />
        </>
      ) : (
        <>
          {current?.status === "failed" ? <Banner text={t("dataExport.failed")} /> : null}
          <Button label={t("dataExport.request")} onPress={() => void ask()} busy={busy} />
        </>
      )}
      <Text style={styles.note}>{t("dataExport.note")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  lead: { ...typography.body, color: colors.textPrimary },
  list: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.accent },
  item: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
  note: { ...typography.caption, color: colors.textSecondary },
});
