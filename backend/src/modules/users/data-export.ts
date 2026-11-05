/**
 * "Download your data" (Settings → Download your data). The worker gathers everything someone has
 * put into Katkee into one ZIP: their account, every Story they posted (with its photo or video),
 * their comments, likes, follows, the messages they sent, Highlights, blocks and Close Friends.
 * Other people's words are left out: from a chat, only what this person wrote. The file is
 * private to its owner, kept for EXPORT_DAYS, then deleted by retention. One request a day.
 */
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { query, queryOne, type Row } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { asLocale } from "../../shared/locale";
import { MAX_ZIP_BYTES, ZipWriter } from "../../shared/zip";
import { sendEmailSafely } from "../email/email";
import { EMAIL_TEMPLATES } from "../email/templates";
import { cdnEnabled, signedCdnUrl } from "../media/delivery";
import { findMediaById } from "../media/media.repository";
import type { ObjectStore } from "../media/storage";
import { streamObject } from "../media/stream";

export const EXPORT_DAYS = 7;
/** How long before someone can ask again. */
export const EXPORT_COOLDOWN_HOURS = 24;

export interface DataExportStatus {
  id: string;
  status: "queued" | "running" | "ready" | "failed";
  createdAt: string;
  readyAt: string | null;
  expiresAt: string;
  byteSize: number;
  /** Only when ready: the app's download link (this API; it redirects to the CDN when there is one). */
  downloadUrl: string | null;
}

interface ExportRow {
  id: string;
  userId: string;
  status: DataExportStatus["status"];
  attempts: number;
  maxAttempts: number;
  storageKey: string | null;
  byteSize: number;
  createdAt: string;
  readyAt: string | null;
  expiresAt: string;
}

const COLUMNS = "id, user_id, status, attempts, max_attempts, storage_key, byte_size, created_at, ready_at, expires_at";
const iso = (v: unknown) => new Date(v as string).toISOString();

function mapRow(row: Row): ExportRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    status: row.status as ExportRow["status"],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    storageKey: (row.storage_key as string | null) ?? null,
    byteSize: Number(row.byte_size ?? 0),
    createdAt: iso(row.created_at),
    readyAt: row.ready_at ? iso(row.ready_at) : null,
    expiresAt: iso(row.expires_at),
  };
}

function toStatus(row: ExportRow): DataExportStatus {
  return {
    id: row.id, status: row.status, createdAt: row.createdAt, readyAt: row.readyAt, expiresAt: row.expiresAt, byteSize: row.byteSize,
    downloadUrl: row.status === "ready" ? `/api/v1/users/me/data-export/${row.id}/file` : null,
  };
}

async function latest(userId: string): Promise<ExportRow | null> {
  const row = await queryOne(
    `SELECT ${COLUMNS} FROM data_exports WHERE user_id = :'user' AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    { user: userId },
  );
  return row ? mapRow(row) : null;
}

/** The newest export that hasn't expired, or null. */
export async function getDataExport(userId: string): Promise<DataExportStatus | null> {
  const row = await latest(userId);
  return row ? toStatus(row) : null;
}

/** Starts an export, or returns the one already on its way or made in the last day. */
export async function requestDataExport(userId: string): Promise<{ export: DataExportStatus; created: boolean }> {
  const current = await latest(userId);
  if (current && (current.status === "queued" || current.status === "running")) return { export: toStatus(current), created: false };
  if (current && current.status === "ready" && Date.now() - Date.parse(current.createdAt) < EXPORT_COOLDOWN_HOURS * 3600_000) {
    return { export: toStatus(current), created: false };
  }
  const row = await queryOne(
    `WITH e AS (
       INSERT INTO data_exports (user_id, expires_at) VALUES (:'user', now() + make_interval(days => :'days'::integer))
       RETURNING ${COLUMNS})
     SELECT e.*, pg_notify('media_jobs', 'data-export') AS notified FROM e`,
    { user: userId, days: EXPORT_DAYS },
  );
  return { export: toStatus(mapRow(row!)), created: true };
}

export async function sendDataExportFile(req: IncomingMessage, res: ServerResponse, userId: string, exportId: string, store: ObjectStore): Promise<void> {
  const row = await queryOne(`SELECT ${COLUMNS} FROM data_exports WHERE id = :'id' AND user_id = :'user' AND expires_at > now()`, { id: exportId, user: userId })
    .catch(() => null);
  const job = row ? mapRow(row) : null;
  if (!job || job.status !== "ready" || !job.storageKey) throw new HttpError(404, "Export not found.");
  if (cdnEnabled()) {
    res.writeHead(302, { Location: signedCdnUrl(job.storageKey).url, "Cache-Control": "private, no-store" });
    res.end();
    return;
  }
  await streamObject(req, res, { key: job.storageKey, mimeType: "application/zip", size: job.byteSize, etag: `"data-export-${job.id}"` }, store);
}

// --- the worker side ---------------------------------------------------------------------------

export async function claimDataExport(workerId: string, leaseSeconds: number): Promise<ExportRow | null> {
  const row = await queryOne(
    `UPDATE data_exports d
        SET status = 'running', attempts = d.attempts + 1, locked_by = :'worker', locked_until = now() + make_interval(secs => :'lease'::integer)
      WHERE d.id = (
        SELECT id FROM data_exports
         WHERE (status = 'queued' OR (status = 'running' AND locked_until < now())) AND expires_at > now()
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING ${COLUMNS.split(", ").map((c) => `d.${c}`).join(", ")}`,
    { worker: workerId, lease: leaseSeconds },
  );
  return row ? mapRow(row) : null;
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8");
const at = (v: unknown) => (v ? iso(v) : null);

const README = `Your Katkee data
================

This is a copy of what you have put into Katkee, made when you asked for it.

account.json        Your profile and account details.
stories.json        Every Story you posted (including expired ones), with its words, stickers and settings.
media/              The photo or video of each Story, named by the Story's id.
comments.json       Comments you wrote.
likes.json          Stories you liked.
following.json      People you follow.  followers.json  People who follow you.
messages.json       Messages you sent (other people's messages are theirs, so they aren't included).
highlights.json     Your Highlights and the Stories in them.
blocked.json        People you blocked.  close_friends.json  Your Close Friends.

Times are UTC. Questions: support@katkee.com
`;

/** Builds the archive for one export and stores it. Returns its size. */
async function build(userId: string, store: ObjectStore, file: string, workDir: string): Promise<{ bytes: number; skippedMedia: number }> {
  const zip = await ZipWriter.create(file);
  await zip.addBuffer("README.txt", Buffer.from(README, "utf8"));

  const user = await queryOne(
    `SELECT id, username, email, display_name, bio, is_private, created_at, birth_date, email_verified_at, interests_json, locale,
            verified_at, verified_category, professional_category, findable_by_contacts, show_on_web
       FROM users WHERE id = :'id'`,
    { id: userId },
  );
  if (!user) throw new Error("account gone");
  await zip.addBuffer("account.json", json({
    id: user.id, username: user.username, email: user.email, displayName: user.display_name, bio: user.bio,
    privateAccount: user.is_private === "t", joinedAt: at(user.created_at), birthDate: user.birth_date,
    emailVerifiedAt: at(user.email_verified_at), interests: JSON.parse((user.interests_json as string) || "[]"), language: user.locale,
    verifiedAt: at(user.verified_at), verifiedCategory: user.verified_category, professionalCategory: user.professional_category,
    findableByContacts: user.findable_by_contacts === "t", profileOnTheWeb: user.show_on_web === "t",
  }));

  const stories = await query(
    `SELECT id, media_id, caption, audience, allow_comments, allow_sharing, created_at, expires_at, deleted_at, overlays, filter, music, topic, festival
       FROM stories WHERE owner_id = :'id' ORDER BY created_at`,
    { id: userId },
  );
  let skippedMedia = 0;
  const storyRows = [];
  for (const s of stories) {
    let mediaFile: string | null = null;
    const media = s.media_id ? await findMediaById(s.media_id as string) : null;
    const variant = media && !media.purgedAt ? (media.variants.video_720 ?? media.variants.display ?? media.variants.poster) : null;
    if (variant) {
      const ext = variant.mimeType === "video/mp4" ? "mp4" : "jpg";
      const local = path.join(workDir, `${s.id}.${ext}`);
      try {
        if (zip.size + (variant.byteSize ?? 0) > MAX_ZIP_BYTES) throw new Error("archive full");
        await store.downloadToFile(variant.key, local, MAX_ZIP_BYTES);
        mediaFile = `media/${s.id}.${ext}`;
        await zip.addFile(mediaFile, local);
      } catch {
        mediaFile = null;
        skippedMedia++;
      } finally {
        await fsp.rm(local, { force: true });
      }
    }
    storyRows.push({
      id: s.id, postedAt: at(s.created_at), expiredAt: at(s.expires_at), deletedAt: at(s.deleted_at),
      caption: s.caption, audience: s.audience, comments: s.allow_comments, sharing: s.allow_sharing === "t",
      textAndStickers: JSON.parse((s.overlays as string) || "[]"), filter: s.filter, music: s.music ? JSON.parse(s.music as string) : null,
      topic: s.topic, festival: s.festival, file: mediaFile,
    });
  }
  await zip.addBuffer("stories.json", json(storyRows));

  const rows = async (sql: string) => query(sql, { id: userId });
  await zip.addBuffer("comments.json", json((await rows(
    `SELECT c.story_id, c.body, c.created_at, c.deleted_at FROM story_comments c WHERE c.user_id = :'id' ORDER BY c.created_at`,
  )).map((r) => ({ storyId: r.story_id, comment: r.body, writtenAt: at(r.created_at), deletedAt: at(r.deleted_at) }))));
  await zip.addBuffer("likes.json", json((await rows(
    `SELECT l.story_id, l.created_at FROM story_likes l WHERE l.user_id = :'id' ORDER BY l.created_at`,
  )).map((r) => ({ storyId: r.story_id, likedAt: at(r.created_at) }))));
  const people = async (sql: string, key: string) => (await rows(sql)).map((r) => ({ username: r.username, [key]: at(r.created_at) }));
  await zip.addBuffer("following.json", json(await people(
    `SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = :'id' AND u.deleted_at IS NULL ORDER BY f.created_at`, "since")));
  await zip.addBuffer("followers.json", json(await people(
    `SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = :'id' AND u.deleted_at IS NULL ORDER BY f.created_at`, "since")));
  await zip.addBuffer("blocked.json", json(await people(
    `SELECT u.username, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = :'id' ORDER BY b.created_at`, "blockedAt")));
  await zip.addBuffer("close_friends.json", json(await people(
    `SELECT u.username, c.created_at FROM close_friends c JOIN users u ON u.id = c.friend_id WHERE c.owner_id = :'id' AND u.deleted_at IS NULL ORDER BY c.created_at`, "addedAt")));
  await zip.addBuffer("messages.json", json((await rows(
    `SELECT m.conversation_id, m.body, m.created_at, m.shared_story_id, m.media_id, m.forwarded,
            COALESCE(c.title, (SELECT string_agg(u.username, ', ' ORDER BY u.username) FROM conversation_members cm JOIN users u ON u.id = cm.user_id
                                WHERE cm.conversation_id = m.conversation_id AND cm.user_id <> :'id')) AS chat
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.sender_id = :'id' AND m.event IS NULL ORDER BY m.created_at`,
  )).map((r) => ({
    chat: r.chat, conversationId: r.conversation_id, sentAt: at(r.created_at), message: r.body,
    sharedStoryId: r.shared_story_id, hadPhotoOrVideo: !!r.media_id, forwarded: r.forwarded === "t",
  }))));
  await zip.addBuffer("highlights.json", json((await rows(
    `SELECT h.id, h.title, h.created_at,
            COALESCE((SELECT json_agg(i.story_id ORDER BY i.position) FROM highlight_items i WHERE i.highlight_id = h.id), '[]') AS stories
       FROM highlights h WHERE h.owner_id = :'id' ORDER BY h.position, h.created_at`,
  )).map((r) => ({ id: r.id, title: r.title, createdAt: at(r.created_at), storyIds: JSON.parse(r.stories as string) }))));

  return { bytes: await zip.close(), skippedMedia };
}

export async function processDataExport(job: ExportRow, store: ObjectStore, workerId: string): Promise<"done" | "retrying" | "failed"> {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "katkee-export-"));
  const file = path.join(workDir, "katkee-data.zip");
  try {
    const { bytes, skippedMedia } = await build(job.userId, store, file, workDir);
    // Under m/, where the API and worker may read and write (infra), like Story exports.
    const key = `m/${job.id}/katkee-data.zip`;
    await store.putFile(key, file, "application/zip", "private, no-store");
    await query(
      `UPDATE data_exports SET status = 'ready', storage_key = :'key', byte_size = :'size', ready_at = now(), locked_by = NULL, locked_until = NULL,
              error = NULLIF(:'note', '')
        WHERE id = :'id' AND locked_by = :'worker'`,
      { id: job.id, worker: workerId, key, size: bytes, note: skippedMedia ? `${skippedMedia} Story files were unavailable` : "" },
    );
    const user = await queryOne(`SELECT email, locale FROM users WHERE id = :'id' AND deleted_at IS NULL`, { id: job.userId });
    if (user?.email) void sendEmailSafely({ kind: "data_export_ready", to: user.email as string, ...EMAIL_TEMPLATES[asLocale(user.locale)].dataExportReady(EXPORT_DAYS) });
    console.info(JSON.stringify({ event: "data_export_ready", exportId: job.id, bytes, skippedMedia }));
    return "done";
  } catch (error) {
    const last = job.attempts >= job.maxAttempts;
    await query(
      `UPDATE data_exports SET status = :'status', locked_by = NULL, locked_until = NULL, error = left(:'error', 500) WHERE id = :'id' AND locked_by = :'worker'`,
      { id: job.id, worker: workerId, status: last ? "failed" : "queued", error: (error as Error).message },
    );
    console.error(JSON.stringify({ event: "data_export_error", exportId: job.id, error: (error as Error).message, final: last }));
    return last ? "failed" : "retrying";
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

/** Retention: expired exports and their files go. */
export async function expiredDataExports(store: ObjectStore, batch: number): Promise<number> {
  // Also the exports of a deleted account, at once.
  const rows = await query(
    `SELECT d.id, d.storage_key FROM data_exports d JOIN users u ON u.id = d.user_id
      WHERE d.expires_at <= now() OR u.deleted_at IS NOT NULL ORDER BY d.expires_at LIMIT :'n'`,
    { n: batch },
  );
  if (!rows.length) return 0;
  const keys = rows.map((r) => r.storage_key as string | null).filter((k): k is string => !!k);
  if (keys.length) await store.deleteObjects(keys);
  await query(`DELETE FROM data_exports WHERE id = ANY(string_to_array(:'ids', ',')::uuid[])`, { ids: rows.map((r) => r.id as string).join(",") });
  return rows.length;
}
