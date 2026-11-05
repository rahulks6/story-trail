import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { avatarFileUrl } from "../api/users";
import { useAuth } from "../state/AuthContext";
import { useProfilePhotoSource } from "../hooks/useProfilePhotoSource";
import { colors, radii } from "../theme";
import { FadeInImage } from "./FadeInImage";
import { initialOf } from "../utils/initial";

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
        <View style={[StyleSheet.absoluteFill, styles.initialFill, { backgroundColor: initialColor(username || displayName || "") }]}>
          <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>{initialOf(displayName || username || "") || "?"}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Someone without a photo gets their initial on a colour of their own (the same everywhere, from
 * their username), as other social apps do, instead of a grey disc. Deep enough for white text.
 */
export const INITIAL_COLORS = ["#E07B00", "#E0445E", "#B4479F", "#6E56CF", "#2F7BD8", "#0F8F7E", "#3E8E4F", "#C2552E"] as const;

export function initialColor(name: string): string {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return INITIAL_COLORS[hash % INITIAL_COLORS.length]!;
}

const styles = StyleSheet.create({
  circle: { borderRadius: radii.pill, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initialFill: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#FFFFFF", fontWeight: "700" },
});
