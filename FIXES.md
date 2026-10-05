# Bug fixes and verification

## Changes

- Mobile API requests recover from expired access tokens and retry once. Concurrent failures share one refresh request; late failures reuse the current token. Uploads use the same recovery path. Invalid refresh credentials end the local session; temporary startup network errors do not erase saved credentials.
- Backend refresh-token consumption uses a conditional UPDATE with RETURNING. Exactly one concurrent request can consume a given unexpired, unrevoked token before issuing a replacement.
- Highlight edits validate cover membership against the proposed item list before any writes.
- Story playback pauses when its screen loses focus or the app leaves the foreground. Hidden playback does not record watch time. Pending gesture timers are cancelled on navigation/unmount.
- Home refreshes its playback component after a successful feed reload, clearing exhausted state and stale Story caches. The caught-up screen offers a refresh button. Empty/expired creators are skipped when more creators remain.
- Removed duplicate initial Home requests. Added retry/error controls. Photos wait for image loading and resume their remaining duration after a pause. Video progress follows the player and completion has only one trigger.
- Fixed backend TypeScript configuration to accept the declared TypeScript 5.x dependency.

## Verification completed

- Backend TypeScript 5.9.3 strict type-check: passed.
- Parsed all 174 TypeScript/TSX files: passed. This is a syntax check, not a full mobile type-check.
- Six checks in verification/regressions.cjs: passed. These exercise actual transpiled source with mocked repository/network boundaries; they do not prove live PostgreSQL or native-player behavior.
- Added live API regressions in backend/test/auth.test.ts and backend/test/highlights.test.ts for concurrent token rotation and rejected edits preserving saved data.

Run the focused checks with Node and TypeScript installed:

    node verification/regressions.cjs /absolute/path/to/typescript

Run backend type-check and the complete backend tests using backend/README.md's database setup. The test command resets the configured test database; use an isolated test database. Run mobile type-check after installing mobile dependencies.

## Still requires device/database validation

No PostgreSQL server, Android/iOS native build, or React Native dependency installation was available for the completed checks. The source archive needs the native project bootstrap and real API configuration documented in DEPLOYMENT.md. Production API configuration is still a placeholder.

Device regression checklist:

1. Sign in, remain in the app beyond the access-token TTL, then load Stories, messages and upload media. Concurrent requests should recover without a login prompt.
2. Switch away from Home during a photo/video and background the app. Verify playback/audio stops and hidden Stories are not advanced or counted.
3. Watch all Stories, publish fresh content from another account, then use Check for new Stories or return to Home. Fresh content should appear.
4. Pause a photo near its end and resume. It should use the remaining time. Verify a video advances once, including after opening and closing a sheet.
5. Simulate a failed media/feed request. Retry or skip should remain available.
6. Run the new concurrent refresh and invalid Highlight-edit tests against PostgreSQL.
7. Profile scrolling, playback, memory and API latency on representative low-end Android and iOS devices with slow networking before release.

Performance is not certified by these checks. In particular, the backend still starts a psql process for each database query; load testing and a pooled database driver are future work if concurrent traffic makes API latency unacceptable.
