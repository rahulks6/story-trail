# Media pipeline

How a photo or video gets from a phone to viewers, and how to run it on AWS
(Mumbai, `ap-south-1`). Implemented in Phase 2 (5 October 2026); evidence in
`docs/phases/PHASE_2_MEDIA_PIPELINE.md`.

## Flow

```
App outbox ──POST /media/uploads──▶ API (session + signed part URLs)
   │                                     │
   └──PUT part 1..N (SigV4, exact length)──▶ S3  m/<mediaId>/original
   │
   └──POST /media/uploads/:id/complete──▶ API: every part present? size matches?
                                           media.status = processing, job queued
                                           (NOTIFY; SQS message if MEDIA_QUEUE=sqs)
   └──POST /stories {requestId}──────────▶ 201 published (media ready) or
                                           202 processing (publish request recorded)
Worker ── claims job (SKIP LOCKED, lease) ── downloads original
       ── photo: sharp → display.jpg (≤1080×1920, q82), thumb.jpg (≤360×640)
       ── video: ffprobe checks → poster.jpg, thumb.jpg, video_720.mp4, video_480.mp4
       ── uploads variants (Cache-Control: immutable) ── finish_media_processing():
          media ready + every waiting publish request published in one transaction
Viewer ── story/list responses carry `media` URLs ── CloudFront signed URLs
```

States the app shows: **Preparing → Uploading n% → Processing (posts
automatically) → Posted**, or **Couldn't post** with the reason and Retry (or,
for a file that can't be used, a prompt to choose another).

## What processing guarantees

- Viewers never receive the original. Variants are re-encoded from pixels, so
  EXIF (including GPS), XMP, maker notes and QuickTime location atoms are gone;
  EXIF orientation and video rotation are applied.
- Accepted: JPEG, PNG, WebP photos up to 25 MiB / 100 MP; MP4/MOV video up to
  200 MiB, 60 s, 4K. HEIC must be converted on the device (the app uploads JPEG).
- HDR video (HLG/PQ) is tone-mapped to SDR BT.709; output is H.264 High,
  ≤30 fps, AAC, `+faststart`.
- Untrusted-input hardening: libvips may run only its JPEG/PNG/WebP loaders;
  ffmpeg/ffprobe open files with the mov demuxer and file protocol only (a
  disguised playlist cannot make them fetch URLs or read other files); every
  process has a deadline.
- Failures: a file that can't be used fails permanently with a clear message;
  infrastructure errors retry with backoff (30 s, 2 min, 8 min), then the owner
  can press Retry (`POST /media/:id/retry-processing`), which re-processes the
  stored original without re-uploading.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/media/uploads` | `{clientUploadId, kind, mimeType, byteSize}` → `{media, upload: {partSize, partCount, parts[{partNumber, byteLength, uploaded, url}]}}`. Idempotent per `clientUploadId`. 415 type, 413 size, 429 limits. |
| GET | `/api/v1/media/uploads/:id` | Resume: uploaded parts from storage itself, fresh URLs for the rest. |
| POST | `/api/v1/media/uploads/:id/complete` | 409 `fields.missingParts` if any part is missing; 422 if the assembled size differs. Idempotent. |
| POST | `/api/v1/media/uploads/:id/abort` | Deletes the multipart upload and the row. |
| POST | `/api/v1/media/:id/retry-processing` | Only for retryable failures. |
| GET | `/api/v1/media/:id` | Owner sees status, `processingError`, `retryable`; `delivery` URLs when ready. |
| GET | `/api/v1/media/:id/file?variant=` | `display`, `thumbnail`, `poster`, `video_720`, `video_480`, `original` (owner only). CDN: 302 to a signed URL. |
| POST | `/api/v1/stories` | 201 `{story}` or 202 `{publish: {state: "processing"}}`; 422 `media_failed` with `retryable`. |
| GET | `/api/v1/stories/publish-requests/:requestId` | `processing` / `published` (+`storyId`) / `failed` (+`error`, `retryable`). |

The original single-request endpoints (`POST /media/photos|videos`) remain for
the Admin console and older builds: photos are processed before the response
(so `ready` still means publishable), videos answer `processing`.

## AWS setup (beta)

All resources in `ap-south-1`. Production refuses to start without
`MEDIA_STORE=s3`, `MEDIA_S3_BUCKET`, `MEDIA_CDN_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`
and `CLOUDFRONT_PRIVATE_KEY` (see `backend/.env.prod.example`).

1. **S3 bucket** (e.g. `katkee-media-prod`): Block Public Access on, default
   encryption SSE-S3, versioning optional. Lifecycle rule (required — the
   backstop for uploads nobody finishes):

   ```json
   {"Rules":[{"ID":"abort-incomplete-uploads","Status":"Enabled","Filter":{"Prefix":"m/"},
     "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}
   ```
   No CORS rule is needed: the app is native, and the Admin console uploads through the API.
2. **CloudFront**: origin = the bucket with Origin Access Control (sign
   requests); viewer protocol HTTPS only; restrict viewer access with a
   **trusted key group** (upload the public key of an RSA-2048 pair; the
   private key goes to the secret store as `CLOUDFRONT_PRIVATE_KEY`, its ID is
   `CLOUDFRONT_KEY_PAIR_ID`); cache policy CachingOptimized (query strings not in
   the cache key). Bucket policy allows `s3:GetObject` on `m/*` only to this
   distribution (`AWS:SourceArn` condition). Optional: `CLOUDFRONT_SIGNING_ALGORITHM=SHA256`
   for SHA-256 signed URLs.
3. **IAM** (task roles; an IAM user only if not on AWS):
   - API: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`,
     `s3:ListMultipartUploadParts` on `arn:aws:s3:::<bucket>/m/*`; `ses:SendEmail`;
     `sqs:SendMessage` on the queue if used.
   - Worker: the same S3 actions; `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
     `sqs:ChangeMessageVisibility` if used.
4. **SQS (optional)** standard queue, visibility timeout ≥ `MEDIA_JOB_LEASE_SECONDS`
   (900), `MEDIA_QUEUE=sqs`, `MEDIA_SQS_QUEUE_URL`. Useful as the autoscaling
   signal (ApproximateNumberOfMessagesVisible) for the worker service. Job state
   stays in PostgreSQL, so lost or duplicate messages are harmless.
5. **Worker service**: image `docker build --target worker backend` (adds
   ffmpeg), command `node dist/src/worker.js`. Measured on 4 vCPU (Xeon 2.1 GHz):
   a 60 s 1080p30 clip → poster, thumbnail, 720p and 480p in 27 s (0.45× real
   time); a 12 MP photo in 0.44 s (`docs/performance/2026-10-05-media-processing.json`).
   Smaller tasks will be proportionally slower (not measured); scale out freely.
   Health: the container checks its heartbeat file.

## Retention (run by the worker, hourly, one worker at a time)

| What | When | Notes |
|---|---|---|
| Upload sessions never completed | 24 h | multipart upload aborted, row removed |
| Media nobody uses (no Story, avatar, ad, waiting publish) | 48 h | objects and row deleted; race-safe with publishing |
| Media of Stories the owner deleted | 30 days | unreachable immediately on delete; held while a report is open |
| Content removed by moderation | 180 days | kept as evidence, then purged |
| Accounts deleted | 30 days | media purged; username/email/name/bio/password/sign-in links scrubbed; evidence held |
| Originals (may carry location metadata) | 30 days after processing | variants remain for Archive/Highlights |
| Expired security records, finished jobs, old security events (400 days), scratch files | continuous | |

Every run is recorded in `retention_runs` (task, start, finish, items, error).
All windows are configurable (`RETENTION_*`). Update the Privacy Policy's
retention section to match before launch.

## Operations

- Migrating a server that used local disk: `MEDIA_STORE=s3 MEDIA_S3_BUCKET=… MEDIA_STORAGE_ROOT=<old dir> node dist/scripts/copy-local-media-to-s3.js --dry-run`, then without `--dry-run`. Idempotent; reports files missing on disk.
- Media uploaded before the pipeline is queued for processing by migration
  0030 and keeps serving its original until its variants exist; a failed
  backfill never takes published media down.
- Signed URLs live 1–2 × `MEDIA_URL_TTL_SECONDS` (default 1 h). Deleting or
  moderating a Story stops new URLs immediately; already-issued URLs keep
  working until they expire. Lower the TTL if that window is too long.
- Local test servers: `backend/scripts/install-media-test-servers.sh`
  (Versity S3 gateway, goaws SQS); without them the S3/SQS suites report as skipped.
