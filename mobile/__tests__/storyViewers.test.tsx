// Your Story's viewers: tapping one opens their profile, and the sheet closes first.
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { StoryInsightsSheet } from "../src/components/StoryInsightsSheet";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("../src/components/StickerResults", () => ({ StickerResults: () => null }));
jest.mock("../src/api/stories", () => ({
  getStoryInsights: jest.fn(async () => ({ insights: { viewCount: 2, completionRate: 0.5, followingViewRate: 0.5, discoveryViewRate: 0.5, profileVisitRate: 0 } })),
  getStoryViewers: jest.fn(async () => ({ viewers: [
    { id: "u1", username: "riya", displayName: "Riya", avatarMediaId: null, verified: false, viewedAt: "2026-11-16T10:00:00Z" },
    { id: "u2", username: "aman", displayName: "Aman", avatarMediaId: null, verified: false, viewedAt: "2026-11-16T09:00:00Z" },
  ] })),
}));

test("tapping someone who viewed your Story opens their profile", async () => {
  const onClose = jest.fn();
  const onOpenProfile = jest.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<StoryInsightsSheet visible storyId="s1" onClose={onClose} onOpenProfile={onOpenProfile} />); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  const row = tree.root.find((n) => n.props.testID === "viewer-riya" && typeof n.props.onPress === "function");
  expect(row.props.accessibilityLabel).toBe("Open @riya's profile");
  await act(async () => row.props.onPress());
  expect(onClose).toHaveBeenCalled();
  expect(onOpenProfile).toHaveBeenCalledWith("riya");
  await act(async () => tree.unmount());
});
