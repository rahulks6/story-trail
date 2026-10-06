import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Image, Text, View } from "react-native";
import { Avatar } from "../src/components/Avatar";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));

let current: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => current?.unmount());
  current = undefined;
});
async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    if (current) current.update(element);
    else current = create(element);
  });
}
const root = () => current!.root;
const image = () => root().findAllByType(Image)[0];
const initial = () => root().findAllByType(Text).map((t) => t.props.children)[0];

test("shows the person's photo from the access-checked endpoint, versioned by the media id", async () => {
  await render(<Avatar username="alice" displayName="Alice" avatarMediaId="m1" />);
  expect(image()!.props.source).toEqual({
    uri: expect.stringMatching(/\/api\/v1\/users\/alice\/avatar\/file\?v=m1$/),
    headers: { Authorization: "Bearer token" },
  });
  // Decorative: the row it sits in names the person.
  expect(root().findAllByType(View)[0]!.props).toMatchObject({ accessible: false, importantForAccessibility: "no-hide-descendants" });
});

test("no photo: the initial, without a request", async () => {
  await render(<Avatar username="bob" displayName="Bob" avatarMediaId={null} />);
  expect(image()).toBeUndefined();
  expect(initial()).toBe("B");
});

test("unknown photo (the Story footer, older servers): tried, and the initial if it fails", async () => {
  await render(<Avatar username="carol" />);
  expect(image()!.props.source.uri).toMatch(/\/users\/carol\/avatar\/file$/);
  await act(async () => image()!.props.onError());
  expect(image()).toBeUndefined();
  expect(initial()).toBe("C");
  // A new photo is tried again.
  await render(<Avatar username="carol" avatarMediaId="m2" />);
  expect(image()!.props.source.uri).toMatch(/\?v=m2$/);
});
