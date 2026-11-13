import { extendSlots, takeTurns } from "../src/models/homeSlots";

const person = (username: string, ...ids: string[]) => ({ owner: { username }, stories: ids.map((id) => ({ id })) });

test("people take turns: everyone's first Story, then everyone's second, never one person twice in a row", () => {
  const slots = takeTurns([person("a", "a1", "a2", "a3"), person("b", "b1"), person("c", "c1", "c2")]);
  expect(slots.map((s) => s.storyId)).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
});

test("a person listed without their Stories gets one place (their first Story)", () => {
  expect(takeTurns([person("a")])).toEqual([{ username: "a", storyId: "" }]);
});

test("more of the feed goes after what's there; a fresh feed starts over", () => {
  const first = [person("a", "a1", "a2"), person("b", "b1")];
  const slots = extendSlots(first, null, []);
  expect(slots.map((s) => s.storyId)).toEqual(["a1", "b1", "a2"]);
  const grown = [...first, person("c", "c1"), person("d", "d1")];
  expect(extendSlots(grown, first, slots).map((s) => s.storyId)).toEqual(["a1", "b1", "a2", "c1", "d1"]);
  const fresh = [person("d", "d1"), person("a", "a1")];
  expect(extendSlots(fresh, first, slots).map((s) => s.storyId)).toEqual(["d1", "a1"]);
});
