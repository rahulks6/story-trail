/**
 * Object storage for media originals and their delivery variants.
 *
 * Production uses S3 (s3-store.ts); this file also holds the local-disk store used
 * for development and tests. Both speak the same protocol to clients: a multipart
 * upload whose parts are sent straight to per-part, short-lived signed URLs, so the
 * API never buffers media bytes in production. Config refuses local disk in
 * production (config/env.ts).
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createHash, createHmac, randomBytes, timingSafeEqual, hkdfSync } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { config } from "../../config/env";

export interface ObjectRange { start: number; end: number }
export interface ObjectInfo { size: number; contentType: string | null }
export interface UploadedPart { partNumber: number; etag: string; size: number }
export interface PartUrlRequest {
  key: string;
  uploadId: string;
  partNumber: number;
  byteLength: number;
  expiresInSeconds: number;
  mediaId: string;
}

export interface ObjectStore {
  readonly kind: "local" | "s3";
  /** Copies a local file to `key` (the source file is left in place). */
  putFile(key: string, filePath: string, contentType: string, cacheControl?: string): Promise<void>;
  head(key: string): Promise<ObjectInfo | null>;
  read(key: string, range?: ObjectRange): Promise<Readable>;
  /** Downloads `key` to `filePath`, refusing objects larger than `maxBytes`. Returns the byte count. */
  downloadToFile(key: string, filePath: string, maxBytes: number): Promise<number>;
  deleteObjects(keys: string[]): Promise<void>;
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  /** URL the client PUTs exactly `byteLength` bytes to. Relative URLs are served by this API. */
  presignPart(request: PartUrlRequest): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}

export class ObjectTooLargeError extends Error {}

/** Counts (and optionally hashes) bytes as they pass, failing past `maxBytes`. */
export class ByteCounter extends Transform {
  bytes = 0;
  private readonly md5 = createHash("md5");
  constructor(private readonly maxBytes: number) {
    super();
  }
  override _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(new ObjectTooLargeError(`Object exceeds ${this.maxBytes} bytes.`));
      return;
    }
    this.md5.update(chunk);
    callback(null, chunk);
  }
  md5Hex(): string {
    return this.md5.digest("hex");
  }
}

/** Server-generated keys only: m/<media uuid>/<file>, or a pre-Phase-2 flat key. */
const MEDIA_KEY = /^m\/[0-9a-f-]{36}\/[a-z0-9][a-z0-9_.-]{0,63}$/;
const LEGACY_KEY = /^[a-f0-9-]+$/i;
const UPLOAD_ID = /^[0-9a-f]{32}$/;

const localUploadKey = Buffer.from(hkdfSync("sha256", config.jwt.refreshSecret, Buffer.alloc(0), "katkee:local-upload-url", 32));

/** Signature for the local store's part URLs; the S3 store uses AWS SigV4 instead. */
export function localPartSignature(mediaId: string, partNumber: number, byteLength: number, expires: number): string {
  return createHmac("sha256", localUploadKey).update(`${mediaId}|${partNumber}|${byteLength}|${expires}`).digest("hex");
}

export function verifyLocalPartSignature(mediaId: string, partNumber: number, byteLength: number, expires: number, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature) || !Number.isSafeInteger(expires) || expires * 1000 < Date.now()) return false;
  const expected = Buffer.from(localPartSignature(mediaId, partNumber, byteLength, expires), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export class LocalObjectStore implements ObjectStore {
  readonly kind = "local" as const;

  constructor(private readonly rootDir: string) {}

  private resolvePath(key: string): string {
    // Keys are server-generated; this guard stops any caller from being tricked
    // into path traversal by an attacker-controlled key.
    if (MEDIA_KEY.test(key)) return path.join(this.rootDir, ...key.split("/"));
    if (LEGACY_KEY.test(key)) return path.join(this.rootDir, key.slice(0, 2), key);
    throw new Error(`Invalid media storage key: ${key}`);
  }

  private uploadDir(uploadId: string): string {
    if (!UPLOAD_ID.test(uploadId)) throw new Error("Invalid upload id.");
    return path.join(this.rootDir, ".multipart", uploadId);
  }

  private async tempPath(): Promise<string> {
    const dir = path.join(this.rootDir, ".tmp");
    await fsp.mkdir(dir, { recursive: true });
    return path.join(dir, randomBytes(16).toString("hex"));
  }

  /** Writes to a temp file then renames, so readers never see a partial object. */
  private async commit(key: string, tempFile: string): Promise<void> {
    const target = this.resolvePath(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(tempFile, target);
  }

  async putFile(key: string, filePath: string, _contentType: string): Promise<void> {
    const temp = await this.tempPath();
    try {
      await fsp.copyFile(filePath, temp);
      await this.commit(key, temp);
    } catch (error) {
      await fsp.rm(temp, { force: true });
      throw error;
    }
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const stat = await fsp.stat(this.resolvePath(key));
      return { size: stat.size, contentType: null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async read(key: string, range?: ObjectRange): Promise<Readable> {
    const stream = fs.createReadStream(this.resolvePath(key), range);
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
    return stream;
  }

  async downloadToFile(key: string, filePath: string, maxBytes: number): Promise<number> {
    const counter = new ByteCounter(maxBytes);
    await pipeline(fs.createReadStream(this.resolvePath(key)), counter, fs.createWriteStream(filePath));
    return counter.bytes;
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) await fsp.rm(this.resolvePath(key), { force: true });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    this.resolvePath(key);
    const uploadId = randomBytes(16).toString("hex");
    const dir = this.uploadDir(uploadId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "upload.json"), JSON.stringify({ key, contentType, createdAt: new Date().toISOString() }));
    return uploadId;
  }

  async presignPart({ mediaId, partNumber, byteLength, expiresInSeconds }: PartUrlRequest): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = localPartSignature(mediaId, partNumber, byteLength, expires);
    return `/api/v1/media/uploads/${mediaId}/parts/${partNumber}?length=${byteLength}&expires=${expires}&signature=${signature}`;
  }

  /** Receives one part for a signed local part URL. Exactly `byteLength` bytes or nothing is kept. */
  async writePart(uploadId: string, partNumber: number, body: Readable, byteLength: number): Promise<string> {
    const dir = this.uploadDir(uploadId);
    if (!fs.existsSync(path.join(dir, "upload.json"))) throw new Error("NoSuchUpload");
    const temp = path.join(dir, `${partNumber}.${randomBytes(6).toString("hex")}.tmp`);
    const counter = new ByteCounter(byteLength);
    try {
      await pipeline(body, counter, fs.createWriteStream(temp));
      if (counter.bytes !== byteLength) throw new ObjectTooLargeError("Part length mismatch.");
      const etag = `"${counter.md5Hex()}"`;
      await fsp.writeFile(path.join(dir, `${partNumber}.etag`), JSON.stringify({ etag, size: counter.bytes }));
      await fsp.rename(temp, path.join(dir, `${partNumber}.part`));
      return etag;
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }

  async listParts(_key: string, uploadId: string): Promise<UploadedPart[]> {
    const dir = this.uploadDir(uploadId);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("NoSuchUpload");
      throw error;
    }
    const parts: UploadedPart[] = [];
    for (const name of names) {
      const match = /^(\d{1,5})\.part$/.exec(name);
      if (!match) continue;
      const partNumber = Number(match[1]);
      const meta = JSON.parse(await fsp.readFile(path.join(dir, `${partNumber}.etag`), "utf8")) as { etag: string; size: number };
      parts.push({ partNumber, etag: meta.etag, size: meta.size });
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    const dir = this.uploadDir(uploadId);
    const stored = new Map((await this.listParts(key, uploadId)).map((p) => [p.partNumber, p]));
    const temp = await this.tempPath();
    try {
      const out = fs.createWriteStream(temp);
      for (const part of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
        if (stored.get(part.partNumber)?.etag !== part.etag) throw new Error("InvalidPart");
        await pipeline(fs.createReadStream(path.join(dir, `${part.partNumber}.part`)), out, { end: false });
      }
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
      await this.commit(key, temp);
      await fsp.rm(dir, { recursive: true, force: true });
    } catch (error) {
      await fsp.rm(temp, { force: true });
      throw error;
    }
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    await fsp.rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  /** Removes scratch files older than `maxAgeMs` (crashed uploads, interrupted writes). */
  async sweepScratch(maxAgeMs: number): Promise<number> {
    let removed = 0;
    for (const sub of [".tmp", ".multipart"]) {
      const dir = path.join(this.rootDir, sub);
      let names: string[] = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const full = path.join(dir, name);
        const stat = await fsp.stat(full).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > maxAgeMs) {
          await fsp.rm(full, { recursive: true, force: true });
          removed++;
        }
      }
    }
    return removed;
  }
}
