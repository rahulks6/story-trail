import { withAddedStories } from "../src/components/AddToHighlightSheet";

describe("adding Archive Stories to a Highlight", () => {
  it("keeps the Highlight's own Stories first and adds only new ones, once", () => {
    expect(withAddedStories(["a", "b"], ["c", "a", "c", "d"])).toEqual(["a", "b", "c", "d"]);
    expect(withAddedStories(["a"], ["a"])).toEqual(["a"]);
  });
});
