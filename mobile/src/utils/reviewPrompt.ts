import AsyncStorage from "@react-native-async-storage/async-storage";
import InAppReview from "react-native-in-app-review";

const POSTED_KEY = "katkee.review.storiesPosted";
const ASKED_KEY = "katkee.review.lastAskedAt";
/** Asked only once someone has posted this many Stories: they know the app by then. */
export const STORIES_BEFORE_ASKING = 3;
/** And not again for this long (Apple shows its sheet at most three times a year anyway). */
export const ASK_AGAIN_AFTER_MS = 120 * 24 * 60 * 60 * 1000;
/** A moment after the Story has posted, so the "Posted" moment is seen first. */
const DELAY_MS = 1500;

/**
 * "Rate Katkee", the stores' own way: Google Play's in-app review sheet and Apple's
 * SKStoreReviewController (the only prompt Apple allows). It never asks at launch or mid-task:
 * only after someone's third Story has posted, then at most every 120 days. The stores decide
 * whether the sheet actually shows; nothing is said either way, and nothing depends on it.
 */
export async function noteStoryPosted(now = Date.now()): Promise<boolean> {
  try {
    const posted = Number((await AsyncStorage.getItem(POSTED_KEY)) ?? "0") + 1;
    await AsyncStorage.setItem(POSTED_KEY, String(posted));
    if (posted < STORIES_BEFORE_ASKING) return false;
    const lastAsked = Number((await AsyncStorage.getItem(ASKED_KEY)) ?? "0");
    if (lastAsked && now - lastAsked < ASK_AGAIN_AFTER_MS) return false;
    if (!InAppReview.isAvailable()) return false;
    await AsyncStorage.setItem(ASKED_KEY, String(now));
    setTimeout(() => {
      Promise.resolve(InAppReview.RequestInAppReview()).catch(() => undefined);
    }, DELAY_MS);
    return true;
  } catch {
    // A missing store (a phone without Play) or storage trouble: never in the way.
    return false;
  }
}
