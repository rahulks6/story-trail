import React from "react";
import { act, create } from "react-test-renderer";
import { Text } from "react-native";
import { EmptyState } from "../src/components/EmptyState";

test("renders a real component with the React Native preset", async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<EmptyState title="Nothing here" message="Try again later" />);
  });
  const texts = tree.root.findAllByType(Text).map((t) => t.props.children);
  expect(texts).toEqual(expect.arrayContaining(["Nothing here", "Try again later"]));
});
