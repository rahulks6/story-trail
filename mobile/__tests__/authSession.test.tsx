import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthProvider, useAuth } from "../src/state/AuthContext";
import * as authApi from "../src/api/auth";
import * as tokenStorage from "../src/state/tokenStorage";
import { ApiError } from "../src/api/client";

// Restoring a saved session at launch: only the server saying no signs you out.
const mockHandler: { current: ((token: string) => Promise<string>) | null } = { current: null };
jest.mock("../src/api/client", () => {
  const actual = jest.requireActual("../src/api/client");
  return { ...actual, setSessionHandler: (handler: ((token: string) => Promise<string>) | null) => { mockHandler.current = handler; } };
});
jest.mock("../src/api/auth", () => ({ fetchMe: jest.fn(), refresh: jest.fn(), logout: jest.fn(async () => undefined) }));
jest.mock("../src/state/tokenStorage", () => ({
  loadTokens: jest.fn(async () => ({ accessToken: "a1", refreshToken: "r1" })),
  saveTokens: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
}));
jest.mock("../src/push/pushNotifications", () => ({ unregisterForPush: jest.fn(async () => undefined) }));
jest.mock("../src/state/dmOutbox", () => ({ clearOutbox: jest.fn(async () => undefined) }));
jest.mock("../src/screens/dm/dmMediaOutbox", () => ({ clearMediaOutbox: jest.fn(async () => undefined) }));

const api = authApi as jest.Mocked<typeof authApi>;
const tokens = tokenStorage as jest.Mocked<typeof tokenStorage>;
const me = { id: "u-1", username: "rahul", email: "r@example.com", displayName: "Rahul", bio: "", avatarMediaId: null, interests: [], isPrivate: false };

function Probe(): React.JSX.Element {
  const { status, user } = useAuth();
  return <Text>{`${status}:${user?.username ?? "-"}`}</Text>;
}
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const shown = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
async function launch(): Promise<void> {
  await act(async () => { tree = create(<AuthProvider><Probe /></AuthProvider>); });
  await flush();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
});

test("offline at launch, the saved account opens the app and the session is kept", async () => {
  await AsyncStorage.setItem("katkee.lastUser.v1", JSON.stringify(me));
  api.fetchMe.mockRejectedValue(new TypeError("Network request failed"));
  await launch();
  expect(shown()).toEqual(["signedIn:rahul"]);
  expect(tokens.clearTokens).not.toHaveBeenCalled();
});

test("offline at launch with no saved account: Can't connect, then Try again signs in", async () => {
  api.fetchMe.mockRejectedValueOnce(new ApiError(408, "The request timed out.")).mockResolvedValueOnce({ user: me });
  await launch();
  expect(shown()).toContain("Can't connect to Katkee. Check your connection and try again.");
  expect(tokens.clearTokens).not.toHaveBeenCalled();
  await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Try again").props.onPress());
  await flush();
  expect(shown()).toEqual(["signedIn:rahul"]);
  // The account is saved for the next offline launch.
  expect(JSON.parse((await AsyncStorage.getItem("katkee.lastUser.v1"))!)).toMatchObject({ id: "u-1" });
});

test("a session the server rejects (401) signs out and forgets the saved account", async () => {
  await AsyncStorage.setItem("katkee.lastUser.v1", JSON.stringify(me));
  api.fetchMe.mockRejectedValue(new ApiError(401, "Please sign in again."));
  await launch();
  expect(shown()).toEqual(["signedOut:-"]);
  expect(tokens.clearTokens).toHaveBeenCalled();
  await flush();
  expect(await AsyncStorage.getItem("katkee.lastUser.v1")).toBeNull();
});

test("a refresh that fails on the network keeps you signed in; only a refused refresh token signs out", async () => {
  api.fetchMe.mockResolvedValue({ user: me });
  await launch();
  expect(shown()).toEqual(["signedIn:rahul"]);

  api.refresh.mockRejectedValueOnce(new TypeError("Network request failed"));
  await act(async () => { await expect(mockHandler.current!("a1")).rejects.toThrow("Network request failed"); });
  api.refresh.mockRejectedValueOnce(new ApiError(408, "The request timed out."));
  await act(async () => { await expect(mockHandler.current!("a1")).rejects.toThrow("timed out"); });
  expect(shown()).toEqual(["signedIn:rahul"]);
  expect(tokens.clearTokens).not.toHaveBeenCalled();

  // Two requests rejected at once share one refresh.
  let finish!: (v: { tokens: { accessToken: string; refreshToken: string } }) => void;
  api.refresh.mockReturnValueOnce(new Promise((r) => { finish = r; }));
  let both!: Promise<string[]>;
  await act(async () => { both = Promise.all([mockHandler.current!("a1"), mockHandler.current!("a1")]); });
  await act(async () => finish({ tokens: { accessToken: "a2", refreshToken: "r2" } }));
  expect(await both).toEqual(["a2", "a2"]);
  expect(api.refresh).toHaveBeenCalledTimes(3);

  api.refresh.mockRejectedValueOnce(new ApiError(401, "Invalid or expired refresh token."));
  await act(async () => { await expect(mockHandler.current!("a2")).rejects.toBeInstanceOf(ApiError); });
  await flush();
  expect(shown()).toEqual(["signedOut:-"]);
  expect(tokens.clearTokens).toHaveBeenCalled();
});
