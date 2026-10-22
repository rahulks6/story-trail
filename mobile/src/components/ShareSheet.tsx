import React from "react";
import { Share } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { useAuth } from "../state/AuthContext";
import { shareStory } from "../api/engagement";
import { storyShareLink } from "../navigation/profileLinks";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { showToast } from "./Toast";

interface Props {
  visible: boolean;
  storyId: string;
  ownerUsername: string;
  isPublic: boolean;
  onClose: () => void;
  /** Opens the "Send to…" picker; the caller owns navigation. */
  onSendToUser: () => void;
}

/**
 * Share a Story: send it to someone on Katkee, through another app (the system share sheet),
 * or copy its link. Copy link is for public Stories only, so sharing never bypasses privacy.
 * Share via… and Copy link record the share (Send records it when the message is sent).
 */
export function ShareSheet({ visible, storyId, ownerUsername, isPublic, onClose, onSendToUser }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const link = storyShareLink(storyId);

  const recordShare = async () => {
    if (!accessToken) return;
    try {
      await shareStory(storyId, accessToken);
    } catch {
      // Sharing still proceeds locally even if the analytics call fails.
    }
  };

  const actions: SheetAction[] = [
    { label: "Send in Katkee", onPress: onSendToUser },
    {
      label: "Share via…",
      onPress: () => {
        void recordShare();
        Share.share({ message: `@${ownerUsername} on Katkee: ${link}` }).catch(() => undefined); // cancelling isn't an error
      },
    },
    ...(isPublic
      ? [{
          label: "Copy link",
          onPress: () => {
            void recordShare();
            Clipboard.setString(link);
            showToast("Link copied");
          },
        }]
      : []),
  ];

  return <ActionSheet visible={visible} title="Share" groups={[actions]} onClose={onClose} />;
}
