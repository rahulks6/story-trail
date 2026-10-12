import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, AppState, Linking, PermissionsAndroid, Platform, Switch, Text } from "react-native";
import Geolocation from "@react-native-community/geolocation";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { encodeGeohash } from "../src/utils/geohash";
import { AREA_REFRESH_MS, nearbyChoice, setNearbyChoice, syncArea } from "../src/state/nearby";
import { NearbyPrompt } from "../src/components/NearbyPrompt";
import { SettingsScreen } from "../src/screens/profile/SettingsScreen";
import * as areaApi from "../src/api/area";

// Nearby Stories (Phase 9): opt-in, approximate, and only a city-sized cell ever leaves the phone.
const mockAuth = {
  status: "signedIn",
  user: { id: "u-near", username: "near_me", isPrivate: false },
  accessToken: "token",
  logout: jest.fn(),
  applyProfile: jest.fn(),
  deleteAccount: jest.fn(),
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/api/area", () => ({ putMyArea: jest.fn(async () => ({ area: { cell: null, timeZone: null, updatedAt: "" } })), getMyArea: jest.fn() }));
jest.mock("../src/api/users", () => ({ ...jest.requireActual("../src/api/users"), listFollowRequests: jest.fn(async () => ({ requests: [] })) }));
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return { ...jest.requireActual("@react-navigation/native"), useFocusEffect: (effect: () => void) => React.useEffect(effect, []) };
});

const putMyArea = areaApi.putMyArea as jest.MockedFunction<typeof areaApi.putMyArea>;
const geo = Geolocation as jest.Mocked<typeof Geolocation>;
const BENGALURU = { latitude: 12.971598, longitude: 77.594566 };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const settingsProps = { navigation: { navigate: jest.fn() }, route: { key: "Settings", name: "Settings" } } as unknown as React.ComponentProps<typeof SettingsScreen>;

/** The phone's reading: a position, or a refusal (code 1). */
function locationGives(result: "position" | "denied" | "timeout") {
  geo.getCurrentPosition.mockImplementation((ok, fail) => {
    if (result === "position") ok({ coords: { ...BENGALURU, accuracy: 3000, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as never);
    else fail?.({ code: result === "denied" ? 1 : 3, message: result } as never);
  });
  geo.requestAuthorization.mockImplementation((ok, fail) => (result === "denied" ? fail?.({ code: 1 } as never) : ok?.()));
}

let tree: ReactTestRenderer | undefined;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function render(element: React.ReactElement): Promise<void> {
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>); });
  await flush();
}
const texts = () => tree!.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const pressable = (label: string) =>
  tree!.root.find((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onClick === "function" && n.props.accessibilityLabel === label);
const nearbySwitch = () => tree!.root.findAll((n) => n.type === Switch && n.props.accessibilityLabel === "Nearby Stories")[0];
/** Every body sent, as text: no coordinates may ever appear. */
const sentText = () => JSON.stringify(putMyArea.mock.calls.map((call) => call[0]));

beforeEach(() => {
  (globalThis as { __mockStorage?: Map<string, string> }).__mockStorage?.clear();
  locationGives("position");
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the area cell", () => {
  test("is the standard geohash, cut to 4 characters on the phone", () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(encodeGeohash(57.64911, 10.40744)).toBe("u4pr");
    expect(encodeGeohash(BENGALURU.latitude, BENGALURU.longitude)).toMatch(/^[0-9b-hjkmnp-z]{4}$/);
    expect(() => encodeGeohash(91, 0)).toThrow();
    expect(() => encodeGeohash(Number.NaN, 0)).toThrow();
  });
});

describe("Settings → Nearby Stories", () => {
  test("is off until turned on; turning it on asks once and sends only the area cell and time zone", async () => {
    await render(<SettingsScreen {...settingsProps} />);
    expect(nearbySwitch()!.props.value).toBe(false);
    expect(putMyArea).not.toHaveBeenCalled();
    await act(async () => nearbySwitch()!.props.onValueChange(true));
    await flush();
    expect(geo.requestAuthorization).toHaveBeenCalledTimes(1);
    expect(putMyArea).toHaveBeenCalledWith({ cell: encodeGeohash(BENGALURU.latitude, BENGALURU.longitude), timeZone: zone }, "token");
    expect(sentText()).not.toMatch(/12\.97|77\.59|latitude|longitude/);
    expect(nearbySwitch()!.props.value).toBe(true);
    expect(await nearbyChoice("u-near")).toBe("on");
  });

  test("on Android it asks for approximate location only, never precise", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const check = jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
    const request = jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    await render(<SettingsScreen {...settingsProps} />);
    await act(async () => nearbySwitch()!.props.onValueChange(true));
    await flush();
    expect(check).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
    expect(request).not.toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    expect(putMyArea).toHaveBeenCalledTimes(1);
  });

  test("a refusal sends nothing, turns the switch back off and offers the phone's Settings", async () => {
    locationGives("denied");
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await render(<SettingsScreen {...settingsProps} />);
    await act(async () => nearbySwitch()!.props.onValueChange(true));
    await flush();
    expect(putMyArea).not.toHaveBeenCalled();
    expect(nearbySwitch()!.props.value).toBe(false);
    expect(alert.mock.calls[0]![0]).toBe("Allow location for Nearby Stories");
    const buttons = alert.mock.calls[0]![2]!;
    buttons.find((b) => b.text === "Open Settings")!.onPress!();
    expect(openSettings).toHaveBeenCalled();
    expect(await nearbyChoice("u-near")).toBeNull();
  });

  test("turning it off clears the cell on the server", async () => {
    await setNearbyChoice("u-near", "on");
    await render(<SettingsScreen {...settingsProps} />);
    expect(nearbySwitch()!.props.value).toBe(true);
    await act(async () => nearbySwitch()!.props.onValueChange(false));
    await flush();
    expect(putMyArea).toHaveBeenCalledWith({ cell: null }, "token");
    expect(nearbySwitch()!.props.value).toBe(false);
    expect(await nearbyChoice("u-near")).toBe("off");
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  test("if the server can't be reached, the switch shows what the server still has", async () => {
    await setNearbyChoice("u-near", "on");
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    putMyArea.mockRejectedValueOnce(new Error("offline"));
    await render(<SettingsScreen {...settingsProps} />);
    await act(async () => nearbySwitch()!.props.onValueChange(false));
    await flush();
    expect(nearbySwitch()!.props.value).toBe(true);
    expect(await nearbyChoice("u-near")).toBe("on");
  });
});

describe("keeping the area current", () => {
  test("without Nearby Stories only the time zone is sent, at most every few hours, and location is never read", async () => {
    const now = 1_800_000_000_000;
    await syncArea("u-near", "token", { now });
    expect(putMyArea).toHaveBeenLastCalledWith({ timeZone: zone }, "token");
    await syncArea("u-near", "token", { now: now + AREA_REFRESH_MS - 1 });
    expect(putMyArea).toHaveBeenCalledTimes(1);
    await syncArea("u-near", "token", { now: now + AREA_REFRESH_MS });
    expect(putMyArea).toHaveBeenCalledTimes(2);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.requestAuthorization).not.toHaveBeenCalled();
  });

  test("with it on, a fresh reading is sent as a cell; a later refusal clears the cell instead of leaving it to go stale", async () => {
    await setNearbyChoice("u-near", "on");
    await syncArea("u-near", "token", { force: true });
    expect(putMyArea).toHaveBeenLastCalledWith({ timeZone: zone, cell: encodeGeohash(BENGALURU.latitude, BENGALURU.longitude) }, "token");
    locationGives("timeout");
    await syncArea("u-near", "token", { force: true });
    expect(putMyArea).toHaveBeenLastCalledWith({ timeZone: zone }, "token");
    locationGives("denied");
    await syncArea("u-near", "token", { force: true });
    expect(putMyArea).toHaveBeenLastCalledWith({ timeZone: zone, cell: null }, "token");
    expect(sentText()).not.toMatch(/12\.97|77\.59/);
  });

  test("on Android, location switched off in the phone's settings clears the cell without asking again", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
    const request = jest.spyOn(PermissionsAndroid, "request");
    await setNearbyChoice("u-near", "on");
    await syncArea("u-near", "token", { force: true });
    expect(putMyArea).toHaveBeenLastCalledWith({ timeZone: zone, cell: null }, "token");
    expect(request).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  test("overlapping refreshes send once", async () => {
    await Promise.all([syncArea("u-near", "token"), syncArea("u-near", "token"), syncArea("u-near", "token")]);
    expect(putMyArea).toHaveBeenCalledTimes(1);
  });
});

describe("the one-time invitation", () => {
  // The preset's AppState mock has no real state; the app is in the foreground here.
  const appState = AppState as unknown as { currentState: unknown };
  const presetState = appState.currentState;
  beforeEach(() => {
    jest.useFakeTimers();
    appState.currentState = "active";
  });
  afterEach(() => {
    appState.currentState = presetState;
  });
  const wait = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); await flush(); };

  test("appears a few seconds in, never at once; Not now sends nothing and it doesn't come back", async () => {
    await render(<NearbyPrompt delayMs={6000} />);
    expect(texts()).not.toContain("See Stories from people near you");
    await wait(5999);
    expect(texts()).not.toContain("See Stories from people near you");
    await wait(1);
    expect(texts()).toContain("See Stories from people near you");
    expect(texts()).toContain("Katkee uses an approximate area about the size of a city, never your exact location.");
    await act(async () => pressable("Not now").props.onClick());
    await flush();
    expect(texts()).not.toContain("See Stories from people near you");
    expect(putMyArea).not.toHaveBeenCalled();
    expect(geo.requestAuthorization).not.toHaveBeenCalled();
    expect(await nearbyChoice("u-near")).toBe("off");

    await act(async () => tree?.unmount());
    await render(<NearbyPrompt delayMs={6000} />);
    await wait(10_000);
    expect(texts()).not.toContain("See Stories from people near you");
  });

  test("Turn on asks for location and sends the cell; a refusal at the system prompt is taken as the answer", async () => {
    await render(<NearbyPrompt delayMs={10} />);
    await wait(10);
    await act(async () => pressable("Turn on Nearby Stories").props.onClick());
    await flush();
    expect(putMyArea).toHaveBeenCalledWith({ cell: encodeGeohash(BENGALURU.latitude, BENGALURU.longitude), timeZone: zone }, "token");
    expect(await nearbyChoice("u-near")).toBe("on");
    expect(texts()).not.toContain("See Stories from people near you");

    (globalThis as { __mockStorage?: Map<string, string> }).__mockStorage?.clear();
    putMyArea.mockClear();
    locationGives("denied");
    await act(async () => tree?.unmount());
    await render(<NearbyPrompt delayMs={10} />);
    await wait(10);
    await act(async () => pressable("Turn on Nearby Stories").props.onClick());
    await flush();
    expect(putMyArea).not.toHaveBeenCalled();
    expect(await nearbyChoice("u-near")).toBe("off");
  });

  test("never shows while signed out", async () => {
    const saved = mockAuth.status;
    mockAuth.status = "signedOut";
    try {
      await render(<NearbyPrompt delayMs={10} />);
      await wait(100);
      expect(texts()).not.toContain("See Stories from people near you");
    } finally {
      mockAuth.status = saved;
    }
  });
});
