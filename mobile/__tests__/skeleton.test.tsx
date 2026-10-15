import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { ListSkeleton, ProfileSkeleton, StorySkeleton, ThreadSkeleton } from "../src/components/Skeleton";

let tree: ReactTestRenderer;
const busy = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityRole === "progressbar");

describe("loading skeletons", () => {
  it.each([
    ["a Story", <StorySkeleton key="s" />, "Loading Stories"],
    ["a list", <ListSkeleton key="l" rows={3} label="Loading people" />, "Loading people"],
    ["a profile", <ProfileSkeleton key="p" />, "Loading profile"],
    ["a conversation", <ThreadSkeleton key="t" />, "Loading messages"],
  ])("say Loading once for %s, as a busy progress bar", async (_name, element, label) => {
    await act(async () => { tree = create(element); });
    const roots = busy();
    expect(roots).toHaveLength(1);
    expect(roots[0]!.props.accessibilityLabel).toBe(label);
    expect(roots[0]!.props.accessibilityState).toEqual({ busy: true });
    expect(roots[0]!.props.accessible).toBe(true);
    await act(async () => tree.unmount());
  });
});
