import React, { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../state/AuthContext";
import { getHighlightDetail, listHighlightsForUser, updateHighlight, type HighlightSummary } from "../api/highlights";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { tapFeedback } from "../utils/haptics";

/** The Story ids a Highlight has after adding some: its own first, in order, then the new ones not already in it. */
export function withAddedStories(existing: string[], adding: string[]): string[] {
  return [...existing, ...adding.filter((id, i) => !existing.includes(id) && adding.indexOf(id) === i)];
}

/**
 * Add Stories to one of your Highlights (like Instagram), or start a new one with them. Used from
 * the Archive's selection and from a Story opened in the Archive.
 */
export function AddToHighlightSheet({ visible, storyIds, onClose, onAdded }: { visible: boolean; storyIds: string[]; onClose: () => void; onAdded?: (title: string) => void }): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [highlights, setHighlights] = useState<HighlightSummary[] | null>(null);

  useEffect(() => {
    if (!visible || !accessToken || !user) return;
    let cancelled = false;
    listHighlightsForUser(user.username, accessToken)
      .then((r) => { if (!cancelled) setHighlights(r.highlights); })
      .catch(() => { if (!cancelled) setHighlights([]); });
    return () => { cancelled = true; };
  }, [visible, accessToken, user]);

  const addTo = async (highlight: HighlightSummary) => {
    if (!accessToken) return;
    try {
      const { highlight: detail } = await getHighlightDetail(highlight.id, accessToken);
      const current = detail.items.map((item) => item.storyId);
      const next = withAddedStories(current, storyIds);
      if (next.length === current.length) {
        Alert.alert("Already there", `${storyIds.length === 1 ? "This Story is" : "These Stories are"} already in ${highlight.title}.`);
        return;
      }
      await updateHighlight(highlight.id, { storyIds: next }, accessToken);
      tapFeedback("success");
      onAdded?.(highlight.title);
    } catch {
      Alert.alert("Couldn't add", "Check your connection and try again.");
    }
  };

  const groups: SheetAction[][] = [
    (highlights ?? []).map((h) => ({ label: `${h.title} · ${h.itemCount}`, onPress: () => void addTo(h) })),
    [{ label: "New Highlight", onPress: () => navigation.navigate("HighlightEditor", { initialStoryIds: storyIds }) }],
  ].filter((g) => g.length > 0);

  return <ActionSheet visible={visible} title={highlights === null ? "Loading your Highlights…" : "Add to Highlight"} groups={groups} onClose={onClose} />;
}
