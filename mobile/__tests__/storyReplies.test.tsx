import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import * as conversationsApi from "../src/api/conversations";
import { ApiError } from "../src/api/client";
import { ReplySheet } from "../src/components/ReplySheet";
import { storyReplyLabel } from "../src/models/storyReplies";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));

const g = globalThis as unknown as { __haptics: string[] };
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const pressable = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));

const sent = { message: { id: "m1", conversationId: "c1", senderId: "me", body: "🔥", sharedStoryId: null, createdAt: "", storyReply: { storyId: "s1", kind: "reaction" as const } }, conversationId: "c1" };

beforeEach(() => {
  g.__haptics = [];
  jest.restoreAllMocks();
});

async function open(onSent = jest.fn(), onClose = jest.fn()) {
  await act(async () => { tree = create(<ReplySheet visible storyId="s1" ownerUsername="asha" onClose={onClose} onSent={onSent} />); });
  await flush();
  return { onSent, onClose };
}

describe("ReplySheet", () => {
  it("sends a quick reaction with one tap, then closes with a success haptic", async () => {
    const reply = jest.spyOn(conversationsApi, "replyToStory").mockResolvedValue(sent);
    const { onSent, onClose } = await open();
    expect(texts()).toContain("Reply to @asha");
    expect(conversationsApi.STORY_REACTIONS).toHaveLength(8);
    await act(async () => pressable("React with 🔥").props.onPress());
    await flush();
    expect(reply).toHaveBeenCalledWith("s1", { reaction: "🔥" }, "token", expect.stringMatching(/^reply_/));
    expect(onSent).toHaveBeenCalledWith("reaction");
    expect(onClose).toHaveBeenCalled();
    expect(g.__haptics).toEqual(["notificationSuccess"]);
  });

  it("sends a written reply, trimmed, and keeps the same id when retrying after an error", async () => {
    const reply = jest.spyOn(conversationsApi, "replyToStory")
      .mockRejectedValueOnce(new ApiError(503, "Try again in a moment."))
      .mockResolvedValueOnce({ ...sent, message: { ...sent.message, body: "So good", storyReply: { storyId: "s1", kind: "reply" } } });
    const { onSent } = await open();
    const input = tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === "Reply" && typeof n.props.onChangeText === "function");
    await act(async () => input.props.onChangeText("  So good  "));
    await act(async () => pressable("Send reply").props.onPress());
    await flush();
    expect(texts()).toContain("Try again in a moment.");
    expect(onSent).not.toHaveBeenCalled();
    await act(async () => pressable("Send reply").props.onPress());
    await flush();
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[0]![1]).toEqual({ body: "So good" });
    expect(reply.mock.calls[1]![3]).toBe(reply.mock.calls[0]![3]);
    expect(onSent).toHaveBeenCalledWith("reply");
  });

  it("won't send an empty reply", async () => {
    const reply = jest.spyOn(conversationsApi, "replyToStory");
    await open();
    expect(pressable("Send reply").props.accessibilityState).toMatchObject({ disabled: true });
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("story reply captions in DMs", () => {
  it("say who answered which Story, from each side", () => {
    expect(storyReplyLabel({ storyId: "s1", kind: "reply" }, false)).toBe("Replied to your Story");
    expect(storyReplyLabel({ storyId: "s1", kind: "reaction" }, false)).toBe("Reacted to your Story");
    expect(storyReplyLabel({ storyId: "s1", kind: "reply" }, true)).toBe("You replied to their Story");
    expect(storyReplyLabel({ storyId: null, kind: "reaction" }, true)).toBe("You reacted to their Story · no longer available");
  });
});
