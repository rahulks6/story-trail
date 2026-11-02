import React from "react";
import { ActionSheet } from "../ActionSheet";
import { t } from "../../i18n";

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
          { label: t("common.shareProfile"), onPress: onShare },
          { label: t("profileMoreSheet.copyProfileLink"), onPress: onCopyLink },
          { label: isMuted ? t("common.unmute") : t("profileMoreSheet.mute"), onPress: onToggleMute },
        ],
        [
          { label: t("common.block"), onPress: onBlock, destructive: true },
          { label: t("common.report"), onPress: onReport, destructive: true },
        ],
      ]}
    />
  );
}
