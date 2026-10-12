import React from "react";
import { ActionSheet } from "../ActionSheet";

interface Props {
  visible: boolean;
  username: string;
  isMuted: boolean;
  onClose: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onToggleMute: () => void;
  onBlock: () => void;
  onReport: () => void;
}

/**
 * Another person's page, More (Phase 10): share or copy the profile link, mute, block or report,
 * in one place instead of a line of small links under the page.
 */
export function ProfileMoreSheet({ visible, username, isMuted, onClose, onShare, onCopyLink, onToggleMute, onBlock, onReport }: Props): React.JSX.Element {
  return (
    <ActionSheet
      visible={visible}
      title={`@${username}`}
      onClose={onClose}
      groups={[
        [
          { label: "Share profile", onPress: onShare },
          { label: "Copy profile link", onPress: onCopyLink },
          { label: isMuted ? "Unmute" : "Mute", onPress: onToggleMute },
        ],
        [
          { label: "Block", onPress: onBlock, destructive: true },
          { label: "Report", onPress: onReport, destructive: true },
        ],
      ]}
    />
  );
}
