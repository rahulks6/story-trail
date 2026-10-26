import React, { useRef } from "react";
import { Animated, type ImageProps } from "react-native";

/**
 * An image that fades in once it has loaded (about a fifth of a second), instead of popping in.
 * Android's Image already fades; iPhone's doesn't, so this makes both the same. Used for
 * avatars and thumbnails, where many arrive at once; a Story itself has its own reveal.
 */
export function FadeInImage({ onLoad, style, ...rest }: ImageProps): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <Animated.Image
      {...rest}
      fadeDuration={0}
      style={[style, { opacity }]}
      onLoad={(event) => {
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        onLoad?.(event);
      }}
    />
  );
}
