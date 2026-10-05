# Repeatable native builds

These commands build Android/iOS artifacts and preserve evidence under `docs/native-builds/`.
A successful JavaScript bundle is not a successful native build, and a successful native
build is not device acceptance.

## Toolchain (React Native 0.87.1, upgraded 5 Oct 2026)

| Component | Version | Notes |
|---|---|---|
| React Native / React | 0.87.1 / 19.2.3 | New Architecture (Fabric + TurboModules) enabled; required since RN 0.82 |
| Node | ≥ 22.11 | |
| JDK | **17** | The React Native Gradle plugin pins a Java 17 toolchain. JDK 21 alone fails ("Cannot find a Java installation … languageVersion=17"). |
| Gradle | 9.4.1 | Wrapper downloads from `services.gradle.org` |
| Android Gradle Plugin | 9.2.1 | From the React Native version catalog |
| Kotlin | 2.2.0 | |
| Android SDK platform | 37 (`platforms;android-37.0`) | `compileSdk 37`, `targetSdk 36`, `minSdk 24` |
| Build-tools | 37.0.0 | Provides `zipalign` and `apksigner` used by the verification step |
| NDK | 27.1.12297006 | Produces 16 KB-aligned 64-bit libraries |
| CMake | 3.30.5 | |
| Camera | react-native-vision-camera 5.2.3 (Nitro) | Ported from v4; needs `react-native-nitro-modules` and `react-native-nitro-image` |

### Network hosts the Android build needs

The Gradle build downloads AGP and AndroidX from Google's Maven repository and React Native's
own artifacts from the React Native Maven repository:

- `dl.google.com` (Google Maven; `maven.google.com` redirects here; also the SDK manager)
- `repo.reactnative.dev` (Maven Central redirects `com.facebook.react:react-android` here)
- `repo.maven.apache.org` / `repo1.maven.org`, `plugins.gradle.org`, `services.gradle.org`

In the cloud environment used on 5 Oct 2026, `dl.google.com` and `repo.reactnative.dev`
were denied by the egress policy, so the Gradle build could not run there (evidence:
`docs/native-builds/2026-10-05T10-39-25-568Z-android/`).

## Android debug APK (any OS)

1. Install Node 22, **JDK 17**, Android Studio or the command-line tools, then:
   `sdkmanager "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.30.5" "platform-tools"`.
   Set `ANDROID_HOME` and `JAVA_HOME` (JDK 17).
2. `npm --prefix mobile ci`
3. Set `developmentApiUrl` in `mobile/build-config.json` to an API address your phone can reach.
4. `npm run build:android-debug` — runs `:app:assembleDebug`, then checks every 64-bit `.so`
   for 16 KB ELF alignment and runs `zipalign -c -P 16`. Output:
   `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
5. `npm --prefix mobile start`, install the APK, `adb reverse tcp:8081 tcp:8081`.

## Android signed release APK + Play AAB

Preconditions enforced by `mobile/scripts/check-release.cjs` (the build refuses to start otherwise):

- `mobile/build-config.json`: live HTTPS `productionApiUrl`, `privacyPolicyUrl`, `termsUrl`,
  `supportUrl`; permanent `androidApplicationId` (not `*.development`) matching
  `android/app/build.gradle`; `releaseIdentifiersConfirmed: true`.
- Private upload key in the build environment (never committed):
  `KATKEE_UPLOAD_STORE_FILE` (absolute path), `KATKEE_UPLOAD_STORE_PASSWORD`,
  `KATKEE_UPLOAD_KEY_ALIAS`, `KATKEE_UPLOAD_KEY_PASSWORD`. The public debug keystore and the
  `androiddebugkey` alias are rejected.
- Optional: `KATKEE_VERSION_CODE` (monotonic integer) and `KATKEE_VERSION_NAME`.

Generate an upload key once and store it in your password manager / CI secret store:

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore katkee-upload.p12 \
  -alias katkee-upload -keyalg RSA -keysize 4096 -validity 10000
```

Then `npm run build:android-release`. It runs `:app:assembleRelease :app:bundleRelease`,
writes SHA-256 digests of both artifacts, verifies 16 KB alignment of every 64-bit library in
the APK and the AAB, runs `zipalign -c -P 16` and `apksigner verify` on the APK, and fails if
any check fails. Enroll in Play App Signing and upload the AAB to an internal-testing track.

Check any artifact on its own: `npm run check:16kb -- path/to/app.aab`.

## iOS on a Mac

1. Install Xcode 26+, Node 22 and Ruby Bundler. `npm --prefix mobile ci`, then `cd mobile && bundle install`.
2. From the project root: `npm run build:ios-simulator` (resolves Pods, builds an unsigned
   Debug simulator app). Keep `Podfile.lock` after a successful resolution.
3. The iOS host now uses a Swift `AppDelegate` with `RCTReactNativeFactory` (React Native
   0.87 template) and a minimum deployment target of iOS 15.1. The app is iPhone-only.
4. Before archiving, resolve the blockers in the current release report (icons, privacy
   manifest declarations, production API, Apple sign-in requirement, identifiers, signing).

## Database acceptance

Install PostgreSQL and its `createdb`/`psql` tools. Use a dedicated local test instance and
test-only credentials with CREATEDB rights. Set PGHOST, PGPORT, PGUSER and PGPASSWORD, then run
`npm run verify:full`. Never use production credentials. Generated test databases are retained.
