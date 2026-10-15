import type { StoryReplyKind } from "../api/conversations";

/** The caption over a DM that answers a Story, from the reader's side of the conversation. */
export function storyReplyLabel(reply: { storyId: string | null; kind: StoryReplyKind }, mine: boolean): string {
  const verb = reply.kind === "reaction" ? (mine ? "You reacted to their Story" : "Reacted to your Story") : mine ? "You replied to their Story" : "Replied to your Story";
  return reply.storyId ? verb : `${verb} · no longer available`;
}
