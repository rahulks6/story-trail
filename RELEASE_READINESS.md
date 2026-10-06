# Katkee Android/iOS release checkpoint — 1 October 2026 (India)

**Latest: [3 October verification update](docs/CONTINUATION_2026-10-03.md). Android debug APK built and signature verified. PostgreSQL integration passes: 191 backend tests, plus 44 focused regressions and both JavaScript bundles. Inspection found 105 native library entries below 16 KB ELF alignment; native migration, iOS acceptance and product/release blockers remain.**

**Current v3 status: [Android/iOS audit](docs/ANDROID_IOS_RELEASE_AUDIT_2026-10-01.md). Read it first.** It contains the restored account/profile/link fixes, updated dependency counts, both-platform checks and remaining blockers. The v2 evidence and limitations below are retained as historical context; newer audit results supersede them.

**NOT PUBLISH-READY. No APK/AAB has been produced, signed or tested on a device.**
This document supersedes older completion and deployment claims in the archive.

## Authoritative inputs

- Base: Katkee-Final-Source-Public-View-Count-2026-09-26.zip.
- Product/design: the user's 74-page final master specification with Google/phone login and locked icons.
- The Reviewed-Source ZIP is the preceding source version. The smaller katkee-project ZIP lacks the native Android project.
- Approved artwork, layout and app identity have not been redesigned in this checkpoint. Exact artwork matching still needs visual acceptance.

## Changes made in this checkpoint

- API requests now have a 30-second total deadline, including refresh and response-body reads. Upload HTTP requests have a 180-second deadline. Requests abort underlying work and release the caller even if a transport ignores abort. File-to-blob loading is not covered by this upload HTTP deadline.
- HTML/error proxy responses and empty successful JSON responses produce controlled errors instead of JSON parser errors or undefined data. Valid 204 responses remain supported.
- Authentication refresh accepts standard Headers and case-insensitive header names. Only a 401 is retried once; failed writes are not automatically replayed for timeouts or server errors.
- A trailing slash in the API origin is normalized before adding route paths.
- Android release checks no longer depend on the iOS identifier/project, and iOS release checks no longer depend on Android SDK configuration. Origin validation rejects paths and placeholder hosts. Android release checks reject a renamed copy of the bundled public debug key and incomplete signing settings.
- The existing regression runner now resolves the project's installed TypeScript dependency without an undocumented global install.
- A root verification command generates fresh logs and machine-readable results.
- Profile metadata is now persisted through migration `0027_profile_metadata.sql`: avatar media, up to five validated interests, and username changes are exposed in the API and editor. Avatar ownership/status is checked server-side, blocked/inactive avatar reads return 404, and username/avatar/profile fields commit in one database update.
- The Android project now declares compile/target API 36 and Build Tools 36.0.0. This is a release prerequisite, not proof that the native toolchain or native libraries have been accepted.

## Fresh evidence and limitations

Fresh run: docs/test-runs/2026-09-30T23-45-04-978Z/. All 33 focused source/regression tests and 14 ranking unit tests passed (47 total). Backend TypeScript compilation, mobile typechecking and Android production-mode JavaScript bundling passed. Source-level tests, TypeScript builds and Android JavaScript bundling run locally. Historical backend/database reports under docs/ remain historical, not newly executed evidence.

PostgreSQL server/client and the Android SDK are unavailable in this execution environment. Installing PostgreSQL failed because OS identity/group operations are not permitted. No integration test result or native-build result is inferred from source tests. Native transport tests below use mocks, not an Android device.

The npm audits still report unresolved dependencies (backend: 2 moderate; mobile: 1 high, 15 moderate, 1 low at this checkpoint). A non-forced audit fix did not resolve them. Do not override major transitive dependencies blindly: Metro/native CLI compatibility must be tested. The audit snapshots are in docs/current-audit/.

## Product work still required

These are unresolved items from the source status and specification, not features completed by this checkpoint:

- Password-reset/recovery delivery and remaining settings.
- Full editor preview/export parity, render validation, and physical-device gesture testing.
- OS-managed background uploads (the resumable outbox continues while the app is open). Background processing, renditions/posters and S3/CloudFront delivery were implemented in Phase 2 and verified against local S3/SQS servers; live AWS is not verified.
- Live push delivery and on-device realtime behavior: WebSocket realtime and FCM/APNs push were implemented in Phase 3 and verified against local protocol servers, not with real credentials or devices. Activity grouping completion also remains.
- On-device behavior of the Phase 4 work: the moderation lifecycle and appeals (with automatic reversal), DM reporting with evidence, per-account abuse limits and link safety, Ads audiences/View Profile/automatic completion, and product analytics (DAU/WAU/MAU, retention, crash-free sessions) were implemented in Phase 4 and verified on the server and in the Admin Console (`docs/phases/PHASE_4_MODERATION_ADS_ANALYTICS.md`). Still missing: native crash reporting (only JavaScript crashes are counted), device attestation/CAPTCHA, live Safe Browsing (needs an API key).
- Retention/cleanup jobs, production monitoring, database/media backup and restore exercises, and load testing.

## Android and publishing gates

1. Upgrade React Native and native dependencies together to a supported combination. Build and test for Play's current target requirement (API 36 at this checkpoint), including native-library 16 KB page compatibility. The source now declares API 36, but changing the numbers alone is not a validated native upgrade.
2. Build a development APK and exercise signup/login, story capture/edit/upload/playback, follow/privacy, comments/likes/share, Highlights, DM, account deletion, moderation and advertisements on physical Android devices.
3. Test slow/lost networks, app background/resume, process termination during uploads, session expiry, camera/microphone denial, low storage and accessibility. Confirm no cross-account data leakage and correct public view-count privacy.
4. Deploy the real HTTPS API, PostgreSQL and media storage, run additive migrations against staging, configure backups, and verify restore before real users.
5. Configure Google client IDs/signing fingerprints and the SMS provider. Keep features disabled until real provider acceptance passes.
6. Confirm permanent Android application ID and use a private signing key. Keep secrets outside this ZIP; do not send signing passwords through chat.
7. Replace template launcher assets with the approved logo, prepare store screenshots/privacy/data-safety disclosures, and complete internal testing before submission.

Current Android policy references, checked 30 September 2026 UTC:
https://support.google.com/googleplay/android-developer/answer/11926878
https://developer.android.com/guide/practices/page-sizes

## Continue on Windows

Use the existing mobile/android project. Do not run a new React Native init and overwrite it.
Install Node 22, JDK 17, Android Studio/SDK, and a dedicated local PostgreSQL server/client for development. After the coordinated native upgrade, use the SDK/JDK versions required by that selected React Native version.

From the extracted katkee directory in PowerShell:

```powershell
npm --prefix backend ci
npm --prefix mobile ci
npm run verify:bundle
```

This generates logs under docs/test-runs. This is a source verification command, not an installation command.

For integration tests, set PGHOST to localhost, PGUSER/PGPASSWORD to a local test-only PostgreSQL role with CREATEDB rights, and PGPORT if non-default. A local server that only allows peer authentication also works: set PGHOST to its socket directory (for example /var/run/postgresql) and run as the matching OS account. Add PostgreSQL's bin directory to PATH. Do not use production credentials or a production PostgreSQL instance.

```powershell
npm run verify:full
```

The existing integration runner creates new test databases and retains them; it does not delete existing databases. Review and remove only the generated test databases when finished.

For a development Android build, with the project's required SDK installed:

```powershell
cd mobile/android
.\gradlew.bat :app:assembleDebug
```

A debug APK requires Metro and a reachable development backend; it is not a standalone release app. Use mobile/build-config.json to set a reachable development API URL for a physical phone. Production configuration and signing intentionally remain blank/unconfirmed.

After implementing and testing the remaining release work:

```powershell
npm run check:android-release
```

That command is expected to fail on the supplied development configuration. A configuration pass alone never certifies readiness or enables publishing.
