/**
 * One-off migration for servers that stored media on local disk (the pre-pipeline
 * single-server layout): copies every live object (originals and variants) into
 * the S3 bucket under the same keys, so MEDIA_STORE=s3 can take over.
 *
 *   MEDIA_STORE=s3 MEDIA_S3_BUCKET=<bucket> MEDIA_STORAGE_ROOT=<old media dir> \
 *     node dist/scripts/copy-local-media-to-s3.js [--dry-run]
 *
 * Idempotent: objects already in S3 with the same size are skipped. Media missing
 * locally is reported, never invented. Run it before switching traffic to S3.
 */
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "../src/config/env";
import { closeDatabase, query } from "../src/db/psql";
import { LocalObjectStore, type ObjectStore } from "../src/modules/media/storage";
import { mapMediaRow, MEDIA_COLUMNS } from "../src/modules/media/media.repository";

export interface CopyReport { copied: number; skipped: number; missing: string[] }

export async function copyLocalMediaToS3(local: LocalObjectStore, target: ObjectStore, options: { dryRun?: boolean } = {}): Promise<CopyReport> {
  const report: CopyReport = { copied: 0, skipped: 0, missing: [] };
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "katkee-copy-"));
  try {
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = await query(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id > :'after'::uuid AND purged_at IS NULL ORDER BY id LIMIT 200`, { after });
      if (!rows.length) break;
      for (const row of rows) {
        const media = mapMediaRow(row);
        after = media.id;
        const objects = [
          ...(media.originalPurgedAt || media.status === "uploading" ? [] : [{ key: media.storageKey, mimeType: media.mimeType }]),
          ...Object.values(media.variants).flatMap((v) => (v ? [{ key: v.key, mimeType: v.mimeType }] : [])),
        ];
        for (const object of objects) {
          const source = await local.head(object.key);
          if (!source) {
            report.missing.push(object.key);
            continue;
          }
          const existing = await target.head(object.key);
          if (existing && existing.size === source.size) {
            report.skipped++;
            continue;
          }
          if (!options.dryRun) {
            const file = path.join(work, "object");
            await local.downloadToFile(object.key, file, Number.MAX_SAFE_INTEGER);
            await target.putFile(object.key, file, object.mimeType, object.key === media.storageKey ? undefined : "public, max-age=31536000, immutable");
            await fsp.rm(file, { force: true });
          }
          report.copied++;
        }
      }
    }
    return report;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    if (config.media.store !== "s3") throw new Error("Set MEDIA_STORE=s3 and MEDIA_S3_BUCKET to the destination bucket.");
    const { mediaStorage } = await import("../src/modules/media/instance");
    const report = await copyLocalMediaToS3(new LocalObjectStore(config.media.storageRoot), mediaStorage, { dryRun: process.argv.includes("--dry-run") });
    console.log(JSON.stringify(report, null, 2));
    await closeDatabase();
    if (report.missing.length) process.exitCode = 2;
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
