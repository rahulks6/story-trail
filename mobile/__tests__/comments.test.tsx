import React from "react";
import { Alert, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CommentsSheet } from "../src/components/CommentsSheet";
import * as engagement from "../src/api/engagement";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul", displayName: "Rahul", avatarMediaId: null } }) }));
jest.mock("../src/components/ReportSheet", () => ({ ReportSheet: (p: object) => require("react").createElement("ReportSheet", p) }));
jest.mock("../src/components/Avatar", () => ({ Avatar: (p: object) => require("react").createElement("Avatar", p) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const comment = (id: string, userId: string, username: string, body: string) => ({ id, storyId: "s1", userId, username, displayName: username, avatarMediaId: null, body, createdAt: new Date().toISOString() });
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const press = (label: string) => act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
const texts = () => tree.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Text").map((t) => [t.props.children].flat().join(""));

async function open(props: Partial<React.ComponentProps<typeof CommentsSheet>> = {}) {
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <CommentsSheet visible storyId="s1" storyOwnerId="owner" commentsDisabled={false} onClose={jest.fn()} onCommentCountChange={jest.fn()} {...props} />
      </SafeAreaProvider>,
    );
  });
  await flush();
}

afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });

test("a comment shows at once, and stays if the server stores it", async () => {
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [comment("c1", "u2", "asha", "Nice!")], limit: 50, offset: 0 });
  let resolve!: (v: { comment: engagement.Comment }) => void;
  jest.spyOn(engagement, "postComment").mockReturnValue(new Promise((r) => { resolve = r; }));
  const onCount = jest.fn();
  await open({ onCommentCountChange: onCount });
  expect(texts()).toContain("1 comment");
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("So good"));
  await press("Post comment");
  expect(texts()).toContain("So good");
  expect(texts()).toContain("Posting…");
  await act(async () => resolve({ comment: comment("c2", "me", "rahul", "So good") }));
  expect(texts()).not.toContain("Posting…");
  expect(onCount).toHaveBeenCalledWith(1);
});

test("a failed comment goes back into the box with the reason", async () => {
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [], limit: 50, offset: 0 });
  const { ApiError } = require("../src/api/client");
  jest.spyOn(engagement, "postComment").mockRejectedValue(new ApiError(403, "Only followers can comment on this Story."));
  await open();
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("Hi"));
  await press("Post comment");
  await flush();
  expect(tree.root.findByType(TextInput).props.value).toBe("Hi");
  expect(texts()).toContain("Only followers can comment on this Story.");
});

test("options: delete your own after confirming, report someone else's; names open profiles", async () => {
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [comment("c1", "u2", "asha", "Nice!"), comment("c2", "me", "rahul", "Thanks")], limit: 50, offset: 0 });
  const del = jest.spyOn(engagement, "deleteComment").mockResolvedValue();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const onOpenProfile = jest.fn();
  await open({ onOpenProfile });
  const options = tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Comment options");
  await act(async () => options[0]!.props.onPress());
  expect((alert.mock.calls.at(-1)![2] as { text: string }[]).map((b) => b.text)).toEqual(["Report", "Cancel"]);
  await act(async () => options[1]!.props.onPress());
  const buttons = alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
  expect(buttons.map((b) => b.text)).toEqual(["Delete", "Cancel"]);
  await act(async () => buttons[0]!.onPress!());
  expect(alert.mock.calls.at(-1)![0]).toBe("Delete comment?");
  await act(async () => (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => Promise<void> }[]).find((b) => b.text === "Delete")!.onPress!());
  expect(del).toHaveBeenCalledWith("c2", "token");
  await press("@asha's profile");
  expect(onOpenProfile).toHaveBeenCalledWith("asha");
});

test("explains when only followers can comment", async () => {
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [], limit: 50, offset: 0 });
  await open({ followersOnly: true });
  expect(texts()).toContain("Only followers can comment on this Story.");
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
});

test("the comment box sits above Android's navigation bar, and on the keyboard while typing", async () => {
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [], limit: 50, offset: 0 });
  const { Keyboard, StyleSheet } = require("react-native");
  const listen = jest.spyOn(Keyboard, "addListener");
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ ...metrics, insets: { top: 0, left: 0, right: 0, bottom: 48 } }}>
        <CommentsSheet visible storyId="s1" storyOwnerId="owner" commentsDisabled={false} onClose={jest.fn()} onCommentCountChange={jest.fn()} />
      </SafeAreaProvider>,
    );
  });
  await flush();
  const room = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.flexShrink === 1 && StyleSheet.flatten(n.props.style)?.paddingBottom !== undefined)[0]!;
  expect(StyleSheet.flatten(room().props.style).paddingBottom).toBeGreaterThanOrEqual(48);
  // Everything listening for the keyboard hears it (the sheet also grows with it).
  const shown = listen.mock.calls.filter((call: unknown[]) => call[0] === "keyboardDidShow").map((call) => call[1] as () => void);
  await act(async () => shown.forEach((fn) => fn()));
  expect(StyleSheet.flatten(room().props.style).paddingBottom).toBe(0);
});

test("a comment that timed out but was stored isn't put back in the box (no duplicate on resend)", async () => {
  const { ApiError } = require("../src/api/client");
  jest.spyOn(engagement, "listComments")
    .mockResolvedValueOnce({ comments: [comment("c1", "u2", "asha", "Nice!")], limit: 50, offset: 0 })
    .mockResolvedValueOnce({ comments: [comment("c1", "u2", "asha", "Nice!"), comment("c9", "me", "rahul", "So good")], limit: 50, offset: 0 });
  jest.spyOn(engagement, "postComment").mockRejectedValue(new ApiError(408, "The request timed out."));
  const onCount = jest.fn();
  await open({ onCommentCountChange: onCount });
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("So good"));
  await press("Post comment");
  await flush();
  expect(tree.root.findByType(TextInput).props.value).toBe("");
  expect(texts()).toContain("2 comments");
  expect(texts()).not.toContain("Posting…");
  expect(onCount).toHaveBeenCalledWith(1);
});

test("a timed-out comment the server doesn't have goes back into the box; Post is off while one is sending", async () => {
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [], limit: 50, offset: 0 });
  let fail!: () => void;
  const post = jest.spyOn(engagement, "postComment").mockReturnValue(new Promise((_, reject) => { fail = () => reject(new TypeError("Network request failed")); }));
  await open();
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("Hi"));
  await press("Post comment");
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("Again"));
  const send = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Post comment");
  expect(send.props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => send.props.onPress());
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => { fail(); });
  await flush();
  expect(tree.root.findByType(TextInput).props.value).toBe("Again"); // what they typed since is kept
  expect(texts()).toContain("Couldn't post that comment.");
});
