import React, { useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { launchImageLibrary } from "react-native-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { avatarFileUrl, updateMyProfile } from "../../api/users";
import { uploadPhoto } from "../../api/media";
import { ApiError } from "../../api/client";
import { usernameCheckText, usernameRefused, useUsernameAvailability } from "../../hooks/useUsernameAvailability";

type Props = NativeStackScreenProps<RootStackParamList, "EditProfile">;

const MAX_DISPLAY_NAME_LENGTH = 60;
const MAX_BIO_LENGTH = 150;

/**
 * Edit account identity and profile metadata through `PATCH
 * /api/v1/users/me`. The account's privacy toggle lives in Settings instead
 * (spec's Settings > Privacy row), not duplicated here.
 */
export function EditProfileScreen({ navigation }: Props): React.JSX.Element {
  const { user, accessToken, applyProfile } = useAuth();
  const headerHeight = useHeaderHeight();
  const inFlight = useRef(false);
  const uploadedAvatar = useRef<{uri: string; id: string} | null>(null);
  const [username, setUsername] = useState(user?.username ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [interests, setInterests] = useState((user?.interests ?? []).join(", "));
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState("image/jpeg");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availability = useUsernameAvailability(username, accessToken, user?.username);
  const availabilityLine = usernameCheckText(availability);
  const canSave = username.trim().length >= 3 && displayName.trim().length > 0 && !saving && !!accessToken && !usernameRefused(availability);

  const onSave = async () => {
    if (!canSave || !accessToken || inFlight.current) return;
    const parsedInterests = [...new Set(interests.split(",").map(item => item.trim()).filter(Boolean))];
    if (!/^[a-z0-9_.]{3,30}$/.test(username.trim().toLowerCase())) { setError("Enter a valid username."); return; }
    if (parsedInterests.length > 5 || parsedInterests.some(item => item.length > 30)) { setError("Use up to 5 interests, each at most 30 characters."); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      let avatarMediaId: string | undefined;
      if (avatarUri) {
        if (uploadedAvatar.current?.uri !== avatarUri) {
          const uploaded = await uploadPhoto(avatarUri, avatarMimeType, accessToken);
          uploadedAvatar.current = { uri: avatarUri, id: uploaded.id };
        }
        avatarMediaId = uploadedAvatar.current.id;
      }
      const { user: saved } = await updateMyProfile({ username: username.trim().toLowerCase(), displayName: displayName.trim(), bio, interests: parsedInterests, avatarMediaId }, accessToken);
      applyProfile(saved);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.fieldErrors ?? {}).join("\n") || err.message : "That didn't save — try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <Pressable style={styles.avatarButton} disabled={saving} onPress={async () => {
        try {
          const result = await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, assetRepresentationMode: "compatible", maxWidth: 1024, maxHeight: 1024 });
          if (result.errorCode) { setError(result.errorMessage ?? "Could not open your photos."); return; }
          const asset = result.assets?.[0];
          if (asset?.uri) { setAvatarUri(asset.uri); setAvatarMimeType(asset.type ?? "image/jpeg"); }
        } catch { setError("Could not open your photos. Try again."); }
      }} accessibilityRole="button" accessibilityLabel="Choose profile photo">
        {avatarUri || user?.avatarMediaId ? <Image source={avatarUri ? {uri: avatarUri} : {uri: avatarFileUrl(user!.username, user!.avatarMediaId), headers: {Authorization: `Bearer ${accessToken}`}}} style={styles.avatarImage} /> : <Text style={styles.avatarInitial}>{user?.displayName.charAt(0).toUpperCase() ?? "?"}</Text>}
        <Text style={styles.avatarAction}>Change photo</Text>
      </Pressable>
      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={(value) => setUsername(value.toLowerCase().replace(/\s/g, ""))}
        placeholder="username"
        placeholderTextColor={colors.textDisabled}
        maxLength={30}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Username"
      />
      {availabilityLine ? (
        <Text
          style={[styles.hint, availabilityLine.tone === "success" && styles.available, availabilityLine.tone === "error" && styles.unavailable]}
          accessibilityLiveRegion="polite"
        >
          {availabilityLine.text}
        </Text>
      ) : (
        <Text style={styles.hint}>3–30 lowercase letters, numbers, dots or underscores.</Text>
      )}
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Your name"
        placeholderTextColor={colors.textDisabled}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        accessibilityLabel="Display name"
      />

      <Text style={styles.label}>Bio</Text>
      <TextInput
        style={[styles.input, styles.bioInput]}
        value={bio}
        onChangeText={setBio}
        placeholder="Tell people about yourself"
        placeholderTextColor={colors.textDisabled}
        maxLength={MAX_BIO_LENGTH}
        multiline
        accessibilityLabel="Bio"
      />
      <Text style={styles.counter}>
        {bio.length}/{MAX_BIO_LENGTH}
      </Text>

      <Text style={styles.label}>Interests</Text>
      <TextInput
        style={styles.input}
        value={interests}
        onChangeText={setInterests}
        placeholder="Travel, food, music"
        placeholderTextColor={colors.textDisabled}
        maxLength={180}
        accessibilityLabel="Interests, separated by commas"
      />
      <Text style={styles.hint}>Add up to 5 interests separated by commas.</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave}
        onPress={onSave}
        accessibilityRole="button"
        accessibilityLabel="Save profile changes"
      >
        {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.saveLabel}>Save</Text>}
      </Pressable>
      </ScrollView>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  avatarButton: { alignItems: "center", marginBottom: spacing.sm },
  avatarImage: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: colors.accent },
  avatarInitial: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface, color: colors.textPrimary, fontSize: 32, fontWeight: "700", textAlign: "center", textAlignVertical: "center", borderWidth: 2, borderColor: colors.border },
  avatarAction: { color: colors.accent, marginTop: spacing.xs, fontWeight: "600" },
  label: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 16,
  },
  bioInput: { minHeight: 88, textAlignVertical: "top" },
  counter: { ...typography.caption, color: colors.textDisabled, textAlign: "right", marginTop: spacing.xs },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  error: { color: colors.danger, marginTop: spacing.md },
  available: { color: colors.success },
  unavailable: { color: colors.danger },
  saveButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveLabel: { color: colors.onAccent, fontWeight: "700" },
});
