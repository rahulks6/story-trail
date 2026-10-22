/**
 * The app's identity: the mark from the app icon on sign-in and About, the release version from
 * build-config.json, and the public pages (Privacy Policy, Terms, Help Center) the stores also
 * link to.
 */
import React from "react";
import { Alert, Linking } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import buildConfig from "../build-config.json";
import { BrandMark } from "../src/components/BrandMark";
import { BRAND_MARK } from "../src/components/brandMarkPaths";
import { LoginScreen } from "../src/screens/auth/LoginScreen";
import { AboutScreen } from "../src/screens/profile/AboutScreen";
import { HelpScreen } from "../src/screens/profile/HelpScreen";
import { colors } from "../src/theme/colors";

jest.mock("../src/state/AuthContext", () => ({
  useAuth: () => ({ login: jest.fn(), clearError: jest.fn(), error: null, fieldErrors: null }),
}));
jest.mock("../src/screens/auth/ProviderEntry", () => ({ ProviderEntry: () => null }));
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ navigate: mockNavigate }) }));
// A version unlike build-config.json's, so About can only show it by reading the release version.
jest.mock("../src/config/env", () => ({ appEnv: { apiBaseUrl: "https://api.katkee.com/", appVersion: "9.8.7" } }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
let mounted: ReactTestRenderer | null = null;
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
  jest.restoreAllMocks();
});
async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    mounted = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>);
  });
  return mounted!;
}
const hosts = (tree: ReactTestRenderer, test: (n: ReactTestInstance) => boolean) => tree.root.findAll((n) => typeof n.type === "string" && test(n));
const textOf = (n: ReactTestInstance): string => n.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const row = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => typeof n.props.onPress === "function" && n.props.accessibilityRole === "button" && n.props.accessibilityLabel === label);

describe("the mark", () => {
  test("is the icon's traced shape, in the app's colours, scaled to the height asked for, and hidden from screen readers", async () => {
    const tree = await render(<BrandMark height={64} />);
    const [svg] = hosts(tree, (n) => String(n.type) === "Svg");
    expect(svg!.props).toMatchObject({ viewBox: BRAND_MARK.viewBox, height: 64, accessible: false, importantForAccessibility: "no-hide-descendants" });
    expect(svg!.props.width).toBeCloseTo((64 * BRAND_MARK.width) / BRAND_MARK.height, 5);
    const paths = hosts(tree, (n) => String(n.type) === "Path").map((p) => [p.props.d, p.props.fill]);
    expect(paths).toEqual([[BRAND_MARK.k, colors.textPrimary], [BRAND_MARK.dot, colors.accent]]);
    expect(hosts(tree, (n) => String(n.type) === "Path")[0]!.props.fillRule).toBe("evenodd");
  });
});

describe("sign in", () => {
  test("shows the mark above the wordmark and tagline", async () => {
    const props = { navigation: { navigate: jest.fn() }, route: { key: "Login", name: "Login" } } as unknown as React.ComponentProps<typeof LoginScreen>;
    const tree = await render(<LoginScreen {...props} />);
    const order = hosts(tree, (n) => String(n.type) === "Svg" || (String(n.type) === "Text" && n.props.accessibilityRole === "header"));
    expect(order.map((n) => (String(n.type) === "Svg" ? n.props.testID : textOf(n)))).toEqual(["brand-mark", "Katkee"]);
    expect(hosts(tree, (n) => String(n.type) === "Text").some((n) => textOf(n) === "Story that connects.")).toBe(true);
  });
});

describe("About", () => {
  test("shows the mark, the name and the release version the build reports", async () => {
    const tree = await render(<AboutScreen />);
    expect(hosts(tree, (n) => n.props.testID === "brand-mark")).toHaveLength(1);
    const texts = hosts(tree, (n) => String(n.type) === "Text").map(textOf);
    expect(texts).toContain("Katkee");
    expect(texts).toContain("Version 9.8.7");
    expect(texts).not.toContain(`Version ${buildConfig.appVersion}`);
  });

  test("opens the Privacy Policy, Terms of Service and Help Center published at katkee.com", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    const tree = await render(<AboutScreen />);
    for (const [label, url] of [["Privacy Policy", "https://katkee.com/privacy"], ["Terms of Service", "https://katkee.com/terms"], ["Help Center", "https://katkee.com/support"]] as const) {
      await act(async () => row(tree, label).props.onPress());
      expect(open).toHaveBeenLastCalledWith(url);
    }
    expect([buildConfig.privacyPolicyUrl, buildConfig.termsUrl, buildConfig.supportUrl]).toEqual(["https://katkee.com/privacy", "https://katkee.com/terms", "https://katkee.com/support"]);
  });

  test("says so when a page can't be opened", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const tree = await render(<AboutScreen />);
    await act(async () => row(tree, "Privacy Policy").props.onPress());
    expect(alert).toHaveBeenCalledWith("Could not open link", "Please try again.");
  });
});

describe("Help", () => {
  test("leads to the Help Center for anything the common questions don't answer", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    const tree = await render(<HelpScreen />);
    expect(hosts(tree, (n) => String(n.type) === "Text").map(textOf)).toContain("Need more help?");
    await act(async () => row(tree, "Help Center").props.onPress());
    expect(open).toHaveBeenCalledWith("https://katkee.com/support");
    // And to Send feedback, first.
    await act(async () => row(tree, "Send feedback").props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("Feedback");
  });
});
