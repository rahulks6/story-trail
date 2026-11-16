import React, { useEffect, useState } from "react";
import { Share } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { useAuth } from "../state/AuthContext";
import { shareStory } from "../api/engagement";
import { profileShareLink, storyShareLink } from "../navigation/profileLinks";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { ExternalShareModal } from "./ExternalShareModal";
import type { ShareCardStory } from "./StoryShareCard";
import { showToast } from "./Toast";
import { myInviteUrl } from "../state/invites";
import type { ShareTarget } from "../utils/shareStoryExternally";
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
  const { accessToken, user } = useAuth();
  const link = storyShareLink(storyId);
  const [exporting, setExportingState] = useState<ShareTarget | null>(null);
  const setExporting = (target: ShareTarget | null) => {
    setExportingState(target);
    onExternalShareChange?.(target !== null);
  };
  // Your invite link goes with whatever you share outside Katkee, so friends who install from it
  // are credited to you and offered your Stories first (state/invites.ts).
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !accessToken || inviteUrl) return;
    let alive = true;
    myInviteUrl(accessToken, user?.id).then((url) => { if (alive) setInviteUrl(url); }).catch(() => undefined);
    return () => { alive = false; };
  }, [visible, accessToken, user?.id, inviteUrl]);
  const joinLine = inviteUrl ? t("shareSheet.madeOnKatkeeJoinMe", { url: inviteUrl }) : null;

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
    ? [joinLine ?? t("shareSheet.ownerusernameOnKatkeeOwnerusername2", { ownerUsername, ownerUsername2: profileShareLink(ownerUsername, ownStory.ownerId) }), ...(isPublic ? [link] : [])].join("\n")
    : "";

  const actions: SheetAction[] = [
    { label: t("shareSheet.sendInKatkee"), onPress: onSendToUser },
    ...(ownStory ? [
      { label: t("shareSheet.shareToWhatsApp"), onPress: () => setExporting("whatsapp") },
      { label: t("shareSheet.shareToOtherApps"), onPress: () => setExporting("any") },
    ] : []),
    {
      label: t("shareSheet.shareVia"),
      onPress: () => {
        void recordShare();
        const message = [t("shareSheet.ownerusernameOnKatkeeLink", { ownerUsername, link }), ...(joinLine ? [joinLine] : [])].join("\n");
        Share.share({ message }).catch(() => undefined); // cancelling isn't an error
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
      {ownStory && exporting !== null ? (
        <ExternalShareModal
          visible
          storyId={storyId}
          story={ownStory.story}
          username={ownerUsername}
          message={fileMessage}
          accessToken={accessToken}
          target={exporting}
          onShared={(sent) => { if (sent) void recordShare(); }}
          onClose={() => setExporting(null)}
        />
      ) : null}
    </>
  );
}
