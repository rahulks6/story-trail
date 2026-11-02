import React, { useState } from "react";
import { Share } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { useAuth } from "../state/AuthContext";
import { shareStory } from "../api/engagement";
import { profileShareLink, storyShareLink } from "../navigation/profileLinks";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { ExternalShareModal } from "./ExternalShareModal";
import type { ShareCardStory } from "./StoryShareCard";
import { showToast } from "./Toast";
import { t } from "../i18n";

interface Props {
  visible: boolean;
  storyId: string;
  ownerUsername: string;
  isPublic: boolean;
  onClose: () => void;
  /** Opens the "Send to…" picker; the caller owns navigation. */
  onSendToUser: () => void;
  /**
   * Your own Story, as it's shown: offers "Share to other apps" (the picture or video itself,
   * with a small Katkee mark). Left out for anyone else's Story, whose media stays in Katkee.
   */
  ownStory?: { story: ShareCardStory; ownerId: string } | null;
  /** True while the picture or video is being prepared, so the viewer can hold the Story still. */
  onExternalShareChange?: (active: boolean) => void;
}

/**
 * Share a Story: send it to someone on Katkee, through another app (the system share sheet),
 * or copy its link. Copy link is for public Stories only, so sharing never bypasses privacy.
 * Share via… and Copy link record the share (Send records it when the message is sent).
 */
export function ShareSheet({ visible, storyId, ownerUsername, isPublic, onClose, onSendToUser, ownStory, onExternalShareChange }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const link = storyShareLink(storyId);
  const [exporting, setExportingState] = useState(false);
  const setExporting = (active: boolean) => {
    setExportingState(active);
    onExternalShareChange?.(active);
  };

  const recordShare = async () => {
    if (!accessToken) return;
    try {
      await shareStory(storyId, accessToken);
    } catch {
      // Sharing still proceeds locally even if the analytics call fails.
    }
  };

  // With the picture: your profile, and the Story itself when anyone can open it.
  const fileMessage = ownStory
    ? [t("shareSheet.ownerusernameOnKatkeeOwnerusername2", { ownerUsername, ownerUsername2: profileShareLink(ownerUsername, ownStory.ownerId) }), ...(isPublic ? [link] : [])].join("\n")
    : "";

  const actions: SheetAction[] = [
    { label: t("shareSheet.sendInKatkee"), onPress: onSendToUser },
    ...(ownStory ? [{ label: t("shareSheet.shareToOtherApps"), onPress: () => setExporting(true) }] : []),
    {
      label: t("shareSheet.shareVia"),
      onPress: () => {
        void recordShare();
        Share.share({ message: t("shareSheet.ownerusernameOnKatkeeLink", { ownerUsername, link }) }).catch(() => undefined); // cancelling isn't an error
      },
    },
    ...(isPublic
      ? [{
          label: t("shareSheet.copyLink"),
          onPress: () => {
            void recordShare();
            Clipboard.setString(link);
            showToast(t("common.linkCopied"));
          },
        }]
      : []),
  ];

  return (
    <>
      <ActionSheet visible={visible} title={t("common.share")} groups={[actions]} onClose={onClose} />
      {ownStory && exporting ? (
        <ExternalShareModal
          visible
          storyId={storyId}
          story={ownStory.story}
          username={ownerUsername}
          message={fileMessage}
          accessToken={accessToken}
          onShared={(sent) => { if (sent) void recordShare(); }}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </>
  );
}
