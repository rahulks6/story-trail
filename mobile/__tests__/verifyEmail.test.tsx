import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { AppState, Text, TextInput } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { VerifyEmailScreen } from "../src/screens/auth/VerifyEmailScreen";
import * as authApi from "../src/api/auth";
import { ApiError } from "../src/api/client";

const mockAuth = {
  accessToken: "token",
  user: { id: "u-me", email: "me@example.com", emailVerified: false, emailVerificationRequired: false },
  applyProfile: jest.fn(),
  logout: jest.fn(async () => undefined),
  refreshUser: jest.fn(async () => undefined),
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/api/auth", () => ({ sendEmailCode: jest.fn(async () => undefined), verifyEmail: jest.fn(), changeEmail: jest.fn() }));
const api = authApi as jest.Mocked<typeof authApi>;

const navigation = { goBack: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) };
let tree: ReactTestRenderer;
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); }); };

async function render() {
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <VerifyEmailScreen navigation={navigation as never} route={{ key: "v", name: "VerifyEmail" } as never} />
      </SafeAreaProvider>,
    );
  });
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAuth.user = { ...mockAuth.user, email: "me@example.com", emailVerificationRequired: false };
  await render();
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
  await act(async () => button("Send a new code in 30s").props.onPress());
  expect(api.sendEmailCode).not.toHaveBeenCalled();
  for (let i = 0; i < 30; i++) await act(async () => { jest.advanceTimersByTime(1000); });
  await act(async () => button("Send a new code").props.onPress());
  await settle();
  expect(api.sendEmailCode).toHaveBeenCalledWith("token");
  expect(texts()).toContain("We sent a new code to me@example.com.");
  await act(async () => button("Later").props.onPress());
  expect(navigation.replace).toHaveBeenCalledWith("Main", { screen: "Home" });
});

describe("a new account, which must verify", () => {
  beforeEach(async () => {
    await act(async () => tree.unmount());
    mockAuth.user = { ...mockAuth.user, emailVerificationRequired: true };
    await render();
  });

  test("has no Later; the right code lifts the gate without navigating", async () => {
    expect(texts().join(" ")).toContain("Enter it to finish creating your account.");
    expect(texts()).not.toContain("Later");
    api.verifyEmail.mockResolvedValueOnce({ user: { ...mockAuth.user, emailVerified: true, emailVerificationRequired: false } } as never);
    await act(async () => tree.root.findByType(TextInput).props.onChangeText("123456"));
    await act(async () => button("Verify").props.onPress());
    await settle();
    expect(mockAuth.applyProfile).toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  test("a mistyped email can be fixed, and a new code goes there", async () => {
    await act(async () => button("Change email").props.onPress());
    expect(tree.root.findByType(TextInput).props.value).toBe("me@example.com");
    api.changeEmail.mockResolvedValueOnce({ user: { ...mockAuth.user, email: "fixed@example.com" } } as never);
    await act(async () => tree.root.findByType(TextInput).props.onChangeText(" Fixed@Example.com "));
    await act(async () => button("Send code").props.onPress());
    await settle();
    expect(api.changeEmail).toHaveBeenCalledWith("fixed@example.com", "token");
    expect(texts()).toContain("We sent a new code to fixed@example.com.");
    expect(button("Send a new code in 30s")).toBeTruthy();
  });

  test("a rejected email shows the server's message; Log out signs out", async () => {
    await act(async () => button("Change email").props.onPress());
    api.changeEmail.mockRejectedValueOnce(new ApiError(409, "That email is already used by another account."));
    await act(async () => tree.root.findByType(TextInput).props.onChangeText("taken@example.com"));
    await act(async () => button("Send code").props.onPress());
    await settle();
    expect(texts()).toContain("That email is already used by another account.");
    await act(async () => button("Cancel").props.onPress());
    await act(async () => button("Log out").props.onPress());
    expect(mockAuth.logout).toHaveBeenCalled();
  });
});

test("a required check looks again when the app comes back, so verifying elsewhere lets you in", async () => {
  const listeners: Array<(state: string) => void> = [];
  const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() } as never;
  });
  try {
    await act(async () => tree.unmount());
    mockAuth.user = { ...mockAuth.user, emailVerificationRequired: true };
    await render();
    await act(async () => listeners.forEach((l) => l("background")));
    expect(mockAuth.refreshUser).not.toHaveBeenCalled();
    await act(async () => listeners.forEach((l) => l("active")));
    expect(mockAuth.refreshUser).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});
