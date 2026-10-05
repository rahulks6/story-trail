/**
 * Scheduled retention and cleanup. Runs inside the media worker, on one worker at a
 * time (session advisory lock), in bounded batches; every task run is recorded in
 * retention_runs (start, finish, items removed, error) as operational evidence.
 *
 * Policy (all configurable, see config.retention):
 *  - expired upload sessions: aborted and removed;
 *  - media nobody uses (no Story, avatar, ad or waiting publish) after 48 h: deleted;
 *  - Stories the owner deleted: media purged after 30 days (already unreachable on delete),
 *    unless an open report still needs it as evidence;
 *  - content removed by moderation: kept as evidence for 180 days, then purged;
 *  - deleted accounts: media purged and profile/sign-in data scrubbed after 30 days;
 *  - originals (which may carry location metadata) deleted 30 days after processing;
 *    the stripped variants remain for Archive and Highlights;
 *  - expired security records (rate-limit windows, reset codes, challenges, tokens,
 *    finished jobs) and stale scratch files.
 */
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Client } from "pg";
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";
import { LocalObjectStore, type ObjectStore } from "./storage";
import { MEDIA_COLUMNS, mapMediaRow, type MediaRecord } from "./media.repository";

export interface RetentionReport {
  task: string;
  items: number;
  error?: string;
}

/** Arbitrary constant naming the retention leader lock. */
const RETENTION_LOCK = 7315220001;
const OPEN_REPORT = `r.status IN ('pending', 'under_review', 'appealed')`;

function objectKeys(media: MediaRecord): string[] {
  const keys = Object.values(media.variants).map((v) => v?.key).filter((k): k is string => !!k);
  if (!media.originalPurgedAt) keys.push(media.storageKey);
  return [...new Set(keys)];
}

async function recorded(task: string, work: () => Promise<number>): Promise<RetentionReport> {
  const run = await queryOne(`INSERT INTO retention_runs (task) VALUES (:'task') RETURNING id`, { task });
  const runId = run?.id as string;
  try {
    const items = await work();
    await query(`UPDATE retention_runs SET finished_at = now(), items = :'items'::integer WHERE id = :'id'`, { id: runId, items });
    return { task, items };
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    await query(`UPDATE retention_runs SET finished_at = now(), error = :'error' WHERE id = :'id'`, { id: runId, error: message });
    return { task, items: 0, error: message };
  }
}

/** Deletes a media row's objects, then marks it purged (the row stays: Stories reference it). */
async function purgeReferenced(store: ObjectStore, media: MediaRecord): Promise<void> {
  await store.deleteObjects(objectKeys(media));
  await query(
    `UPDATE media SET purged_at = now(), variants = '{}'::jsonb, original_purged_at = coalesce(original_purged_at, now())
     WHERE id = :'id' AND purged_at IS NULL`,
    { id: media.id },
  );
}

async function purgeAll(store: ObjectStore, sql: string, params: Record<string, string | number>): Promise<number> {
  const rows = await query(sql, params);
  for (const row of rows) await purgeReferenced(store, mapMediaRow(row));
  return rows.length;
}

export async function abandonedUploads(store: ObjectStore, batch: number): Promise<number> {
  const rows = await query(
    `SELECT s.media_id, s.multipart_upload_id, m.storage_key FROM media_upload_sessions s JOIN media m ON m.id = s.media_id
     WHERE s.completed_at IS NULL AND m.status = 'uploading' AND s.expires_at < now()
     ORDER BY s.expires_at LIMIT :'batch'`,
    { batch },
  );
  let removed = 0;
  for (const row of rows) {
    // S3's lifecycle rule (AbortIncompleteMultipartUpload) is the backstop if this fails.
    await store.abortMultipartUpload(row.storage_key as string, row.multipart_upload_id as string).catch(() => undefined);
    removed += (await query(`DELETE FROM media WHERE id = :'id' AND status = 'uploading' RETURNING id`, { id: row.media_id as string })).length;
  }
  return removed;
}

export async function unusedMedia(store: ObjectStore, batch: number, minAgeHours: number): Promise<number> {
  const candidates = await query(
    `SELECT m.id FROM media m
     WHERE m.created_at < now() - make_interval(hours => :'hours'::integer) AND m.status <> 'uploading'
       AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM ad_creatives c WHERE c.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM story_publish_requests r WHERE r.media_id = m.id AND r.state = 'waiting')
     ORDER BY m.created_at LIMIT :'batch'`,
    { hours: minAgeHours, batch },
  );
  let removed = 0;
  for (const candidate of candidates) {
    const row = await queryOne(`SELECT ${MEDIA_COLUMNS} FROM claim_unused_media_for_purge(:'id'::uuid, :'hours'::integer)`, {
      id: candidate.id as string,
      hours: minAgeHours,
    });
    if (!row) continue; // referenced after all
    const media = mapMediaRow(row);
    await store.deleteObjects(objectKeys(media));
    removed += (await query(
      `DELETE FROM media WHERE id = :'id' AND purged_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM stories WHERE media_id = media.id)
         AND NOT EXISTS (SELECT 1 FROM ad_creatives WHERE media_id = media.id) RETURNING id`,
      { id: media.id },
    )).length;
  }
  return removed;
}

export function deletedStoryMedia(store: ObjectStore, batch: number, days: number): Promise<number> {
  return purgeAll(store,
    `SELECT ${MEDIA_COLUMNS} FROM media WHERE id IN (
       SELECT s.media_id FROM stories s JOIN media m ON m.id = s.media_id
       WHERE s.deleted_at < now() - make_interval(days => :'days'::integer) AND s.moderation_removed_at IS NULL AND m.purged_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'story' AND r.target_id = s.id AND ${OPEN_REPORT})
       ORDER BY s.deleted_at LIMIT :'batch')`,
    { days, batch });
}

export function removedContentMedia(store: ObjectStore, batch: number, days: number): Promise<number> {
  return purgeAll(store,
    `SELECT ${MEDIA_COLUMNS} FROM media WHERE id IN (
       SELECT s.media_id FROM stories s JOIN media m ON m.id = s.media_id
       WHERE s.moderation_removed_at < now() - make_interval(days => :'days'::integer) AND m.purged_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'story' AND r.target_id = s.id AND ${OPEN_REPORT})
       ORDER BY s.moderation_removed_at LIMIT :'batch')`,
    { days, batch });
}

/** Media of accounts deleted long enough ago, except content still held as moderation evidence. */
export async function deletedAccounts(store: ObjectStore, batch: number, days: number, evidenceDays: number): Promise<number> {
  const users = await query(
    `SELECT id FROM users WHERE deleted_at < now() - make_interval(days => :'days'::integer) AND data_purged_at IS NULL
     ORDER BY deleted_at LIMIT :'batch'`,
    { days, batch },
  );
  let scrubbed = 0;
  for (const user of users) {
    const id = user.id as string;
    const held = `EXISTS (SELECT 1 FROM stories s WHERE s.media_id = media.id AND (
        s.moderation_removed_at > now() - make_interval(days => :'evidence'::integer)
        OR EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'story' AND r.target_id = s.id AND ${OPEN_REPORT})))`;
    const uploads = await query(
      `SELECT s.multipart_upload_id, m.storage_key, m.id FROM media_upload_sessions s JOIN media m ON m.id = s.media_id
       WHERE m.owner_id = :'id' AND m.status = 'uploading'`, { id });
    for (const u of uploads) {
      await store.abortMultipartUpload(u.storage_key as string, u.multipart_upload_id as string).catch(() => undefined);
      await query(`DELETE FROM media WHERE id = :'media' AND status = 'uploading'`, { media: u.id as string });
    }
    const media = await query(
      `SELECT ${MEDIA_COLUMNS} FROM media WHERE owner_id = :'id' AND purged_at IS NULL AND status <> 'uploading' AND NOT ${held}
       LIMIT :'batch'`, { id, evidence: evidenceDays, batch });
    for (const row of media) await purgeReferenced(store, mapMediaRow(row));
    if (media.length === batch) continue; // more next run; scrub once everything is gone
    await query(
      `WITH u AS (
         UPDATE users SET username = 'deleted_' || substr(replace(id::text, '-', ''), 1, 12), email = NULL, password_hash = NULL,
                display_name = 'Deleted account', bio = '', avatar_media_id = NULL, interests_json = '[]', data_purged_at = now()
         WHERE id = :'id' AND deleted_at IS NOT NULL AND data_purged_at IS NULL RETURNING id),
       a AS (DELETE FROM auth_identities WHERE user_id IN (SELECT id FROM u)),
       t AS (DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM u)),
       e AS (DELETE FROM auth_security_events WHERE user_id IN (SELECT id FROM u)),
       p AS (DELETE FROM password_reset_requests WHERE user_id IN (SELECT id FROM u))
       SELECT count(*) AS n FROM u`,
      { id },
    );
    scrubbed++;
  }
  return scrubbed;
}

/** Originals may carry EXIF/GPS; once the stripped variants exist they are only kept for a while. */
export async function processedOriginals(store: ObjectStore, batch: number, days: number): Promise<number> {
  const rows = await query(
    `SELECT id, storage_key FROM media
     WHERE processed_at < now() - make_interval(days => :'days'::integer) AND original_purged_at IS NULL AND purged_at IS NULL
       AND status = 'ready' AND variants <> '{}'::jsonb
     ORDER BY processed_at LIMIT :'batch'`,
    { days, batch },
  );
  for (const row of rows) {
    await store.deleteObjects([row.storage_key as string]);
    await query(`UPDATE media SET original_purged_at = now() WHERE id = :'id'`, { id: row.id as string });
  }
  return rows.length;
}

/** Deletes in slices so a large backlog never holds long locks. */
async function deleteWhere(table: string, condition: string, params: Record<string, number> = {}): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const rows = await query(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${condition} LIMIT 5000) RETURNING 1 AS x`, params);
    total += rows.length;
    if (rows.length < 5000) break;
  }
  return total;
}

export async function expiredRecords(): Promise<number> {
  const accessTtl = Math.max(86400, config.jwt.accessTtlSeconds);
  let total = 0;
  total += await deleteWhere("rate_limit_buckets", "window_started_at < now() - interval '1 day'");
  // Access tokens from these sessions have long expired by then.
  total += await deleteWhere("revoked_sessions", "revoked_at < now() - make_interval(secs => :'ttl'::integer)", { ttl: accessTtl });
  total += await deleteWhere("password_reset_requests", "expires_at < now() - interval '1 day'");
  total += await deleteWhere("admin_login_challenges", "expires_at < now() - interval '1 day'");
  total += await deleteWhere("auth_provider_proofs", "expires_at < now() - interval '1 day'");
  total += await deleteWhere("auth_reauth_tickets", "expires_at < now() - interval '1 day'");
  total += await deleteWhere("auth_phone_challenges", "created_at < now() - interval '2 days'");
  total += await deleteWhere("home_feed_snapshots", "expires_at < now() - interval '1 hour'");
  total += await deleteWhere("refresh_tokens", "expires_at < now() - interval '7 days'");
  total += await deleteWhere("admin_sessions", "absolute_expires_at < now() - interval '1 day'");
  total += await deleteWhere("media_jobs", "status IN ('done', 'failed') AND finished_at < now() - interval '30 days'");
  total += await deleteWhere("story_publish_requests", "state <> 'waiting' AND resolved_at < now() - interval '30 days'");
  total += await deleteWhere("auth_security_events", "created_at < now() - make_interval(days => :'days'::integer)", { days: config.retention.securityEventDays });
  total += await deleteWhere("retention_runs", "started_at < now() - interval '400 days'");
  total += await deleteWhere("realtime_tickets", "expires_at < now() - interval '1 hour'");
  total += await deleteWhere("push_outbox", "status IN ('sent', 'failed', 'skipped') AND finished_at < now() - interval '30 days'");
  total += await deleteWhere("push_devices", "disabled_at < now() - interval '90 days'");
  return total;
}

/** Work directories left behind by crashed processing or interrupted uploads. */
export async function scratchFiles(store: ObjectStore, maxAgeMs = 24 * 3600 * 1000): Promise<number> {
  let removed = store instanceof LocalObjectStore ? await store.sweepScratch(maxAgeMs) : 0;
  const tmp = os.tmpdir();
  for (const name of await fsp.readdir(tmp).catch(() => [] as string[])) {
    if (!name.startsWith("katkee-media-") && !name.startsWith("katkee-upload-")) continue;
    const full = path.join(tmp, name);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > maxAgeMs) {
      await fsp.rm(full, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

export async function runRetention(store: ObjectStore): Promise<RetentionReport[]> {
  const r = config.retention;
  return [
    await recorded("abandoned_uploads", () => abandonedUploads(store, r.batchSize)),
    await recorded("unused_media", () => unusedMedia(store, r.batchSize, r.unusedMediaHours)),
    await recorded("deleted_story_media", () => deletedStoryMedia(store, r.batchSize, r.deletedStoryDays)),
    await recorded("removed_content_media", () => removedContentMedia(store, r.batchSize, r.moderationEvidenceDays)),
    await recorded("deleted_accounts", () => deletedAccounts(store, r.batchSize, r.deletedAccountDays, r.moderationEvidenceDays)),
    await recorded("processed_originals", () => processedOriginals(store, r.batchSize, r.originalMediaDays)),
    await recorded("expired_records", () => expiredRecords()),
    await recorded("scratch_files", () => scratchFiles(store)),
  ];
}

/**
 * Runs retention if this worker holds the leader lock and nobody ran it within the
 * interval. `connection` must be a dedicated connection (session-level lock).
 */
export async function runRetentionIfDue(connection: Client, store: ObjectStore, intervalMinutes: number): Promise<RetentionReport[] | null> {
  const lock = await connection.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [RETENTION_LOCK]);
  if (!lock.rows[0]?.ok) return null;
  try {
    const recent = await connection.query<{ n: string }>(
      "SELECT count(*) AS n FROM retention_runs WHERE task = 'expired_records' AND started_at > now() - make_interval(secs => $1)",
      [Math.floor(intervalMinutes * 60 * 0.9)],
    );
    if (Number(recent.rows[0]?.n ?? 0) > 0) return null;
    return await runRetention(store);
  } finally {
    await connection.query("SELECT pg_advisory_unlock($1)", [RETENTION_LOCK]);
  }
}
