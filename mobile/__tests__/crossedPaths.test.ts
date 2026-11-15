import { CROSSED_VISIT_EVERY_MS, crossedPathsOn, sendCrossedVisit, turnCrossedPathsOff, turnCrossedPathsOn } from "../src/state/crossedPaths";
import * as api from "../src/api/crossedPaths";
import * as nearby from "../src/state/nearby";

jest.mock("../src/api/crossedPaths", () => ({
  getCrossedPaths: jest.fn(async () => ({ enabled: false })),
  putCrossedPaths: jest.fn(async (enabled: boolean) => ({ enabled })),
  postCrossedVisit: jest.fn(async () => ({ recorded: true })),
}));
jest.mock("../src/state/nearby", () => ({ locationAllowed: jest.fn(async () => true), currentCell: jest.fn(async () => ({ cell: "tdr1w" })) }));
const mockedApi = api as jest.Mocked<typeof api>;
const loc = nearby as jest.Mocked<typeof nearby>;
const storage = (global as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
beforeEach(() => { storage.clear(); jest.clearAllMocks(); loc.locationAllowed.mockResolvedValue(true); });

test("off until turned on: nothing is sent", async () => {
  expect(await sendCrossedVisit("u1", "token", { force: true })).toBe(false);
  expect(mockedApi.postCrossedVisit).not.toHaveBeenCalled();
});

test("turning on asks for approximate location, saves it, and sends a neighbourhood-sized cell, never coordinates", async () => {
  expect(await turnCrossedPathsOn("u1", "token")).toBe("on");
  expect(loc.locationAllowed).toHaveBeenCalledWith(true);
  expect(mockedApi.putCrossedPaths).toHaveBeenCalledWith(true, "token");
  expect(loc.currentCell).toHaveBeenCalledWith(5);
  expect(mockedApi.postCrossedVisit).toHaveBeenCalledWith("tdr1w", "token");
  expect(await crossedPathsOn("u1")).toBe(true);
});

test("location refused: stays off", async () => {
  loc.locationAllowed.mockResolvedValue(false);
  expect(await turnCrossedPathsOn("u1", "token")).toBe("denied");
  expect(mockedApi.putCrossedPaths).not.toHaveBeenCalled();
  expect(await crossedPathsOn("u1")).toBe(false);
});

test("at most one visit every half hour, never prompting for location; off stops it", async () => {
  await turnCrossedPathsOn("u1", "token");
  mockedApi.postCrossedVisit.mockClear();
  const t0 = Date.now();
  expect(await sendCrossedVisit("u1", "token", { now: t0 + 60_000 })).toBe(false);
  expect(await sendCrossedVisit("u1", "token", { now: t0 + CROSSED_VISIT_EVERY_MS + 1000 })).toBe(true);
  expect(loc.locationAllowed).toHaveBeenLastCalledWith(false);
  await turnCrossedPathsOff("u1", "token");
  expect(mockedApi.putCrossedPaths).toHaveBeenLastCalledWith(false, "token");
  expect(await sendCrossedVisit("u1", "token", { force: true })).toBe(false);
});
