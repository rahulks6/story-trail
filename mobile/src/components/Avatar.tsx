import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { avatarFileUrl } from "../api/users";
import { useAuth } from "../state/AuthContext";
import { useProfilePhotoSource } from "../hooks/useProfilePhotoSource";
import { colorScheme } from "../theme/colors";
import { FadeInImage } from "./FadeInImage";

interface Props {
  username: string;
  displayName?: string | null;
  /**
   * From the list API: an id when the person has a photo, null when they have none (the
   * placeholder is shown without a request). Undefined means unknown (a screen that only knows
   * the username, or an older server): the photo is tried and the placeholder stays if there
   * isn't one.
   */
  avatarMediaId?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A person's photo, or a grey person shape (as a phone's contacts show someone without one). The
 * shape is drawn under the photo too, so while a photo loads, or if it can't, the circle is
 * never an empty dark disc. The image comes from the access-checked avatar
 * endpoint with the viewer's token (blocked people's photos are never served), versioned by
 * the media id so a new photo is a new URL. A photo still being processed (just saved) is asked
 * for again shortly, and the one you saved on this phone shows at once. Decorative: the row it sits in names the person.
 */
export function Avatar({ username, displayName, avatarMediaId, size = 44, style }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const photo = useProfilePhotoSource(avatarMediaId === null ? null : avatarFileUrl(username, avatarMediaId), avatarMediaId, accessToken);
  // Katkee rounded square (the Postcard look), not a circle.
  const round = { width: size, height: size, borderRadius: squircleRadius(size) };
  const dark = colorScheme() === "dark";
  return (
    <View style={[styles.circle, round, { backgroundColor: dark ? PLACEHOLDER.dark.fill : PLACEHOLDER.light.fill }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <PersonShape size={size} color={dark ? PLACEHOLDER.dark.person : PLACEHOLDER.light.person} />
      {photo.source ? <FadeInImage source={photo.source} style={[StyleSheet.absoluteFill, round]} onError={photo.onError} /> : null}
    </View>
  );
}

/** Corner radius of Katkee's rounded-square photos and Story rings, for a box `size` wide. */
export function squircleRadius(size: number): number {
  return Math.round(size * 0.3);
}

/** The placeholder's colours: a soft grey disc with a lighter (dark mode) or white (light mode) person. */
export const PLACEHOLDER = {
  dark: { fill: "#3A3F4A", person: "#8C929E" },
  light: { fill: "#C9CDD4", person: "#FFFFFF" },
} as const;

/** Head and shoulders, cut off by the circle at the bottom. */
function PersonShape({ size, color }: { size: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" testID="avatar-placeholder">
      <Circle cx={12} cy={9.4} r={4.3} fill={color} />
      <Path d="M3.6 24.5c0-5.2 3.8-9.1 8.4-9.1s8.4 3.9 8.4 9.1z" fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
