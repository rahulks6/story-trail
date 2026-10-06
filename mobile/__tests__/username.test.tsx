import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text, TextInput } from "react-native";
import * as Keychain from "react-native-keychain";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SignupScreen } from "../src/screens/auth/SignupScreen";
import { EditProfileScreen } from "../src/screens/profile/EditProfileScreen";
import { ProviderEntry } from "../src/screens/auth/ProviderEntry";
import * as usersApi from "../src/api/users";
import * as providersApi from "../src/api/providers";
import { ApiError } from "../src/api/client";

// Choosing a username (spec section 23): checked as people type at sign-up, in onboarding and
// in Edit Profile, with the network replaced.
const mockAuth = {
  signup: jest.fn(async () => undefined),
  clearError: jest.fn(),
  error: null as string | null,
  fieldErrors: null as Record<string, string> | null,
  user: { id: "u-me", username: "me_now", email: "me@example.com", displayName: "Me", bio: "", avatarMediaId: null, interests: [], isPrivate: false },
  accessToken: "token",
  applyProfile: jest.fn(),
  acceptSession: jest.fn(async () => undefined),
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("../src/api/users", () => ({ ...jest.requireActual("../src/api/users"), checkUsername: jest.fn(), updateMyProfile: jest.fn() }));
jest.mock("../src/api/providers", () => ({ ...jest.requireActual("../src/api/providers"), methods: jest.fn(), complete: jest.fn() }));

const api = usersApi as jest.Mocked<typeof usersApi>;
const providers = providersApi as jest.Mocked<typeof providersApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
type Answer = usersApi.UsernameAvailability;
const answer = (username: string, reason: Answer["reason"], message: string): Answer =>
  ({ username, reason, message, available: reason === "available" || reason === "yours" });
function pending() {
  let resolve!: (value: Answer) => void;
  const promise = new Promise<Answer>((r) => { resolve = r; });
  return { promise, resolve };
}

let tree: ReactTestRenderer;
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
  jest.clearAllMocks();
});

const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
async function render(element: React.ReactElement): Promise<void> {
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>); });
  await flush();
}
const input = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.onChangeText && String(n.props.accessibilityLabel).startsWith(label));
const type = async (label: string, text: string) => { await act(async () => input(label).props.onChangeText(text)); };
const settle = async () => { await act(async () => { jest.advanceTimersByTime(400); }); await flush(); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const buttonWithText = (text: string) =>
  tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === text));
const signUpButton = () => tree.root.find((n: ReactTestInstance) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Sign up" && typeof n.type === "string");

describe("Sign up", () => {
  const props = { navigation: { navigate: jest.fn() }, route: { key: "Signup", name: "Signup" } } as unknown as React.ComponentProps<typeof SignupScreen>;
  const fillTheRest = async () => {
    await type("Display name", "Rahul K");
    await type("Email", "rahul@example.com");
    await type("Password", "a long passphrase");
  };

  test("checks the name as it's typed; a taken name gives the reason and blocks Sign up", async () => {
    await render(<SignupScreen {...props} />);
    await fillTheRest();
    const first = pending();
    api.checkUsername.mockReturnValueOnce(first.promise);
    await type("Username", "Rahul.K");
    await settle();
    expect(api.checkUsername).toHaveBeenCalledWith("rahul.k", null, expect.any(Object));
    expect(texts()).toContain("Checking…");
    await act(async () => first.resolve(answer("rahul.k", "available", "Available.")));
    await flush();
    expect(texts()).toContain("Available.");
    expect(signUpButton().props.accessibilityState).toMatchObject({ disabled: false });

    api.checkUsername.mockResolvedValueOnce(answer("taken_name", "taken", "That username is taken."));
    await type("Username", "taken_name");
    await settle();
    expect(input("Username").props.accessibilityLabel).toBe("Username. That username is taken.");
    expect(signUpButton().props.accessibilityState).toMatchObject({ disabled: true });
  });

  test("an answer about older text never shows against newer text", async () => {
    await render(<SignupScreen {...props} />);
    const older = pending();
    api.checkUsername.mockReturnValueOnce(older.promise).mockResolvedValueOnce(answer("aaab", "available", "Available."));
    await type("Username", "aaa");
    await settle();
    const olderSignal = api.checkUsername.mock.calls[0]![2]!;
    await type("Username", "aaab");
    await act(async () => older.resolve(answer("aaa", "taken", "That username is taken.")));
    await flush();
    expect(input("Username").props.accessibilityLabel).toBe("Username");
    expect(texts()).toContain("Checking…");
    await settle();
    expect(olderSignal.aborted).toBe(true);
    expect(api.checkUsername).toHaveBeenLastCalledWith("aaab", null, expect.any(Object));
    expect(texts()).toContain("Available.");
  });
});

describe("Edit Profile", () => {
  const props = { navigation: { goBack: jest.fn() }, route: { key: "EditProfile", name: "EditProfile" } } as unknown as React.ComponentProps<typeof EditProfileScreen>;
  const save = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Save profile changes");

  test("the current name isn't checked; another is checked with the session, and a refused one disables Save", async () => {
    await render(<EditProfileScreen {...props} />);
    await settle();
    expect(api.checkUsername).not.toHaveBeenCalled();
    expect(texts()).toContain("3–30 lowercase letters, numbers, dots or underscores.");

    api.checkUsername.mockResolvedValueOnce(answer("me_new", "held", "That username was used recently by someone else. Try another."));
    await type("Username", "me_new");
    await settle();
    expect(api.checkUsername).toHaveBeenCalledWith("me_new", "token", expect.any(Object));
    expect(texts()).toContain("That username was used recently by someone else. Try another.");
    expect(save().props.disabled).toBe(true);

    await type("Username", "me_now");
    await settle();
    expect(api.checkUsername).toHaveBeenCalledTimes(1);
    expect(save().props.disabled).toBe(false);
  });

  test("a refused rename says when the next one is possible", async () => {
    await render(<EditProfileScreen {...props} />);
    api.checkUsername.mockResolvedValueOnce(answer("me_next", "available", "Available."));
    await type("Username", "me_next");
    await settle();
    expect(texts()).toContain("Available.");
    const limit = "You can change your username twice in 14 days. Try again after 2026-10-20.";
    api.updateMyProfile.mockRejectedValueOnce(new ApiError(429, limit, { username: limit }));
    await act(async () => save().props.onPress());
    await flush();
    expect(texts()).toContain(limit);
    expect(props.navigation.goBack).not.toHaveBeenCalled();
  });
});

describe("Google or phone onboarding", () => {
  test("the chosen name is lowercased and checked; a reserved one can't continue", async () => {
    providers.methods.mockResolvedValue({ google: false, phone: false, countries: [], codeLength: 6 });
    await Keychain.setGenericPassword("pending", JSON.stringify({ proof: "proof-1", expiresAt: Date.now() + 60_000 }), { service: "com.katkee.provider-onboarding.v1" });
    await render(<ProviderEntry />);
    expect(texts()).toContain("Choose your username");

    api.checkUsername.mockResolvedValueOnce(answer("k4tkee", "reserved", "That username is reserved."));
    await type("Username", "K4tkee");
    expect(input("Username").props.value).toBe("k4tkee");
    await settle();
    expect(api.checkUsername).toHaveBeenCalledWith("k4tkee", null, expect.any(Object));
    expect(texts()).toContain("That username is reserved.");
    expect(buttonWithText("Continue to Katkee").props.disabled).toBe(true);

    api.checkUsername.mockResolvedValueOnce(answer("new_person", "available", "Available."));
    await type("Username", "new_person");
    await settle();
    expect(buttonWithText("Continue to Katkee").props.disabled).toBe(false);
    providers.complete.mockResolvedValueOnce({ user: mockAuth.user, tokens: { accessToken: "a", refreshToken: "r" } } as never);
    await act(async () => buttonWithText("Continue to Katkee").props.onPress());
    await flush();
    expect(providers.complete).toHaveBeenCalledWith("proof-1", "new_person", "");
  });
});
