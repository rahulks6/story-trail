import React, { useCallback, useRef, useState } from "react";
import { Alert, Linking, PermissionsAndroid, Platform } from "react-native";
import { launchCamera, launchImageLibrary, type ImagePickerResponse } from "react-native-image-picker";
import { AvatarCropper, type PickedPhoto } from "./AvatarCropper";
import { useAuth } from "../state/AuthContext";
import { uploadPhoto } from "../api/media";
import { updateMyProfile } from "../api/users";
import { ApiError } from "../api/client";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

/**
 * Adding a profile photo in one go, from anywhere: choose (gallery or a selfie), place it in the
 * circle (AvatarCropper), and it's saved to the account at once. Used where people without a
 * photo are asked for one: onboarding, their own profile's empty circle, and the Home card.
 * Edit profile keeps its own flow (the photo is saved with the other changes there).
 */
export function useAddProfilePhoto(onSaved?: () => void): {
  choose: (source: "library" | "camera") => Promise<void>;
  busy: boolean;
  error: string | null;
  element: React.JSX.Element;
} {
  const { accessToken, applyProfile } = useAuth();
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  const cameraRefused = () => {
    Alert.alert(t("common.allowCameraAccess"), t("editProfile.toTakeAProfilePhoto"), [
      { text: t("common.notNow"), style: "cancel" },
      { text: t("common.openSettings"), onPress: () => void Linking.openSettings().catch(() => undefined) },
    ]);
  };

  const choose = useCallback(async (source: "library" | "camera") => {
    setError(null);
    try {
      if (source === "camera" && Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) return cameraRefused();
      }
      const result: ImagePickerResponse =
        source === "camera"
          ? await launchCamera({ mediaType: "photo", cameraType: "front", saveToPhotos: false, maxWidth: 2048, maxHeight: 2048, quality: 0.9 })
          : await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, assetRepresentationMode: "compatible", maxWidth: 2048, maxHeight: 2048, quality: 0.9 });
      if (result.didCancel) return;
      if (result.errorCode === "permission") {
        if (source === "camera") return cameraRefused();
        return setError(t("editProfile.allowAccessToYourPhotos"));
      }
      if (result.errorCode === "camera_unavailable") return setError(t("editProfile.theresNoCameraAvailableChoose"));
      if (result.errorCode) return setError(result.errorMessage ?? t("editProfile.couldntOpenThatTryAgain"));
      const asset = result.assets?.[0];
      if (asset?.uri && asset.width && asset.height) setPicked({ uri: asset.uri, width: asset.width, height: asset.height });
      else setError(t("editProfile.couldntReadThatPhotoTry"));
    } catch {
      setError(t("editProfile.couldntOpenThatTryAgain"));
    }
  }, []);

  const save = async (uri: string) => {
    setPicked(null);
    if (!accessToken || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadPhoto(uri, "image/jpeg", accessToken);
      const { user } = await updateMyProfile({ avatarMediaId: uploaded.id }, accessToken);
      applyProfile(user);
      tapFeedback("success");
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("editProfile.thatDidntSaveTryAgain"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const element = <AvatarCropper photo={picked} kind="avatar" onCancel={() => setPicked(null)} onDone={(uri) => void save(uri)} />;
  return { choose, busy, error, element };
}
