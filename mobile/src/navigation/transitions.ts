import { Platform } from "react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

/**
 * One way of moving between screens across the app. Android's default changes from version to
 * version (fade, zoom or slide), so it's set to the slide iPhone users get; on iPhone the swipe
 * back works from anywhere on the screen, not only the edge.
 */
export const PUSH_TRANSITION: NativeStackNavigationOptions = {
  animation: Platform.OS === "android" ? "slide_from_right" : "default",
  fullScreenGestureEnabled: true,
};

/** Stories and Highlights fade in over what you were looking at, quickly, like a photo opening. */
export const MEDIA_TRANSITION: NativeStackNavigationOptions = { presentation: "fullScreenModal", animation: "fade", animationDuration: 180 };

