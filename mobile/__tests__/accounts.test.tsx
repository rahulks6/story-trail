import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Keychain from "react-native-keychain";
import { AuthProvider, useAuth } from "../src/state/AuthContext";
import * as authApi from "../src/api/auth";
import * as push from "../src/push/pushNotifications";

// Several accounts on one phone: add one while keeping the first, switch between them with no
// password (each with its own tokens), and logging out of one opens the other.
jest.mock("../src/api/client", () => ({ ...jest.requireActual("../src/api/client"), setSessionHandler: () => undefined }));
jest.mock("../src/api/auth", () => ({ fetchMe: jest.fn(), refresh: jest.fn(), logout: jest.fn(async () => undefined), login: jest.fn(), verifyTwoStep: jest.fn() }));
const mockSession: { tokens: { accessToken: string; refreshToken: string } | null } = { tokens: null };
jest.mock("../src/state/tokenStorage", () => ({
  loadTokens: jest.fn(async () => mockSession.tokens),
  saveTokens: jest.fn(async (tokens: { accessToken: string; refreshToken: string }) => { mockSession.tokens = tokens; }),
  clearTokens: jest.fn(async () => { mockSession.tokens = null; }),
}));
jest.mock("../src/push/pushNotifications", () => ({ unregisterForPush: jest.fn(async () => undefined) }));
jest.mock("../src/state/dmOutbox", () => ({ clearOutbox: jest.fn(async () => undefined) }));
jest.mock("../src/screens/dm/dmMediaOutbox", () => ({ clearMediaOutbox: jest.fn(async () => undefined) }));

const api = authApi as jest.Mocked<typeof authApi>;
const person = (id: string, username: string) => ({ id, username, email: `${username}@example.com`, displayName: username.toUpperCase(), bio: "", avatarMediaId: null, interests: [], isPrivate: false });
const asha = person("u-a", "asha"), ravi = person("u-r", "ravi");
let auth!: ReturnType<typeof useAuth>;
function Probe(): React.JSX.Element {
  auth = useAuth();
  return <Text>{`${auth.status}:${auth.user?.username ?? "-"}:${auth.savedAccounts.map((a) => a.user.username).join(",")}`}</Text>;
}
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const shown = () => tree.root.findByType(Text).props.children as string;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession.tokens = null;
  await Keychain.resetGenericPassword({ service: "com.katkee.accounts.v1" });
  jest.clearAllMocks();
});
afterEach(async () => { await act(async () => tree?.unmount()); });

test("add a second account, switch back and forth without a password, and log out of one", async () => {
  api.login.mockResolvedValueOnce({ user: asha, tokens: { accessToken: "a1", refreshToken: "ar1" } } as never)
    .mockResolvedValueOnce({ user: ravi, tokens: { accessToken: "r1", refreshToken: "rr1" } } as never);
  await act(async () => { tree = create(<AuthProvider><Probe /></AuthProvider>); });
  await flush();
  await act(async () => { await auth.login({ email: "asha@example.com", password: "pw" }); });
  await flush();
  expect(shown()).toBe("signedIn:asha:");

  // Add account: asha is kept (not signed out on the server), and sign-in shows for the next one.
  await act(async () => { await auth.addAccount(); });
  await flush();
  expect(shown()).toBe("signedOut:-:asha");
  expect(api.logout).not.toHaveBeenCalled();
  expect(push.unregisterForPush).toHaveBeenCalledWith("a1");
  await act(async () => { await auth.login({ email: "ravi@example.com", password: "pw" }); });
  await flush();
  expect(shown()).toBe("signedIn:ravi:asha");

  // Switch to asha: her own refresh token gets fresh tokens; ravi is kept.
  api.refresh.mockResolvedValueOnce({ tokens: { accessToken: "a2", refreshToken: "ar2" } } as never);
  api.fetchMe.mockResolvedValueOnce({ user: asha } as never);
  await act(async () => { await auth.switchAccount("u-a"); });
  await flush();
  expect(api.refresh).toHaveBeenLastCalledWith("ar1");
  expect(shown()).toBe("signedIn:asha:ravi");
  expect(auth.accessToken).toBe("a2");

  // Log out of asha: ravi opens.
  api.refresh.mockResolvedValueOnce({ tokens: { accessToken: "r2", refreshToken: "rr2" } } as never);
  api.fetchMe.mockResolvedValueOnce({ user: ravi } as never);
  await act(async () => { await auth.logout(); });
  await flush();
  expect(api.logout).toHaveBeenCalledWith("ar2");
  expect(api.refresh).toHaveBeenLastCalledWith("rr1");
  expect(shown()).toBe("signedIn:ravi:");
});

test("an account whose sign-in no longer works is dropped, and the one in use stays", async () => {
  api.login.mockResolvedValueOnce({ user: asha, tokens: { accessToken: "a1", refreshToken: "ar1" } } as never)
    .mockResolvedValueOnce({ user: ravi, tokens: { accessToken: "r1", refreshToken: "rr1" } } as never);
  await act(async () => { tree = create(<AuthProvider><Probe /></AuthProvider>); });
  await flush();
  await act(async () => { await auth.login({ email: "asha@example.com", password: "pw" }); });
  await act(async () => { await auth.addAccount(); });
  await act(async () => { await auth.login({ email: "ravi@example.com", password: "pw" }); });
  await flush();
  api.refresh.mockRejectedValueOnce(new Error("revoked"));
  await act(async () => { await auth.switchAccount("u-a").catch(() => undefined); });
  await flush();
  expect(auth.savedAccounts.map((a) => a.user.username)).not.toContain("asha");
});
