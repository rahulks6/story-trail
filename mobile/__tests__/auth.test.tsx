import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { LoginScreen } from "../src/screens/auth/LoginScreen";
import { SignupScreen } from "../src/screens/auth/SignupScreen";
import { useScreenInsets } from "../src/hooks/useScreenInsets";

const mockAuth = {
  login: jest.fn(async () => undefined),
  signup: jest.fn(async () => undefined),
  clearError: jest.fn(),
  error: null as string | null,
  fieldErrors: null as Record<string, string> | null,
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
// Google/phone sign-in has its own tests; here it would only add native SDK noise.
jest.mock("../src/screens/auth/ProviderEntry", () => ({ ProviderEntry: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const navigation = { navigate: jest.fn() };

let mounted: ReactTestRenderer | null = null;
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
  jest.clearAllMocks();
  mockAuth.error = null;
  mockAuth.fieldErrors = null;
});

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    mounted = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>);
  });
  return mounted!;
}
const host = (tree: ReactTestRenderer, test: (n: ReactTestInstance) => boolean) => tree.root.find((n) => typeof n.type === "string" && test(n));
const field = (tree: ReactTestRenderer, label: string) => host(tree, (n) => n.props.onChangeText && String(n.props.accessibilityLabel).startsWith(label));
const button = (tree: ReactTestRenderer, label: string) => host(tree, (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === label);
const type = (input: ReactTestInstance, text: string) => act(async () => input.props.onChangeText(text));
const press = (tree: ReactTestRenderer, label: string) =>
  act(async () => tree.root.find((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
const flatten = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe("Log in", () => {
  const props = { navigation, route: { key: "Login", name: "Login" } } as unknown as React.ComponentProps<typeof LoginScreen>;

  test("labelled fields with password-manager hints; Log in only when both are filled", async () => {
    const tree = await render(<LoginScreen {...props} />);
    const email = field(tree, "Email"), password = field(tree, "Password");
    expect([email.props.autoComplete, email.props.textContentType, email.props.keyboardType]).toEqual(["email", "username", "email-address"]);
    expect([password.props.secureTextEntry, password.props.autoComplete, password.props.textContentType]).toEqual([true, "current-password", "password"]);
    expect(button(tree, "Log in").props.accessibilityState).toMatchObject({ disabled: true });

    await type(email, "rahul@example.com");
    await type(password, "correct horse");
    expect(button(tree, "Log in").props.accessibilityState).toMatchObject({ disabled: false });
    await act(async () => password.props.onSubmitEditing());
    expect(mockAuth.login).toHaveBeenCalledWith({ email: "rahul@example.com", password: "correct horse" });
  });

  test("errors are announced, and the form clears the notch and home indicator", async () => {
    mockAuth.error = "Incorrect email or password.";
    mockAuth.fieldErrors = { email: "Enter a valid email." };
    const tree = await render(<LoginScreen {...props} />);
    const banner = host(tree, (n) => n.props.accessibilityRole === "alert");
    expect(banner.props.children).toBe("Incorrect email or password.");
    expect(field(tree, "Email").props.accessibilityLabel).toBe("Email. Enter a valid email.");
    const scroll = host(tree, (n) => n.props.keyboardShouldPersistTaps === "handled");
    expect(flatten(scroll.props.contentContainerStyle)).toMatchObject({ paddingTop: 47 + 24, paddingBottom: 34 + 24 });
  });
});

describe("Sign up", () => {
  const props = { navigation, route: { key: "Signup", name: "Signup" } } as unknown as React.ComponentProps<typeof SignupScreen>;

  test("checks the password as people type and sends a lowercase username", async () => {
    const tree = await render(<SignupScreen {...props} />);
    await type(field(tree, "Display name"), "Rahul K");
    await type(field(tree, "Username"), "Rahul.K");
    await type(field(tree, "Email"), "rahul@example.com");
    await type(field(tree, "Date of birth"), "15051995");
    await type(field(tree, "Password"), "short");
    expect(field(tree, "Password").props.accessibilityLabel).toBe("Password. Use at least 8 characters.");
    expect(button(tree, "Sign up").props.accessibilityState).toMatchObject({ disabled: true });

    await type(field(tree, "Password"), "rahul.k");
    expect(field(tree, "Password").props.accessibilityLabel).toBe("Password. Use at least 8 characters.");
    await type(field(tree, "Password"), "RAHUL.K1");
    expect(button(tree, "Sign up").props.accessibilityState).toMatchObject({ disabled: false });
    await press(tree, "Sign up");
    expect(mockAuth.signup).toHaveBeenCalledWith({ displayName: "Rahul K", username: "rahul.k", email: "rahul@example.com", password: "RAHUL.K1", birthDate: "1995-05-15" });
    expect(field(tree, "Password").props.autoComplete).toBe("new-password");
  });

  test("the name and username stop at the server's limits (60 and 30), as in Edit profile", async () => {
    const tree = await render(<SignupScreen {...props} />);
    expect(field(tree, "Display name").props.maxLength).toBe(60);
    expect(field(tree, "Username").props.maxLength).toBe(30);
  });

  test("asks for a date of birth as DD/MM/YYYY and allows only people 18 and older", async () => {
    const tree = await render(<SignupScreen {...props} />);
    await type(field(tree, "Display name"), "Rahul K");
    await type(field(tree, "Username"), "rahul.k");
    await type(field(tree, "Email"), "rahul@example.com");
    await type(field(tree, "Password"), "a long passphrase");
    const birth = () => field(tree, "Date of birth");
    expect([birth().props.keyboardType, birth().props.maxLength, birth().props.placeholder]).toEqual(["number-pad", 10, "DD/MM/YYYY"]);
    expect(button(tree, "Sign up").props.accessibilityState).toMatchObject({ disabled: true });

    await type(birth(), "1505");
    expect(birth().props.value).toBe("15/05");
    expect(birth().props.accessibilityLabel).toBe("Date of birth"); // no complaint while they're still typing
    const year = new Date().getUTCFullYear();
    await type(birth(), `1505${year - 17}`);
    expect(birth().props.value).toBe(`15/05/${year - 17}`);
    expect(birth().props.accessibilityLabel).toBe("Date of birth. Katkee is only for people 18 and older.");
    expect(button(tree, "Sign up").props.accessibilityState).toMatchObject({ disabled: true });
    await type(birth(), "30/02/1995");
    expect(birth().props.accessibilityLabel).toBe("Date of birth. Enter a valid date of birth.");
    expect(button(tree, "Sign up").props.accessibilityState).toMatchObject({ disabled: true });

    await type(birth(), "15/05/1995");
    expect(birth().props.accessibilityLabel).toBe("Date of birth");
    expect(button(tree, "Sign up").props.accessibilityState).toMatchObject({ disabled: false });
    await press(tree, "Sign up");
    expect(mockAuth.signup).toHaveBeenCalledWith(expect.objectContaining({ birthDate: "1995-05-15" }));
  });

  test("the server's answer about the date of birth shows on the field", async () => {
    mockAuth.fieldErrors = { birthDate: "Katkee is only for people 18 and older." };
    const tree = await render(<SignupScreen {...props} />);
    expect(field(tree, "Date of birth").props.accessibilityLabel).toBe("Date of birth. Katkee is only for people 18 and older.");
  });

  test("a password equal to the username is refused before it reaches the server", async () => {
    const tree = await render(<SignupScreen {...props} />);
    await type(field(tree, "Username"), "longusername");
    await type(field(tree, "Password"), "LongUsername");
    expect(field(tree, "Password").props.accessibilityLabel).toBe("Password. Don't use your username as your password.");
  });
});

describe("safe areas", () => {
  function Probe(): React.JSX.Element {
    const insets = useScreenInsets();
    return <Text>{`${insets.top}/${insets.bottom}`}</Text>;
  }
  test("full-screen views clear both edges; inside the tabs the tab bar owns the bottom edge", async () => {
    let tree = await render(<Probe />);
    expect(tree.root.findByType(Text).props.children).toBe("47/34");
    await act(async () => mounted?.unmount());
    tree = await render(
      <BottomTabBarHeightContext.Provider value={83}>
        <Probe />
      </BottomTabBarHeightContext.Provider>,
    );
    expect(tree.root.findByType(Text).props.children).toBe("47/0");
  });
});
