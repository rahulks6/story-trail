import React, { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

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
  // KeyboardAvoidingView owns its own paddingBottom (it sets it to the keyboard's height, 0 when
  // closed), which silently dropped a sheet's room for Android's navigation bar: the comment box
  // sat under the navigation buttons. That room is kept on an inner view, while the keyboard is shut.
  const { paddingBottom, ...rest } = StyleSheet.flatten(style) ?? {};
  const keyboardOpen = useKeyboardOpen(paddingBottom !== undefined);
  return (
    <KeyboardAvoidingView
      behavior={behavior}
      keyboardVerticalOffset={topOffset}
      style={paddingBottom === undefined ? style : rest}
      contentContainerStyle={contentContainerStyle}
      pointerEvents={pointerEvents}
    >
      {paddingBottom === undefined ? children : (
        <View style={[styles.inner, { paddingBottom: keyboardOpen ? 0 : paddingBottom }]} pointerEvents="box-none">{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

function useKeyboardOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const shown = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => { shown.remove(); hidden.remove(); };
  }, [enabled]);
  return open;
}

const styles = StyleSheet.create({
  inner: { flexGrow: 1, flexShrink: 1 },
});
