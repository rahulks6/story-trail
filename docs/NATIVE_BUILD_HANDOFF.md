# Repeatable native builds

These commands build development artifacts and preserve evidence under `docs/native-builds/`. They never sign or publish a store release. A successful JavaScript bundle is not a successful native build.

## Android on Windows, macOS or Linux

1. Install Node, JDK 17 and Android Studio. Install SDK platform 36, Build Tools 36.0.0, platform-tools and NDK 26.1.10909125 for the current development host. Set ANDROID_HOME to that SDK and add Java to PATH. The eventual coordinated React Native upgrade may require different tool versions.
2. Run `npm --prefix mobile ci` from the project root.
3. Set `developmentApiUrl` in `mobile/build-config.json` to the API address reachable from your phone. Android's default emulator address is not your phone's address.
4. Run `npm run build:android-debug`. Read its result JSON and log. A successful output is `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
5. Start Metro with `npm --prefix mobile start`. Install the APK and test against the development backend. For USB-connected Android, `adb reverse tcp:8081 tcp:8081` forwards Metro; configure API networking separately.

The existing React Native 0.75/AGP 8.5 development host is still blocked from release. Migrate the framework, native modules and toolchain together and validate 16 KB binaries before releasing. Do not bypass `check:android-release` to obtain a publishable artifact.

## iOS on a Mac

1. Install/select Xcode 26+, Node and Ruby Bundler. Run `npm --prefix mobile ci`, then `cd mobile` and `bundle install`.
2. From the project root run `npm run build:ios-simulator`. It resolves Pods and builds an unsigned Debug simulator app. Keep Podfile.lock after a successful dependency resolution.
3. Simulator compilation does not test camera hardware, device permissions or production signing. Use Xcode and your Apple team for device builds and TestFlight.
4. Before archiving, resolve the blockers in the current release audit: native migration, app icons, privacy declarations, production API, login requirements, identifiers and signing.

## Database acceptance

Install PostgreSQL and its `createdb`/`psql` tools. Use a dedicated local test instance and test-only credentials with CREATEDB rights. Set PGHOST, PGPORT, PGUSER and PGPASSWORD in your local environment, then run `npm run verify:full`. Never use production credentials. Generated test databases are retained for inspection.

Build logs and result JSON files must travel with the exact source and artifact tested. Do not infer success from an interrupted terminal or a missing error message.
