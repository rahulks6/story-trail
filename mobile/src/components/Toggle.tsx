import React from "react";
import { Platform, Switch, type SwitchProps } from "react-native";
import { colors } from "../theme";

/**
 * The app's on/off switch, in Katkee's colours: yellow when on, a quiet grey when off, a white
 * knob (Android's default is teal on green, which looked like another app). Use it instead of
 * react-native's Switch.
 */
export function Toggle(props: SwitchProps): React.JSX.Element {
  return (
    <Switch
      trackColor={{ false: colors.border, true: colors.accent }}
      thumbColor={Platform.OS === "android" ? "#FFFFFF" : undefined}
      ios_backgroundColor={colors.border}
      {...props}
    />
  );
}
