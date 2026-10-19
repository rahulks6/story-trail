import { query, type Row } from "../../db/psql";
import { containsPattern } from "../../shared/validation";

/** One song in Katkee's catalogue (openly licensed; see migrations/0046_music.sql). */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  mood: string;
  durationMs: number;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  license: string;
  licenseUrl: string;
  attribution: string;
}

const COLUMNS = "id, title, artist, mood, duration_ms, storage_key, mime_type, byte_size, license, license_url, attribution";

function mapRow(row: Row): MusicTrack {
  return {
    id: row.id as string,
    title: row.title as string,
    artist: row.artist as string,
    mood: (row.mood as string) ?? "",
    durationMs: Number(row.duration_ms),
    storageKey: row.storage_key as string,
    mimeType: row.mime_type as string,
    byteSize: Number(row.byte_size),
    license: row.license as string,
    licenseUrl: row.license_url as string,
    attribution: row.attribution as string,
  };
}

/** Active tracks, by title; `search` matches the title or the artist, `mood` filters. */
export async function listTracks(search: string, mood: string, limit: number, offset: number): Promise<MusicTrack[]> {
  const rows = await query(
    `SELECT ${COLUMNS} FROM music_tracks
     WHERE active AND (:'search' = '' OR title ILIKE :'pattern' OR artist ILIKE :'pattern') AND (:'mood' = '' OR lower(mood) = lower(:'mood'))
     ORDER BY title, id LIMIT :'limit' OFFSET :'offset'`,
    { search, pattern: containsPattern(search), mood, limit, offset },
  );
  return rows.map(mapRow);
}

export async function listMoods(): Promise<string[]> {
  const rows = await query(`SELECT DISTINCT mood FROM music_tracks WHERE active AND mood <> '' ORDER BY mood`, {});
  return rows.map((r) => r.mood as string);
}

/** Tracks by id, inactive ones included: a Story keeps playing a track taken out of the picker. */
export async function findTracksByIds(ids: string[]): Promise<Map<string, MusicTrack>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return new Map();
  const rows = await query(`SELECT ${COLUMNS} FROM music_tracks WHERE id = ANY (string_to_array(:'ids', ',')::uuid[])`, { ids: unique.join(",") });
  return new Map(rows.map((r) => [r.id as string, mapRow(r)]));
}

export async function findActiveTrack(id: string): Promise<MusicTrack | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query(`SELECT ${COLUMNS} FROM music_tracks WHERE id = :'id' AND active`, { id });
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findTrack(id: string): Promise<MusicTrack | null> {
  return (await findTracksByIds([id])).get(id) ?? null;
}
