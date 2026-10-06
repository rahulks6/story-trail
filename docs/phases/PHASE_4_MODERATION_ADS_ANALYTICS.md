# Phase 4 — Moderation and appeals, abuse protection, Sponsored Stories, product analytics

Date: 5–6 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`. Design and setup:
`docs/MODERATION_AND_SAFETY.md`, `docs/ANALYTICS.md`, `docs/ADMIN_ADS_RELEASE.md` (updated).

## Release gates in scope

| Gate | Status | Evidence |
|---|---|---|
| #20 Moderation and appeals work | IMPLEMENTED AND VERIFIED (server, Admin Console) / IMPLEMENTED BUT NOT VERIFIED (app screens on devices) | `moderationLifecycle.test.ts` (6), `moderation.test.ts`, browser checks |
| #22 Ads can be created, reviewed, approved, delivered, paused and reported | IMPLEMENTED AND VERIFIED (server, Admin Console) / IMPLEMENTED BUT NOT VERIFIED (on devices) | `adsLifecycle.test.ts` (5), `adminAds.test.ts`, browser wizard check |
| #23 Failed ads fall back to organic Stories | IMPLEMENTED AND VERIFIED (server) / IMPLEMENTED BUT NOT VERIFIED (on devices) | invalid input 422, delivery errors logged and answered with no ads, nothing eligible → organic only (`adsLifecycle.test.ts`); the app skips an ad that fails to validate or load within 800 ms |
| #24 DAU/WAU/MAU and retention data are accurate | IMPLEMENTED AND VERIFIED | `analytics.test.ts`: one day aggregated **exactly** from real API activity; D1/D7/D30 exact for a seeded cohort; pending until the day finishes |

## Outcome by requirement

| Requirement (spec) | Status | Evidence |
|---|---|---|
| Report statuses OPEN → UNDER_REVIEW → ACTIONED/DISMISSED → APPEALED → CLOSED, versioned (concurrent-review protection) | IMPLEMENTED AND VERIFIED | `moderationLifecycle.test.ts`: full lifecycle; a stale version gets 409 |
| Report Stories, comments, profiles, ads; impersonation and scam reasons; one open report per person and item | IMPLEMENTED AND VERIFIED | duplicates return the open report (200); strict UUIDs |
| Priority from reason severity and number of reporters; queue filters | IMPLEMENTED AND VERIFIED | priority raised at 3 reporters (siblings too); `minPriority`, legacy lowercase filters |
| Content preview, creator information, report history, previous actions, moderator notes (append-only) | IMPLEMENTED AND VERIFIED | report detail and notes tests; console review page (browser) |
| Keep, remove, restrict, suspend, restore; removed content ineligible immediately; immutable audit | IMPLEMENTED AND VERIFIED | existing moderation tests plus lifecycle tests; audit hash chain verified in the browser run |
| Appeals with review; upholding reverses the action | IMPLEMENTED AND VERIFIED | Story restored and suspension lifted (sign-in works again) in one transaction; permission to reverse required; only removals, restrictions and suspensions are appealable |
| Reporting a specific DM, under a documented safety workflow | IMPLEMENTED AND VERIFIED (server) / IMPLEMENTED BUT NOT VERIFIED (app on devices) | reported message + 9 before it copied as evidence; separate permission `reports.messages.read`; every view audited; purged 180 days after resolution; Admin crawl still finds no DM text anywhere else |
| Evidence retention and policy cleanup | IMPLEMENTED AND VERIFIED | `retention.test.ts` (DM evidence purge; existing media evidence purge) |
| Abuse limits: likes, comments, follows, messages, new conversations, views (shared across instances, tighter for new accounts), `Retry-After` | IMPLEMENTED AND VERIFIED | `abuse.test.ts` (8) |
| Fake views, mass likes and comments, copy-paste spam, notification spam | IMPLEMENTED AND VERIFIED | over-budget views silently not counted; 3rd identical comment within an hour refused; like/follow notifications once per 7 days |
| Malicious links: dangerous schemes, new-account link limits, punycode, Admin blocklist with subdomains, Google Safe Browsing (fail-open, cached) | IMPLEMENTED AND VERIFIED (local Safe Browsing server) / BLOCKED (live, no API key) | `abuse.test.ts`; Admin → Link safety (audited) |
| Bots: device attestation or CAPTCHA | NOT IMPLEMENTED | needs Play Integrity / App Attest or a CAPTCHA provider and native builds |
| Sponsored Story lifecycle DRAFT → PENDING_REVIEW → APPROVED → ACTIVE ⇄ PAUSED → COMPLETED / REJECTED; reviewer ≠ author | IMPLEMENTED AND VERIFIED | `adsLifecycle.test.ts`, `adminAds.test.ts` |
| Creation steps Details → Creative → Audience → Budget/Schedule → Preview → Review → Activate | IMPLEMENTED AND VERIFIED | five-step wizard in the console; browser check asserts only the current step is visible and the preview summary |
| Broad, non-sensitive targeting only | IMPLEMENTED AND VERIFIED | up to 5 of 20 fixed interest categories and/or Android/iOS; religion/health/age/free-text/web refused (422); matched exactly against interests people chose; enforced in `reserve_ad` |
| CTAs Learn More / Visit Website / Shop Now / Install / **View Profile**; "Why am I seeing this?" | IMPLEMENTED AND VERIFIED (server) / IMPLEMENTED BUT NOT VERIFIED (app on devices) | View Profile returns the advertiser's username and no URL; the explanation names the matched category or says "broadly"; `verification/ads-client.cjs` (4) |
| Budgets, schedule, frequency/daily/session caps, organic gap, pause/resume, automatic completion, audit history | IMPLEMENTED AND VERIFIED | completes at end date or impression limit (worker, audited `CAMPAIGN_COMPLETED`) |
| Ad events requested, rendered, impression, qualified view, completion, click, hide, report | IMPLEMENTED AND VERIFIED | counted per delivery once each; shown per campaign and in Analytics |
| Analytics events (spec section 15) | IMPLEMENTED AND VERIFIED (server, aggregation) / IMPLEMENTED BUT NOT VERIFIED (app on devices) | server-observed metrics come from existing rows; app-only events (sessions, crashes, uploads, Highlight/profile views, searches, editor starts) through an idempotent batch endpoint; `analytics-client.cjs` (7), `upload-queue.cjs` |
| Admin metrics: DAU/WAU/MAU, registrations, returning, creators, Stories, views, per-viewer, completion, watch time, likes, comments, shares, DMs, upload success, crash-free sessions, platforms, D1/D7/D30, reports, backlog, ad metrics | IMPLEMENTED AND VERIFIED | Admin → Analytics (browser check), `analytics.test.ts` |
| Crash-free sessions | PARTIAL | fatal JavaScript errors and caught render crashes are counted; native crashes need a native crash reporter (not installed) |
| Analytics asynchronous, idempotent, aggregate-only, no advertiser access | IMPLEMENTED AND VERIFIED | stable ids (retries counted once); activity recorded after the response; dashboard payload checked to contain no user id, username or email; DM rollup checked to never read message text |

## Database migrations (additive)

- `0032_moderation_lifecycle.sql`: uppercase statuses (old names mapped; duplicate open reports
  closed with a note, never deleted), reasons `impersonation` and `scam`, one open report per
  reporter and item, `reports.source`, priority trigger, `moderation_notes` (immutable),
  appeal opening/review functions with reversal, `report_message_evidence`.
- `0033_abuse_protection.sql`: `blocked_link_domains`, an index for duplicate-comment checks.
- `0034_ads_lifecycle.sql`: View Profile CTA, `ad_interest_categories` (20), `ad_campaigns.audience`,
  audience matching, `reserve_ad(viewer, slot, platform)`, `complete_finished_campaigns()`.
- `0035_analytics.sql`: `analytics_active_days`, `analytics_events`, `analytics_daily`,
  `analytics_retention`, BRIN indexes on 13 time columns, `analytics_rollup_day()` and
  `analytics_rollup_retention()` (JIT off).

All four applied twice to fresh databases (second run a no-op). Rollback: the previous API
ignores the new tables and columns. It does not understand the uppercase report statuses, so
roll back only with a forward fix, as the earlier moderation notes advise.

## Behaviour changes (deliberate)

- Report statuses are uppercase in API responses; filters still accept the old names. The Admin
  reports list defaults to OPEN; `status=all` (or empty) lists everything.
- `POST /api/v1/reports` answers 200 with the existing open report instead of creating a duplicate.
- Over-budget likes, comments, follows, messages and new conversations get 429 with `Retry-After`;
  over-budget views are skipped silently. Accounts under 24 hours old have lower budgets and
  cannot post links in comments or messages; under 7 days, no punycode links.
- Like and follow notifications from the same person repeat at most once per 7 days.
- `GET /api/v1/ads/placements` requires an integer `organicCount` from 0 to 1000 (422 otherwise)
  and takes `platform`; delivery failures are logged and answered with no ads.
- The app sends `X-Katkee-Platform` on API requests. The server records one active-day row per
  person, day and platform (Admin Console traffic excluded).
- Purging a deleted account also deletes its analytics rows.
- `scripts/run-tests.cjs` and `verification/run-admin-browser.cjs` accept a Unix-socket
  directory as `PGHOST` (local by definition).

## Files

- Backend, new: migrations `0032`–`0035`; `src/modules/admin/moderation-admin.ts`;
  `src/modules/safety/{limits,links}.ts`; `src/modules/analytics/{activity,events,rollup,analytics.routes}.ts`;
  tests `moderationLifecycle`, `abuse`, `adsLifecycle`, `analytics`.
- Backend, changed: `app.ts`, `config/env.ts` (safety and analytics settings, validation),
  `http/errors.ts` and `http/server.ts` (response headers, activity hook), admin
  (`admin.routes.ts`, `appeals.routes.ts`, `policy.ts`), ads (service, routes), conversations
  (repository, service, routes, dto: DM reports), moderation (repository, service, routes, dto),
  `notifications.repository.ts`, `social.service.ts`, `engagement.service.ts`,
  `stories.service.ts`, `profiles.service.ts`, `media/retention.ts` (evidence purge, campaign
  completion, analytics tasks, analytics purge with accounts), `scripts/run-tests.cjs`,
  `.env.example`, `.env.prod.example`; tests `moderation`, `retention`, `dmPrivacy`, `env`.
- Admin Console: `admin/app.js` (report workspace, appeals, Link safety, campaign wizard,
  Analytics), `admin/style.css`.
- Mobile, new: `src/analytics/{analytics,useAnalytics}.ts`.
- Mobile, changed: `index.js`, `src/crashReporting.ts`, `src/api/{client,ads,moderation}.ts`,
  `src/components/ReportSheet.tsx`, `src/navigation/RootNavigator.tsx`, screens
  (`ConversationScreen`, `AppealsScreen`, `SponsoredStory`, `StoryFeed`, `StoryEditorScreen`,
  `HighlightViewerScreen`, `UserProfileScreen`, `SearchScreen`), `src/state/uploadQueue.ts`.
- Verification: `verification/{ads-client,analytics-client}.cjs` (new); `admin-browser.cjs`,
  `run-admin-browser.cjs`, `upload-queue.cjs`, `release-hardening.cjs`; `scripts/verify.cjs`.
- Docs: `docs/MODERATION_AND_SAFETY.md`, `docs/ANALYTICS.md` (new); `docs/ADMIN_ADS_RELEASE.md`,
  `docs/ADMIN_ADS_ARCHITECTURE.md`, `RELEASE_READINESS.md` (updated, superseded statements marked); this report.

## Commands

```sh
node scripts/verify.cjs --bundle                     # build, typecheck, source tests, ranking tests, both release bundles
npm --prefix backend test                            # backend integration suite (or, with peer auth:)
sudo -u postgres env PGHOST=/var/run/postgresql PGUSER=postgres node backend/scripts/run-tests.cjs
TEST_FILTER='^(moderationLifecycle|abuse|adsLifecycle|analytics|dmPrivacy|retention)\.test' npm --prefix backend test
node --test verification/ads-client.cjs verification/analytics-client.cjs verification/upload-queue.cjs
PLAYWRIGHT_MODULE=/path/to/playwright-core node verification/run-admin-browser.cjs [outputDir]
```

## Tests and builds

Evidence: `docs/test-runs/2026-10-06T02-56-16-714Z/` and `docs/browser-runs/2026-10-05T21-25-13-000Z/`.

- Backend integration: **307 passed, 0 failed, 0 skipped** in 31 files (281 after Phase 3 + 26 new:
  `moderationLifecycle` 6, `abuse` 8, `adsLifecycle` 5, `analytics` 6, `dmPrivacy` +1).
  Run as the local `postgres` OS account over the Unix socket (peer authentication); the summary
  in `database-integration.json` is computed from the log.
- Source/unit: **101 passed** (89 after Phase 3 + 12 new: `ads-client` 4, `analytics-client` 7,
  `release-hardening` +1); ranking unit tests passed.
- Backend build, mobile typecheck, Android and iOS release JavaScript bundles: passed.
- Admin Console in Chromium (Playwright): **15 checks passed**, no page errors (adds the campaign
  wizard with audience and preview, and the Analytics page with Refresh).
- Mutation checks: failed analytics batches treated as delivered → caught (2 tests fail).
  Equivalent mutant noted: removing the signed-out guard in `track()` changes nothing, because
  sign-in starts from an empty queue.
- Bugs found and fixed: the Phase 4b link check broke `release-hardening.cjs` (missing mock; my
  4b verification had run only the integration suite); a server-reported processing failure
  (no exception) would not have been counted as a failed upload; the analytics queue could have
  been overwritten by an early save before it was loaded; the browser check's first DAU
  expectation wrongly counted Admin console operators; the console chart drew one full-width
  bar for one day of data; PostgreSQL JIT made each retention rollup take ~0.5 s.

## Security and privacy findings

- Fixed: Ads placements no longer swallow every error (Phase 3 open item): invalid input is 422 and
  failures are logged before falling back to organic Stories.
- By design and tested: DMs remain invisible to Admins except messages a participant reports
  (separate permission, every view audited, purged after 180 days); sensitive ad targeting is
  impossible (fixed category list; sensitive names refused); advertisers never see viewers; ad
  destinations pass the link policy; analytics stores no free text and the dashboard is
  aggregate-only (tested against every user id, username and email); the DM rollup never reads
  message content (tested); analytics rows are erased with a purged account.
- Dependencies: none added or changed. Backend production dependencies: 0 vulnerabilities. Mobile:
  the same 20 high findings in build tooling (`metro`, `braces`) as before this phase.
- Open: device attestation/CAPTCHA not implemented; native crash reporting not installed; the
  per-IP request limiter and the report limits are per API instance.

## Performance (measured locally, small test databases)

- Retention rollup per call: ~496 ms with PostgreSQL JIT, **1.3–3.7 ms** with JIT off (now set on
  both rollup functions). One day's rollup: ~6–10 ms. Admin analytics query: ~5 ms.
- Activity recording adds no work to the request: it runs after the response, at most once per
  person, day and platform per API instance.
- Not measured: rollups at production volume, ingestion throughput under load, the app's battery
  and data use. No performance compliance is claimed.

## Blockers

- Android Gradle builds (`dl.google.com`, `repo.reactnative.dev`) and the Docker runtime image
  (`deb.debian.org`): the network proxy still refuses these hosts (403, rechecked 6 October).
  iOS: no Mac. So every app change in this phase is verified by typecheck, release bundles and
  logic tests, not on devices.
- Live services without credentials: Google Safe Browsing key, Firebase (Crashlytics, push), APNs, AWS.
- Device attestation / CAPTCHA provider keys.

## Next phase

**Phase 6 — mobile UX audit and fixes** (Home, Create/editor, Profile/Search, Highlights,
Activity, DM), carrying over: Android notification channel and icon, iOS badge clearing,
Hermes-safe timestamp parsing in the remaining screens, and an app-version source for
analytics. Phase 5 (Android native upgrade, 16 KB alignment, APK/AAB) resumes as soon as the
blocked hosts are allowed.
