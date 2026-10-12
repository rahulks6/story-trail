# Final verification, 12 October 2026 (Phases 10 to 12)

- `node scripts/verify.cjs --bundle` (as root): every step passed, see `results.json`. The steps
  are:
  - the backend build, app typecheck and test typecheck;
  - component tests (15 suites, 78 tests);
  - source checks (123), ranking tests (28);
  - infrastructure build and tests (38);
  - both release JavaScript bundles.

  Its `notVerified` list includes "database integration tests" only because that suite ran
  separately, below.
- `database-integration.log`: the backend integration suite (`scripts/run-tests.cjs`) on a real
  local PostgreSQL 16, run as the `postgres` OS user (peer authentication), on the same code:
  418 tests in 43 files, 0 failed, 0 skipped.
- `mutations.json`: the deliberate breaks for Phases 10 and 11, with first-run misses and the
  reruns after the tests that now catch them. Phase 9's are in
  `docs/test-runs/2026-10-12T12-14-48-185Z/mutations.json`.
- Network recheck (12 Oct): `dl.google.com`, `repo.reactnative.dev`, `deb.debian.org` answered
  403 ("CONNECT tunnel failed") from the network policy.

Not covered here: Android/iOS native builds, devices, live AWS and providers.
