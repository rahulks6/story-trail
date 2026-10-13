# Screen preview

Renders the app's own screen code in Chromium with React Native for Web and sample data, then
takes screenshots. It is a quick design check: it found the malformed Like-heart icon path in
Phase 10. It is **not** a device test. Fonts (Inter here), native headers, gestures and
platform details differ on iPhone and Android.

```
cd tools/screen-preview
npm install                 # React Native for Web, esbuild, Inter
npx playwright install chromium   # skip if Playwright's Chromium is already installed
npm run shots               # shots/*.png, creator-page-preview.png, edit-profile-preview.png
```

- `src/app.tsx` renders the real `ProfileScreen`, `UserProfileScreen`, `EditProfileScreen`,
  `AvatarCropper` and `BottomTabBar` inside a 390 x 844 phone frame.
  `?screen=own|other|private|edit|crop|login|signup|about` picks the screen, and `&story=none` shows
  your page without an active Story. `login` leaves out Google and phone sign-in, which need
  native SDKs.
- `npm run shots` also writes `shots/edit-profile-preview.png`.
- `src/mocks/` replaces the network, sign-in and navigation with sample data. The sample
  people and pictures are made up, and the pictures are drawn gradients.
- `build.cjs` maps `react-native` to `react-native-web` and the app's API, auth and navigation
  modules to those mocks.
