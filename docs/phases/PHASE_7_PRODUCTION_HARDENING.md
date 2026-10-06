# Phase 7: production hardening, infrastructure, final release gate

Date: 6 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`.

**Production-ready: no.** The server, Admin console and infrastructure code are tested, but
several things cannot be done from this environment:
- no Android build (blocked hosts);
- no iOS build (no Mac);
- no device runs;
- no deploy (no AWS account);
- no live third-party provider (no credentials).

The release gate below shows each item with its evidence.

## What this phase did

| Part | Commit | Result |
|---|---|---|
| 7a API deployment hardening | `5fa861b` | Separate readiness (`/ready`: 503 while draining or when the database is down) and liveness checks. On SIGTERM the API stops taking work, waits for in-flight requests, then closes the database pool (forced after a timeout). Every response carries a request ID, and server errors log it. |
| 7b Admin console production build (gate 4) | `348ea40` | Minified, content-hashed, integrity-checked (SRI) and precompressed. Served from memory with immutable caching and a Trusted Types CSP. Built inside the Docker image. Fixed MFA enrollment, which broke under the stricter CSP. |
| 7c AWS infrastructure as code | `ec1739c` | CDK stack for ap-south-1: VPC, ECS Fargate (API, worker, migrations), RDS PostgreSQL 16 Multi-AZ, private S3 + CloudFront signed URLs, SQS + DLQ, Secrets Manager, WAF, alarms, budget, AWS Backup. **Never deployed.** It needed backend changes: verified database TLS, client IPs behind the load balancer, a least-privilege runtime role, migrations needing only database credentials, and startup refusals of placeholder keys. |
| 7d Backup and restore drill (gate 25) | `1b6e211` | Scripted dump → restore → fingerprint comparison; the API then runs on the restored database. Recorded on a 138 MB database. |
| 7e Security sweep and final gate | `c76eeb4` and this commit | Cross-user access sweep of every parameterized route (gate 26). The icon rule and text contrast are now enforced by checks, which found and fixed one Unicode glyph in a control and one red that fell short of AA contrast. |

## Outcome by requirement

| Requirement | Status | Evidence |
|---|---|---|
| Readiness vs liveness; graceful drain on SIGTERM; request IDs | IMPLEMENTED AND VERIFIED | `lifecycle.test.ts` (6), including a real SIGTERM of `dist/src/index.js`; `docker stop` drained cleanly in the builder image |
| Admin console production build (gate 4) | IMPLEMENTED AND VERIFIED | `adminConsole.test.ts` (8): determinism, SRI, br/gzip, 304s, unknown names, production refusal. Browser run `docs/browser-runs/2026-10-06T13-48-30-000Z/` (16 checks, 0 page errors) |
| Verified TLS to PostgreSQL (`PGSSLMODE=verify-full`, pinned RDS Mumbai CA) | IMPLEMENTED AND VERIFIED (local PostgreSQL TLS) / BLOCKED (RDS) | `databaseTls.test.ts` (3). It refuses a certificate that doesn't name the host, an untrusted CA, and the RDS bundle against another server |
| Client IPs behind the load balancer (`TRUSTED_PROXY_IPS` with CIDR ranges) | IMPLEMENTED AND VERIFIED | `rateLimiting.test.ts` (7) |
| Least-privilege database role for the API and worker | IMPLEMENTED AND VERIFIED | `runtimeRole.test.ts` (7). It can read and write rows. It cannot change audit history, alter or drop tables, disable triggers, create objects or roles, or escalate. Its password reaches the server only as a SCRAM verifier; rotation works |
| Migrations need database settings only | IMPLEMENTED AND VERIFIED | `productionConfig.test.ts` |
| Startup refuses a placeholder or damaged CloudFront/FCM/APNs key, and an unwritable `/tmp` | IMPLEMENTED AND VERIFIED | `productionConfig.test.ts`, `push.test.ts`, infra contract test |
| Infrastructure as code (ap-south-1) | IMPLEMENTED AND VERIFIED (synth + 38 tests) / **BLOCKED** (deploy: no AWS account) | `infra/test/katkee-stack.test.ts`: encryption, private networking, least privilege, TLS, WAF, alarms, backups, modes. `infra/test/backend-contract.test.ts` runs the backend's own startup with each container's exact environment |
| Backup and restore (gate 25) | IMPLEMENTED AND VERIFIED (local drill) / **BLOCKED** (RDS/AWS Backup restore) | `backupRestore.test.ts` (6); `docs/backup-drills/2026-10-06T14-43-16Z-local-138MB.json`; `docs/BACKUP_AND_RESTORE.md` |
| Cross-user access / IDOR (gate 26) | IMPLEMENTED AND VERIFIED (server) | `accessControl.test.ts` (17): all 54 routes outside the Admin API that take an id or username, plus every Admin route, tried by a stranger. A coverage test fails on any new untried route |
| Icon rule: no emoji or symbol glyphs as controls (spec 42–43) | IMPLEMENTED AND VERIFIED (source) | `verification/icon-glyphs.cjs`; fixed "Story published ✓" (now the icon family's check) |
| Text contrast ≥ 4.5:1 (WCAG AA) | IMPLEMENTED AND VERIFIED (measured) | `verification/contrast.cjs`. `danger` red #E4483C → #ED5246, same hue; it was 4.48:1 on sheets. The delete-button tint went from 15% to 8% |

### Deliberate test failures: each check must fail on a real defect

Every new check was run against a deliberately broken copy of the code, one defect at a time.
All 26 breakages were caught:
- **7a lifecycle (5)**;
- **7c (8):**
  - the CloudFront key check, the `/tmp` check, and migrations importing the app config;
  - the runtime role's audit-history protection, default grants, owner guard and
    elevated-role guard;
  - proxy CIDR ranges ignored;
- **7d restore drill (4):** keeps a failed restore, ignores data, ignores triggers, drops a
  database it didn't create;
- **7e (9):**
  - six ownership checks: follow requests, notifications, sign-ins, Story viewers,
    conversation membership, private Highlights;
  - a new unclassified route;
  - the old red in the palette;
  - the "✓" glyph back in the editor's button.

## Security findings this phase (all fixed, with tests)

1. **No TLS to the database.** RDS requires TLS, and an unverified connection could be
   intercepted inside the VPC. The fix is `verify-full` against a pinned CA. node-postgres
   sends no server name when the host is an IP address, so Node checked the certificate
   against "localhost"; it is now checked against the configured host.
2. **The app connected as the schema owner.** A compromised API could have disabled the
   audit-history triggers and rewritten history. It now uses a runtime role that owns nothing.
3. **Placeholder secrets would have run.** A CloudFront key left as its placeholder would have
   started fine and failed on the first media request. Startup now refuses it, and a deploy
   rolls back.
4. **Database statement logs could hold message text.** Queries carry user text as literals.
   The RDS parameter group now never logs statement text.
5. **`.gitignore` dropped the CA bundle** (`*.pem`), so a clean checkout's Docker build
   would have failed. Public CA certificates are now tracked.
6. **MFA enrollment broke under Trusted Types** (7b). The QR code is drawn without
   `DOMParser`.

The cross-user sweep found **no** IDOR vulnerability: every refusal held and leaked nothing.

## Final release gate (30 gates)

| # | Gate | Baseline (5 Oct) | Now | Evidence or blocker |
|---|---|---|---|---|
| 1 | Android 16 KB alignment | FAIL (105 entries) | **BLOCKED** | Phase 5 can't start: `dl.google.com`, `repo.reactnative.dev` denied (rechecked 6 Oct 19:05 UTC) |
| 2 | Signed AAB | NOT BUILT | **BLOCKED** | Same hosts; also needs the upload key |
| 3 | iOS archive or BLOCKED | BLOCKED | **BLOCKED** (accepted label) | No Mac/Xcode |
| 4 | Web production build | static console | IMPLEMENTED AND VERIFIED | Admin console build (7b). There is no consumer web app in scope |
| 5 | Google login in production | BLOCKED | **BLOCKED** | Needs OAuth client IDs. Verified against a test gateway only; infra wires `googleClientIds` |
| 6 | Phone OTP in production | BLOCKED | **BLOCKED** | Needs Twilio Verify credentials; secrets and startup checks are ready |
| 7 | Password recovery | NOT IMPLEMENTED | IMPLEMENTED AND VERIFIED (server) / BLOCKED (live SES) / NOT VERIFIED (device) | Phase 1 |
| 8 | Story creation | server VERIFIED | IMPLEMENTED AND VERIFIED (server) / NOT VERIFIED (device) | No device or Android build |
| 9 | Upload on Wi-Fi/mobile/offline/reconnect | NOT VERIFIED | IMPLEMENTED BUT NOT VERIFIED | Outbox logic tests; needs devices |
| 10 | Background/resumable uploads | NOT IMPLEMENTED | PARTIAL | Resumable: VERIFIED (protocol). OS-managed background transfer: NOT IMPLEMENTED |
| 11 | Video processing and CDN | NOT IMPLEMENTED | IMPLEMENTED AND VERIFIED (local S3/SQS, signatures) / BLOCKED (live CloudFront) | Phase 2 |
| 12 | Story expiration | VERIFIED | VERIFIED | |
| 13 | Highlights survive expiration | VERIFIED | VERIFIED | Also survives a restore (7d) |
| 14 | Public aggregate view counts | VERIFIED | VERIFIED | Sweep: the count endpoint returns only `views` |
| 15 | Viewer identities private | VERIFIED | VERIFIED | Sweep: viewers and insights are owner-only, even on public Stories |
| 16 | Realtime DMs | NOT IMPLEMENTED | IMPLEMENTED AND VERIFIED (server, cross-instance) / NOT VERIFIED (device) | Phase 3 |
| 17 | Push notifications | NOT IMPLEMENTED | IMPLEMENTED AND VERIFIED (protocol) / BLOCKED (live, native builds) | Phase 3 |
| 18 | Admin MFA | NOT IMPLEMENTED | IMPLEMENTED AND VERIFIED | Phase 1, browser runs |
| 19 | Unauthorized Admin access blocked | PARTIAL | IMPLEMENTED AND VERIFIED | Phase 1 closed the legacy bypass; the sweep checks every Admin route refuses consumer tokens |
| 20 | Moderation and appeals | VERIFIED (server) | IMPLEMENTED AND VERIFIED (server, console) / NOT VERIFIED (device) | Phase 4 |
| 21 | Audit logs immutable and complete | PARTIAL | IMPLEMENTED AND VERIFIED | Triggers + hash chain (Phase 1). The runtime role can't touch history (7c). Triggers survive a restore (7d) |
| 22 | Ads lifecycle | VERIFIED (server) | IMPLEMENTED AND VERIFIED (server, console) / NOT VERIFIED (device) | Phase 4 |
| 23 | Failed ads fall back to organic | NOT VERIFIED | IMPLEMENTED AND VERIFIED (server) / NOT VERIFIED (device) | Phase 4 |
| 24 | DAU/WAU/MAU and retention | NOT IMPLEMENTED | IMPLEMENTED AND VERIFIED | Phase 4 |
| 25 | Backups restore | NOT IMPLEMENTED | PARTIAL: drill VERIFIED locally; AWS restore **BLOCKED** | 7d |
| 26 | Security and IDOR tests | PARTIAL | IMPLEMENTED AND VERIFIED (server) | 7e sweep. Not a third-party penetration test |
| 27 | Performance measured | BLOCKED | **BLOCKED** (devices) | Server-side only: realtime p95 87 ms across instances (Phase 3); restore throughput (7d) |
| 28 | Crash/error monitoring | NOT IMPLEMENTED | PARTIAL | JavaScript crashes counted (Phase 4); request IDs and error logs (7a); CloudWatch alarms in infra (not deployed). Native crash reporter NOT IMPLEMENTED |
| 29 | Privacy policy, Terms, deletion process | PARTIAL | PARTIAL | Deletion is verified on the server; the legal texts need legal review |
| 30 | Store metadata and screenshots | PARTIAL | PARTIAL | Text only; screenshots need device builds (BLOCKED) |

**Fully passing with evidence:** 4, 12, 13, 14, 15, 18, 19, 21, 24 and 26 (server scope).
Server-verified with device verification pending: 7, 8, 11, 16, 17, 20, 22, 23.
**Blocked:** 1, 2, 3, 5, 6, 27, plus the live parts of 25. **Partial:** 9, 10, 25, 28, 29, 30.

## Spec section 43: Final 10/10 Release Gate

| Gate | Must be true | Status | Evidence or gap |
|---|---|---|---|
| Visual | Premium icon family consistent everywhere; no basic or mixed glyphs | PARTIAL | Controls use the SVG icon family; the glyph guard passes. Needs visual acceptance against the approved board. Launcher icons are still the template; the notification icon is provisional |
| UX | Each tab has one obvious job; common intent ≤ 2 actions | IMPLEMENTED BUT NOT VERIFIED | Phase 6 audit; navigation tests lock the six tabs. Needs usability checks on devices |
| Speed | Home/camera/editor budgets measured | **BLOCKED** | No devices |
| Creation | All editor tools + drafts reliable | PARTIAL | Tools implemented; overlays and audio persistence verified on the server; draft validation tested. Preview/export parity and device behaviour not verified |
| Discovery | Emerging creators can earn distribution | IMPLEMENTED AND VERIFIED (server) | Exploration boost for new creators (`scoring.test.ts`); unfollowed public creators reach feeds (`recommendations.test.ts`) |
| Connection | Story → Profile → Follow/Reply → DM loop works | IMPLEMENTED AND VERIFIED (server) / NOT VERIFIED (device) | Social, conversation and realtime suites |
| Memories | Archive/Highlights lifecycle + ordering persist | IMPLEMENTED AND VERIFIED (server, component) | Survive expiry and restore, exact reordering, three per row (`highlights.test.tsx`). Drag on device not verified |
| Safety | Block/report/moderation/RBAC/audit/appeals tested | IMPLEMENTED AND VERIFIED | Phases 1 and 4, 7c (runtime role), 7e (sweep) |
| Ads | Clear, capped, safe, non-blocking | IMPLEMENTED AND VERIFIED (server) / NOT VERIFIED (device) | Labels, caps, independent review, hide/report/why, organic fallback; the app skips an ad that isn't ready within 800 ms |
| Security | IDOR/privilege/privacy tests pass | IMPLEMENTED AND VERIFIED (server) | 7e sweep, DM privacy crawl (Phase 3), MFA/RBAC (Phase 1), TLS and runtime role (7c) |
| Accessibility | Labels, contrast, targets, reduced motion, reorder alternatives | PARTIAL | Roles and labels (static check); text contrast measured AA (fixed); reorder and Story gestures have accessibility actions; reduced motion for the like pulse. Not done: a global touch-target audit and screen-reader runs on devices. Input borders are 1.41:1, below the 3:1 non-text guideline; that is a design decision for the approved palette |
| Trust | No fake engagement or social proof | IMPLEMENTED AND VERIFIED | Counts come from real rows; over-budget and fake views are not counted (Phase 4); a source scan finds no invented numbers or demo data in the app |
| Regression | Existing Katkee flows still pass | IMPLEMENTED AND VERIFIED | Full suites below, all passing |

## Commands and results (final run)

| Command | Result |
|---|---|
| `node scripts/verify.cjs --bundle` | **All 10 steps passed.** Evidence: `docs/test-runs/2026-10-06T19-05-20-185Z/`. <br>- backend build, app typecheck and test typecheck <br>- component tests: 9 suites, 24 tests <br>- source checks: 120 tests, including the new icon and contrast checks <br>- ranking: 14 tests <br>- infrastructure build, and 38 infrastructure tests <br>- Android and iOS release JavaScript bundles |
| `scripts/run-tests.cjs` as the `postgres` user (real PostgreSQL 16) | **367 / 367** tests in 39 files; 0 failed, 0 skipped. Log: `database-integration.log` in the evidence folder |
| `node verification/run-admin-browser.cjs` (Chromium, production console build) | **16 checks, 0 page errors**. Evidence: `docs/browser-runs/2026-10-06T19-29-00-000Z/` |
| `npx cdk synth` (all providers, Admin allowlist) | Synthesized: 136 resources |
| `node dist/scripts/restore-drill.js` on 138 MB | **0 differences**. Dump 1.8 s, restore 2.9 s, verify 3.1 s |
| Network recheck (6 Oct, 19:05 UTC) | `dl.google.com`, `repo.reactnative.dev`, `deb.debian.org`: 403 from the network policy |

Backend tests grew from 315 before Phase 7 to 367 (52 new):
- `lifecycle` 6;
- `adminConsole` 8;
- `databaseTls` 3;
- `productionConfig` 4;
- `runtimeRole` 7;
- `backupRestore` 6;
- `accessControl` 17;
- `push` +1.

Infrastructure tests: 38 (new). Source checks: +6 (`icon-glyphs` 2, `contrast` 4).

## Builds

| Build | Status |
|---|---|
| Backend TypeScript (dev and production configs) | passed |
| Admin console production build | passed; deterministic; also built inside the Docker builder stage (7b) |
| Android and iOS release JavaScript bundles | passed (final run) |
| CDK synth (all providers, Admin allowlist) | passed (136 resources) |
| Docker builder stage | passed (7b) |
| Docker runtime and worker images | **BLOCKED**: `apt-get` needs `deb.debian.org` |
| Android APK/AAB | **BLOCKED**: `dl.google.com`, `repo.reactnative.dev` |
| iOS archive | **BLOCKED**: no Mac |

## What unblocks the rest

1. **Network.** In the cloud environment's settings, open Network access and choose Custom.
   Add `dl.google.com`, `repo.reactnative.dev` and `deb.debian.org`, keeping the default
   package-manager list. Steps: https://code.claude.com/docs/en/cloud-environments#network-access.
   That unblocks Phase 5 and the runtime and worker images.
2. **AWS account.** Follow `infra/README.md`: bootstrap deploy, fill in the secrets, push the
   images, migrate, start. Then run the restore drill in staging (`docs/BACKUP_AND_RESTORE.md`).
3. **Provider credentials:**
   - Firebase service account;
   - APNs key;
   - Google OAuth client IDs;
   - Twilio Verify;
   - Safe Browsing key;
   - SES production access.
4. **Devices.** Android and iPhone runs for the gates marked NOT VERIFIED (device); a Mac for
   the iOS archive.
5. **Design and legal.** Visual acceptance of icons and launcher art; input-border contrast;
   legal review of the privacy policy and Terms.

## Next phase

**Phase 5** (Android native upgrade, 16 KB alignment, debug/release APK and AAB) once the
hosts above are allowed. Then a staging deploy on AWS and device acceptance.
