import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, spacing } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getStoryOwnerUsername } from "../../api/stories";
import { ApiError } from "../../api/client";
import { EmptyState } from "../../components/EmptyState";
import { Button } from "../../components/Form";

type Props = NativeStackScreenProps<RootStackParamList, "StoryLink">;

/**
 * Landing route for katkee://story/<id>. The server applies the same privacy, block and
 * expiry rules as opening the Story itself, so a link never reveals more than the viewer
 * could already see.
 */
export function StoryLinkScreen({ navigation, route }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setProblem(null);
    getStoryOwnerUsername(route.params.storyId, accessToken)
      .then(({ username }) => {
        if (!cancelled) navigation.replace("StoryViewer", { creators: [username], startIndex: 0, initialStoryId: route.params.storyId });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          setProblem({ title: "Story unavailable", message: e.status === 403 ? "This Story is only visible to approved followers." : "It may have expired or been removed." });
        } else {
          setProblem({ title: "Couldn't open this Story", message: "Check your connection and try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, route.params.storyId, navigation, attempt]);

  if (!problem) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" accessibilityLabel="Opening Story" />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <EmptyState title={problem.title} message={problem.message} />
      <View style={styles.actions}>
        {problem.title !== "Story unavailable" ? <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} /> : null}
        <Button label="Close" variant="secondary" onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.replace("Main", { screen: "Home" }))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  actions: { padding: spacing.xl, gap: spacing.sm },
});
