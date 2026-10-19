import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";
import { Button } from "./Form";

/** A whole-screen "couldn't load" with a way out, instead of a spinner that never ends. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="alert" style={[typography.body, styles.message]}>{message}</Text>
      <Button label="Try again" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  message: { textAlign: "center", color: colors.textSecondary },
});
