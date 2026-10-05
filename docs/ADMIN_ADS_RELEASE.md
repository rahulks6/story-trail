# Admin and Sponsored Stories: implementation and release status

The implementation is additive and remains **disabled by default**. It is not yet a production release candidate: native device regression, staging recovery rehearsal, and performance acceptance remain open.

## Implemented

- Separate `/admin/login` and `/admin` web console. Consumer navigation does not include Admin controls; Admin assets are not imported by the mobile bundle.
- Explicit ADMIN/SUPER_ADMIN grants, per-operation authorization, live grant checks, hashed expiring sessions, same-origin CSRF protection, password reauthentication for sensitive actions, and rate limits. USER is the absence of a privileged grant.
- Super Admin assigns exact ADMIN permissions, disables access, and revokes sessions. No public Super Admin promotion, self-promotion, or audit deletion endpoint exists.
- Existing reports feed the queue, with pagination, filters, evidence access, review, soft removal/restoration, account restrictions, appeals backend, and append-only moderation/audit records. Private conversations are not browsable.
- Admin-managed advertisers, validated media uploads, persistent campaigns/creatives, independent approval, pause/complete transitions, edits that revoke approval, and real aggregate event analytics.
- Optional Sponsored Stories inserted after organic ranking. Public advertiser/block eligibility, schedule/review checks, server-configured gaps, conservative reservation caps, hide/report, safe HTTPS CTAs, disclosure, failure skip, and nonblocking analytics batches.
- Windows database parameter encoding and output handling fixed. Migration files and their applied-version record now commit in the same transaction.

## Local verification

The full existing/new backend suite passed 177 tests against separate disposable PostgreSQL databases. Later focused runs cover the final authorization, media, and ad changes; see `verification-results.json`. The backend builds and mobile TypeScript typecheck pass. Six source/pure regression checks pass.

Eight Chrome browser checks passed: Super Admin login, real dashboard, limited Admin creation, limited navigation, report/media review, Story removal with consumer 404, audit history, and campaign creation form. This is not a complete browser campaign-publishing or native Sponsored Story end-to-end test.

All 23 migrations were applied by the real runner to new databases, and a second run was a no-op. Existing databases were not reset or dropped. This does not replace migration testing against a staging copy of production data.

## Performance evidence: gate remains open

Local Windows loopback measurements used six organic creators, sequential requests, and disabled ads. Baseline and updated builds shared the same Windows-compatible database adapter because the original adapter failed on Windows line endings. These small samples do not establish production p95 or device performance.

| API | Samples per build | Baseline p50 / p95 (ms) | Updated p50 / p95 (ms) |
| --- | ---: | ---: | ---: |
| Auth/me | 20 | 42 / 160 | 200 / 227 |
| Home, six creators | 10 | 3034 / 3711 | 2795 / 3642 |
| Media metadata | 20 | 479 / 620 | 550 / 756 |

The current adapter launches `psql` processes per query; organic ranking performs many queries per creator. The new live suspension check adds work to authenticated requests. Home remains slow in this environment and smaller endpoints regressed. The media moderation check was combined with its existing lookup to avoid another database process, but performance acceptance has **not** passed. No claim of lag-free playback, crash-free operation, or unchanged production latency is supported.

## Staging rollout

1. Back up database and media using the existing operations process. Restore to staging and rehearse recovery. Use an appropriate maintenance window for additive schema changes.
2. In `backend`, install development dependencies and run `npm run build`. Configure existing database and JWT environment variables, then run `node dist/scripts/migrate.js` from the backend directory. Do not run the existing `pretest` reset script against shared data.
3. Serve the sibling `admin` directory using `ADMIN_STATIC_ROOT`. The optional `docker-compose.admin.yml` mounts it without replacing the existing Compose configuration.
4. Set `ADMIN_ORIGIN` to the exact HTTPS origin from which the console is served, without a path or trailing slash. The console and its API use the same origin. Configure the existing proxy/DNS accordingly; no production proxy was changed here.
5. Choose an existing active account and run `node dist/scripts/bootstrap-super-admin.js existing-account-email`. The command only creates the first Super Admin and has no default password. Bootstrap requires trusted database operator access.
6. Set `ADMIN_CONSOLE_ENABLED=true` in staging. Sign in at `/admin/login`; use **Verify password** before sensitive changes after five minutes. Sessions expire after 30 minutes. Create a second, narrowly permissioned reviewer: campaign authors and last editors cannot approve their own work.
7. Keep `ADS_ENABLED=false`, `SPONSORED_STORIES_ENABLED=false`, and `AD_REPORTING_ENABLED=false` until native and performance gates pass. Enabling delivery needs both ad flags. Enable ad reporting alongside any delivery rollout.
8. Create a public advertiser account, advertiser record, campaign/creative, independent approval, and activation. Review real aggregated events. Start with a small staged cohort and observe failures, skips, hides, reports, and organic outcomes.

Operational ad permissions allow reading campaign resources needed for those operations. Aggregate analytics still requires `ads.analytics.read`. Admin management remains Super Admin-only even if an ADMIN is assigned an admin-management permission name.

## Policy and deployment limits

- RESTRICTED prevents publishing, commenting, and starting new DM conversations; existing conversations remain available. SUSPENDED/DISABLED accounts fail authenticated consumer access. Enforcement is on the backend.
- Removed media is retained for authorized report review; ordinary direct media access is denied, including to the owner. Existing cached/downloaded copies cannot be remotely erased. No automatic physical evidence purge is implemented: configure and approve retention/deletion policy before production use.
- Appeals and moderation notices have authenticated/password-confirmed backend workflows and an Admin resolution screen. A dedicated consumer notices/appeals screen is not implemented. Submitting or upholding an appeal does not automatically restore content.
- MFA is an extension point, not a working second-factor enrollment/challenge flow. `mfa_required=true` fails closed. Require an appropriate upstream protection or implement verified MFA before treating this as MFA-protected administration.
- Rate limits are effective within one server process; multiple instances require a shared limiter. Database superusers can alter database protections; append-only triggers do not replace database access control or an external audit archive.
- V1 is untargeted broad delivery only. No sensitive targeting, DM targeting, advertiser viewer lists, third-party ad SDK, billing, or spend computation exists. Budget is planning metadata; hard delivery allocations cap reservations. No billing spend is fabricated.
- Reservations conservatively consume campaign/user/session/daily caps even if the user skips before rendering. Viewable impressions are separate deduplicated events. Client viewability signals are not independently certified fraud-proof measurement.
- No real-device cold start, first frame, gesture, camera/editor, background/foreground, video/CTA, accessibility, or crash-rate measurements were possible from this archive. The supplied mobile project lacks native `ios`/`android` host projects. Existing backend regression coverage does not substitute for those checks.

## Recovery

Disable ad delivery flags immediately for an ad incident; organic Home does not wait for ad delivery. Disable the console flag for an Admin UI incident while keeping backend moderation enforcement. Retain applied schema and audit data. Do not drop new tables or blindly roll back to an old binary that bypasses restrictions. Prefer a forward fix with compatibility checks; if full recovery is necessary, use the rehearsed database/media backup procedure.

## Reproducing browser checks

`verification/admin-browser.cjs` creates test accounts/content and only accepts a loopback test URL. Run it against an isolated migrated test server with the console enabled. Provide `KATKEE_TEST_SUPER_EMAIL`, `KATKEE_TEST_SUPER_PASSWORD`, optional `KATKEE_TEST_BASE`, `CHROME_PATH`, and `KATKEE_TEST_OUTPUT`. Install `playwright-core` in your test tooling and make it resolvable through Node. Never use production credentials or a production database. Screenshots and results are written to the chosen output directory.
