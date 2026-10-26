import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Image, Text, View } from "react-native";
import { Avatar } from "../src/components/Avatar";
import { PROFILE_PHOTO_RETRY_DELAYS_MS, rememberLocalProfilePhoto } from "../src/hooks/useProfilePhotoSource";

const mockAuth = { accessToken: "token" };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));

let current: ReactTestRenderer | undefined;
afterEach(async () => {
  mockAuth.accessToken = "token";
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

test("a photo still being processed (404 for a few seconds after it's saved) is asked for again, then shows", async () => {
  jest.useFakeTimers();
  try {
    await render(<Avatar username="dev" displayName="Dev" avatarMediaId="m3" />);
    await act(async () => image()!.props.onError());
    // The initial while waiting, not a blank circle, and not given up on.
    expect(image()).toBeUndefined();
    expect(initial()).toBe("D");
    await act(async () => { jest.advanceTimersByTime(PROFILE_PHOTO_RETRY_DELAYS_MS[0]!); });
    expect(image()!.props.source.uri).toMatch(/\/users\/dev\/avatar\/file\?v=m3&attempt=1$/);
    expect(image()!.props.source.headers).toEqual({ Authorization: "Bearer token" });
    // Still not ready: tried again, later each time, until it gives up on it.
    for (const delay of PROFILE_PHOTO_RETRY_DELAYS_MS.slice(1)) {
      await act(async () => image()!.props.onError());
      await act(async () => { jest.advanceTimersByTime(delay); });
      expect(image()).toBeDefined();
    }
    await act(async () => image()!.props.onError());
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(image()).toBeUndefined();
    expect(initial()).toBe("D");
  } finally {
    jest.useRealTimers();
  }
});

test("the photo you just saved on this phone shows at once, from the phone; the server's if that file is gone", async () => {
  rememberLocalProfilePhoto("m4", "file:///cache/cropped.jpg");
  await render(<Avatar username="me" displayName="Me" avatarMediaId="m4" />);
  expect(image()!.props.source).toEqual({ uri: "file:///cache/cropped.jpg" });
  await act(async () => image()!.props.onError());
  expect(image()!.props.source.uri).toMatch(/\/users\/me\/avatar\/file\?v=m4$/);
});

test("a photo refused because the sign-in had just expired shows once the session is refreshed", async () => {
  await render(<Avatar username="erin" displayName="Erin" />);
  await act(async () => image()!.props.onError());
  expect(initial()).toBe("E");
  mockAuth.accessToken = "token-2";
  await render(<Avatar username="erin" displayName="Erin" />);
  expect(image()!.props.source.headers).toEqual({ Authorization: "Bearer token-2" });
});

test("a name starting with an emoji or another script shows that whole character, never half of an emoji", async () => {
  await render(<Avatar username="sun" displayName="😀 Sunny" avatarMediaId={null} />);
  expect(initial()).toBe("😀");
  await render(<Avatar username="raj" displayName="राज" avatarMediaId={null} />);
  expect(initial()).toBe("र");
  await render(<Avatar username="ann" displayName="  ann" avatarMediaId={null} />);
  expect(initial()).toBe("A");
});
