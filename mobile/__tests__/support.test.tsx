import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, TextInput } from "react-native";
import * as client from "../src/api/client";
import * as media from "../src/api/media";
import { FeedbackScreen } from "../src/screens/profile/FeedbackScreen";
import { describeError, flushCrashReports, installCrashReporting, reportCrash, resetCrashReportsForTests, setCurrentScreen, startCrashReports } from "../src/crashReporting";

const mockAuth = { accessToken: "token", user: { id: "me", username: "rahul" } };
const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => mockNavigation }));

const storage = () => (globalThis as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const saved = () => JSON.parse(storage().get("katkee.crashReports.v1") ?? "[]") as Array<Record<string, unknown>>;

beforeEach(() => {
  jest.restoreAllMocks();
  resetCrashReportsForTests();
  storage().delete("katkee.crashReports.v1");
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("crash reports", () => {
  it("a fatal error is saved before the app closes and sent on the next launch, with where it happened", async () => {
    let handler: (e: unknown, fatal?: boolean) => void = () => undefined;
    const crashScreen = jest.fn();
    const errorUtils = { getGlobalHandler: () => crashScreen, setGlobalHandler: (h: typeof handler) => { handler = h; } };
    installCrashReporting(errorUtils);
    setCurrentScreen("StoryViewer");
    await flush();
    const error = new TypeError("Cannot read property 'id' of undefined");
    handler(error, true);
    expect(crashScreen).toHaveBeenCalledWith(error, true); // the crash still reaches React Native at once
    await flush();
    expect(saved()).toEqual([expect.objectContaining({ kind: "fatal", name: "TypeError", message: "Cannot read property 'id' of undefined", screen: "StoryViewer", userId: null })]);

    // Next launch, signed in: sent, then gone from the phone. The local owner never leaves it.
    const post = jest.spyOn(client, "apiPost").mockResolvedValue({ ok: true });
    startCrashReports("me", () => "token");
    await flush();
    expect(post).toHaveBeenCalledWith("/api/v1/crash-reports", expect.objectContaining({ kind: "fatal", screen: "StoryViewer" }), "token");
    expect(post.mock.calls[0]![1]).not.toHaveProperty("userId");
    expect(saved()).toEqual([]);
    // Non-fatal errors (a red box in development) aren't reports.
    handler(new Error("warning"), false);
    await flush();
    expect(saved()).toEqual([]);
  });

  it("a screen crash is sent straight away; offline it waits, and someone else's report is left for them", async () => {
    const post = jest.spyOn(client, "apiPost").mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValue({ ok: true });
    storage().set("katkee.crashReports.v1", JSON.stringify([{ ...describeError(new Error("theirs"), "fatal"), userId: "someone-else" }]));
    startCrashReports("me", () => "token");
    await flush();
    reportCrash(new Error("render failed"), { componentStack: "\n    in Composer\n    in ConversationScreen" });
    await flush();
    expect(post).toHaveBeenCalledTimes(1); // offline: kept
    expect(saved().map((r) => r.message)).toEqual(["theirs", "render failed"]);
    await act(async () => { await flushCrashReports(); });
    expect(post).toHaveBeenLastCalledWith("/api/v1/crash-reports", expect.objectContaining({ kind: "render", message: "render failed", componentStack: "\n    in Composer\n    in ConversationScreen" }), "token");
    expect(saved().map((r) => r.message)).toEqual(["theirs"]);
  });

  it("a report the server refuses for good isn't retried forever", async () => {
    jest.spyOn(client, "apiPost").mockRejectedValue(new client.ApiError(422, "Invalid", undefined));
    startCrashReports("me", () => "token");
    reportCrash(new Error("odd"));
    await flush();
    expect(saved()).toEqual([]);
  });
});

describe("Send feedback", () => {
  let tree: ReactTestRenderer;
  afterEach(async () => { await act(async () => tree?.unmount()); });
  const press = (label: string) => act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());

  it("sends the note with an attached screenshot, the app version and phone; then says thanks", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const upload = jest.spyOn(media, "uploadPhoto").mockResolvedValue({ id: "shot-1" } as Awaited<ReturnType<typeof media.uploadPhoto>>);
    const post = jest.spyOn(client, "apiPost").mockResolvedValue({ feedback: { id: "f1" } });
    (globalThis as unknown as { __picker: { result: unknown } }).__picker.result = { assets: [{ uri: "file:///shot.png", type: "image/png", width: 1080, height: 2400 }] };
    await act(async () => { tree = create(<FeedbackScreen />); });
    await act(async () => tree.root.findByType(TextInput).props.onChangeText("  The music picker froze  "));
    await press("Attach a screenshot");
    await flush();
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Remove screenshot")).not.toHaveLength(0);
    await press("Send");
    await flush();
    expect(upload).toHaveBeenCalledWith("file:///shot.png", "image/png", "token");
    expect(post).toHaveBeenCalledWith("/api/v1/feedback", expect.objectContaining({ body: "The music picker froze", screenshotMediaId: "shot-1", appVersion: expect.any(String) }), "token");
    expect(alert.mock.calls[0]![0]).toBe("Thanks!");
    expect(mockNavigation.goBack).toHaveBeenCalled();
    (globalThis as unknown as { __picker: { result: unknown } }).__picker.result = { didCancel: true };
  });

  it("a failure keeps what you wrote and says what went wrong", async () => {
    jest.spyOn(client, "apiPost").mockRejectedValue(new client.ApiError(429, "Too many requests. Try again later.", undefined));
    mockNavigation.goBack.mockClear();
    await act(async () => { tree = create(<FeedbackScreen />); });
    await act(async () => tree.root.findByType(TextInput).props.onChangeText("Stories skip"));
    await press("Send");
    await flush();
    expect(tree.root.findByType(TextInput).props.value).toBe("Stories skip");
    expect(tree.root.findAll((n) => n.props.children === "Too many requests. Try again later.")).not.toHaveLength(0);
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });
});
