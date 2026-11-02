import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Switch } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SettingsScreen } from "../src/screens/profile/SettingsScreen";
import * as usersApi from "../src/api/users";

// Settings > Privacy > "Let people find me from their contacts", and the Friends section.
const mockAuth = {
  status: "signedIn",
  user: { id: "u-me", username: "me", isPrivate: false } as { id: string; username: string; isPrivate: boolean; findableByContacts?: boolean },
  accessToken: "token",
  logout: jest.fn(),
  applyProfile: jest.fn(),
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/invites", () => ({ shareInvite: jest.fn() }));
jest.mock("../src/api/users", () => ({ updateMyProfile: jest.fn(), listFollowRequests: jest.fn(async () => ({ requests: [] })) }));
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return { ...jest.requireActual("@react-navigation/native"), useFocusEffect: (effect: () => void) => React.useEffect(effect, []) };
});

const api = usersApi as jest.Mocked<typeof usersApi>;
const navigation = { navigate: jest.fn() };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const findable = () => tree.root.findAll((n) => n.type === Switch && n.props.accessibilityLabel === "Let people find me from their contacts")[0]!;
const row = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);

async function render(): Promise<void> {
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <SettingsScreen {...({ navigation, route: { key: "Settings", name: "Settings" } } as unknown as React.ComponentProps<typeof SettingsScreen>)} />
      </SafeAreaProvider>,
    );
  });
  await flush();
}
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.clearAllMocks();
  jest.restoreAllMocks();
  delete mockAuth.user.findableByContacts;
});

test("being found from contacts is on by default, and turning it off saves it", async () => {
  await render();
  expect(findable().props.value).toBe(true);
  api.updateMyProfile.mockResolvedValueOnce({ user: { ...mockAuth.user, findableByContacts: false } } as never);
  await act(async () => findable().props.onValueChange(false));
  await flush();
  expect(api.updateMyProfile).toHaveBeenCalledWith({ findableByContacts: false }, "token");
  expect(mockAuth.applyProfile).toHaveBeenCalled();
  expect(findable().props.value).toBe(false);
});

test("a failed save puts the switch back", async () => {
  mockAuth.user.findableByContacts = false;
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render();
  expect(findable().props.value).toBe(false);
  api.updateMyProfile.mockRejectedValueOnce(new Error("offline"));
  await act(async () => findable().props.onValueChange(true));
  await flush();
  expect(findable().props.value).toBe(false);
  expect(alert).toHaveBeenCalled();
});

test("Friends: Contacts on Katkee and Invite friends", async () => {
  await render();
  await act(async () => row("Contacts on Katkee").props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith("ContactsOnKatkee", { from: "settings" });
  const { shareInvite } = jest.requireMock("../src/state/invites") as { shareInvite: jest.Mock };
  await act(async () => row("Invite friends").props.onPress());
  expect(shareInvite).toHaveBeenCalledWith("settings", "token", "u-me");
});
