/**
 * Component tests (Phase 6): render real screens and components with React Native's Jest
 * preset; native modules are replaced by small in-memory mocks in __tests__/setup.js.
 * Run: npm --prefix mobile test
 */
module.exports = {
  preset: "@react-native/jest-preset",
  rootDir: __dirname,
  testMatch: ["<rootDir>/__tests__/**/*.test.ts?(x)"],
  setupFiles: ["<rootDir>/__tests__/setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*|@react-native-async-storage|@react-native-firebase|@react-native-google-signin|@react-native-clipboard|@dr\\.pogodin)/)",
  ],
};
