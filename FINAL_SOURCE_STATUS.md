> Current checkpoint: read [RELEASE_READINESS.md](RELEASE_READINESS.md). This source is not publish-ready. Earlier completion claims and setup directions below are historical.

# Katkee source delivery — 26 September 2026

**Source-code delivery, not a finished iOS/Android release. The full master specification is not complete. No APK, AAB or IPA has been built or signed.**

The owner confirmed production API hosting and application identifiers are not set up. This environment has no Android SDK/JDK or Xcode; its Docker daemon is unavailable. Native/container execution and physical-device performance remain unverified.

## Final Story view-count rule

Public Story viewers who are authorized to watch a Story can see its aggregate view count. They cannot see who viewed it. Viewer identities and detailed Insights are owner-only. The Story detail payload now carries the aggregate count for faster first render, while the owner-only viewer endpoint remains protected. See `PUBLIC_STORY_VIEW_POLICY.md`.

## Latest review and fixes (26 September)

- Added an account-scoped durable upload queue with private local copies, restart-safe retry metadata, duplicate-submit protection and migration 0026 for idempotent Story publication. Failed jobs can be retried from Settings; originals are preserved.
- Fixed suspended-account visibility through Story, media, profile, Highlight and search paths.
- Fixed camera hold/release stale state, concurrent capture guards, inactive-camera handling and camera use without microphone permission. Physical-device behavior is not yet verified.
- Badge polling now avoids background requests and discards stale session responses.
- Profile patches update only supplied fields, preventing simultaneous edits from overwriting privacy changes.
- Latest backend and mobile TypeScript checks passed. Both updated production-mode JavaScript bundles passed (not native binaries). Adapter checks passed: upload queue 4, secure storage 3, client/source regressions 6. Focused backend checks before packaging: Stories 31, moderation/ads 5, and social/profile 17 passed. Native autolinking detects the new filesystem module on both platforms.
- Dependency audit still reports unresolved advisories: backend 2 moderate; mobile dependency tree 1 high, 27 moderate, 1 low. These include transitive build-tool dependencies and require a tested dependency/toolchain upgrade before release. No claim of security clearance is made.

Historical full-suite results below predate these latest changes. See bundled focused test evidence for current changes; full native acceptance remains outstanding.
## Added in this delivery

- Matching React Native Android/iOS development hosts, Gradle wrapper, Podfile, permissions, Metro/Babel dependencies and native autolinking, preserving the consumer source/navigation.
- Authenticated byte-range media streaming for Story/ad video partial downloads and seeking. Privacy is checked before every request.
- Shared PostgreSQL Home snapshots (migration 0025): cursors survive API restarts and work across replicas; content eligibility is reread on continuation.
- Consumer moderation notices/appeals from login and settings, including suspended accounts. Password or linked-provider verification gates access. One-use tickets cannot appeal another user's notice or restore content automatically.
- Current video playback position restoration after returning from another screen and revalidating access.
- Corrected Docker runtime dependencies, optional provider/proxy overlays, exact trusted-proxy IP handling, and release configuration checks.
- Automatic database reset removed from `npm test`. The new runner creates uniquely named local test databases and retains them for inspection.

Previous updates remain included: separate Admin Console/RBAC/audit, Sponsored Stories, default-off Google/phone provider integration, account linking/reauthentication, secure device token storage, vector controls and batched Home queries.

## Verification

| Check | Result |
|---|---|
| Full backend suite, migrations 0001–0025 | 185/185 passed; second migration run was a no-op |
| Subsequent trusted-proxy suite | 7/7 passed, including one additional case: 186 distinct backend tests total |
| Source/session/client/Highlight checks | 6/6 passed |
| Secure-storage adapter tests | 3/3 passed |
| Backend/mobile TypeScript | Passed |
| Android production-mode JavaScript bundle | Passed |
| iOS production-mode JavaScript bundle | Passed |
| Native project/autolinking discovery | Both platforms found; 11 native modules |
| Combined Docker Compose configuration | Passed |
| Docker image/runtime | Not run: daemon unavailable |
| Gradle/native Android build | Not run: JDK/Android SDK unavailable |
| Xcode/native iOS build | Not run: macOS/Xcode unavailable |
| Live Google/SMS/device acceptance | Not run: provider/device configuration unavailable |

Evidence: `docs/final-integration-results.json`, `docs/final-proxy-tests.txt`. Earlier Admin browser checks and small loopback benchmarks are historical evidence, not new native acceptance or a lag-free guarantee.

## Remaining native, configuration and release work

1. Register permanent Android/iOS identifiers and developer accounts, and configure signing privately. `com.katkee.development` is only a development identifier.
2. Upgrade and test the native toolchain/dependencies for store submission. The source now declares Android API 36; new Play submissions require API 36. Editing the target number alone does not prove binary compatibility. Verify native-library 16 KB page compatibility. Sources: [target SDK requirements](https://developer.android.com/google/play/requirements/target-sdk), [page-size guidance](https://developer.android.com/guide/practices/page-sizes).
3. Build/test iOS against Apple's required toolchain. Current minimum: Xcode 26/iOS 26 SDK. Compatibility of this older React Native/dependency combination is unverified. [Apple requirements](https://developer.apple.com/news/upcoming-requirements/).
4. Deploy HTTPS API/database/media, backups and staging migrations, then set the production URL. No production infrastructure was created or changed.
5. Configure Google OAuth registrations, Android signing fingerprints and the iOS reversed-client-ID URL scheme; configure Twilio Verify. Flags remain off until live acceptance.
6. Replace development launcher assets with approved assets; complete legal/store disclosures and audit native privacy manifests against the final app. Template icons/manifests are not finished store submissions.
7. Run the entire auth/camera/editor/Story/DM/privacy/Admin/Ads regression matrix on physical iOS/Android devices, including slow networks, background/resume, accessibility, memory pressure and performance budgets.

## Remaining source/product work

These gaps need implementation, not just credentials:

- Background media processing, optimized video renditions/posters and authenticated object-storage/CDN integration.
- OS-managed background uploading remains unimplemented; the new durable outbox retries while the app is open.
- Full editor preview/export parity and native/GPU gesture performance acceptance.
- Username/avatar/interests source paths are now implemented and covered by fresh source checks; avatar crop and full recovery/settings flows remain.
- Email password-reset/recovery delivery and remaining settings inventory.
- Live FCM/APNs delivery and on-device realtime behavior (Phase 3 implemented WebSocket realtime, push and the DM outbox, verified against local protocol servers only), and Activity grouping.
- Production retention/cleanup jobs, observability dashboards and full load/performance testing.

Do not represent this archive as a complete implementation of the 74-page master specification until these and native acceptance gates are closed.

## Development setup

Use Node 22 and a dedicated local PostgreSQL server. In `backend`: `npm ci`, configure environment variables from `.env.example`, then `npm run build`. With Node's environment-file support, run `node --env-file=.env dist/scripts/migrate.js`, then `node --env-file=.env dist/src/index.js`. Generate proper signing secrets. Never run the legacy reset-test-db utility against retained data.

In `mobile`: `npm ci` and `npm run typecheck`. Android development requires JDK 17 and the matching SDK/NDK plus emulator/device. On macOS/Linux, restore the executable bit with `chmod +x android/gradlew` after extracting this Windows-created ZIP. For iOS on a Mac: `bundle install`, then `cd ios && bundle exec pod install`. The Podfile restores the iOS bundle wrapper's executable bit. Start Metro with `npm start`; use `npm run android` or `npm run ios` on the corresponding toolchain.

Android emulator defaults to `http://10.0.2.2:4000`; iOS Simulator to `http://localhost:4000`. Set `developmentApiUrl` in `mobile/build-config.json` for a physical device. Set production HTTPS origin/permanent identifiers there and in native project settings before release. `npm run check:release` intentionally fails on the supplied unconfigured development build. Android release signing uses private `KATKEE_UPLOAD_*` environment values, never the public template debug key.

For Docker, combine `docker-compose.prod.yml` with the optional admin/providers/proxy overlays. Keep backend port 4000 private. Choose a non-conflicting subnet/address for the proxy overlay. Apply migrations as a separate controlled step. Compose syntax passed; image build/deployment is not claimed.

Native source: [React Native Community template](https://github.com/react-native-community/template), npm `@react-native-community/template@0.75.4`; MIT license at `mobile/NATIVE_TEMPLATE_LICENSE`.
