import React from "react";
import { KeyboardAvoidingView, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

type Props = Pick<ViewProps, "pointerEvents"> & {
  /**
   * How far below the top of the screen this view starts: useHeaderHeight() on a stack
   * screen with an opaque header; 0 (the default) on full-screen screens, under a
   * transparent header, and in a Modal sheet.
   */
  topOffset?: number;
  /** "padding" shrinks a screen or sheet; "position" lifts a panel floating over content. */
  behavior?: "padding" | "position";
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

/**
 * Keeps text fields above the on-screen keyboard, the same way on iOS and Android.
 *
 * The app draws edge-to-edge on Android (android/gradle.properties edgeToEdgeEnabled; from
 * Android 15 the OS enforces it), so the system no longer resizes the window when the
 * keyboard opens: windowSoftInputMode="adjustResize" alone leaves inputs underneath it,
 * and a KeyboardAvoidingView whose behavior is undefined on Android does nothing. React
 * Native still reports where the keyboard is (keyboardDidShow), so the same behavior works
 * on both platforms; on Android the content moves when the keyboard has opened instead of
 * sliding with it.
 */
export function KeyboardAvoider({ topOffset = 0, behavior = "padding", style, contentContainerStyle, pointerEvents, children }: Props): React.JSX.Element {
  return (
    <KeyboardAvoidingView
      behavior={behavior}
      keyboardVerticalOffset={topOffset}
      style={style}
      contentContainerStyle={contentContainerStyle}
      pointerEvents={pointerEvents}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
