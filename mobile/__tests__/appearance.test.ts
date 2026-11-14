import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, NativeModules, Platform } from "react-native";
import { appearanceChoice, loadAppearance, setAppearance } from "../src/theme/appearance";
import { colors, colorScheme, darkPalette, lightPalette, mediaColors } from "../src/theme/colors";

afterEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

test("Automatic follows the phone; a saved choice wins; Story screens stay dark", async () => {
  jest.spyOn(Appearance, "getColorScheme").mockReturnValue("light");
  await loadAppearance();
  expect([appearanceChoice(), colorScheme(), colors.background]).toEqual(["system", "light", lightPalette.background]);
  expect(mediaColors.background).toBe(darkPalette.background);

  await AsyncStorage.setItem("katkee.appearance.v1", "dark");
  await loadAppearance();
  expect([appearanceChoice(), colorScheme(), colors.textPrimary]).toEqual(["dark", "dark", darkPalette.textPrimary]);
});

test("choosing reloads the app on Android, and asks for a reopen elsewhere", async () => {
  const restart = jest.fn();
  (NativeModules as Record<string, unknown>).KatkeeAppRestart = { restart };
  const realOS = Platform.OS;
  (Platform as { OS: string }).OS = "android";
  expect(await setAppearance("light")).toBe(true);
  expect(restart).toHaveBeenCalled();
  expect(await AsyncStorage.getItem("katkee.appearance.v1")).toBe("light");
  (Platform as { OS: string }).OS = "ios";
  expect(await setAppearance("dark")).toBe(false);
  (Platform as { OS: string }).OS = realOS;
});
