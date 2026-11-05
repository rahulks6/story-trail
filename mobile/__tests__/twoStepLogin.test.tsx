import React from "react";
import { Text, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthProvider, useAuth } from "../src/state/AuthContext";
import * as authApi from "../src/api/auth";
import { ApiError } from "../src/api/client";

// Two-step login: a sign-in that answers with a challenge brings up the code screen; the right
// code finishes signing in; a wrong one says so and lets you try again.
jest.mock("../src/api/client", () => ({ ...jest.requireActual("../src/api/client"), setSessionHandler: () => undefined }));
jest.mock("../src/api/auth", () => ({ fetchMe: jest.fn(), refresh: jest.fn(), logout: jest.fn(async () => undefined), login: jest.fn(), verifyTwoStep: jest.fn() }));
jest.mock("../src/state/tokenStorage", () => ({ loadTokens: jest.fn(async () => null), saveTokens: jest.fn(async () => undefined), clearTokens: jest.fn(async () => undefined) }));
jest.mock("../src/push/pushNotifications", () => ({ unregisterForPush: jest.fn(async () => undefined) }));
jest.mock("../src/state/dmOutbox", () => ({ clearOutbox: jest.fn(async () => undefined) }));
jest.mock("../src/screens/dm/dmMediaOutbox", () => ({ clearMediaOutbox: jest.fn(async () => undefined) }));

const api = authApi as jest.Mocked<typeof authApi>;
const me = { id: "u-1", username: "rahul", email: "r@example.com", displayName: "Rahul", bio: "", avatarMediaId: null, interests: [], isPrivate: false };
let auth!: ReturnType<typeof useAuth>;
function Probe(): React.JSX.Element {
  auth = useAuth();
  return <Text>{`${auth.status}:${auth.user?.username ?? "-"}`}</Text>;
}
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const shown = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === label));

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => tree?.unmount()); });

test("asks for the code after the password, and the right code signs in", async () => {
  api.login.mockResolvedValue({ twoStepRequired: true, challenge: "c".repeat(64), expiresIn: 300 } as never);
  api.verifyTwoStep.mockRejectedValueOnce(new ApiError(401, "That code isn't right. Check your authenticator app and try again."));
  api.verifyTwoStep.mockResolvedValueOnce({ user: me, tokens: { accessToken: "a", refreshToken: "r" } } as never);
  await act(async () => { tree = create(<AuthProvider><Probe /></AuthProvider>); });
  await flush();
  await act(async () => { await auth.login({ email: "r@example.com", password: "a long password" }); });
  await flush();
  expect(shown()).toContain("signedOut:-");
  expect(shown()).toContain("Enter the 6-digit code from your authenticator app.");

  const input = () => tree.root.findByType(TextInput);
  await act(async () => input().props.onChangeText("12a3456"));
  expect(input().props.value).toBe("123456");
  await act(async () => button("Continue").props.onPress());
  await flush();
  expect(api.verifyTwoStep).toHaveBeenLastCalledWith("c".repeat(64), "123456");
  expect(shown()).toContain("That code isn't right. Check your authenticator app and try again.");

  await act(async () => input().props.onChangeText("654321"));
  await act(async () => button("Continue").props.onPress());
  await flush();
  expect(shown()).toContain("signedIn:rahul");
  expect(shown()).not.toContain("Enter the 6-digit code from your authenticator app.");
});

test("a backup code can be used instead, and Cancel goes back to signing in", async () => {
  api.login.mockResolvedValue({ twoStepRequired: true, challenge: "d".repeat(64), expiresIn: 300 } as never);
  await act(async () => { tree = create(<AuthProvider><Probe /></AuthProvider>); });
  await flush();
  await act(async () => { await auth.login({ email: "r@example.com", password: "a long password" }); });
  await flush();
  await act(async () => button("Use a backup code").props.onPress());
  expect(shown()).toContain("Enter one of your backup codes. Each one works once.");
  await act(async () => button("Cancel").props.onPress());
  await flush();
  expect(shown()).not.toContain("Two-step login");
  expect(auth.twoStep).toBeNull();
});
