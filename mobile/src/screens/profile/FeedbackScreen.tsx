import React, { useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { launchImageLibrary } from "react-native-image-picker";
import { Icon } from "../../components/Icon";
import { Banner, Button, TextField } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import { uploadPhoto } from "../../api/media";
import { MAX_FEEDBACK_LENGTH, sendFeedback } from "../../api/support";
import { appEnv } from "../../config/env";
import { deviceModel, osVersion } from "../../crashReporting";
import { tapFeedback } from "../../utils/haptics";

/**
 * Tell us what went wrong or what you'd like (Settings > Help > Send feedback). A screenshot is
 * optional and only ever one you choose: take it with your phone's buttons, then attach it here.
 * The app version and phone model go with it, so a bug can be found.
 */
export function FeedbackScreen(): React.JSX.Element {
  const navigation = useNavigation();
  const { accessToken } = useAuth();
  const [body, setBody] = useState("");
  const [screenshot, setScreenshot] = useState<{ uri: string; type: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attach = async () => {
    const result = await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, assetRepresentationMode: "compatible", maxWidth: 2048, maxHeight: 2048, quality: 0.8 });
    if (result.errorCode === "permission") {
      Alert.alert("Allow photo access", "To attach a screenshot, allow Katkee to access your photos in your phone's Settings.", [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
      ]);
      return;
    }
    const asset = result.assets?.[0];
    if (asset?.uri) setScreenshot({ uri: asset.uri, type: asset.type ?? "image/jpeg" });
  };

  const send = async () => {
    const text = body.trim();
    if (!text || !accessToken || sending) return;
    setSending(true);
    setError(null);
    try {
      const shot = screenshot ? await uploadPhoto(screenshot.uri, screenshot.type, accessToken) : null;
      await sendFeedback({ body: text, ...(shot ? { screenshotMediaId: shot.id } : {}), appVersion: appEnv.appVersion, osVersion: osVersion(), deviceModel: deviceModel() }, accessToken);
      tapFeedback("success");
      Alert.alert("Thanks!", "We read every message. It helps make Katkee better.");
      navigation.goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoider style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[typography.body, styles.intro]}>
          Something not working, or an idea? Tell us what happened and what you expected. A screenshot helps.
        </Text>
        {error ? <Banner text={error} /> : null}
        <TextField
          label="Your feedback"
          value={body}
          onChangeText={setBody}
          placeholder="e.g. The music picker froze after I searched for a song."
          multiline
          maxLength={MAX_FEEDBACK_LENGTH}
          textAlignVertical="top"
          hint={`${body.length}/${MAX_FEEDBACK_LENGTH}`}
        />
        {screenshot ? (
          <View style={styles.shot}>
            <Image source={{ uri: screenshot.uri }} style={styles.shotImage} resizeMode="cover" accessibilityIgnoresInvertColors />
            <Pressable onPress={() => setScreenshot(null)} style={styles.shotRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove screenshot">
              <Icon name={ICONS.close} size={16} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => void attach()} style={styles.attach} accessibilityRole="button" accessibilityLabel="Attach a screenshot">
            <Icon name={ICONS.gallery} size={20} color={colors.textPrimary} />
            <Text style={styles.attachText}>Attach a screenshot</Text>
          </Pressable>
        )}
        <Text style={styles.note}>
          Sent with your username, app version ({appEnv.appVersion || "unknown"}) and phone model, so we can look into it.
        </Text>
        <Button label="Send" onPress={() => void send()} disabled={!body.trim()} busy={sending} />
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  intro: { color: colors.textSecondary },
  attach: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  attachText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  shot: { alignSelf: "flex-start" },
  shotImage: { width: 120, height: 200, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  shotRemove: { position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  note: { color: colors.textSecondary, fontSize: 12 },
});
