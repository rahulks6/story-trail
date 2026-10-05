# Google and phone authentication rollout

Status: implemented behind default-off flags; live provider and native-device acceptance remain outstanding. Existing email/password login is retained. Migration `0024_provider_auth.sql` adds identities, short-lived proof/ticket tables and persistent OTP admission limits. It permits provider-only accounts without fabricated email addresses or passwords.

## Configuration

> Later update: native development hosts are now included, and migration 0025 moves feed snapshots into PostgreSQL. The process-local cursor limitation below is historical. Follow [current delivery status](../FINAL_SOURCE_STATUS.md) for remaining native and release gates.

Apply all migrations with the existing migration runner before enabling either provider. Back up and rehearse on a staging copy first. Do not reset the database. Keep secrets in server deployment configuration, never in the mobile bundle.

| Server setting | Purpose |
|---|---|
| GOOGLE_AUTH_ENABLED | Default false; enable only after staging validation |
| GOOGLE_CLIENT_IDS | Comma-separated accepted OAuth audiences |
| PHONE_AUTH_ENABLED | Default false |
| PHONE_AUTH_COUNTRIES | Explicit supported ISO country codes, such as IN |
| PHONE_IDENTITY_SECRET | Stable random secret of at least 32 characters for phone HMAC identities; back up securely; changing it breaks identity lookup |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN | Server-only account credentials |
| TWILIO_VERIFY_SERVICE_SID | Verify service identifier |
| PHONE_OTP_CODE_LENGTH | Must match the Verify service; default 6 |
| PHONE_OTP_DAILY_LIMIT | Global daily admission cap; default 100 |

The backend verifies Google signatures/audience/issuer using Google's library. Set public web/iOS OAuth client IDs in `mobile/src/config/providers.ts`. Register real Android signing certificates and the iOS URL scheme/bundle identifier with Google. The source does not include native Android/iOS host projects; integrating/autolinking Google Sign-In, react-native-keychain and react-native-svg into those hosts and rebuilding is required. JavaScript-only updates cannot supply these native modules.

Enable Twilio Verify fraud protection, allowed destinations and spending alerts before a live rollout. SMS admission is persisted before provider contact: 60-second resend cooldown, five requests per phone per day, twenty per IP per hour, and the global cap. Codes are checked by Verify, never stored by Katkee. Phone values are used transiently for sending; stored identities are HMACs and displayed destinations are masked. Configure trusted proxy/IP handling for the deployed topology.

## Identity and account safety

Provider subjects map to the existing canonical user ID. A matching email does not silently merge accounts: the user must sign into the existing account and explicitly link after recent reauthentication. Linking/unlinking requires a one-use five-minute ticket. Provider proofs expire after five minutes. Removing the last usable sign-in method is rejected. Method changes revoke refresh sessions; account deletion disables access while retaining identity tombstones so a provider cannot recreate the deleted identity accidentally.

Administrative web sign-in still requires the existing password-based privileged account flow. Do not provision a provider-only account as an administrator until an appropriate privileged authentication enrollment flow is implemented.

Tokens migrate from legacy AsyncStorage to one atomic Keychain/Keystore record. Legacy tokens are removed only after a successful secure write. Secure-storage failure must be surfaced; there is no plaintext fallback.

## Operations and recovery

The application now uses a ten-connection PostgreSQL pool per server process. Account for all replicas in the database connection budget. `DB_DRIVER=psql` restores the prior adapter for diagnosis; migrations still use their existing transactional runner. Pooled queries have a ten-second statement timeout. Do not enable SQL statement/parameter logging in production authentication paths.

Disable provider flags to stop new provider sign-ins during an incident. Do not reverse migration 0024 by forcing password/email NOT NULL after provider-only accounts exist. Keep the schema and roll forward; those accounts require a compatible recovery/sign-in path. Expired proof, ticket and challenge rows need a scheduled retention job; retain at least the full OTP rate-limit window. No automated cleanup or production retention policy is represented as deployed.

Feed cursors are viewer-bound, three-minute, process-local ranking snapshots, bounded to 500 entries. Every continuation rechecks privacy and content availability. A restart/eviction returns 410 and requires refresh. Multiple API replicas need sticky routing or a shared snapshot implementation before enabling this paginated client in production.

## Verification and release gates

The local integration suite passed 181 tests after pooling/provider integration; the expanded recommendation suite passed 17 tests including two new privacy/cursor cases (183 distinct backend tests in total). Three secure-storage adapter tests passed. Backend and mobile TypeScript checks passed. Tests replace only the remote Google/SMS gateway; they exercise real HTTP routing, SQL migrations, identity state, sessions and authorization. They do not prove live SMS delivery or native SDK behavior.

Local sequential loopback benchmark, six organic creators and ads disabled: Home p50/p95 changed from 2996/3418 ms to 6/7 ms. This small sample is not a load test, cold-start measurement, or device playback measurement. Native playback, camera/editor FPS, background/foreground restoration and real provider sign-in still require the device acceptance matrix.

Provider references: [Google backend verification](https://developers.google.com/identity/sign-in/android/backend-auth), [React Native Google Sign-In](https://react-native-google-signin.github.io/docs/original), [Twilio Verify](https://www.twilio.com/docs/verify/api/verification), [PostgreSQL pooling](https://node-postgres.com/apis/pool).
