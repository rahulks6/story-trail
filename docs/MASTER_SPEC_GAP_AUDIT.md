# Master spec gap audit — 25 September 2026

Source: the user's 74-page Google + Phone Login master spec. Pages 2–3 override the older Activity bell illustration: Activity is the approved heart. Existing consumer navigation, identity IDs and stored data remain authoritative.

## Implemented checkpoint

> Later delivery: native development hosts, shared database feed snapshots, byte-range media and consumer appeals are now present. See [current delivery status](../FINAL_SOURCE_STATUS.md) for remaining source work and native/store blockers. Counts below describe earlier checkpoints.

The table below records the initial audit. Since then, the shared Unicode control catalog has been replaced with vector icons and locked color tokens; session storage uses Keychain/Keystore with safe legacy migration; default-off Google/Twilio Verify authentication, verified identity linking and recent-auth account controls have been added. Migration 0024 is additive and preserves canonical user IDs. A bounded PostgreSQL pool and batched Home ranking replace CLI query overhead and per-creator queries. Home now requests bounded, viewer-bound cursor pages and preserves its mounted viewer when returning from Profile/DM. Followers-only Story metadata is excluded from non-follower summaries.

Verification: 181 backend tests passed in the full run, followed by 17 recommendation tests including two new cases (183 distinct backend tests). Both TypeScript projects and three secure-storage tests passed. These are code/API checks, not a native-device acceptance claim. See [provider rollout and remaining gates](PROVIDER_AUTH_ROLLOUT.md). Actual native rendering, live provider delivery, camera/editor performance, media/CDN processing, realtime messaging and other product gaps below remain open.

| Spec pages | Current implementation | Missing / unverified |
|---|---|---|
| 2–4 icons | Shared Unicode catalog | Actual vector paths, locked colors, consistent icon states and targets |
| 5–9 Home/ranking | Six tabs; grouped Stories and gesture handling; separate ad insertion | Bounded feed pagination, poster/rendition delivery, broad device gesture/context verification |
| 10 Search | People search/follow | Interests, richer suggestions, cancellation verification |
| 11 camera | Vision Camera, gallery, capture/record/zoom | Native host integration and measured preview budgets |
| 12–19 editor | Text, overlays, draw, crop, filters, draft model | Native/GPU gesture/export validation, exact preview/export parity, durable upload queue |
| 20–21 Activity/DM | Backend persistence, navigation, inbox/chat | Realtime transport, grouped Activity, complete optimistic/retry/device validation |
| 22–26 Profile/memories/insights | Bio, social edges, Archive, Highlights, owner insights | Avatar crop/upload, interests, full username policy, device reorder and viewer-count semantics |
| 27–28 auth/settings | Email/password, rotating sessions, privacy/settings | Secure device token storage, reset/recovery, complete settings inventory |
| 29–32 Admin/Ads | Separate protected console, RBAC, audited moderation, campaigns/delivery/events | Consumer appeal UI, complete ad E2E/device checks, production retention/operations configuration |
| 33–34 data/media | PostgreSQL migrations and validated local files | Background processing, optimized variants/posters, storage/CDN integration |
| 35–59 performance/security | Local API baseline and tests; default-off Admin/Ads flags | Pooling, N+1 elimination, bounded caches, telemetry dashboards, device/network release matrix |
| 60–74 Google/phone | No provider identities/configuration or provider login UI | Verified provider exchange, OTP provider/caps, identities/linking/onboarding, secure session integration and provider tests |

Implementation sequence: (1) locked vector/icon tokens and secure storage, (2) additive provider identities and authentication integration while retaining email/password, (3) backend pooling and batched/paginated Home with ranking semantics preserved, (4) remaining product/media/telemetry gaps, (5) full regression and native acceptance. Each step needs build and relevant tests before progression.

Provider configuration is not present in the repository. Google OAuth app registrations, SMS provider configuration, native signing/bundle IDs, and an actual storage/CDN deployment cannot be inferred. Prepare fail-closed integrations; do not fabricate provider success or production measurements.

Prior verification remains a baseline, not proof of this new specification: 177 backend tests, later focused tests, eight Admin browser checks, TypeScript checks. API performance failed the prior release gate. No native iOS/Android host directories are supplied.
