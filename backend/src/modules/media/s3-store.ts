/**
 * Amazon S3 object store (production; ap-south-1). Clients upload directly to S3
 * with SigV4 presigned UploadPart URLs that sign the exact Content-Length, so a
 * URL cannot be reused for a larger body. The bucket is private (Block Public
 * Access on, default encryption on); people only ever read through CloudFront
 * signed URLs (delivery.ts), and CloudFront reads the bucket with origin access
 * control. Credentials come from the task role, never from this repository.
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ByteCounter, type ObjectInfo, type ObjectRange, type ObjectStore, type PartUrlRequest, type UploadedPart } from "./storage";

export interface S3StoreOptions {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  forcePathStyle?: boolean | undefined;
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export class S3ObjectStore implements ObjectStore {
  readonly kind = "s3" as const;
  readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StoreOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? false,
      // Presigned part URLs must not carry SDK-computed checksums of an empty body.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async putFile(key: string, filePath: string, contentType: string, cacheControl?: string): Promise<void> {
    const { size } = await fsp.stat(filePath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }));
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(out.ContentLength ?? 0), contentType: out.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async read(key: string, range?: ObjectRange): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    }));
    return out.Body as Readable;
  }

  async downloadToFile(key: string, filePath: string, maxBytes: number): Promise<number> {
    const head = await this.head(key);
    if (!head) throw new Error(`Object ${key} not found.`);
    if (head.size > maxBytes) throw new Error(`Object ${key} is larger than allowed.`);
    const counter = new ByteCounter(maxBytes);
    await pipeline(await this.read(key), counter, fs.createWriteStream(filePath));
    return counter.bytes;
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const out = await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
      const failed = (out.Errors ?? []).filter((e) => e.Code !== "NoSuchKey");
      if (failed.length) throw new Error(`S3 delete failed for ${failed.length} object(s): ${failed[0]?.Code}`);
    }
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const out = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!out.UploadId) throw new Error("S3 did not return an upload id.");
    return out.UploadId;
  }

  presignPart({ key, uploadId, partNumber, byteLength, expiresInSeconds }: PartUrlRequest): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: byteLength }),
      { expiresIn: expiresInSeconds, signableHeaders: new Set(["content-length"]) },
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    for (;;) {
      const out = await this.client.send(new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MaxParts: 1000, PartNumberMarker: marker }));
      for (const p of out.Parts ?? []) {
        if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: Number(p.Size ?? 0) });
      }
      if (!out.IsTruncated) break;
      marker = out.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }));
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    } catch (error) {
      const e = error as { name?: string };
      if (e?.name !== "NoSuchUpload" && !isNotFound(error)) throw error;
    }
  }
}
