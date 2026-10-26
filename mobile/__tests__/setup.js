/* Native modules replaced for component tests. Kept small: only what screens touch. */
const mockStorage = new Map();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k) => (mockStorage.has(k) ? mockStorage.get(k) : null)),
    setItem: jest.fn(async (k, v) => { mockStorage.set(k, v); }),
    removeItem: jest.fn(async (k) => { mockStorage.delete(k); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiRemove: jest.fn(async (keys) => { keys.forEach((k) => mockStorage.delete(k)); }),
    clear: jest.fn(async () => { mockStorage.clear(); }),
  },
}));
global.__mockStorage = mockStorage;

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

// SVG primitives render as plain host elements (no native drawing in tests).
jest.mock("react-native-svg", () => {
  const React = require("react");
  const host = (name) => {
    const C = (props) => React.createElement(name, props, props.children);
    C.displayName = name;
    return C;
  };
  const names = ["Svg", "Path", "Circle", "Rect", "G", "Line", "Polyline", "Polygon", "Ellipse", "Defs", "LinearGradient", "RadialGradient", "Stop", "ClipPath", "Mask", "Text"];
  const exports = Object.fromEntries(names.map((n) => [n, host(n)]));
  return { __esModule: true, default: exports.Svg, ...exports };
});

// Video: a host element tests can drive (props.onReadyForDisplay(), props.onEnd(), ...).
jest.mock("react-native-video", () => {
  const React = require("react");
  const Video = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ seek: jest.fn(), pause: jest.fn(), resume: jest.fn() }));
    return React.createElement("Video", props);
  });
  Video.displayName = "Video";
  return { __esModule: true, default: Video };
});

// Camera: permission and device state are set per test through global.__camera.
global.__camera = { permission: true, microphone: true, device: { id: "back", position: "back" } };
jest.mock("react-native-vision-camera", () => {
  const React = require("react");
  const Camera = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: jest.fn() }));
    return React.createElement("Camera", props);
  });
  Camera.displayName = "Camera";
  const permission = (key) => () => ({ hasPermission: global.__camera[key], requestPermission: jest.fn(async () => global.__camera[key]) });
  return {
    __esModule: true,
    Camera,
    useCameraDevice: () => global.__camera.device,
    useCameraPermission: permission("permission"),
    useMicrophonePermission: permission("microphone"),
    usePhotoOutput: () => ({ capturePhoto: jest.fn() }),
    useVideoOutput: () => global.__camera.videoOutput ?? { startRecording: jest.fn() },
  };
});

// Nitro Image (the on-phone crop for profile photos, and the editor's filter previews): records
// each step and the saved result. Raw pixels are a flat RGBA fill of `colour`.
global.__nitroImage = { size: { width: 2048, height: 1536 }, colour: [200, 120, 90, 255], saved: [], fail: false };
jest.mock("react-native-nitro-image", () => {
  const make = (width, height, steps, pixels) => ({
    width,
    height,
    cropAsync: jest.fn(async (sx, sy, ex, ey) => make(ex - sx, ey - sy, [...steps, ["crop", sx, sy, ex, ey]])),
    resizeAsync: jest.fn(async (w, h) => make(w, h, [...steps, ["resize", w, h]])),
    rotateAsync: jest.fn(async (degrees) => make(degrees % 180 ? height : width, degrees % 180 ? width : height, [...steps, ["rotate", degrees]])),
    mirrorHorizontallyAsync: jest.fn(async () => make(width, height, [...steps, ["mirror"]])),
    toRawPixelDataAsync: jest.fn(async () => {
      const bytes = new Uint8Array(width * height * 4);
      for (let i = 0; i < bytes.length; i += 4) bytes.set(global.__nitroImage.colour, i);
      return { buffer: bytes.buffer, width, height, pixelFormat: "RGBA" };
    }),
    saveToTemporaryFileAsync: jest.fn(async (format, quality) => {
      global.__nitroImage.saved.push({ steps, width, height, format, quality, pixels });
      return `/tmp/katkee-crop-${global.__nitroImage.saved.length}.jpg`;
    }),
  });
  return {
    loadImage: jest.fn(async ({ filePath }) => {
      if (global.__nitroImage.fail) throw new Error("unreadable");
      return make(global.__nitroImage.size.width, global.__nitroImage.size.height, [["load", filePath]]);
    }),
    Images: {
      loadFromRawPixelDataAsync: jest.fn(async (data) => make(data.width, data.height, [["raw", data.pixelFormat]], new Uint8Array(data.buffer.slice(0)))),
    },
  };
});

// Voice recorder: global.__sound drives it (the file it "records" and the progress events).
global.__sound = { path: "/data/voice.mp4", listener: null };
jest.mock("react-native-nitro-sound", () => ({
  AudioEncoderAndroidType: { AAC: 3 },
  OutputFormatAndroidType: { MPEG_4: 2 },
  createSound: () => ({
    addRecordBackListener: (fn) => { global.__sound.listener = fn; },
    removeRecordBackListener: () => { global.__sound.listener = null; },
    startRecorder: jest.fn(async () => global.__sound.path),
    stopRecorder: jest.fn(async () => global.__sound.path),
  }),
}));

// Haptics: records each trigger.
global.__haptics = [];
jest.mock("react-native-haptic-feedback", () => ({ trigger: jest.fn((type) => global.__haptics.push(type)) }));

global.__picker = { result: { didCancel: true } };
jest.mock("react-native-image-picker", () => ({
  launchImageLibrary: jest.fn(async () => global.__picker.result),
  launchCamera: jest.fn(async () => global.__picker.camera ?? { didCancel: true }),
}));

jest.mock("@dr.pogodin/react-native-fs", () => ({
  DocumentDirectoryPath: "/documents",
  CachesDirectoryPath: "/caches",
  moveFile: jest.fn(async () => undefined),
  downloadFile: jest.fn(() => ({ jobId: 1, promise: Promise.resolve({ jobId: 1, statusCode: 200, bytesWritten: 1024 }) })),
  stopDownload: jest.fn(),
  copyFile: jest.fn(async () => undefined),
  exists: jest.fn(async () => true),
  mkdir: jest.fn(async () => undefined),
  read: jest.fn(async () => ""),
  stat: jest.fn(async () => ({ size: 1024 })),
  unlink: jest.fn(async () => undefined),
}));

// Sharing a file to other apps: the system share sheet, and the capture of a view to a file.
jest.mock("react-native-share", () => ({ __esModule: true, default: { open: jest.fn(async () => ({ success: true, message: "" })) } }));
jest.mock("react-native-view-shot", () => ({ __esModule: true, captureRef: jest.fn(async (_ref, options) => `file:///tmp/capture.${options?.format ?? "png"}`) }));

jest.mock("react-native-keychain", () => {
  const items = new Map();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "AccessibleWhenUnlockedThisDeviceOnly" },
    setGenericPassword: jest.fn(async (u, p, o) => { items.set(o?.service ?? "", { username: u, password: p }); return true; }),
    getGenericPassword: jest.fn(async (o) => items.get(o?.service ?? "") ?? false),
    resetGenericPassword: jest.fn(async (o) => items.delete(o?.service ?? "")),
  };
});

jest.mock("@react-native-clipboard/clipboard", () => require("@react-native-clipboard/clipboard/jest/clipboard-mock.js"));
jest.mock("@react-native-community/geolocation", () => ({ getCurrentPosition: jest.fn(), requestAuthorization: jest.fn() }));
jest.mock("@react-native-google-signin/google-signin", () => {
  const React = require("react");
  return {
    GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(async () => true), signIn: jest.fn(), signOut: jest.fn() },
    GoogleSigninButton: (props) => React.createElement("GoogleSigninButton", props),
    isSuccessResponse: () => false,
    isErrorWithCode: () => false,
    statusCodes: {},
  };
});
