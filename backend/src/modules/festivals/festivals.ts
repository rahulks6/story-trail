import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { query, queryOne } from "../../db/psql";

/**
 * Katkee's festival calendar (migration 0051): the festival being celebrated today, the Stories
 * people post for it, and whether a new Story can still join it. Days are India's
 * (Asia/Kolkata), where Katkee's festivals are celebrated.
 */
export const FESTIVAL_TIME_ZONE = "Asia/Kolkata";
const TODAY = `(now() AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date`;

export interface Festival {
  slug: string;
  name: string;
  emoji: string;
  greeting: string;
  startsOn: string;
  endsOn: string;
}

const COLUMNS = "slug, name, emoji, greeting, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on";
const toFestival = (r: Record<string, string | null>): Festival => ({
  slug: r.slug as string,
  name: r.name as string,
  emoji: r.emoji as string,
  greeting: r.greeting as string,
  startsOn: r.starts_on as string,
  endsOn: r.ends_on as string,
});

/** Today's festival; when several overlap (Navratri and Durga Puja), the shortest, most specific one. */
export async function currentFestival(): Promise<Festival | null> {
  const row = await queryOne(
    `SELECT ${COLUMNS} FROM festivals WHERE ${TODAY} BETWEEN starts_on AND ends_on
     ORDER BY ends_on - starts_on, starts_on DESC LIMIT 1`,
  );
  return row ? toFestival(row) : null;
}

/** The next festival to come (for "Diwali is in 5 days"). */
export async function nextFestival(): Promise<Festival | null> {
  const row = await queryOne(`SELECT ${COLUMNS} FROM festivals WHERE starts_on > ${TODAY} ORDER BY starts_on LIMIT 1`);
  return row ? toFestival(row) : null;
}

/**
 * The festival a new Story may join: celebrated today, or within a day of it (a Story queued
 * offline on the last evening still counts). Anything else is quietly left untagged rather than
 * failing the upload.
 */
export async function taggableFestival(slug: string | undefined): Promise<string | undefined> {
  if (!slug) return undefined;
  const row = await queryOne(
    `SELECT slug FROM festivals WHERE slug = :'slug' AND ${TODAY} BETWEEN starts_on - 1 AND ends_on + 1`,
    { slug },
  );
  return row ? (row.slug as string) : undefined;
}

/**
 * Who posted a public Story for this festival that the viewer can see: active, public Stories of
 * public accounts, never across a block. Your own first, then the most recent.
 */
export async function festivalCreators(slug: string, viewerId: string, limit = 50): Promise<{ creators: string[]; storyCount: number }> {
  const rows = await query(
    `SELECT u.username, count(*) AS stories, max(s.created_at) AS latest, bool_or(u.id = :'viewer') AS mine
     FROM stories s JOIN users u ON u.id = s.owner_id
     WHERE s.festival = :'slug' AND s.audience = 'public' AND s.deleted_at IS NULL AND s.moderation_removed_at IS NULL
       AND s.expires_at > now() AND u.is_active AND u.deleted_at IS NULL
       AND (NOT u.is_private OR u.id = :'viewer')
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'viewer' AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :'viewer'))
     GROUP BY u.username
     ORDER BY bool_or(u.id = :'viewer') DESC, max(s.created_at) DESC
     LIMIT :'limit'`,
    { slug, viewer: viewerId, limit },
  );
  return { creators: rows.map((r) => r.username as string), storyCount: rows.reduce((n, r) => n + Number(r.stories), 0) };
}

export function registerFestivalRoutes(router: Router): void {
  // Home's festival ring and the editor's festival stickers: today's festival and its Stories,
  // or the next one coming up.
  router.get("/api/v1/festivals/current", async (req, res) => {
    requireAuth(req);
    const festival = await currentFestival();
    if (!festival) {
      sendJson(res, 200, { festival: null, next: await nextFestival(), creators: [], storyCount: 0 });
      return;
    }
    const { creators, storyCount } = await festivalCreators(festival.slug, req.userId as string);
    sendJson(res, 200, { festival, next: null, creators, storyCount });
  });
}
