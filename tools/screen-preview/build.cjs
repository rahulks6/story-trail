// Bundles the app's real screens for the browser with React Native for Web; see README.md.
const esbuild = require("esbuild"), path = require("path");
const mobile = path.resolve(__dirname, "../../mobile");
const mock = (f) => path.join(__dirname, "src/mocks", f);
const redirects = [
  [/^react-native$/, require.resolve("react-native-web")],
  [/^react-native-svg$/, path.join(mobile, "node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js")],
  [/^@react-navigation\/native$/, mock("navigation.ts")],
  [/^@react-navigation\/bottom-tabs$/, mock("tabs.ts")],
  [/^react-native-safe-area-context$/, mock("safeArea.tsx")],
  [/^@react-native-clipboard\/clipboard$/, mock("misc.ts")],
  [/(^|\/)state\/AuthContext$/, mock("auth.ts")],
  [/(^|\/)state\/NotificationsContext$/, mock("contexts.ts")],
  [/(^|\/)state\/DMContext$/, mock("contexts.ts")],
  [/(^|\/)api\/users$/, mock("users.ts")],
  [/(^|\/)api\/stories$/, mock("stories.ts")],
  [/(^|\/)api\/highlights$/, mock("highlights.ts")],
  [/(^|\/)api\/conversations$/, mock("misc.ts")],
  [/(^|\/)analytics\/analytics$/, mock("misc.ts")],
  [/(^|\/)components\/ReportSheet$/, mock("misc.ts")],
  [/^@react-native\/assets-registry\/registry$/, mock("misc.ts")],
];
esbuild.build({
  entryPoints: [path.join(__dirname, "src/app.tsx")],
  bundle: true, outfile: path.join(__dirname, "dist/app.js"), format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', __DEV__: "true", global: "window" },
  resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js"],
  nodePaths: [path.join(__dirname, "node_modules"), path.join(mobile, "node_modules")],
  loader: { ".png": "dataurl" },
  logLevel: "warning",
  plugins: [{ name: "preview-redirects", setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      for (const [re, target] of redirects) if (re.test(args.path)) return { path: target };
      // One React for everything, the preview's.
      if (/^react(-dom)?(\/.*)?$/.test(args.path)) return { path: require.resolve(args.path, { paths: [__dirname] }) };
      return undefined;
    });
  } }],
}).then(() => console.log("built")).catch((e) => { console.error(e.message); process.exit(1); });
