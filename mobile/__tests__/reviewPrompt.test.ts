import AsyncStorage from "@react-native-async-storage/async-storage";
import InAppReview from "react-native-in-app-review";
import { ASK_AGAIN_AFTER_MS, noteStoryPosted } from "../src/utils/reviewPrompt";

describe("rate Katkee prompt", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    (InAppReview.RequestInAppReview as jest.Mock).mockClear();
    (InAppReview.isAvailable as jest.Mock).mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  it("asks only after the third Story, then not again for 120 days", async () => {
    const now = Date.UTC(2026, 10, 1);
    expect(await noteStoryPosted(now)).toBe(false);
    expect(await noteStoryPosted(now)).toBe(false);
    expect(await noteStoryPosted(now)).toBe(true);
    jest.runAllTimers();
    expect(InAppReview.RequestInAppReview).toHaveBeenCalledTimes(1);

    expect(await noteStoryPosted(now + 1000)).toBe(false);
    expect(await noteStoryPosted(now + ASK_AGAIN_AFTER_MS - 1)).toBe(false);
    expect(await noteStoryPosted(now + ASK_AGAIN_AFTER_MS + 1)).toBe(true);
    jest.runAllTimers();
    expect(InAppReview.RequestInAppReview).toHaveBeenCalledTimes(2);
  });

  it("does nothing where the store can't show it, and never throws", async () => {
    (InAppReview.isAvailable as jest.Mock).mockReturnValue(false);
    for (let i = 0; i < 4; i++) expect(await noteStoryPosted()).toBe(false);
    (InAppReview.isAvailable as jest.Mock).mockImplementation(() => { throw new Error("no Play"); });
    expect(await noteStoryPosted()).toBe(false);
    jest.runAllTimers();
    expect(InAppReview.RequestInAppReview).not.toHaveBeenCalled();
  });
});
