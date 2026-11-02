// Autolinking exceptions.
module.exports = {
  dependencies: {
    // Sign in with Apple is offered on iPhone only (src/screens/auth/ProviderEntry.tsx). The
    // library's Android web flow is unused, so its Android module isn't built into the app.
    "@invertase/react-native-apple-authentication": { platforms: { android: null } },
  },
};
