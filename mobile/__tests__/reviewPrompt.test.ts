import { Linking, NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ASK_AGAIN_AFTER_MS, markActiveDay, MAX_ASKS, openStoreListing, requestInAppReview, storyPostedShouldAsk } from "../src/state/reviewPrompt";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({}) }));

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1, 10);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.replaceProperty(Platform, "OS", "android");
});
afterEach(() => jest.restoreAllMocks());

test("asks only after 3 Stories on 3 different days", async () => {
  expect(await storyPostedShouldAsk("me", T0)).toBe(false);
  expect(await storyPostedShouldAsk("me", T0 + 1000)).toBe(false); // 2 Stories, 1 day
  expect(await storyPostedShouldAsk("me", T0 + 2000)).toBe(false); // 3 Stories, still 1 day
  await markActiveDay("me", T0 + DAY);
  expect(await storyPostedShouldAsk("me", T0 + 2 * DAY)).toBe(true); // 4th Story, 3rd day
});

test("then not again for months, and never more than 3 times", async () => {
  for (let d = 0; d < 3; d++) await markActiveDay("me", T0 + d * DAY);
  await storyPostedShouldAsk("me", T0);
  await storyPostedShouldAsk("me", T0);
  expect(await storyPostedShouldAsk("me", T0 + 2 * DAY)).toBe(true);
  expect(await storyPostedShouldAsk("me", T0 + 3 * DAY)).toBe(false);
  let now = T0 + 2 * DAY;
  let asks = 1;
  for (let i = 0; i < 6; i++) {
    now += ASK_AGAIN_AFTER_MS + DAY;
    if (await storyPostedShouldAsk("me", now)) asks++;
  }
  expect(asks).toBe(MAX_ASKS);
});

test("each account counts on its own", async () => {
  for (let d = 0; d < 3; d++) await markActiveDay("a", T0 + d * DAY);
  await storyPostedShouldAsk("a", T0 + 2 * DAY);
  await storyPostedShouldAsk("a", T0 + 2 * DAY);
  expect(await storyPostedShouldAsk("b", T0 + 2 * DAY)).toBe(false);
  expect(await storyPostedShouldAsk("a", T0 + 2 * DAY)).toBe(true);
});

test("uses Google Play's card on Android, and nothing elsewhere", async () => {
  const requestReview = jest.fn().mockResolvedValue(true);
  NativeModules.KatkeeInAppReview = { requestReview };
  expect(await requestInAppReview()).toBe(true);
  jest.replaceProperty(Platform, "OS", "ios");
  expect(await requestInAppReview()).toBe(false);
  expect(requestReview).toHaveBeenCalledTimes(1);
});

test("Rate Katkee opens the Play Store app, or the web page without it", async () => {
  const open = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("no Play")).mockResolvedValue(true);
  await openStoreListing();
  expect(open.mock.calls.map((c) => c[0])).toEqual(["market://details?id=com.katkee.app", "https://play.google.com/store/apps/details?id=com.katkee.app"]);
});
