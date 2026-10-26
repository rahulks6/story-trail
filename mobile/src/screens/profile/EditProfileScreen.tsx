import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import { useHeaderHeight } from "@react-navigation/elements";
import { usePreventRemove } from "@react-navigation/native";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { launchCamera, launchImageLibrary, type ImagePickerResponse } from "react-native-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { profileChanged } from "../../state/storyChanges";
import { updateMyProfile } from "../../api/users";
import { uploadPhoto } from "../../api/media";
import { ApiError } from "../../api/client";
import { hasTickLikeCharacter, NAME_TICK_ERROR } from "../../api/verification";
import { usernameCheckText, usernameRefused, useUsernameAvailability } from "../../hooks/useUsernameAvailability";
import { Avatar } from "../../components/Avatar";
import { ActionSheet } from "../../components/ActionSheet";
import { AvatarCropper, type PickedPhoto } from "../../components/AvatarCropper";
import { INTEREST_CHOICES, MAX_INTERESTS } from "../onboarding/OnboardingScreen";

type Props = NativeStackScreenProps<RootStackParamList, "EditProfile">;

const MAX_DISPLAY_NAME_LENGTH = 60;
const MAX_BIO_LENGTH = 150;
const PHOTO_SIZE = 96;

/** What Save will do with the profile photo. Nothing is uploaded or removed before Save. */
type PhotoChange = { kind: "unchanged" } | { kind: "new"; uri: string } | { kind: "removed" };

/**
 * Edit Profile (spec section 23; Phase 11 completes it): photo (take, choose or remove, then
 * move and scale it in a circle), username with a live check, name, bio and interests (the
 * same chips as onboarding). The old
 * photo stays until Save succeeds. Leaving with unsaved changes asks first, including the back
 * gesture. A save updates your page at once and tells Home to refresh. The account's privacy
 * switch lives in Settings, under Privacy.
 */
export function EditProfileScreen({ navigation }: Props): React.JSX.Element {
  const { user, accessToken, applyProfile } = useAuth();
  const headerHeight = useHeaderHeight();
  const inFlight = useRef(false);
  const uploadedPhoto = useRef<{ uri: string; id: string } | null>(null);
  const original = useRef({
    username: user?.username ?? "",
    displayName: user?.displayName ?? "",
    bio: user?.bio ?? "",
    interests: user?.interests ?? [],
  }).current;
  const [username, setUsername] = useState(original.username);
  const [displayName, setDisplayName] = useState(original.displayName);
  const [bio, setBio] = useState(original.bio);
  const [interests, setInterests] = useState<string[]>(original.interests);
  // The usual choices, plus any older free-typed interest you still have.
  const interestChoices = useRef([...INTEREST_CHOICES, ...original.interests.filter((i) => !INTEREST_CHOICES.includes(i))]).current;
  const toggleInterest = (interest: string) => {
    setError(null);
    setInterests((current) => {
      if (current.includes(interest)) return current.filter((i) => i !== interest);
      if (current.length >= MAX_INTERESTS) {
        setError(`Pick up to ${MAX_INTERESTS} interests.`);
        return current;
      }
      return [...current, interest];
    });
  };
  const [photo, setPhoto] = useState<PhotoChange>({ kind: "unchanged" });
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availability = useUsernameAvailability(username, accessToken, user?.username);
  const availabilityLine = usernameCheckText(availability);
  const nameMissing = displayName.trim().length === 0;
  // A tick in a name would pass for the verified badge (the server refuses it too).
  const nameHasTick = hasTickLikeCharacter(displayName);
  const canSave = username.trim().length >= 3 && !nameMissing && !nameHasTick && !saving && !!accessToken && !usernameRefused(availability);
  const dirty =
    username !== original.username || displayName !== original.displayName || bio !== original.bio ||
    interests.join("\n") !== original.interests.join("\n") || photo.kind !== "unchanged";
  const hasPhoto = photo.kind === "new" || (photo.kind === "unchanged" && !!user?.avatarMediaId);

  // Back button, Android back and the iOS swipe all come through here while changes are unsaved.
  usePreventRemove(dirty && !saved, ({ data }) => {
    Alert.alert("Discard changes?", "Your changes to your profile won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Leave only once the guard above has seen the save.
  useEffect(() => {
    if (saved) navigation.goBack();
  }, [saved, navigation]);

  const takeFrom = async (source: "camera" | "library") => {
    setError(null);
    try {
      if (source === "camera" && Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          cameraRefused();
          return;
        }
      }
      const result: ImagePickerResponse =
        source === "camera"
          ? await launchCamera({ mediaType: "photo", cameraType: "front", saveToPhotos: false, maxWidth: 2048, maxHeight: 2048, quality: 0.9 })
          : await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, assetRepresentationMode: "compatible", maxWidth: 2048, maxHeight: 2048, quality: 0.9 });
      if (result.didCancel) return;
      if (result.errorCode === "permission") {
        if (source === "camera") cameraRefused();
        else setError("Allow access to your photos in Settings to choose a photo.");
        return;
      }
      if (result.errorCode === "camera_unavailable") {
        setError("There's no camera available. Choose a photo instead.");
        return;
      }
      if (result.errorCode) {
        setError(result.errorMessage ?? "Couldn't open that. Try again.");
        return;
      }
      const asset = result.assets?.[0];
      if (asset?.uri && asset.width && asset.height) setPicked({ uri: asset.uri, width: asset.width, height: asset.height });
      else setError("Couldn't read that photo. Try another.");
    } catch {
      setError("Couldn't open that. Try again.");
    }
  };

  const cameraRefused = () => {
    Alert.alert("Allow camera access", "To take a profile photo, allow Katkee to use the camera in your phone's Settings.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
    ]);
  };

  const onSave = async () => {
    if (!canSave || !accessToken || inFlight.current) return;
    if (!dirty) {
      navigation.goBack();
      return;
    }
    if (!/^[a-z0-9_.]{3,30}$/.test(username.trim().toLowerCase())) {
      setError("Enter a valid username.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      let avatarMediaId: string | null | undefined;
      if (photo.kind === "new") {
        if (uploadedPhoto.current?.uri !== photo.uri) {
          const uploaded = await uploadPhoto(photo.uri, "image/jpeg", accessToken);
          uploadedPhoto.current = { uri: photo.uri, id: uploaded.id };
        }
        avatarMediaId = uploadedPhoto.current.id;
      } else if (photo.kind === "removed") {
        avatarMediaId = null;
      }
      const { user: savedUser } = await updateMyProfile(
        {
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          bio: bio.trim(),
          interests,
          ...(avatarMediaId !== undefined ? { avatarMediaId } : {}),
        },
        accessToken,
      );
      applyProfile(savedUser);
      profileChanged();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.fieldErrors ?? {}).join("\n") || err.message : "That didn't save. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const photoActions = [
    [
      { label: "Take photo", onPress: () => void takeFrom("camera") },
      { label: "Choose from library", onPress: () => void takeFrom("library") },
    ],
    ...(hasPhoto ? [[{ label: "Remove current photo", onPress: () => setPhoto({ kind: "removed" }), destructive: true }]] : []),
  ];

  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Pressable
          style={styles.photoButton}
          disabled={saving}
          onPress={() => setPhotoSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
        >
          {photo.kind === "new" ? (
            <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel="New profile photo" />
          ) : user ? (
            <Avatar username={user.username} displayName={user.displayName} avatarMediaId={photo.kind === "removed" ? null : user.avatarMediaId} size={PHOTO_SIZE} />
          ) : null}
          <Text style={styles.photoAction}>{hasPhoto ? "Change photo" : "Add photo"}</Text>
        </Pressable>
        {photo.kind !== "unchanged" ? (
          <Text style={styles.photoNote} accessibilityLiveRegion="polite">
            {photo.kind === "new" ? "Your new photo is used when you save." : "Your photo is removed when you save."}
          </Text>
        ) : null}

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

        <View style={styles.labelRow}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.counter}>{displayName.length}/{MAX_DISPLAY_NAME_LENGTH}</Text>
        </View>
        <TextInput
          style={[styles.input, (nameMissing || nameHasTick) && styles.inputError]}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor={colors.textDisabled}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          accessibilityLabel="Display name"
        />
        {nameMissing ? <Text style={[styles.hint, styles.unavailable]}>Enter your name.</Text> : null}
        {nameHasTick ? <Text style={[styles.hint, styles.unavailable]} accessibilityLiveRegion="polite">{NAME_TICK_ERROR}</Text> : null}

        <View style={styles.labelRow}>
          <Text style={styles.label}>Bio</Text>
          <Text style={styles.counter}>{bio.length}/{MAX_BIO_LENGTH}</Text>
        </View>
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

        <View style={styles.labelRow}>
          <Text style={styles.label}>Interests</Text>
          <Text style={styles.counter}>{interests.length}/{MAX_INTERESTS}</Text>
        </View>
        <View style={styles.chips}>
          {interestChoices.map((interest) => {
            const selected = interests.includes(interest);
            return (
              <Pressable
                key={interest}
                onPress={() => toggleInterest(interest)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={interest}
              >
                <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{interest}</Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}

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

      <ActionSheet visible={photoSheetOpen} title="Profile photo" groups={photoActions} onClose={() => setPhotoSheetOpen(false)} />
      <AvatarCropper
        photo={picked}
        onCancel={() => setPicked(null)}
        onDone={(uri) => {
          setPicked(null);
          setPhoto({ kind: "new", uri });
        }}
      />
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  photoButton: { alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2 },
  photoAction: { color: colors.accentText, fontWeight: "700", fontSize: 15 },
  photoNote: { ...typography.caption, textAlign: "center", marginTop: spacing.xs },
  labelRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
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
  inputError: { borderColor: colors.danger },
  bioInput: { minHeight: 88, textAlignVertical: "top" },
  counter: { ...typography.caption, color: colors.textDisabled, marginBottom: spacing.xs },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { ...typography.body, color: colors.textPrimary, fontWeight: "600" },
  chipLabelSelected: { color: colors.onAccent },
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
