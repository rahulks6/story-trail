import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { avatarFileUrl } from "../api/users";
import { useAuth } from "../state/AuthContext";
import { useProfilePhotoSource } from "../hooks/useProfilePhotoSource";
import { colors, radii } from "../theme";
import { FadeInImage } from "./FadeInImage";

interface Props {
  username: string;
  displayName?: string | null;
  /**
   * From the list API: an id when the person has a photo, null when they have none (their
   * initial is shown without a request). Undefined means unknown (a screen that only knows
   * the username, or an older server): the photo is tried and the initial shown if there
   * isn't one.
   */
  avatarMediaId?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A person's photo, or their initial. The image comes from the access-checked avatar
 * endpoint with the viewer's token (blocked people's photos are never served), versioned by
 * the media id so a new photo is a new URL. A photo still being processed (just saved) is asked
 * for again shortly, and the one you saved on this phone shows at once. Decorative: the row it sits in names the person.
 */
export function Avatar({ username, displayName, avatarMediaId, size = 44, style }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const photo = useProfilePhotoSource(avatarMediaId === null ? null : avatarFileUrl(username, avatarMediaId), avatarMediaId, accessToken);
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.circle, round, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      {photo.source ? (
        <FadeInImage source={photo.source} style={round} onError={photo.onError} />
      ) : (
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>{(displayName || username || "?").charAt(0).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { borderRadius: radii.pill, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initial: { color: colors.textPrimary, fontWeight: "700" },
});
