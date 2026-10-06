# Final Phase 7 verification, 6 October 2026

- `node scripts/verify.cjs --bundle` (as root): every step passed, see `results.json`. The
  steps are the backend build, app typechecks, component tests, source checks, ranking tests,
  infrastructure build and tests, and both release JavaScript bundles. Its `notVerified` list
  includes "database integration tests" only because that suite ran separately, below.
- `database-integration.log`: the backend integration suite (`scripts/run-tests.cjs`) on a
  real local PostgreSQL 16, run as the `postgres` OS user (peer authentication). It used the
  same backend build: 367 tests in 39 files, 0 failed, 0 skipped.
- Admin console in Chromium against the production console build:
  `docs/browser-runs/2026-10-06T19-29-00-000Z/` (16 checks, no page errors).

Not covered here: Android/iOS native builds, devices, live AWS and providers (see
`docs/phases/PHASE_7_PRODUCTION_HARDENING.md`).
