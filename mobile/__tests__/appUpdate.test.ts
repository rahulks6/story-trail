import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ASK_AGAIN_AFTER_MS, CHECK_EVERY_MS, checkForAppUpdate, resetAppUpdateCheck } from "../src/state/appUpdate";

const T0 = Date.UTC(2026, 10, 13, 10);
let result: "shown" | "none" | "error";
const checkAndUpdate = jest.fn(async () => result);

beforeEach(async () => {
  await AsyncStorage.clear();
  resetAppUpdateCheck();
  checkAndUpdate.mockClear();
  result = "shown";
  jest.replaceProperty(Platform, "OS", "android");
  (NativeModules as Record<string, unknown>).KatkeeInAppUpdate = { checkAndUpdate };
});
afterEach(() => {
  jest.restoreAllMocks();
  delete (NativeModules as Record<string, unknown>).KatkeeInAppUpdate;
});

test("shows Play's update page, then not again for a day", async () => {
  expect(await checkForAppUpdate(T0)).toBe("shown");
  expect(await checkForAppUpdate(T0 + CHECK_EVERY_MS + 1)).toBe("none");
  expect(checkAndUpdate).toHaveBeenCalledTimes(1);
  expect(await checkForAppUpdate(T0 + ASK_AGAIN_AFTER_MS + 1)).toBe("shown");
  expect(checkAndUpdate).toHaveBeenCalledTimes(2);
});

test("with no newer version, asks Play again later, but not on every return to the app", async () => {
  result = "none";
  await checkForAppUpdate(T0);
  await checkForAppUpdate(T0 + 1000);
  expect(checkAndUpdate).toHaveBeenCalledTimes(1);
  result = "shown";
  expect(await checkForAppUpdate(T0 + CHECK_EVERY_MS + 1)).toBe("shown");
});

test("nothing on iPhone or without the native module", async () => {
  jest.replaceProperty(Platform, "OS", "ios");
  expect(await checkForAppUpdate(T0)).toBe("none");
  jest.replaceProperty(Platform, "OS", "android");
  delete (NativeModules as Record<string, unknown>).KatkeeInAppUpdate;
  expect(await checkForAppUpdate(T0)).toBe("none");
  expect(checkAndUpdate).not.toHaveBeenCalled();
});
