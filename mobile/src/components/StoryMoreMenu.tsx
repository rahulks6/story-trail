import React, { useState } from "react";
import { Alert } from "react-native";
import { useAuth } from "../state/AuthContext";
import { deleteStory } from "../api/stories";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { showToast } from "./Toast";
import { muteUser, blockUser } from "../api/users";
import { recordEvent } from "../api/events";
import { ReportSheet } from "./ReportSheet";

interface Props {
  visible: boolean;
  storyId: string;
  isOwnStory: boolean;
  /** Shared with everyone: only then is "Show more like this" offered. */
  isPublic?: boolean;
  otherUsername: string | null;
  otherUserId: string | null;
  onClose: () => void;
  onDeleted: () => void;
  /** Your own Story: its viewers and Insights (the same sheet as the Activity button). */
  onOpenInsights?: () => void;
}

/**
 * The Story's More menu, as the app's other action sheets. Your own Story: Insights, Delete.
 * Someone else's: Show more like this (public Stories: Home leans towards its topic), Not
 * interested (they're no longer recommended), Mute, Report, Block.
 */
export function StoryMoreMenu({ visible, storyId, isOwnStory, isPublic = false, otherUsername, otherUserId, onClose, onDeleted, onOpenInsights }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);

  const onDelete = () => {
    Alert.alert("Delete this Story?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await deleteStory(storyId, accessToken);
            showToast("Story deleted");
            onDeleted();
          } catch {
            Alert.alert("Couldn't delete that Story", "Check your connection and try again.");
          }
        },
      },
    ]);
  };

  const onNotInterested = async () => {
    if (!accessToken || !otherUserId) return;
    try {
      await recordEvent({ eventType: "not_interested", creatorId: otherUserId }, accessToken);
      showToast("You'll see fewer Stories like this");
      onDeleted(); // this creator won't be recommended again: nothing more to show here
    } catch {
      Alert.alert("Couldn't save that", "Check your connection and try again.");
    }
  };

  const onMoreLikeThis = async () => {
    if (!accessToken) return;
    try {
      await recordEvent({ eventType: "more_like_this", storyId, ...(otherUserId ? { creatorId: otherUserId } : {}) }, accessToken);
      showToast("You'll see more Stories like this");
    } catch {
      Alert.alert("Couldn't save that", "Check your connection and try again.");
    }
  };

  const onMute = async () => {
    if (!accessToken || !otherUsername) return;
    try {
      await muteUser(otherUsername, accessToken);
      showToast(`Muted @${otherUsername}`);
    } catch {
      Alert.alert("Couldn't mute", "Check your connection and try again.");
    }
  };

  const onBlock = () => {
    if (!otherUsername) return;
    Alert.alert(`Block @${otherUsername}?`, "They won't be able to see your Stories or profile, or message you.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await blockUser(otherUsername, accessToken);
            showToast(`Blocked @${otherUsername}`);
            onDeleted(); // the Story is no longer visible either way: close the viewer
          } catch {
            Alert.alert("Couldn't block", "Check your connection and try again.");
          }
        },
      },
    ]);
  };

  const groups: SheetAction[][] = isOwnStory
    ? [[...(onOpenInsights ? [{ label: "View insights", onPress: onOpenInsights }] : []), { label: "Delete Story", destructive: true, onPress: onDelete }]]
    : [
        [
          ...(isPublic ? [{ label: "Show more like this", onPress: () => void onMoreLikeThis() }] : []),
          { label: "Not interested", onPress: () => void onNotInterested() },
          { label: `Mute @${otherUsername ?? ""}`, onPress: () => void onMute() },
        ],
        [
          { label: "Report", destructive: true, onPress: () => setReportOpen(true) },
          { label: `Block @${otherUsername ?? ""}`, destructive: true, onPress: onBlock },
        ],
      ];

  return (
    <>
      <ActionSheet visible={visible} groups={groups} onClose={onClose} />
      <ReportSheet visible={reportOpen} targetType="story" targetId={storyId} onClose={() => setReportOpen(false)} />
    </>
  );
}
