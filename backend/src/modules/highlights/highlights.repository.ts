import { aiClearedSql } from "../../shared/aiCleared";
import { shownToViewerSql } from "../../shared/testAccounts";
import { nullable, query, queryOne, type Row } from "../../db/psql";
import type { Audience } from "../stories/stories.repository";
import { COLLAB_BLOCKS_SQL } from "../stories/audience";

export interface HighlightRow {
  id: string;
  ownerId: string;
  title: string;
  position: number;
  coverStoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HighlightItemRow {
  storyId: string;
  mediaId: string;
  audience: Audience;
  position: number;
  addedAt: string;
}

export interface HighlightWithItems extends HighlightRow {
  items: HighlightItemRow[];
}

function mapHighlightRow(row: Row): HighlightRow {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    title: row.title as string,
    position: Number(row.position),
    coverStoryId: (row.cover_story_id as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** New Highlights join the end of the owner's own order, same as a freshly-created item joins the end of a Highlight's own contents. */
export async function createHighlight(ownerId: string, title: string): Promise<HighlightRow> {
  const row = await queryOne(
    `INSERT INTO highlights (owner_id, title, position)
     VALUES (:'owner_id', :'title', (SELECT COALESCE(MAX(position) + 1, 0) FROM highlights WHERE owner_id = :'owner_id'))
     RETURNING id, owner_id, title, position, cover_story_id, created_at, updated_at`,
    { owner_id: ownerId, title },
  );
  if (!row) throw new Error("Highlight insert returned no row");
  return mapHighlightRow(row);
}

/** Pass `null` to clear back to the default (first item) cover. */
export async function setCoverStory(id: string, coverStoryId: string | null): Promise<void> {
  await query(`UPDATE highlights SET cover_story_id = ${nullable("cover_story_id", "uuid")}, updated_at = now() WHERE id = :'id'`, {
    id,
    cover_story_id: coverStoryId,
  });
}

/**
 * Full reorder, same shape as replaceHighlightItems one level down — the
 * caller (highlights.service.ts) has already checked `orderedIds` is
 * exactly this owner's current Highlight set, so this just assigns each
 * its new array index as its position.
 */
export async function reorderHighlights(ownerId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await query(`UPDATE highlights SET position = :'position', updated_at = now() WHERE id = :'id' AND owner_id = :'owner_id'`, {
      id: orderedIds[i] as string,
      position: i,
      owner_id: ownerId,
    });
  }
}

export async function findHighlightById(id: string): Promise<HighlightRow | null> {
  const row = await queryOne(
    `SELECT id, owner_id, title, position, cover_story_id, created_at, updated_at FROM highlights WHERE id = :'id'`,
    { id },
  );
  return row ? mapHighlightRow(row) : null;
}

export async function renameHighlight(id: string, title: string): Promise<void> {
  await query(`UPDATE highlights SET title = :'title', updated_at = now() WHERE id = :'id'`, { id, title });
}

export async function deleteHighlight(id: string): Promise<void> {
  await query(`DELETE FROM highlights WHERE id = :'id'`, { id });
}

/**
 * Replaces a highlight's full ordered item list in one call — delete then
 * re-insert, not a diff/patch. There's no cross-statement transaction in
 * this psql-CLI shim (see db/psql.ts), so this is sequential rather than
 * atomic, the same accepted tradeoff as other multi-step repository
 * functions elsewhere in this codebase (e.g. conversations.repository's
 * createMessage + markRead).
 */
export async function replaceHighlightItems(highlightId: string, storyIds: string[]): Promise<void> {
  await query(`DELETE FROM highlight_items WHERE highlight_id = :'highlight_id'`, { highlight_id: highlightId });
  for (let i = 0; i < storyIds.length; i++) {
    await query(
      `INSERT INTO highlight_items (highlight_id, story_id, position) VALUES (:'highlight_id', :'story_id', :'position')`,
      { highlight_id: highlightId, story_id: storyIds[i] as string, position: i },
    );
  }
  await query(`UPDATE highlights SET updated_at = now() WHERE id = :'id'`, { id: highlightId });
}

function groupIntoHighlights(rows: Row[]): HighlightWithItems[] {
  const byId = new Map<string, HighlightWithItems>();
  const order: string[] = [];
  for (const row of rows) {
    const id = row.id as string;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        ownerId: row.owner_id as string,
        title: row.title as string,
        position: Number(row.h_position),
        coverStoryId: (row.cover_story_id as string | null) ?? null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        items: [],
      });
      order.push(id);
    }
    // A highlight with zero surviving items (none inserted yet, or every
    // Story it held has since been removed) yields one row with every
    // item column NULL via the LEFT JOINs — skip rather than push a
    // half-null item.
    if (row.story_id && row.media_id) {
      byId.get(id)!.items.push({
        storyId: row.story_id as string,
        mediaId: row.media_id as string,
        audience: row.audience as Audience,
        position: Number(row.position),
        addedAt: row.added_at as string,
      });
    }
  }
  return order.map((id) => byId.get(id)!);
}

// h.position is aliased to h_position — hi.position (an item's own
// position within the Highlight) already claims the bare "position"
// column name in this same SELECT list.
const HIGHLIGHT_WITH_ITEMS_SELECT = `
  h.id, h.owner_id, h.title, h.position AS h_position, h.cover_story_id, h.created_at, h.updated_at,
  hi.story_id, hi.position, hi.added_at, s.media_id, s.audience
`;
const HIGHLIGHT_WITH_ITEMS_JOINS = `
  FROM highlights h
  LEFT JOIN highlight_items hi ON hi.highlight_id = h.id
  LEFT JOIN stories s ON s.id = hi.story_id AND s.deleted_at IS NULL
`;

export async function listForOwner(ownerId: string): Promise<HighlightWithItems[]> {
  const rows = await query(
    `SELECT ${HIGHLIGHT_WITH_ITEMS_SELECT} ${HIGHLIGHT_WITH_ITEMS_JOINS}
     WHERE h.owner_id = :'owner_id'
     ORDER BY h.position ASC, h.created_at ASC, hi.position ASC`,
    { owner_id: ownerId },
  );
  return groupIntoHighlights(rows);
}

export async function getWithItems(id: string): Promise<HighlightWithItems | null> {
  const rows = await query(
    `SELECT ${HIGHLIGHT_WITH_ITEMS_SELECT} ${HIGHLIGHT_WITH_ITEMS_JOINS}
     WHERE h.id = :'id'
     ORDER BY hi.position ASC`,
    { id },
  );
  const grouped = groupIntoHighlights(rows);
  return grouped[0] ?? null;
}

export async function isStoryInHighlight(highlightId: string, storyId: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM highlight_items WHERE highlight_id = :'highlight_id' AND story_id = :'story_id' LIMIT 1`,
    { highlight_id: highlightId, story_id: storyId },
  );
  return rows.length > 0;
}

/** Used by stories.service.canAccessMediaViaStory to decide whether expiry should be bypassed at all before doing the real (audience/block/private) check. */
export async function storyIsInAnyHighlight(storyId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM highlight_items WHERE story_id = :'story_id' LIMIT 1`, { story_id: storyId });
  return rows.length > 0;
}

export async function removeStoryFromAllHighlights(storyId: string): Promise<void> {
  await query(`DELETE FROM highlight_items WHERE story_id = :'story_id'`, { story_id: storyId });
}

export interface DiscoverableHighlightRow {
  id: string;
  title: string;
  coverMediaId: string;
  itemCount: number;
  latestAt: string;
  owner: { id: string; username: string; displayName: string; avatarMediaId: string | null };
}

/**
 * Highlights anyone may see, for the end of Home: public accounts only (active, not suspended),
 * never the viewer's own, nobody blocked either way or muted by the viewer, and only the public
 * Stories inside them (a followers-only or Close Friends item never counts or shows). The newest
 * first, at most two per person.
 */
export async function listDiscoverable(viewerId: string, limit: number): Promise<DiscoverableHighlightRow[]> {
  const rows = await query(
    `WITH visible AS (
       SELECT h.id, h.owner_id, h.title, h.cover_story_id, hi.story_id, hi.position, hi.added_at, s.media_id
       FROM highlights h
       JOIN users u ON u.id = h.owner_id
       JOIN highlight_items hi ON hi.highlight_id = h.id
       JOIN stories s ON s.id = hi.story_id AND s.deleted_at IS NULL AND s.moderation_removed_at IS NULL AND s.audience = 'public' AND ${aiClearedSql("s")}
                     AND ${COLLAB_BLOCKS_SQL}
       WHERE h.owner_id <> :'viewer' AND u.deleted_at IS NULL AND u.is_active AND NOT u.is_private AND u.moderation_state = 'ACTIVE'
         AND ${shownToViewerSql("u")}
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'viewer' AND b.blocked_id = h.owner_id) OR (b.blocker_id = h.owner_id AND b.blocked_id = :'viewer'))
         AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = :'viewer' AND m.muted_id = h.owner_id)
     ), per_highlight AS (
       SELECT id, owner_id, title, count(*)::int AS item_count, max(added_at) AS latest_at,
              COALESCE((array_agg(media_id) FILTER (WHERE story_id = cover_story_id))[1], (array_agg(media_id ORDER BY position))[1]) AS cover_media_id
       FROM visible GROUP BY id, owner_id, title
     ), ranked AS (
       SELECT p.*, row_number() OVER (PARTITION BY owner_id ORDER BY latest_at DESC) AS n FROM per_highlight p
     )
     SELECT r.id, r.title, r.item_count, r.latest_at, r.cover_media_id, u.id AS owner_id, u.username, u.display_name, u.avatar_media_id
     FROM ranked r JOIN users u ON u.id = r.owner_id
     WHERE r.n <= 2
     ORDER BY r.latest_at DESC
     LIMIT :'limit'`,
    { viewer: viewerId, limit },
  );
  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    coverMediaId: row.cover_media_id as string,
    itemCount: Number(row.item_count),
    latestAt: row.latest_at as string,
    owner: { id: row.owner_id as string, username: row.username as string, displayName: (row.display_name as string) ?? (row.username as string), avatarMediaId: (row.avatar_media_id as string | null) ?? null },
  }));
}
