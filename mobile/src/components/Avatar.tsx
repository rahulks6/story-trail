import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { avatarFileUrl } from "../api/users";
import { useAuth } from "../state/AuthContext";
import { colors, radii } from "../theme";

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
 * the media id so a new photo is a new URL. Decorative: the row it sits in names the person.
 */
export function Avatar({ username, displayName, avatarMediaId, size = 44, style }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [username, avatarMediaId]);
  const round = { width: size, height: size, borderRadius: size / 2 };
  const showPhoto = avatarMediaId !== null && !!accessToken && !failed;
  return (
    <View style={[styles.circle, round, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      {showPhoto ? (
        <Image
          source={{ uri: avatarFileUrl(username, avatarMediaId), headers: { Authorization: `Bearer ${accessToken}` } }}
          style={round}
          onError={() => setFailed(true)}
        />
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
