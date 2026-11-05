import { Image } from "react-native";
import { takeWarmStories, warmStories } from "../src/state/warmStories";
import type { PublicStory } from "../src/api/stories";

const story = (id: string, expiresInMs = 3_600_000, imageUrl = "https://cdn.test/" + id + "/display"): PublicStory =>
  ({ id, media: { imageUrl, urlsExpireAt: new Date(Date.now() + expiresInMs).toISOString() } }) as unknown as PublicStory;

describe("a profile hands its Stories to the viewer", () => {
  beforeEach(() => { jest.spyOn(Image, "prefetch").mockResolvedValue(true); });
  afterEach(() => jest.restoreAllMocks());

  test("once, with the first frame already loading", () => {
    warmStories("riya", [story("a"), story("b")]);
    expect(Image.prefetch).toHaveBeenCalledWith("https://cdn.test/a/display");
    expect(takeWarmStories("riya")?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(takeWarmStories("riya")).toBeNull();
  });

  test("never stale: a minute old, or links about to expire, are fetched again", () => {
    warmStories("riya", [story("a")]);
    expect(takeWarmStories("riya", Date.now() + 61_000)).toBeNull();
    warmStories("riya", [story("a", 30_000)]);
    expect(takeWarmStories("riya")).toBeNull();
  });

  test("an API-relative link isn't prefetched (it needs the sign-in header)", () => {
    warmStories("riya", [story("a", 3_600_000, "/api/v1/media/a/file")]);
    expect(Image.prefetch).not.toHaveBeenCalled();
  });
});
