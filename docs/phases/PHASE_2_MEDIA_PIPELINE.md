# Phase 2 — Production media pipeline

Date: 5 October 2026. Branch `claude/katkee-production-audit-kuexra`.
Labels follow `docs/BASELINE_REPORT_2026-10-05.md`. Design and AWS setup: `docs/MEDIA_PIPELINE.md`.

## Outcome by requirement

| Requirement | Status | Evidence |
|---|---|---|
| Secure upload: direct-to-storage multipart with per-part SigV4 URLs signing the exact length, 1 h URL expiry, idempotent sessions per outbox id, resume, abort, quotas (60/h, 5 open), type/size checks | IMPLEMENTED AND VERIFIED (S3 protocol) | `mediaS3.test.ts` against Versity S3 gateway, which verifies SigV4 like AWS: tampered signature, longer body and expired URL all refused (403); `mediaPipeline.test.ts` for the local store |
| Live Amazon S3 in ap-south-1 | BLOCKED | Needs an AWS account/bucket; adapter is the AWS SDK v3 client used in the tests |
| Validation: magic bytes, decoder allowlist (JPEG/PNG/WebP only), declared-vs-actual type, 100 MP / 25 MiB / 200 MiB / 60 s / 4K limits, MP4/MOV demuxer only | IMPLEMENTED AND VERIFIED | rejects: disguised playlist, PNG declared as JPEG, 5 s video over a 3 s limit, garbage MP4 (`mediaPipeline.test.ts`), SVG/GIF/TIFF loaders blocked |
| Object storage; local disk never the production store | IMPLEMENTED AND VERIFIED | config refuses `MEDIA_STORE≠s3`, missing CDN, test endpoints and in-process worker when `NODE_ENV=production` |
| Processing: EXIF/GPS/maker-note stripping, orientation, display + thumbnail, video poster, 720p/480p H.264 renditions, HDR→SDR tone mapping, ≤30 fps, faststart | IMPLEMENTED AND VERIFIED | orientation-6 JPEG with GPS → 480×640 display without EXIF; rotated MOV with location tag → 360×640 rendition, tag gone; HLG 10-bit → `bt709` |
| Queue + worker: PostgreSQL jobs (SKIP LOCKED, lease, heartbeat, backoff 30 s/2 min/8 min, max 3), NOTIFY wake-ups, crash recovery via lease expiry, separate worker service | IMPLEMENTED AND VERIFIED | lease-expiry, two-worker exclusivity, transient-failure tests |
| SQS wake-ups (`MEDIA_QUEUE=sqs`) | IMPLEMENTED AND VERIFIED (local SQS) / BLOCKED (live) | `mediaQueue.test.ts` against goaws: worker woken only by SQS processes the job once; duplicates dropped; SQS outage loses nothing |
| ECS/MediaConvert | NOT IMPLEMENTED (by choice for beta) | ffmpeg on the worker; MediaConvert is the documented scale path |
| Authorized CDN delivery: CloudFront canned-policy signed URLs (SHA-1 default, SHA-256 option), expiry rounded to the hour for cache hits, originals owner-only, `/file` 302 to CDN, Admin console streamed | IMPLEMENTED AND VERIFIED (signatures) / BLOCKED (live CloudFront) | `mediaDelivery.test.ts` verifies every URL with the key pair's public key |
| Story responses carry media URLs (thumbnail, image/poster, renditions) | IMPLEMENTED AND VERIFIED | story list/detail `media` block; batched (one media query per list) |
| States Preparing → Uploading → Processing → Published; server publishes after processing so the app can close | IMPLEMENTED AND VERIFIED (server) | "publishes the moment processing finishes, and the 24-hour clock starts then" |
| Failure keeps the draft with Retry; Retry resumes (no part re-sent) or re-processes on the server (no re-upload); unusable files ask for a new file | IMPLEMENTED AND VERIFIED (server + client logic) / IMPLEMENTED BUT NOT VERIFIED (on device) | server tests; `verification/upload-queue.cjs` (10 tests) runs the real outbox module against a protocol model |
| Mobile: resumable outbox (bounded memory: 8 MiB ranged reads), progress UI, Story player starts media immediately from list data with a poster frame, thumbnails in grids/rings | IMPLEMENTED BUT NOT VERIFIED (no device/emulator) | mobile typecheck, both release JS bundles, VM tests |
| iOS gallery HEIC → JPEG (pre-existing bug: HEIC was always rejected) | IMPLEMENTED BUT NOT VERIFIED | `assetRepresentationMode: "compatible"`; Android HEIF still rejected with a clear message (PARTIAL) |
| Retention: expired uploads, unused media (48 h, race-safe with publishing), deleted Stories (30 d, held for open reports), moderation evidence (180 d), deleted accounts (30 d: media purged, profile/sign-in data scrubbed), originals (30 d after processing), expired security records, scratch files; leader lock; run log | IMPLEMENTED AND VERIFIED | `retention.test.ts` (9 tests), S3 deletion in `mediaS3.test.ts` |
| Migration path from local disk | IMPLEMENTED AND VERIFIED | `scripts/copy-local-media-to-s3.ts` (dry run, idempotent, reports missing files) |
| Admin console waits for video processing before creating a campaign | IMPLEMENTED AND VERIFIED | browser check uploads a real video creative, sees "Processing video…", and the draft is saved once the worker has produced poster and rendition |
| Docker images (API, worker with ffmpeg) | PARTIAL / BLOCKED | builder stage builds in Docker (npm ci + production compile) and the compiled API runs in that Linux image (health OK, photo processed by sharp there); the runtime stages need `deb.debian.org`, denied by this environment's network policy |

## Database migration

`0030_media_pipeline.sql` (additive): media statuses `uploading`/`processing`/`ready`/`failed`;
`variants`, `processing_error(_retryable)`, `processed_at`, `original_purged_at`, `purged_at`;
nullable checksum (computed by the worker); `media_upload_sessions`; `media_jobs` + `claim_media_job()`;
`story_publish_requests` + `request_story_publish()`; `finish_media_processing()` (marks ready and
publishes waiting Stories in one transaction; lock order matches publishing, so no deadlock);
`fail_media_processing()`; `claim_unused_media_for_purge()`; `users.data_purged_at`;
`retention_runs`; retention indexes. Existing media stays `ready`, keeps serving its original and is
queued for a backfill that never takes it down if it fails. Rollback: the previous API ignores the
new columns/tables; `media` rows created as `uploading`/`processing` would be unusable by it, so
roll back only with the worker drained.

## Behaviour changes (deliberate)

- Viewers receive processed variants, never the original (privacy). One existing test asserted
  viewers get byte-identical originals; it now asserts the owner still does, viewers get a
  metadata-free JPEG of the same size, and `?variant=original` is owner-only (`stories.test.ts`).
- `POST /media/videos` answers `processing` (the video is transcoded first); photos are still
  `ready` on return because they are processed inside the request.
- `POST /stories` may answer 202 while media processes, and 422 `media_failed`.
- The JPEG test fixture now contains real scan data (it had none because "nothing decodes
  pixels"; the server now does). Same function, same dimensions.
- The production Docker build never compiled (pre-existing): `scripts/gen-test-fixtures.ts`
  imports test code absent from the image. Fixed with `tsconfig.prod.json`, which also keeps the
  test-database reset utility out of production images.
- Admin console select options now carry explicit values (fixes the advertiser bug above).

## Commands

```sh
npm --prefix backend test                                   # full backend suite
node scripts/verify.cjs --bundle --integration              # build, typecheck, regressions, bundles, integration
node --test verification/upload-queue.cjs                   # outbox protocol model (10 tests)
docker compose -f backend/docker-compose.prod.yml -f backend/docker-compose.admin.yml config --quiet
docker build --target builder backend                       # (with a sandbox-only proxy/CA shim)
backend/scripts/install-media-test-servers.sh               # Versity S3 gateway v1.8.0, goaws v0.5.4
```

## Tests

Evidence: `docs/test-runs/2026-10-05T16-08-43-175Z/` (final run after all changes) and
`docs/browser-runs/2026-10-05T16-08-05-907Z/`.

- Backend integration: **256 passed, 0 failed, 0 skipped** (216 existing + 40 new:
  `mediaPipeline` 19, `mediaS3` 5, `mediaDelivery` 4, `mediaQueue` 3, `retention` 9). The S3 and
  SQS suites ran against real local servers (Versity S3 gateway v1.8.0, goaws v0.5.4).
- Source/unit: **62 passed** (outbox protocol tests rewritten for the new protocol: the 4 original
  scenarios kept, 6 added).
- Admin console (Playwright, Chromium): **13 checks passed**, 0 page errors (new: video creative
  processed before the draft is saved).
- Release JS bundles (Android, iOS) and mobile typecheck: passed.
- Changed tests (not deleted): `stories.test.ts` viewer-bytes assertion (see Behaviour changes);
  JPEG fixture made decodable; outbox mocks updated to the resumable protocol.
- Bugs found and fixed this phase: the Admin console sent the advertiser **name** as
  `advertiserId`, so no campaign could ever be created from the UI (options had no explicit
  value; relabelling them changed what was submitted); the production Docker build never compiled;
  iOS gallery HEIC photos were always rejected; a multipart upload dropped by storage surfaced as a
  500 (now 410, and a retried create starts afresh).

## Security notes

- Part URLs sign `content-length;host`; a URL cannot carry more bytes, another part or another upload.
- Media is private until ready and authorized; originals (which may contain GPS) are owner-only and
  deleted 30 days after processing.
- Untrusted decoding is restricted (decoder allowlist; mov demuxer + file protocol only; deadlines).
- Signed CDN URLs outlive a deletion by at most 1–2 × `MEDIA_URL_TTL_SECONDS` (default 1 h);
  documented, configurable.
- Production refuses to start with local media storage, without a CDN, with test endpoints, or
  with the worker inside the API.

## Performance (measured, `docs/performance/2026-10-05-media-processing.json`)

4 vCPU Xeon 2.1 GHz: 60 s 1080p30 video → poster, thumbnail, 720p, 480p in 27.2 s (0.45× real time);
12 MP JPEG → display + thumbnail in 0.44 s (median of 5). Story player no longer waits for a separate
media request before loading. Not measured: device upload speed, S3/CloudFront latency in ap-south-1.

## Blockers

- AWS account (S3, CloudFront key group, SQS, SES) — live verification BLOCKED.
- `deb.debian.org` denied by the network policy — runtime/worker Docker images not built here.
- Devices/emulators unavailable — mobile flows verified by typecheck, bundles and module tests only.
- Android Gradle build (`dl.google.com`, `repo.reactnative.dev`) — unchanged from Phase 0.

## Next phase

Phase 3 — realtime and push: WebSocket/SSE for Activity and DMs instead of 20-second polling,
device-token registration, FCM/APNs adapters (live BLOCKED without credentials), DM idempotency
and offline send queue.
