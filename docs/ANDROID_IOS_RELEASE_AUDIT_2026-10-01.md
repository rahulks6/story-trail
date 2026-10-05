# Katkee Android/iOS audit — 1 October 2026

**Not ready for store submission.** This source checkpoint supersedes older completion claims. No signed AAB, APK or iOS archive is certified. Source checks cannot establish native/device readiness.

## Changes in v3

- Isolated draft save, restore, count and deletion by account. Legacy drafts with no known owner are not restored into a new account. Navigation remounts on account changes.
- Profile and privacy changes apply the successful PATCH response directly to the matching signed-in account. Saving has an immediate duplicate guard, validation before avatar upload, reuse of an uploaded avatar after a failed PATCH, readable field errors and picker error handling. Unchanged avatars are omitted from PATCH requests.
- Profile/avatar validation rejects moderated, foreign, processing and non-photo media before any profile write. Only the username constraint is translated into a username-conflict error; unrelated database failures propagate.
- Email signup reserves official-looking usernames consistently. Malformed route escaping returns HTTP 400.
- Added a 30-second deadline to local media reading and rejected empty files; upload HTTP requests retain their separate 180-second deadline.
- Added validated profile-link routing and native Android/iOS URL handlers. Pending profile links can continue after sign-in. Native cold/warm launch tests remain required. Google URL forwarding is included; its real reversed-client-ID scheme still needs configuration.
- Added configurable privacy, terms and support links in About and required them in release checks.
- Upgraded backend google-auth-library to 10.9.1 and mobile Babel core/runtime to 7.29.7 with lockfiles.
- Release checks now reject the old framework/AGP combination even when SDK numbers are raised, and flag missing iOS icon files and an empty privacy declaration. Default checks include Android signing.
- Verification now bundles JavaScript for both Android and iOS and includes account-isolation, avatar-write, username-conflict, malformed-route and profile-link regressions.

## Evidence

Current npm audits: backend **0 known advisories**; mobile **15 (1 high, 14 moderate)**. See `current-audit/*-audit.json`. This includes build dependencies and is not an overall security certification. Remaining Metro/CLI/navigation issues require a coordinated migration; incompatible major transitive overrides were not applied.

Fresh runner results are under `test-runs/`; consult each `results.json` and its logs. Both TypeScript checks and both JS bundles have passed after restoration. The first restored run exposed a test-harness method typo, corrected from `register` to the router's actual `add` method. Failed evidence is retained. Database integration could not start because `createdb` is missing. Installing PostgreSQL through apt failed on environment identity/group permissions. Historical database reports do not cover the new profile migration.

The workspace restarted before the earlier unsaved audit could be packaged. These fixes were restored from the saved v2 source and rechecked; only logs present in this archive count as delivered evidence.

## Android blockers

1. The app still uses React Native 0.75.4 and its AGP 8.5 toolchain. API 36 needs AGP 8.9.1 or later. The native framework and libraries also need a validated 16 KB page-size migration. Raising target/compile SDK integers alone is insufficient.
2. Upgrade React, React Native, Metro, CLI, navigation/screens, native modules, Gradle, Kotlin, NDK and native host code as a compatible set. Build before promoting that migration; verify native ELF alignment and packaging and run on a 16 KB device/emulator.
3. Configure the real production HTTPS API, permanent application ID, approved launcher artwork and private signing key. No keys, accounts or URLs were invented.
4. Build and install an APK, then produce and validate the signed Play AAB. Physical-device acceptance remains outstanding.

## iOS blockers

1. A macOS builder with Xcode 26+/iOS SDK 26+ is required for current submission. Linux JS bundling is not an iOS archive.
2. The AppIcon catalog is a template without image filenames. Supply the approved brand artwork, without redesigning it.
3. Complete the privacy manifest and App Store disclosures using the actual account/contact data, user content, messages, interactions, ads and SDK behavior. The current empty collected-data array is not a completed declaration.
4. Google login is included but a qualifying equivalent login under Apple guideline 4.8 has not been implemented. Determine applicable requirements and complete the required flow, typically Sign in with Apple, including backend verification, revocation and deletion. No exception is assumed.
5. Configure the Apple team, permanent bundle ID, entitlements, provisioning/certificates and Google callback scheme. Resolve CocoaPods, retain Podfile.lock after a successful install, archive in Xcode and validate through TestFlight on real devices.

## Shared unfinished work

Account recovery delivery; avatar crop; editor preview/export parity; media processing/renditions/posters and authenticated object storage/CDN; OS-managed background uploads; realtime/push and Activity grouping; remaining settings/admin MFA; retention/cleanup, backups and restore testing; monitoring and load tests remain open. The current upload queue retries while the app is open.

Deploy staging PostgreSQL/API/media storage and test all additive migrations, including 0027. Enable Google/SMS only after real provider acceptance. Hosting and provider acceptance have not been performed here.

The approved six tabs, Stories/Highlights, no Discover tab and no Music V1 are preserved. Public Story view counts remain aggregate-only; viewer identities and Insights remain owner-only.

## Commands and acceptance

From the extracted `katkee` directory:

```sh
npm --prefix backend ci
npm --prefix mobile ci
npm run verify:bundle
npm run check:android-release
npm run check:ios-release
```

Release configuration checks intentionally fail until their blockers are addressed. Passing them does not certify native behavior or store approval.

For integration tests, use a dedicated local PostgreSQL instance and a test role with CREATEDB rights, install client tools on PATH, set PGHOST/PGPORT/PGUSER/PGPASSWORD locally, and run `npm run verify:full`. The existing runner creates uniquely named databases and retains them; never point it at production.

After the native migration, Android on Windows: `cd mobile/android`, then `.\gradlew.bat :app:assembleDebug`. Debug builds need Metro and a reachable API. After production configuration/signing, `:app:bundleRelease` creates the Play artifact.

On macOS: `cd mobile`, `bundle install`, `cd ios`, `bundle exec pod install`, then open `KatkeeMobile.xcworkspace`. Select the actual team and device destination, Archive, validate and distribute to TestFlight.

Acceptance must exercise login/signup/linking/deletion, camera and permission denial, editor/export, upload interruption/retry/background/termination, Story privacy and counts, Highlights, profile rename/avatar, comments/likes/share, DM, report/block, moderation and ads. Test cold/warm profile links signed in/out, and switch between two accounts to check drafts, navigation, uploads and stale responses. Include slow/offline networks, session expiry, low storage, accessibility and measured performance.

## Official references

- https://developer.android.com/build/releases/about-agp
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://developer.android.com/guide/practices/page-sizes
- https://developer.apple.com/news/upcoming-requirements/?id=04282026a
- https://developer.apple.com/app-store/review/guidelines/
