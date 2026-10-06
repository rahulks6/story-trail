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
    useVideoOutput: () => ({ startRecording: jest.fn() }),
  };
});

global.__picker = { result: { didCancel: true } };
jest.mock("react-native-image-picker", () => ({
  launchImageLibrary: jest.fn(async () => global.__picker.result),
  launchCamera: jest.fn(async () => ({ didCancel: true })),
}));

jest.mock("@dr.pogodin/react-native-fs", () => ({
  DocumentDirectoryPath: "/documents",
  copyFile: jest.fn(async () => undefined),
  exists: jest.fn(async () => true),
  mkdir: jest.fn(async () => undefined),
  read: jest.fn(async () => ""),
  stat: jest.fn(async () => ({ size: 1024 })),
  unlink: jest.fn(async () => undefined),
}));

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
