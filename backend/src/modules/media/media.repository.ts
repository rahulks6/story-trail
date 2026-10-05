import { nullable, query, queryOne } from "../../db/psql";
import type { MediaKind } from "./validation";
import type { VariantName } from "./processing";

export type MediaStatus = "uploading" | "processing" | "ready" | "failed";

export interface MediaVariant {
  key: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  bitrate?: number;
}

export interface MediaRecord {
  id: string;
  ownerId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksumSha256: string | null;
  storageKey: string;
  status: MediaStatus;
  createdAt: string;
  variants: Partial<Record<VariantName, MediaVariant>>;
  processingError: string | null;
  processingErrorRetryable: boolean;
  processedAt: string | null;
  originalPurgedAt: string | null;
  purgedAt: string | null;
}

export const MEDIA_COLUMNS =
  "id, owner_id, kind, mime_type, byte_size, width, height, duration_ms, checksum_sha256, storage_key, status, created_at, " +
  "variants, processing_error, processing_error_retryable, processed_at, original_purged_at, purged_at";

export function mapMediaRow(row: Record<string, string | null>): MediaRecord {
  let variants: MediaRecord["variants"] = {};
  try {
    variants = row.variants ? (JSON.parse(row.variants) as MediaRecord["variants"]) : {};
  } catch {
    variants = {};
  }
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    kind: row.kind as MediaKind,
    mimeType: row.mime_type as string,
    byteSize: Number(row.byte_size),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    checksumSha256: row.checksum_sha256 ?? null,
    storageKey: row.storage_key as string,
    status: row.status as MediaStatus,
    createdAt: row.created_at as string,
    variants,
    processingError: row.processing_error ?? null,
    processingErrorRetryable: row.processing_error_retryable === "t" || row.processing_error_retryable === "true",
    processedAt: row.processed_at ?? null,
    originalPurgedAt: row.original_purged_at ?? null,
    purgedAt: row.purged_at ?? null,
  };
}

/** Creates the row for bytes that are already stored (legacy single-request upload). */
export async function insertStoredMedia(input: {
  id: string;
  ownerId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksumSha256: string;
  storageKey: string;
}): Promise<MediaRecord> {
  const row = await queryOne(
    `INSERT INTO media (id, owner_id, kind, mime_type, byte_size, width, height, duration_ms, checksum_sha256, storage_key, status)
     VALUES (:'id', :'owner_id', :'kind', :'mime_type', :'byte_size', ${nullable("width", "integer")}, ${nullable("height", "integer")},
             ${nullable("duration_ms", "integer")}, :'checksum', :'storage_key', 'processing')
     RETURNING ${MEDIA_COLUMNS}`,
    {
      id: input.id,
      owner_id: input.ownerId,
      kind: input.kind,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      width: input.width,
      height: input.height,
      duration_ms: input.durationMs,
      checksum: input.checksumSha256,
      storage_key: input.storageKey,
    },
  );
  if (!row) throw new Error("Insert did not return a row");
  return mapMediaRow(row);
}

/** Many rows in one query (story lists), keyed by id. */
export async function findMediaByIds(ids: string[]): Promise<Map<string, MediaRecord>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return new Map();
  const rows = await query(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ANY (string_to_array(:'ids', ',')::uuid[])`, { ids: unique.join(",") });
  return new Map(rows.map((row) => {
    const media = mapMediaRow(row);
    return [media.id, media];
  }));
}

export async function findMediaById(id: string, excludeModerated = false): Promise<MediaRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await queryOne(
    `SELECT ${MEDIA_COLUMNS}
     FROM media WHERE id = :'id' ${excludeModerated ? `AND NOT EXISTS (SELECT 1 FROM stories WHERE media_id=media.id AND moderation_removed_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM ad_creatives WHERE media_id=media.id AND review_status='REMOVED')` : ''}`,
    { id },
  );
  return row ? mapMediaRow(row) : null;
}
