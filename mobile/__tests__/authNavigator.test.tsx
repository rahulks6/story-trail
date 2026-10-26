import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthNavigator } from "../src/navigation/AuthNavigator";

// The signed-out screens share one error (useAuth). Each screen is a stand-in that shows it.
const mockListeners = new Set<() => void>();
const mockAuth = { error: null as string | null, clearError: jest.fn(() => { mockAuth.error = null; mockListeners.forEach((l) => l()); }) };
jest.mock("../src/state/AuthContext", () => ({
  useAuth: () => {
    // Like the real context: clearing the error re-renders the screens.
    const [, rerender] = require("react").useReducer((n: number) => n + 1, 0);
    require("react").useEffect(() => { mockListeners.add(rerender); return () => { mockListeners.delete(rerender); }; }, []);
    return mockAuth;
  },
}));
function mockScreen(name: string) {
  return ({ navigation }: { navigation: { navigate: (to: string) => void; goBack: () => void } }) => {
    const { Text: T } = require("react-native");
    const R = require("react");
    jest.requireMock("../src/state/AuthContext").useAuth();
    return R.createElement(
      R.Fragment,
      null,
      R.createElement(T, null, `${name}: ${mockAuth.error ?? "no error"}`),
      R.createElement(T, { accessibilityLabel: `${name} to Signup`, onPress: () => navigation.navigate("Signup") }),
      R.createElement(T, { accessibilityLabel: `${name} back`, onPress: () => navigation.goBack() }),
    );
  };
}
jest.mock("../src/screens/auth/LoginScreen", () => ({ LoginScreen: mockScreen("Login") }));
jest.mock("../src/screens/auth/SignupScreen", () => ({ SignupScreen: mockScreen("Signup") }));
jest.mock("../src/screens/auth/ForgotPasswordScreen", () => ({ ForgotPasswordScreen: mockScreen("Forgot") }));
jest.mock("../src/screens/auth/ResetPasswordScreen", () => ({ ResetPasswordScreen: mockScreen("Reset") }));
jest.mock("../src/screens/profile/AppealsScreen", () => ({ AppealsScreen: mockScreen("Appeals") }));

let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
});
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join("")).filter(Boolean);
const press = (label: string) => act(async () => tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0]!.props.onPress());

test("a Log in error doesn't follow you to Sign up, and a Sign up error doesn't follow you back", async () => {
  mockAuth.error = "Your session has ended. Please sign in again.";
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <NavigationContainer><AuthNavigator /></NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  // Shown where it was raised.
  expect(texts()).toContain("Login: Your session has ended. Please sign in again.");
  expect(mockAuth.clearError).not.toHaveBeenCalled();

  await press("Login to Signup");
  expect(mockAuth.clearError).toHaveBeenCalled();
  expect(texts()).toContain("Signup: no error");

  mockAuth.clearError.mockClear();
  mockAuth.error = "That username is already taken.";
  await press("Signup back");
  expect(mockAuth.clearError).toHaveBeenCalled();
  expect(mockAuth.error).toBeNull();
});
