import React, { useState } from "react";
import { Alert } from "react-native";
import { useAuth } from "../state/AuthContext";
import { deleteStory } from "../api/stories";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { showToast } from "./Toast";
import { muteUser, blockUser } from "../api/users";
import { recordEvent } from "../api/events";
import { ReportSheet } from "./ReportSheet";
import { t } from "../i18n";

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
    Alert.alert(t("common.deleteThisStory"), t("common.thisCantBeUndone"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await deleteStory(storyId, accessToken);
            showToast(t("storyMoreMenu.storyDeleted"));
            onDeleted();
          } catch {
            Alert.alert(t("storyMoreMenu.couldntDeleteThatStory"), t("storyMoreMenu.checkYourConnectionAndTry"));
          }
        },
      },
    ]);
  };

  const onNotInterested = async () => {
    if (!accessToken || !otherUserId) return;
    try {
      await recordEvent({ eventType: "not_interested", creatorId: otherUserId }, accessToken);
      showToast(t("storyMoreMenu.youllSeeFewerStoriesLike"));
      onDeleted(); // this creator won't be recommended again: nothing more to show here
    } catch {
      Alert.alert(t("storyMoreMenu.couldntSaveThat"), t("storyMoreMenu.checkYourConnectionAndTry"));
    }
  };

  const onMoreLikeThis = async () => {
    if (!accessToken) return;
    try {
      await recordEvent({ eventType: "more_like_this", storyId, ...(otherUserId ? { creatorId: otherUserId } : {}) }, accessToken);
      showToast(t("storyMoreMenu.youllSeeMoreStoriesLike"));
    } catch {
      Alert.alert(t("storyMoreMenu.couldntSaveThat"), t("storyMoreMenu.checkYourConnectionAndTry"));
    }
  };

  const onMute = async () => {
    if (!accessToken || !otherUsername) return;
    try {
      await muteUser(otherUsername, accessToken);
      showToast(t("storyMoreMenu.mutedOtherusername", { otherUsername }));
    } catch {
      Alert.alert(t("storyMoreMenu.couldntMute"), t("storyMoreMenu.checkYourConnectionAndTry"));
    }
  };

  const onBlock = () => {
    if (!otherUsername) return;
    Alert.alert(t("storyMoreMenu.blockOtherusername", { otherUsername }), t("storyMoreMenu.theyWontBeAbleTo"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.block"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await blockUser(otherUsername, accessToken);
            showToast(t("storyMoreMenu.blockedOtherusername", { otherUsername }));
            onDeleted(); // the Story is no longer visible either way: close the viewer
          } catch {
            Alert.alert(t("common.couldntBlock"), t("storyMoreMenu.checkYourConnectionAndTry"));
          }
        },
      },
    ]);
  };

  const groups: SheetAction[][] = isOwnStory
    ? [[...(onOpenInsights ? [{ label: t("storyMoreMenu.viewInsights"), onPress: onOpenInsights }] : []), { label: t("storyMoreMenu.deleteStory"), destructive: true, onPress: onDelete }]]
    : [
        [
          ...(isPublic ? [{ label: t("storyMoreMenu.showMoreLikeThis"), onPress: () => void onMoreLikeThis() }] : []),
          { label: t("storyMoreMenu.notInterested"), onPress: () => void onNotInterested() },
          { label: `Mute @${otherUsername ?? ""}`, onPress: () => void onMute() },
        ],
        [
          { label: t("common.report"), destructive: true, onPress: () => setReportOpen(true) },
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
