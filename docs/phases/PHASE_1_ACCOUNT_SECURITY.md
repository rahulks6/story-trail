# Phase 1 — Authentication, account security, Admin MFA and audit integrity

Date: 5 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`.

## Outcome by requirement

| Requirement | Status | Evidence |
|---|---|---|
| Email/password signup, login, logout, refresh rotation | IMPLEMENTED AND VERIFIED | existing suites + `accountSecurity.test.ts` |
| Session revocation (one device, all other devices, logout) — effective on the next request | IMPLEMENTED AND VERIFIED | "lists sign-ins, ends one immediately…", "sign out of other devices…", "logout ends the access token too" |
| Password reset (emailed 6-digit code, no enumeration, single use, 5 attempts, 15 min, newest-wins, per-account email cap, per-network cap) | IMPLEMENTED AND VERIFIED (server) / IMPLEMENTED BUT NOT VERIFIED (mobile UI on device) | 6 reset tests; `ForgotPasswordScreen`, `ResetPasswordScreen` typecheck + bundle |
| Live email delivery (Amazon SES, ap-south-1) | BLOCKED | Needs an AWS account, verified SES identity and production access; integration built and selected by `EMAIL_PROVIDER=ses`, which production requires |
| Authenticated password change ending other sessions | IMPLEMENTED AND VERIFIED | "requires the current password, rejects reuse, and ends other sessions" |
| Brute-force protection: per-account lockout (10/15 min) shared across instances; timing decoy; per-network signup/reset budgets | IMPLEMENTED AND VERIFIED | "locks one account after 10 wrong passwords without affecting others", "caps reset emails per account and requests per network" |
| Common-password denylist (signup, reset, change) | IMPLEMENTED AND VERIFIED | "rejects weak and common passwords…" |
| Suspicious-login controls: new-device detection, email alert, security activity log (keyed device hashes, no raw IPs) | IMPLEMENTED AND VERIFIED | "alerts by email on a sign-in from a new device, once" |
| Secure token storage on device (Keychain/Keystore) | IMPLEMENTED BUT NOT VERIFIED | unchanged adapter; mocked tests pass (async-storage v3 API) |
| Account deletion / re-authentication / provider link-unlink | IMPLEMENTED AND VERIFIED | existing suites, unchanged |
| Google login / phone OTP in production | BLOCKED | No OAuth client IDs, Twilio credentials; verified only against an injected test gateway (Mocked) |
| Sign in with Apple (App Store 4.8 when Google sign-in is offered) | NOT IMPLEMENTED | Requires Apple team/key; listed as an iOS blocker |
| Admin roles USER / ADMIN / SUPER_ADMIN with server-enforced permissions | IMPLEMENTED AND VERIFIED | existing + new suites; legacy bypass closed (below) |
| Real MFA enrollment (TOTP RFC 6238, QR + setup key) and challenge before any session exists | IMPLEMENTED AND VERIFIED | RFC 6238 Appendix B vectors; "issues no session until an authenticator is enrolled and proven"; browser check |
| Backup/recovery codes (10, single use, regenerable, Super Admin reset of another admin's MFA) | IMPLEMENTED AND VERIFIED | "backup codes work exactly once", "a Super Admin can reset another admin's MFA…" |
| Re-authentication for critical actions = password + second factor | IMPLEMENTED AND VERIFIED | "step-up re-authentication needs password and second factor" |
| Admin session expiry: 30 min sliding idle, 8 h absolute | IMPLEMENTED AND VERIFIED | "enforces idle and absolute session expiry" |
| Admin login rate limiting (per account shared; per IP) | IMPLEMENTED AND VERIFIED | shared limiter tests; per-IP limiter existing |
| Suspicious Admin-login alerts (new device, exhausted MFA attempts) → Security page + Super Admin email | IMPLEMENTED AND VERIFIED | "raises a Super Admin alert and email…", "binds a challenge to the device and stops after 5 attempts with an alert" |
| Immutable audit logs + tamper evidence | IMPLEMENTED AND VERIFIED | UPDATE/DELETE/TRUNCATE rejected; SHA-256 hash chain detects an edited row made by a trigger-bypassing owner |
| Audit-log filtering (action prefix, actor, target, time) | IMPLEMENTED AND VERIFIED | "filters by action prefix and actor"; browser check |
| No client-only isAdmin authorization | IMPLEMENTED AND VERIFIED | legacy `/api/v1/moderation/*` moderator endpoints now require the Admin session; "a moderator's consumer bearer token cannot reach moderator endpoints" |
| No Admin access to private DMs | IMPLEMENTED BUT NOT VERIFIED | No DM routes exist in the Admin API (by inspection) |
| Admin console UI for all of the above | IMPLEMENTED AND VERIFIED | 12 Playwright/Chromium checks, 0 page errors (`docs/browser-runs/2026-10-05T11-00-46-097Z/`) |

## Database migrations added

- `0028_account_security.sql` — `users.sessions_revoked_at`, `users.password_changed_at`;
  `refresh_tokens.session_id/last_used_at`; `revoked_sessions`; `password_reset_requests`;
  `rate_limit_buckets` + `consume_rate_limit()`; `auth_security_events`.
- `0029_admin_mfa_audit_chain.sql` — `admin_mfa`, `admin_backup_codes`, `admin_login_challenges`;
  admin session idle/absolute/device columns; `security_alerts`; audit indexes; audit hash
  chain (`chain_seq`, `prev_hash`, `row_hash`, insert trigger, one-time backfill,
  `verify_admin_audit_chain()`).

Both are additive. Rollback: the new tables/columns are unused by the previous release, so
rolling back the API is safe without a down-migration; dropping them is optional. Do not
drop `admin_audit` chain columns (they are part of the evidence).

## Files changed (main)

Backend: `src/config/env.ts`, `src/http/server.ts`, `src/shared/crypto.ts` (new),
`src/shared/sharedRateLimit.ts` (new), `src/modules/email/email.ts` (new),
`src/modules/auth/{account-security.ts (new), auth.service.ts, auth.routes.ts, dto.ts,
tokens.ts, refresh-tokens.repository.ts, provider.service.ts, provider.routes.ts}`,
`src/modules/admin/{totp.ts (new), security.ts, admin.routes.ts, policy.ts}`,
`src/modules/moderation/{moderation.routes.ts, moderation.service.ts}`, env templates,
compose files. Admin console: `admin/{app.js, index.html, style.css}`.
Mobile: `src/components/Form.tsx` (new), `src/screens/auth/{ForgotPasswordScreen,
ResetPasswordScreen}.tsx` (new), `src/screens/profile/SignInSecuritySection.tsx` (new),
`src/screens/story/StoryLinkScreen.tsx` (new), `src/navigation/{profileLinks.ts, RootNavigator.tsx,
AuthNavigator.tsx, types.ts}`, `src/state/AuthContext.tsx`, `src/api/auth.ts`,
`src/utils/{devices.ts, passwordRules.ts}` (new), Android manifest (reset-password host).
Tests: `backend/test/{accountSecurity, adminMfa}.test.ts` (new), `backend/test/adminSession.ts`
(new), updated `adminAds`/`moderation` tests to authenticate through real MFA;
`verification/account-links.cjs` (new); `verification/{admin-browser, run-admin-browser}.cjs`.

## Commands run

```sh
npm --prefix backend test                                  # 216/216 pass
node scripts/verify.cjs --bundle --integration             # all steps pass
node verification/run-admin-browser.cjs                    # 12 browser checks, 0 page errors
docker compose -f backend/docker-compose.prod.yml -f backend/docker-compose.admin.yml config --quiet
```

Evidence: `docs/test-runs/2026-10-05T11-05-43-993Z/` (216 integration, 56 source/unit, both JS bundles).

## Tests

- Passed: 216 backend integration (25 new), 56 source/unit (7 ELF + 5 account-link new), 12 browser.
- Failed: 0. Existing tests were not deleted. Changed tests: admin/moderation tests now sign in
  through the real MFA flow; "denies a non-moderator" now expects 401 (consumer tokens are
  not Admin credentials) and additionally asserts the console refuses non-admins (403).
- Bugs found by the new tests and fixed: an access token minted in the same second before a
  password reset survived (fixed by recording every live session as revoked); my own shared
  limits initially broke existing suites and were made configurable.

## Security notes

- TOTP secrets are AES-256-GCM encrypted with `ADMIN_MFA_ENCRYPTION_KEY`, bound to the user id
  as associated data; codes cannot be replayed within their step; challenges are bound to the
  device and die after 5 attempts.
- The audit hash chain detects edits and deletions inside the log; removal of the newest rows
  is only detectable against an externally recorded head hash (`/api/v1/admin/audit/verify`
  returns it — record it daily in monitoring).
- Production should run the API with a database role that has only SELECT/INSERT on
  `admin_audit` and `moderation_actions` (owner role only for migrations).
- Password reset codes are 6 digits; brute force is bounded by 5 attempts per code, 3 codes
  per account per hour, and per-network request limits.

## Performance

Each authenticated request still performs one indexed lookup (now also checking
`revoked_sessions`). No device measurements were possible (no devices).

## Remaining blockers

- SES production access + verified sender (BLOCKED: AWS account).
- Google OAuth client IDs, Twilio Verify credentials (BLOCKED).
- Sign in with Apple for iOS submission (NOT IMPLEMENTED; needs Apple team).
- Mobile screens not exercised on a device (no emulator/device in this environment).

## Next phase

Phase 2 — production media pipeline: S3 presigned uploads, processing jobs (posters,
thumbnails, renditions), processing status in the publish flow, CDN delivery, retention and
cleanup jobs.
