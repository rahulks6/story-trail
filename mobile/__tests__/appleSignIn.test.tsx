import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Platform, StyleSheet, Text } from "react-native";
import * as Keychain from "react-native-keychain";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { appleAuth } from "@invertase/react-native-apple-authentication";
import { ProviderEntry } from "../src/screens/auth/ProviderEntry";
import * as providersApi from "../src/api/providers";

// Sign in with Apple (iPhone only), and Google beside it on iPhone (App Review 4.8). The
// network and Apple's sheet are replaced; this build has Google client IDs for both platforms.
const mockAuth = { acceptSession: jest.fn(async () => undefined) };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/config/providers", () => ({ providerBuild: { googleWebClientId: "web.apps.googleusercontent.com", googleIosClientId: "ios.apps.googleusercontent.com" } }));
jest.mock("../src/api/providers", () => ({ ...jest.requireActual("../src/api/providers"), methods: jest.fn(), appleNonce: jest.fn(), apple: jest.fn() }));

const providers = providersApi as jest.Mocked<typeof providersApi>;
const performRequest = appleAuth.performRequest as jest.Mock;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const PENDING = { service: "com.katkee.provider-onboarding.v1" };

let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  await Keychain.resetGenericPassword(PENDING);
  jest.clearAllMocks();
});
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
async function render(element: React.ReactElement): Promise<void> {
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>); });
  await flush();
}
const ofType = (name: string) => tree.root.findAll((n: ReactTestInstance) => String(n.type) === name);
const texts = () => tree.root.findAllByType(Text).map((t) => String(t.props.children));
const methods = (apple: boolean) => providers.methods.mockResolvedValue({ google: true, apple, phone: false, countries: [], codeLength: 6 });
// Katkee's own "Continue with Google" button (components/GoogleButton.tsx).
const googleButtons = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.testID === "google-sign-in");
const pressApple = async () => { await act(async () => ofType("AppleButton")[0]!.props.onPress()); await flush(); };

test("on iPhone, Apple's button comes first; Google shows only beside it", async () => {
  methods(true);
  await render(<ProviderEntry />);
  const [apple] = ofType("AppleButton"), [google] = googleButtons();
  expect(apple).toBeDefined();
  expect(google).toBeDefined();
  // Above Google and the same size (Human Interface Guidelines).
  const order = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && (n.type === "AppleButton" || n.props.testID === "google-sign-in")).map((n) => (n.type === "AppleButton" ? "Apple" : "Google"));
  expect(order).toEqual(["Apple", "Google"]);
  expect(StyleSheet.flatten(apple!.props.style).height).toBe(StyleSheet.flatten(google!.props.style).height);
  expect(apple!.props.buttonType).toBe("Continue");
  await act(async () => tree.unmount());

  // A server without Sign in with Apple: no Google on iPhone either.
  methods(false);
  await render(<ProviderEntry />);
  expect(ofType("AppleButton")).toHaveLength(0);
  expect(googleButtons()).toHaveLength(0);
});

test("on Android there is no Apple button, and Google needs no Apple", async () => {
  const os = Platform.OS;
  (Platform as { OS: string }).OS = "android";
  try {
    methods(true);
    await render(<ProviderEntry />);
    expect(ofType("AppleButton")).toHaveLength(0);
    expect(googleButtons()).toHaveLength(1);
  } finally {
    (Platform as { OS: string }).OS = os;
  }
});

test("a new Apple account: the server's nonce goes to Apple, and Apple's one-time name is offered and kept", async () => {
  methods(true);
  providers.appleNonce.mockResolvedValue({ nonce: "n".repeat(64), expiresIn: 600 });
  performRequest.mockResolvedValue({ identityToken: "id-token", authorizationCode: "code", fullName: { givenName: "Asha", familyName: "Rao" }, nonce: "n".repeat(64) });
  providers.apple.mockResolvedValue({ onboardingRequired: true, proof: "p".repeat(64), expiresIn: 300 });
  await render(<ProviderEntry />);
  await pressApple();
  expect(performRequest).toHaveBeenCalledWith(expect.objectContaining({ nonce: "n".repeat(64), requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL] }));
  expect(providers.apple).toHaveBeenCalledWith("id-token", "code", false);
  expect(texts()).toContain("Create your account");
  const name = tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === "Display name (optional)");
  expect(name.props.value).toBe("Asha Rao");
  // Apple won't send the name again: it survives the app closing before sign-up finishes.
  const saved = await Keychain.getGenericPassword(PENDING);
  expect(saved && JSON.parse(saved.password)).toMatchObject({ proof: "p".repeat(64), name: "Asha Rao" });
  await act(async () => tree.unmount());
  await render(<ProviderEntry />);
  expect(tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === "Display name (optional)").props.value).toBe("Asha Rao");
});

test("a returning person is signed in; cancelling Apple's sheet is not an error; linking asks for a proof only", async () => {
  methods(true);
  providers.appleNonce.mockResolvedValue({ nonce: "m".repeat(64), expiresIn: 600 });
  performRequest.mockResolvedValue({ identityToken: "id-token", authorizationCode: "code", fullName: null, nonce: "m".repeat(64) });
  const session = { user: { id: "u1" }, tokens: { accessToken: "a", refreshToken: "r" } } as unknown as providersApi.ProviderSession;
  providers.apple.mockResolvedValue(session);
  await render(<ProviderEntry />);
  await pressApple();
  expect(mockAuth.acceptSession).toHaveBeenCalledWith(session);

  performRequest.mockRejectedValueOnce(Object.assign(new Error("The operation couldn't be completed."), { code: "1001" }));
  await pressApple();
  expect(texts().some((t) => /couldn't be completed/.test(t))).toBe(false);
  await act(async () => tree.unmount());

  const onProof = jest.fn(async () => undefined);
  providers.apple.mockResolvedValue({ proof: "q".repeat(64), expiresIn: 300 });
  await render(<ProviderEntry onProof={onProof} />);
  await pressApple();
  expect(providers.apple).toHaveBeenLastCalledWith("id-token", "code", true);
  expect(onProof).toHaveBeenCalledWith("q".repeat(64));
});
