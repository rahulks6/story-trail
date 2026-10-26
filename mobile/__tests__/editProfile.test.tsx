import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Modal, PermissionsAndroid, Platform, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as ImagePicker from "react-native-image-picker";
import * as NitroImage from "react-native-nitro-image";
import { EditProfileScreen } from "../src/screens/profile/EditProfileScreen";
import {
  avatarCropRect, avatarImageLayout, clampAvatarCrop, initialAvatarCrop, panAvatarCrop, zoomAvatarCrop, MAX_AVATAR_ZOOM,
} from "../src/models/avatarCrop";
import { onProfileChanged } from "../src/state/storyChanges";
import * as usersApi from "../src/api/users";
import * as mediaApi from "../src/api/media";

// Edit Profile (spec section 23, Phase 11): photo take/choose/remove with a square crop made on
// the phone, Save and Discard, name and bio rules, and the change reaching other screens.
const mockUser = { id: "u-me", username: "me_now", email: "me@example.com", displayName: "Me Now", bio: "Old bio", avatarMediaId: "m-old" as string | null, interests: ["Cricket"], isPrivate: false };
const mockAuth = { user: mockUser, accessToken: "token", applyProfile: jest.fn() };
const mockPrevent = { enabled: false, callback: null as null | ((e: { data: { action: unknown } }) => void) };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  usePreventRemove: (enabled: boolean, callback: (e: { data: { action: unknown } }) => void) => {
    mockPrevent.enabled = enabled;
    mockPrevent.callback = callback;
  },
}));
jest.mock("../src/api/users", () => ({ ...jest.requireActual("../src/api/users"), checkUsername: jest.fn(), updateMyProfile: jest.fn() }));
jest.mock("../src/api/media", () => ({ uploadPhoto: jest.fn(async () => ({ id: "m-new" })) }));

const users = usersApi as jest.Mocked<typeof usersApi>;
const media = mediaApi as jest.Mocked<typeof mediaApi>;
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const nitro = NitroImage as unknown as { loadImage: jest.Mock };
const g = globalThis as unknown as { __picker: { result: unknown; camera?: unknown }; __nitroImage: { size: { width: number; height: number }; saved: Array<{ steps: unknown[]; width: number; height: number; format: string; quality: number }>; fail: boolean } };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const navigation = { goBack: jest.fn(), dispatch: jest.fn() };
const props = { navigation, route: { key: "EditProfile", name: "EditProfile" } } as unknown as React.ComponentProps<typeof EditProfileScreen>;

let tree: ReactTestRenderer;
beforeEach(() => {
  g.__picker.result = { didCancel: true };
  g.__picker.camera = undefined;
  g.__nitroImage.saved = [];
  g.__nitroImage.fail = false;
  g.__nitroImage.size = { width: 2048, height: 1536 };
  mockUser.avatarMediaId = "m-old";
  users.updateMyProfile.mockImplementation(async (input) => ({ user: { ...mockUser, ...input } as never }));
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function render(): Promise<void> {
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={metrics}><EditProfileScreen {...props} /></SafeAreaProvider>); });
  await flush();
}
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const labelled = (label: string) => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === label);
const press = async (label: string) => {
  const target = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  await act(async () => target.props.onPress());
  await flush();
};
const type = async (label: string, text: string) => {
  const input = tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.onChangeText && n.props.accessibilityLabel === label);
  await act(async () => input.props.onChangeText(text));
  await flush();
};
/** Choose in the photo sheet; like on iOS, the choice runs once the sheet has closed. */
async function choosePhotoAction(label: string): Promise<void> {
  await press("Change profile photo");
  await press(label);
  const sheet = tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!;
  await act(async () => sheet.props.onDismiss());
  await flush();
}
const saveButton = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Save profile changes");

describe("the square cut", () => {
  const W = 2048, H = 1536;
  test("starts centred with the photo's shorter side filling the circle", () => {
    expect(initialAvatarCrop(W, H)).toEqual({ zoom: 1, centerX: 1024, centerY: 768 });
    expect(avatarCropRect(initialAvatarCrop(W, H), W, H)).toEqual({ startX: 256, startY: 0, endX: 1792, endY: 1536 });
    expect(avatarImageLayout(initialAvatarCrop(W, H), W, H, 300)).toEqual({ width: 400, height: 300, left: -50, top: 0 });
  });

  test("dragging moves the photo with the finger, never past its edges", () => {
    const start = initialAvatarCrop(W, H);
    // 50 points right on a 300-point circle is 256 photo pixels at zoom 1: the left edge.
    expect(panAvatarCrop(start, 50, 0, 300, W, H).centerX).toBe(768);
    expect(panAvatarCrop(start, 500, 0, 300, W, H).centerX).toBe(768);
    expect(panAvatarCrop(start, -500, 0, 300, W, H).centerX).toBe(1280);
    expect(panAvatarCrop(start, 0, 80, 300, W, H).centerY).toBe(768); // no room vertically at zoom 1
  });

  test("zoom stays between 1x and 4x, and every cut is a square inside the photo", () => {
    expect(zoomAvatarCrop(initialAvatarCrop(W, H), 0.2, W, H).zoom).toBe(1);
    expect(zoomAvatarCrop(initialAvatarCrop(W, H), 99, W, H).zoom).toBe(MAX_AVATAR_ZOOM);
    for (const crop of [
      { zoom: 2, centerX: 0, centerY: 0 },
      { zoom: 3.3, centerX: 5000, centerY: -20 },
      { zoom: 1.7, centerX: 1000.4, centerY: 900.6 },
      { zoom: Number.NaN, centerX: Number.NaN, centerY: 10 },
    ]) {
      const r = avatarCropRect(crop, W, H);
      expect(r.endX - r.startX).toBe(r.endY - r.startY);
      expect(r.startX).toBeGreaterThanOrEqual(0);
      expect(r.startY).toBeGreaterThanOrEqual(0);
      expect(r.endX).toBeLessThanOrEqual(W);
      expect(r.endY).toBeLessThanOrEqual(H);
    }
    const tight = clampAvatarCrop({ zoom: 2, centerX: 0, centerY: 0 }, W, H);
    expect([tight.centerX, tight.centerY]).toEqual([384, 384]);
  });
});

describe("profile photo", () => {
  test("choose, move and scale, then Save uploads only the square that was cut", async () => {
    g.__picker.result = { assets: [{ uri: "file:///photos/IMG_1.jpg", width: 2048, height: 1536, type: "image/jpeg" }] };
    await render();
    await choosePhotoAction("Choose from library");
    expect(picker.launchImageLibrary).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "photo", selectionLimit: 1 }));
    expect(texts()).toContain("Move and scale");

    await press("Zoom in");
    await press("Use photo");
    expect(nitro.loadImage).toHaveBeenCalledWith({ filePath: "file:///photos/IMG_1.jpg" });
    // Zoomed in 1.25x around the centre: 1536 / 1.25 = 1228.8, so a 1228-pixel square, made 640 x 640.
    expect(g.__nitroImage.saved).toHaveLength(1);
    expect(g.__nitroImage.saved[0]).toMatchObject({ width: 640, height: 640, format: "jpg", quality: 90 });
    expect(g.__nitroImage.saved[0]!.steps).toEqual([["load", "file:///photos/IMG_1.jpg"], ["crop", 410, 154, 1638, 1382], ["resize", 640, 640]]);
    expect(texts()).not.toContain("Move and scale");
    expect(labelled("New profile photo")).toHaveLength(1);
    expect(texts()).toContain("Your new photo is used when you save.");
    expect(media.uploadPhoto).not.toHaveBeenCalled(); // the old photo stays until Save

    await act(async () => saveButton().props.onPress());
    await flush();
    expect(media.uploadPhoto).toHaveBeenCalledWith("file:///tmp/katkee-crop-1.jpg", "image/jpeg", "token");
    expect(media.uploadPhoto).not.toHaveBeenCalledWith("file:///photos/IMG_1.jpg", expect.anything(), expect.anything());
    expect(users.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ avatarMediaId: "m-new" }), "token");
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test("Remove current photo shows your initial and Save clears it; nothing else is sent for the photo otherwise", async () => {
    await render();
    await choosePhotoAction("Remove current photo");
    expect(texts()).toEqual(expect.arrayContaining(["M", "Your photo is removed when you save.", "Add photo"]));
    await act(async () => saveButton().props.onPress());
    await flush();
    expect(users.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ avatarMediaId: null }), "token");

    await act(async () => tree.unmount());
    jest.clearAllMocks();
    await render();
    await type("Bio", "New bio");
    await act(async () => saveButton().props.onPress());
    await flush();
    expect(users.updateMyProfile.mock.calls[0]![0]).not.toHaveProperty("avatarMediaId");
    expect(media.uploadPhoto).not.toHaveBeenCalled();
  });

  test("no photo yet: the sheet offers taking or choosing one, not removing", async () => {
    mockUser.avatarMediaId = null;
    await render();
    expect(texts()).toContain("Add photo");
    await press("Change profile photo");
    expect(labelled("Take photo")).toHaveLength(1);
    expect(labelled("Remove current photo")).toHaveLength(0);
  });

  test("taking a photo on Android asks for the camera first; a refusal offers Settings and opens nothing", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const request = jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await render();
    await press("Change profile photo");
    await press("Take photo"); // Android runs the choice straight away
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.CAMERA);
    expect(picker.launchCamera).not.toHaveBeenCalled();
    expect(alert.mock.calls[0]![0]).toBe("Allow camera access");

    request.mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    g.__picker.camera = { assets: [{ uri: "file:///camera/1.jpg", width: 1080, height: 1440 }] };
    await press("Change profile photo");
    await press("Take photo");
    expect(picker.launchCamera).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "photo", cameraType: "front", saveToPhotos: false }));
    expect(texts()).toContain("Move and scale");
  });

  test("cancelling the cropper changes nothing; a photo that can't be read says so", async () => {
    g.__picker.result = { assets: [{ uri: "file:///photos/2.jpg", width: 800, height: 800 }] };
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await render();
    await choosePhotoAction("Choose from library");
    await press("Cancel");
    expect(texts()).not.toContain("Move and scale");
    expect(labelled("New profile photo")).toHaveLength(0);
    expect(mockPrevent.enabled).toBe(false);

    g.__nitroImage.fail = true;
    await choosePhotoAction("Choose from library");
    await press("Use photo");
    expect(alert.mock.calls.at(-1)![0]).toBe("Couldn't use this photo");
    expect(labelled("New profile photo")).toHaveLength(0);
  });
});

describe("Save and Discard", () => {
  test("leaving with unsaved changes asks first; Discard leaves, Keep editing stays", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await render();
    expect(mockPrevent.enabled).toBe(false);
    await type("Bio", "Changed my mind");
    expect(mockPrevent.enabled).toBe(true);
    const action = { type: "GO_BACK" };
    await act(async () => mockPrevent.callback!({ data: { action } }));
    expect(alert.mock.calls[0]![0]).toBe("Discard changes?");
    const buttons = alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
    expect(buttons.map((b) => b.text)).toEqual(["Keep editing", "Discard"]);
    expect(navigation.dispatch).not.toHaveBeenCalled();
    buttons.find((b) => b.text === "Discard")!.onPress!();
    expect(navigation.dispatch).toHaveBeenCalledWith(action);
  });

  test("a save turns the guard off before leaving, updates your account at once and tells other screens", async () => {
    const changed = jest.fn();
    const stop = onProfileChanged(changed);
    try {
      await render();
      await type("Display name", "Me Again");
      await act(async () => saveButton().props.onPress());
      await flush();
      expect(users.updateMyProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Me Again", bio: "Old bio" }), "token");
      expect(mockAuth.applyProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Me Again" }));
      expect(changed).toHaveBeenCalledTimes(1);
      expect(mockPrevent.enabled).toBe(false);
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  test("a failed save keeps your changes and stays", async () => {
    users.updateMyProfile.mockRejectedValueOnce(new Error("offline"));
    await render();
    await type("Bio", "Keep this");
    await act(async () => saveButton().props.onPress());
    await flush();
    expect(texts()).toContain("That didn't save. Try again.");
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(mockPrevent.enabled).toBe(true);
  });

  test("name and bio rules: counters, and an empty name can't be saved", async () => {
    await render();
    expect(texts()).toEqual(expect.arrayContaining(["6/60", "7/150"]));
    await type("Display name", "   ");
    expect(texts()).toContain("Enter your name.");
    expect(saveButton().props.disabled).toBe(true);
    await type("Display name", "Me");
    expect(texts()).not.toContain("Enter your name.");
    expect(saveButton().props.disabled).toBe(false);
  });

  test("a name can't include a check mark (it would pass for the verified badge)", async () => {
    await render();
    await type("Display name", "Me Now \u2714");
    expect(texts()).toContain("Names can't include check marks.");
    expect(saveButton().props.disabled).toBe(true);
    await type("Display name", "Me Now");
    expect(texts()).not.toContain("Names can't include check marks.");
    expect(saveButton().props.disabled).toBe(false);
  });

  test("Save with nothing changed just closes", async () => {
    await render();
    await act(async () => saveButton().props.onPress());
    await flush();
    expect(users.updateMyProfile).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
