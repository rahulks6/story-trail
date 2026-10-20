import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text, TextInput } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { VerifyEmailScreen } from "../src/screens/auth/VerifyEmailScreen";
import * as authApi from "../src/api/auth";
import { ApiError } from "../src/api/client";

const mockAuth = { accessToken: "token", user: { id: "u-me", email: "me@example.com", emailVerified: false }, applyProfile: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/api/auth", () => ({ sendEmailCode: jest.fn(async () => undefined), verifyEmail: jest.fn() }));
const api = authApi as jest.Mocked<typeof authApi>;

const navigation = { goBack: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) };
let tree: ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <VerifyEmailScreen navigation={navigation as never} route={{ key: "v", name: "VerifyEmail" } as never} />
      </SafeAreaProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.useRealTimers();
});

test("says where the code went, accepts the right code, and carries on into the app", async () => {
  expect(texts().join(" ")).toContain("me@example.com");
  const user = { ...mockAuth.user, emailVerified: true };
  api.verifyEmail.mockResolvedValueOnce({ user } as never);
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("12a3456"));
  expect(tree.root.findByType(TextInput).props.value).toBe("123456");
  await act(async () => button("Verify").props.onPress());
  await settle();
  expect(api.verifyEmail).toHaveBeenCalledWith("123456", "token");
  expect(mockAuth.applyProfile).toHaveBeenCalledWith(user);
  expect(navigation.replace).toHaveBeenCalledWith("Main", { screen: "Home" });
});

test("a wrong code shows the server's message and stays", async () => {
  api.verifyEmail.mockRejectedValueOnce(new ApiError(400, "That code is incorrect or has expired. Send a new code and try again."));
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("000000"));
  await act(async () => button("Verify").props.onPress());
  await settle();
  expect(texts()).toContain("That code is incorrect or has expired. Send a new code and try again.");
  expect(navigation.replace).not.toHaveBeenCalled();
});

test("a new code can be sent after a short wait; Later skips for now", async () => {
  await act(async () => button("Send a new code (30s)").props.onPress());
  expect(api.sendEmailCode).not.toHaveBeenCalled();
  for (let i = 0; i < 30; i++) await act(async () => { jest.advanceTimersByTime(1000); });
  await act(async () => button("Send a new code").props.onPress());
  await settle();
  expect(api.sendEmailCode).toHaveBeenCalledWith("token");
  expect(texts()).toContain("We sent a new code to me@example.com.");
  await act(async () => button("Later").props.onPress());
  expect(navigation.replace).toHaveBeenCalledWith("Main", { screen: "Home" });
});
