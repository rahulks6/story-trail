import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Modal, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { VerificationScreen } from "../src/screens/profile/VerificationScreen";
import * as verificationApi from "../src/api/verification";
import * as mediaApi from "../src/api/media";
import { ApiError } from "../src/api/client";
import { deepLinkTarget, opensInApp } from "../src/navigation/profileLinks";
import { notificationLink } from "../src/push/pushNotifications";

// Settings > Request verification, driven by GET /me/verification (the server is replaced).
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "asha_k" } }) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("../src/api/verification", () => ({
  ...jest.requireActual("../src/api/verification"),
  getVerification: jest.fn(),
  requestVerification: jest.fn(),
  withdrawVerification: jest.fn(async () => undefined),
}));
jest.mock("../src/api/media", () => ({ uploadPhoto: jest.fn(async () => ({ id: "m-id" })) }));

const api = verificationApi as jest.Mocked<typeof verificationApi>;
const media = mediaApi as jest.Mocked<typeof mediaApi>;
const g = globalThis as unknown as { __picker: { result: unknown; camera?: unknown } };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => () => undefined) };
const DAY = 86_400_000;

const status = (over: Partial<verificationApi.VerificationStatus> = {}): verificationApi.VerificationStatus => ({
  verified: false, onHold: false, category: null, eligibility: { eligible: true, reasons: [] }, request: null, ...over,
});
const request = (over: Partial<verificationApi.VerificationRequest> = {}): verificationApi.VerificationRequest => ({
  id: "r1", status: "pending", category: "creator", fullName: "Asha Kumar", links: ["https://asha.example"],
  createdAt: "2026-10-20T12:00:00Z", decidedAt: null, denialReason: null, canReapplyAt: null, ...over,
});

let tree: ReactTestRenderer;
beforeEach(() => {
  g.__picker.result = { didCancel: true };
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function render(): Promise<void> {
  await act(async () => {
    tree = create(<SafeAreaProvider initialMetrics={metrics}><VerificationScreen navigation={navigation as never} route={{ key: "Verification", name: "Verification" } as never} /></SafeAreaProvider>);
  });
  await flush();
}
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const control = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const press = async (label: string) => {
  await act(async () => control(label).props.onPress());
  await flush();
};
/** A control known by its visible text (the innermost one that shows it). */
const pressText = async (text: string) => {
  const matches = tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((t) => t.type === Text && [t.props.children].flat().join("") === text).length > 0);
  await act(async () => matches.at(-1)!.props.onPress());
  await flush();
};
const type = async (label: string, value: string) => {
  const input = tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.onChangeText && typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith(label));
  await act(async () => input.props.onChangeText(value));
  await flush();
};
/** Choose in the photo sheet; like on iOS, the choice runs once the sheet has closed. */
async function choosePhoto(): Promise<void> {
  g.__picker.result = { assets: [{ uri: "file:///photos/id.jpg", width: 1600, height: 1000, type: "image/jpeg" }] };
  await pressText("Add a photo of your ID");
  await press("Choose from library");
  const sheet = tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!;
  await act(async () => sheet.props.onDismiss());
  await flush();
}
async function fillForm(): Promise<void> {
  await press("Creator");
  await type("Full name as on your ID", "Asha Kumar");
  await type("Link 1", "https://asha.example");
  await pressText("Add a link");
  await type("Link 2", " https://news.example/asha ");
  await choosePhoto();
}

test("eligible: the form sends the category, name, links and the uploaded ID photo, then shows the request in review", async () => {
  api.getVerification.mockResolvedValue(status());
  api.requestVerification.mockResolvedValue({ request: request({ createdAt: "2026-10-26T12:00:00Z" }) });
  await render();
  expect(texts()).toEqual(expect.arrayContaining(["Creator", "Public figure", "Brand or business", "News or media", "Government or organisation"]));
  expect(texts()).toContain("Only Katkee's review team sees your ID. It's deleted 30 days after we decide.");
  await fillForm();
  expect(control("Creator").props.accessibilityState).toEqual({ checked: true });
  await press("Submit request");
  expect(media.uploadPhoto).toHaveBeenCalledWith("file:///photos/id.jpg", "image/jpeg", "token");
  expect(api.requestVerification).toHaveBeenCalledWith(
    { category: "creator", fullName: "Asha Kumar", links: ["https://asha.example", "https://news.example/asha"], idMediaId: "m-id" },
    "token",
  );
  expect(texts()).toEqual(expect.arrayContaining(["In review", "Submitted 26 Oct 2026"]));
});

test("the form checks itself first: a category, the name, https links and a photo", async () => {
  api.getVerification.mockResolvedValue(status());
  await render();
  await type("Link 1", "http://asha.example");
  await press("Submit request");
  expect(texts()).toEqual(expect.arrayContaining([
    "Choose the kind of account this is.",
    "Enter your full name as it appears on your ID.",
    "Use a link that starts with https://",
    "Add a photo of your ID.",
  ]));
  expect(api.requestVerification).not.toHaveBeenCalled();
  expect(media.uploadPhoto).not.toHaveBeenCalled();
  expect(verificationApi.MAX_VERIFICATION_LINKS).toBe(5);
});

test("only five links, and a link can be removed", async () => {
  api.getVerification.mockResolvedValue(status());
  await render();
  for (let i = 0; i < 4; i++) await pressText("Add a link");
  expect(texts()).not.toContain("Add a link");
  await press("Remove link 5");
  expect(texts()).toContain("Add a link");
});

test("the server's field errors show beside their fields (422), keeping what was typed", async () => {
  api.getVerification.mockResolvedValue(status());
  api.requestVerification.mockRejectedValueOnce(new ApiError(422, "Please fix the highlighted fields.", { fullName: "Use the name on your ID.", "links.1": "That link can't be used." }));
  await render();
  await fillForm();
  await press("Submit request");
  expect(texts()).toEqual(expect.arrayContaining(["Check the highlighted fields.", "Use the name on your ID.", "That link can't be used."]));
  expect(tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === "Link 2. That link can't be used.")).toHaveLength(1);
  // Fixed and sent again: the photo isn't uploaded twice.
  api.requestVerification.mockResolvedValueOnce({ request: request() });
  await type("Link 2", "https://news.example/a");
  await press("Submit request");
  expect(media.uploadPhoto).toHaveBeenCalledTimes(1);
  expect(texts()).toContain("In review");
});

test("refused as not eligible (403): the reasons replace the form", async () => {
  api.getVerification.mockResolvedValue(status());
  api.requestVerification.mockRejectedValueOnce(new ApiError(403, "Your account can't apply yet.", undefined, { message: "Your account can't apply yet.", reasons: ["Add a bio."] }));
  await render();
  await fillForm();
  await press("Submit request");
  expect(texts()).toEqual(expect.arrayContaining(["Before you apply", "Add a bio.", "Edit profile"]));
  expect(texts()).not.toContain("Submit request");
});

test("pending: in review since the day it was sent, and it can be withdrawn after confirming", async () => {
  api.getVerification.mockResolvedValueOnce(status({ request: request() })).mockResolvedValue(status({ request: request({ status: "withdrawn" }) }));
  const alert = jest.spyOn(Alert, "alert");
  await render();
  expect(texts()).toEqual(expect.arrayContaining(["In review", "Submitted 20 Oct 2026"]));
  await press("Withdraw request");
  expect(alert).toHaveBeenCalledWith("Withdraw request?", expect.any(String), expect.any(Array));
  expect(api.withdrawVerification).not.toHaveBeenCalled();
  const withdraw = (alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === "Withdraw")!;
  await act(async () => withdraw.onPress!());
  await flush();
  expect(api.withdrawVerification).toHaveBeenCalledWith("token");
  expect(api.getVerification).toHaveBeenCalledTimes(2);
  expect(texts()).toContain("Submit request");
});

test("denied: the reason, and the date you can apply again (not before)", async () => {
  const at = new Date(Date.now() + 10 * DAY);
  at.setHours(12, 0, 0, 0);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  api.getVerification.mockResolvedValue(status({ request: request({ status: "denied", decidedAt: new Date(Date.now() - 20 * DAY).toISOString(), denialReason: "We couldn't confirm the account is notable.", canReapplyAt: at.toISOString() }) }));
  await render();
  expect(texts()).toEqual(expect.arrayContaining([
    "Not approved",
    "We couldn't confirm the account is notable.",
    `You can apply again on ${at.getDate()} ${months[at.getMonth()]} ${at.getFullYear()}.`,
  ]));
  expect(control("Apply again").props.disabled).toBe(true);
});

test("denied and the 30 days are over: Apply again opens the form", async () => {
  api.getVerification.mockResolvedValue(status({ request: request({ status: "denied", denialReason: null, canReapplyAt: new Date(Date.now() - DAY).toISOString() }) }));
  await render();
  expect(texts()).toContain("Your request wasn't approved.");
  expect(control("Apply again").props.disabled).toBeFalsy();
  await press("Apply again");
  expect(texts()).toContain("Submit request");
});

test("not eligible: each reason, with a way to fix it where there is one", async () => {
  api.getVerification.mockResolvedValue(status({ eligibility: { eligible: false, reasons: ["Verify your email address.", "Add a profile photo.", "Your account needs to be 30 days old (on 12 Nov 2026)."] } }));
  await render();
  expect(texts()).toEqual(expect.arrayContaining(["Before you apply", "Verify your email address.", "Add a profile photo.", "Your account needs to be 30 days old (on 12 Nov 2026)."]));
  expect(texts().filter((t) => t === "Verify email" || t === "Edit profile")).toEqual(["Verify email", "Edit profile"]);
  await pressText("Verify email");
  expect(navigation.navigate).toHaveBeenLastCalledWith("VerifyEmail");
  await pressText("Edit profile");
  expect(navigation.navigate).toHaveBeenLastCalledWith("EditProfile");
  expect(texts()).not.toContain("Submit request");
});

test("verified, and paused after a name change", async () => {
  api.getVerification.mockResolvedValueOnce(status({ verified: true, category: "news_media", eligibility: { eligible: false, reasons: [] } }));
  await render();
  expect(texts()).toEqual(expect.arrayContaining(["You're verified", "Category: News or media"]));
  await act(async () => tree.unmount());
  api.getVerification.mockResolvedValueOnce(status({ onHold: true, category: "brand", eligibility: { eligible: false, reasons: [] } }));
  await render();
  expect(texts()).toEqual(expect.arrayContaining(["Badge paused", "Your badge is paused while we review your name change."]));
});

test("a failed load offers Try again", async () => {
  api.getVerification.mockRejectedValueOnce(new ApiError(0, "Request cancelled.")).mockResolvedValue(status());
  await render();
  expect(texts()).toContain("Couldn't load your verification status. Check your connection and try again.");
  await press("Try again");
  expect(texts()).toContain("Submit request");
});

test("katkee://verification opens this screen; a katkee.com address for it doesn't open the app", () => {
  expect(deepLinkTarget("verification")).toEqual({ kind: "verification" });
  expect(deepLinkTarget("/verification/")).toEqual({ kind: "verification" });
  expect(deepLinkTarget("verifications")).toBeNull();
  expect(opensInApp("katkee://verification")).toBe(true);
  expect(opensInApp("https://katkee.com/verification")).toBe(false);
  expect(opensInApp("https://katkee.com/u/asha_k")).toBe(true);
  expect(notificationLink({ data: { url: "katkee://verification" } } as never)).toBe("katkee://verification");
});

test("names can't include check marks", () => {
  for (const name of ["Asha ✓", "✔ Asha", "Asha ✅", "Asha☑", "Asha \u{1F5F8}", "Asha √"]) expect(verificationApi.hasTickLikeCharacter(name)).toBe(true);
  for (const name of ["Asha Kumar", "Zoë", "राहुल", "Asha 🔥"]) expect(verificationApi.hasTickLikeCharacter(name)).toBe(false);
  expect(verificationApi.NAME_TICK_ERROR).toBe("Names can't include check marks.");
});
