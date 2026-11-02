import type { StoryReplyKind } from "../api/conversations";
import { t } from "../i18n";

/** The caption over a DM that answers a Story, from the reader's side of the conversation. */
export function storyReplyLabel(reply: { storyId: string | null; kind: StoryReplyKind }, mine: boolean): string {
  const verb = reply.kind === "reaction" ? (mine ? t("storyReplies.youReactedToTheirStory") : t("storyReplies.reactedToYourStory")) : mine ? t("storyReplies.youRepliedToTheirStory") : t("storyReplies.repliedToYourStory");
  return reply.storyId ? verb : t("storyReplies.verbNoLongerAvailable", { verb });
}
