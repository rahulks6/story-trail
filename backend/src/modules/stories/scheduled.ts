/**
 * Scheduled Stories (migration 0067). In the editor's share step, "Schedule" picks a time up to
 * 7 days ahead. The media uploads straight away, exactly as for a Story shared now; the share
 * then lands here instead of in `stories`, and the worker publishes it when it is due (and tells
 * its owner "Your scheduled Story is live"). Until then it exists only in its owner's Scheduled
 * list: nothing that shows Stories to anyone reads this table. Its 24 hours start at publish.
 *
 * Everything a publish checks is checked twice: when scheduling (so a mistake shows while the
 * person is still in the app) and again at publish time by publish_story_once (the account may
 * have been restricted since, or the media failed processing).
 */
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { config } from "../../config/env";
import { DatabaseError, openDedicatedConnection, query, queryOne, type Row } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { ValidationError } from "../auth/dto";
import { assertCanContribute } from "../admin/account-policy";
import { assertLinksAllowed } from "../safety/links";
import { taggableFestival } from "../festivals/festivals";
import { validateStoryMusic } from "../music/music.service";
import { deliveryFor, type MediaDelivery } from "../media/delivery";
import * as mediaRepo from "../media/media.repository";
import { captionText, type PublishStoryInput } from "./dto";
import type { Audience } from "./stories.repository";

/** As far ahead as a Story can be scheduled. */
export const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 3600 * 1000;
/** Phones' clocks drift: a time this little past the limit is still accepted. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;
/**
 * A share made offline can reach the server after its time: it then posts at once. Longer ago
 * than this and posting "now" would surprise its owner more than refusing it does.
 */
export const LATE_SHARE_GRACE_MS = 24 * 3600 * 1000;
/** A new time chosen in the Scheduled list must still be ahead. */
const MIN_RESCHEDULE_LEAD_MS = 60 * 1000;
/** Pending scheduled Stories per account. */
export const MAX_PENDING_SCHEDULED = 25;
/** Failed ones stay in the list this long, so their owner sees what happened. */
const FAILED_SHOWN_DAYS = 7;

export interface ScheduledStoryView {
  id: string;
  /** The device's outbox id that scheduled it. */
  requestId: string;
  state: "scheduled" | "published" | "canceled" | "failed";
  publishAt: string;
  createdAt: string;
  /** Why it couldn't be posted, for people to read. */
  error: string | null;
  /** Once posted. */
  storyId: string | null;
  caption: string;
  audience: Audience;
  mediaId: string;
  /** Your own media: thumbnail and status (a video may still be processing). */
  media: MediaDelivery | null;
}

/** `publishAt` from a request: an ISO 8601 time with its offset, or undefined when absent. */
export function parsePublishAt(body: unknown): Date | undefined {
  const raw = (typeof body === "object" && body !== null ? (body as Record<string, unknown>).publishAt : undefined);
  if (raw === undefined || raw === null) return undefined;
  const at = typeof raw === "string" && raw.length <= 40 && /(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? Date.parse(raw) : NaN;
  if (!Number.isFinite(at)) throw new ValidationError({ publishAt: "publishAt must be a time with its time zone, like 2026-11-02T18:30:00+05:30." });
  return new Date(at);
}

function assertWithinWindow(publishAt: Date, now: number, earliest: number): void {
  if (publishAt.getTime() > now + MAX_SCHEDULE_AHEAD_MS + CLOCK_SLACK_MS) {
    throw new ValidationError({ publishAt: "Stories can be scheduled up to 7 days ahead." });
  }
  if (publishAt.getTime() < earliest) {
    throw new ValidationError({ publishAt: "That time has passed. Choose a time later than now." });
  }
}

const VIEW_COLUMNS = `id, request_id, state, to_json(publish_at) #>> '{}' AS publish_at, to_json(created_at) #>> '{}' AS created_at,
  error, story_id, media_id, payload->>'caption' AS caption, payload->>'audience' AS audience`;

async function toViews(rows: Row[]): Promise<ScheduledStoryView[]> {
  const media = await mediaRepo.findMediaByIds(rows.map((r) => r.media_id as string));
  return rows.map((r) => {
    const m = media.get(r.media_id as string);
    return {
      id: r.id as string,
      requestId: r.request_id as string,
      state: r.state as ScheduledStoryView["state"],
      publishAt: r.publish_at as string,
      createdAt: r.created_at as string,
      error: r.error ?? null,
      storyId: r.story_id ?? null,
      caption: r.caption ?? "",
      audience: (r.audience ?? "public") as Audience,
      mediaId: r.media_id as string,
      media: m ? deliveryFor(m, true) : null,
    };
  });
}

async function findView(ownerId: string, id: string): Promise<ScheduledStoryView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await queryOne(`SELECT ${VIEW_COLUMNS} FROM scheduled_stories WHERE id = :'id' AND owner_id = :'owner'`, { id, owner: ownerId });
  return row ? (await toViews([row]))[0]! : null;
}

/** The schedule a device's request made, if it was a scheduled share (stories.service checks before publishing). */
export async function findScheduledByRequest(ownerId: string, requestId: string): Promise<ScheduledStoryView | null> {
  const row = await queryOne(`SELECT ${VIEW_COLUMNS} FROM scheduled_stories WHERE owner_id = :'owner' AND request_id = :'request'`, {
    owner: ownerId,
    request: requestId,
  });
  return row ? (await toViews([row]))[0]! : null;
}

/** Whether this upload is waiting to be posted on schedule (so it can't also be shared now). */
export async function mediaIsScheduled(mediaId: string): Promise<boolean> {
  return !!(await queryOne(`SELECT 1 AS found FROM scheduled_stories WHERE media_id = :'media' AND state = 'scheduled'`, { media: mediaId }));
}

/**
 * Schedules a share. Idempotent by the device's request id: a retry after a lost response gets
 * the same schedule back (even if it was rescheduled or has posted since), while the same id
 * with different content is refused.
 */
export async function scheduleStory(ownerId: string, input: PublishStoryInput, publishAt: Date, now = Date.now()): Promise<ScheduledStoryView> {
  const requestId = input.requestId;
  if (!requestId) throw new ValidationError({ requestId: "A scheduled Story needs a request id." });
  await assertCanContribute(ownerId);
  await assertLinksAllowed(captionText(input), "caption", ownerId);
  if (input.music) input = { ...input, music: await validateStoryMusic(input.music) };
  // Hashed as the app sent it (the request path's rule), so a retry still matches its schedule.
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const existing = await findScheduledByRequest(ownerId, requestId);
  if (existing) {
    const row = await queryOne(`SELECT request_hash FROM scheduled_stories WHERE id = :'id'`, { id: existing.id });
    if (row?.request_hash !== hash) throw new HttpError(409, "This upload was already submitted with different content.");
    return existing;
  }
  assertWithinWindow(publishAt, now, now - LATE_SHARE_GRACE_MS);
  const festival = await taggableFestival(input.festival);
  const { festival: _sent, ...rest } = input;
  const payload: PublishStoryInput = festival ? { ...rest, festival } : rest;
  let id: string;
  try {
    const row = await queryOne(
      `SELECT schedule_story(:'owner', :'request', :'hash', :'payload'::jsonb, :'at'::timestamptz, :'max'::integer) AS id`,
      { owner: ownerId, request: requestId, hash, payload: JSON.stringify(payload), at: publishAt.toISOString(), max: MAX_PENDING_SCHEDULED },
    );
    id = row?.id as string;
  } catch (e) {
    if (e instanceof DatabaseError) {
      if (/REQUEST_CONFLICT/.test(e.detail)) throw new HttpError(409, "This upload was already submitted with different content.");
      if (/REQUEST_PUBLISHED/.test(e.detail)) throw new HttpError(409, "This Story has already been posted.");
      if (/MEDIA_NOT_FOUND/.test(e.detail)) throw new HttpError(404, "Media not found.");
      if (/MEDIA_AUDIO/.test(e.detail)) throw new HttpError(422, "A voice note can't be posted as a Story.");
      if (/MEDIA_NOT_UPLOADED/.test(e.detail)) throw new HttpError(409, "Finish uploading this media before scheduling it.");
      if (/MEDIA_FAILED/.test(e.detail)) throw new HttpError(422, "This photo or video couldn't be processed.");
      if (/MEDIA_PUBLISHED|scheduled_stories_media_idx/.test(e.detail)) throw new HttpError(409, "This media has already been posted or scheduled.");
      if (/TOO_MANY_SCHEDULED/.test(e.detail)) {
        throw new HttpError(409, `You can have up to ${MAX_PENDING_SCHEDULED} scheduled Stories. Post or cancel one first.`, undefined, undefined, "too_many_scheduled");
      }
      if (/ACCOUNT_RESTRICTED/.test(e.detail)) throw new HttpError(403, "Your account cannot publish.");
      if (/INVALID_REQUEST/.test(e.detail)) throw new HttpError(422, "Invalid publish request id.");
    }
    throw e;
  }
  const view = await findView(ownerId, id);
  if (!view) throw new HttpError(404, "Scheduled Story not found.");
  return view;
}

/** Your Scheduled list: waiting ones soonest first, then recent ones that couldn't be posted. */
export async function listScheduled(ownerId: string): Promise<ScheduledStoryView[]> {
  const rows = await query(
    `SELECT ${VIEW_COLUMNS} FROM scheduled_stories
     WHERE owner_id = :'owner'
       AND (state = 'scheduled' OR (state = 'failed' AND resolved_at > now() - make_interval(days => :'days'::integer)))
     ORDER BY state = 'failed', publish_at
     LIMIT 100`,
    { owner: ownerId, days: FAILED_SHOWN_DAYS },
  );
  return toViews(rows);
}

/** A new time for one that hasn't posted yet. */
export async function reschedule(ownerId: string, id: string, publishAt: Date, now = Date.now()): Promise<ScheduledStoryView> {
  assertWithinWindow(publishAt, now, now + MIN_RESCHEDULE_LEAD_MS);
  const current = await findView(ownerId, id);
  if (!current || current.state === "canceled") throw new HttpError(404, "Scheduled Story not found.");
  // The worker holds the row while it publishes, so this waits and then sees "published".
  const row = await queryOne(
    `UPDATE scheduled_stories SET publish_at = :'at'::timestamptz, updated_at = now()
     WHERE id = :'id' AND owner_id = :'owner' AND state = 'scheduled' RETURNING id`,
    { id, owner: ownerId, at: publishAt.toISOString() },
  );
  if (!row) throw new HttpError(409, current.state === "published" ? "This Story has already been posted." : "This Story can't be rescheduled.", undefined, undefined, current.state === "published" ? "already_published" : undefined);
  return (await findView(ownerId, id))!;
}

/**
 * Cancels one that hasn't posted (it never appears; its upload is then unused and goes with
 * retention), or dismisses one that failed. A Story that already posted stays up: delete it
 * from the Story itself.
 */
export async function cancelScheduled(ownerId: string, id: string): Promise<void> {
  const current = await findView(ownerId, id);
  if (!current || current.state === "canceled") throw new HttpError(404, "Scheduled Story not found.");
  const row = await queryOne(
    `UPDATE scheduled_stories SET state = 'canceled', resolved_at = now(), updated_at = now()
     WHERE id = :'id' AND owner_id = :'owner' AND state IN ('scheduled', 'failed') RETURNING id`,
    { id, owner: ownerId },
  );
  if (!row) throw new HttpError(409, "This Story has already been posted. Delete it from the Story instead.", undefined, undefined, "already_published");
}

/** Deleting an account cancels everything it had scheduled. */
export async function cancelAllScheduledStories(ownerId: string): Promise<number> {
  const rows = await query(
    `UPDATE scheduled_stories SET state = 'canceled', resolved_at = now(), updated_at = now()
     WHERE owner_id = :'owner' AND state = 'scheduled' RETURNING id`,
    { owner: ownerId },
  );
  return rows.length;
}

/**
 * Publishes what is due (publish_due_scheduled_stories, migration 0067), then sends what every
 * publish sends: mention notifications and the "posted a new Story" pushes to followers.
 */
export async function publishDueScheduledStories(batchSize = config.scheduledStories.batchSize): Promise<{ published: number; failed: number }> {
  const rows = await query(
    `SELECT out_scheduled, out_owner, out_story, out_outcome FROM publish_due_scheduled_stories(:'limit'::integer, :'ttl'::integer)`,
    { limit: batchSize, ttl: config.stories.ttlSeconds },
  );
  // Loaded here, not at the top: stories.service imports this module.
  const { notifyMentionsQuietly } = await import("./stories.service");
  let published = 0;
  for (const row of rows) {
    if (row.out_outcome !== "published" || !row.out_story) continue;
    published++;
    await notifyMentionsQuietly(row.out_story);
  }
  return { published, failed: rows.length - published };
}

/** One worker at a time publishes; others skip the round. */
const LOCK = 7315220004;

/** Runs publishDueScheduledStories every few seconds inside the worker service (ReachWorker's pattern). */
export class ScheduledStoriesWorker {
  private running = false;
  private connection: Client | null = null;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: { everyMs: number; batchSize?: number; log?: (event: Record<string, unknown>) => void }) {}

  /** One round if this worker holds the lock; null when another worker has it. */
  async runOnce(): Promise<{ published: number; failed: number } | null> {
    const connection = this.connection ?? (this.connection = await openDedicatedConnection());
    const lock = await connection.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK]);
    if (!lock.rows[0]?.ok) return null;
    try {
      // A backlog (the worker was down) drains in consecutive rounds, not one per poll.
      const total = { published: 0, failed: 0 };
      for (let round = 0; round < 10; round++) {
        const result = await publishDueScheduledStories(this.options.batchSize);
        total.published += result.published;
        total.failed += result.failed;
        if (result.published + result.failed < (this.options.batchSize ?? config.scheduledStories.batchSize)) break;
      }
      return total;
    } finally {
      await connection.query("SELECT pg_advisory_unlock($1)", [LOCK]);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          const result = await this.runOnce();
          if (result && result.published + result.failed > 0) this.options.log?.({ event: "scheduled_stories_published", ...result });
        } catch (error) {
          this.options.log?.({ event: "scheduled_stories_error", error: (error as Error).message });
        }
        if (this.running) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { this.wake = null; resolve(); }, this.options.everyMs);
            this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.connection?.end().catch(() => undefined);
    this.connection = null;
  }
}
