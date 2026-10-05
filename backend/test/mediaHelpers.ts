/**
 * Real media and real servers for the media pipeline tests: images are encoded by
 * sharp/libvips, videos by ffmpeg, S3 is Versity's S3 gateway (verifies SigV4 like
 * AWS) and SQS is goaws. See scripts/install-media-test-servers.sh.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import sharp from "sharp";
import { authHeader } from "./helpers";

export const VERSITYGW_BIN = process.env.VERSITYGW_BIN ?? "/opt/s3test/versitygw";
export const GOAWS_BIN = process.env.GOAWS_BIN ?? "/opt/s3test/goaws";

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A JPEG carrying camera EXIF, GPS coordinates and the given EXIF orientation. */
export async function jpegWithGps(width: number, height: number, orientation = 1): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation })
    .withExif({
      IFD0: { Make: "KatkeeTestCam", Model: "Leaky 1", Copyright: "private" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 17/1", GPSLongitudeRef: "E", GPSLongitude: "77/1 35/1 40/1" },
    })
    .toBuffer();
}

export interface VideoSpec {
  width?: number;
  height?: number;
  seconds?: number;
  /** Display-matrix rotation, as phones record portrait video. */
  rotation?: 0 | 90 | 180 | 270;
  /** QuickTime location tag (what iPhones write). */
  location?: string;
  hdr?: boolean;
  audio?: boolean;
  /** Target video bitrate, e.g. "20M", to make large files for multipart tests. */
  bitrate?: string;
  container?: "mp4" | "mov";
}

/** Encodes a real test video with ffmpeg and returns its bytes. */
export function makeVideo(spec: VideoSpec = {}): Buffer {
  const dir = tempDir("katkee-test-video-");
  const { width = 320, height = 180, seconds = 1, rotation = 0, audio = true, container = "mp4" } = spec;
  const encoded = path.join(dir, `encoded.${container}`);
  const args = ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=30`,
    ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"] : []),
    "-t", String(seconds),
    "-c:v", "libx264", "-preset", "ultrafast",
    ...(spec.bitrate ? ["-b:v", spec.bitrate, "-maxrate", spec.bitrate, "-bufsize", spec.bitrate, "-x264-params", "nal-hrd=cbr"] : []),
    ...(spec.hdr ? ["-pix_fmt", "yuv420p10le", "-color_trc", "arib-std-b67", "-color_primaries", "bt2020", "-colorspace", "bt2020nc"] : ["-pix_fmt", "yuv420p"]),
    ...(audio ? ["-c:a", "aac"] : []),
    ...(spec.location ? ["-metadata", `location=${spec.location}`] : []),
    encoded];
  execFileSync("ffmpeg", args);
  let output = encoded;
  if (rotation) {
    output = path.join(dir, `rotated.${container}`);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-display_rotation", String(rotation), "-i", encoded, "-c", "copy", output]);
  }
  const bytes = fs.readFileSync(output);
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes;
}

/** Container/stream tags of a media file, via ffprobe. */
export function probe(bytes: Buffer): { format: { tags?: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number; color_transfer?: string; side_data_list?: { rotation?: number }[] }[] } {
  const dir = tempDir("katkee-test-probe-");
  const file = path.join(dir, "media");
  fs.writeFileSync(file, bytes);
  try {
    return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]).toString());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface UploadPlanPart { partNumber: number; byteLength: number; uploaded: boolean; url: string | null }
export interface CreatedUpload { status: number; body: any }

export async function createUploadSession(baseUrl: string, token: string, input: Record<string, unknown>): Promise<CreatedUpload> {
  const res = await fetch(`${baseUrl}/api/v1/media/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    body: JSON.stringify(input),
  });
  return { status: res.status, body: await res.json() };
}

/** PUTs one part exactly as the app does: relative URLs are this API, absolute ones go straight to storage. */
export async function putPart(baseUrl: string, part: UploadPlanPart, bytes: Buffer, partSize: number): Promise<Response> {
  const start = (part.partNumber - 1) * partSize;
  const body = bytes.subarray(start, start + part.byteLength);
  const url = part.url!.startsWith("/") ? `${baseUrl}${part.url}` : part.url!;
  return fetch(url, { method: "PUT", body });
}

export async function completeUpload(baseUrl: string, token: string, mediaId: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/v1/media/uploads/${mediaId}/complete`, { method: "POST", headers: authHeader(token) });
  return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
}

let uploadCounter = 0;
export function clientUploadId(): string {
  uploadCounter++;
  return `test_${Date.now().toString(36)}_${process.pid}_${uploadCounter}_${Math.random().toString(36).slice(2, 10)}`;
}

/** The whole direct-upload flow: session, every part, complete. Returns the media (status 'processing'). */
export async function uploadDirect(baseUrl: string, token: string, bytes: Buffer, kind: "photo" | "video", mimeType: string): Promise<any> {
  const created = await createUploadSession(baseUrl, token, { clientUploadId: clientUploadId(), kind, mimeType, byteSize: bytes.length });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
  for (const part of created.body.upload.parts as UploadPlanPart[]) {
    const res = await putPart(baseUrl, part, bytes, created.body.upload.partSize);
    if (!res.ok) throw new Error(`part ${part.partNumber} failed: ${res.status} ${await res.text()}`);
  }
  const done = await completeUpload(baseUrl, token, created.body.media.id);
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.body)}`);
  return done.body.media;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, child: ChildProcess, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`test server exited with ${child.exitCode}`);
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => { socket.end(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("test server did not start");
}

export interface RunningServer { url: string; port: number; dir: string; stop(): Promise<void> }

function stopper(child: ChildProcess, dir: string) {
  return async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

/** Versity S3 gateway with a POSIX backend; every bucket is a directory. */
export async function startS3(bucket: string, accessKey: string, secretKey: string): Promise<RunningServer> {
  const dir = tempDir("katkee-test-s3-");
  fs.mkdirSync(path.join(dir, bucket));
  const port = await freePort();
  const child = spawn(VERSITYGW_BIN, ["--access", accessKey, "--secret", secretKey, "--region", "ap-south-1", "--port", `127.0.0.1:${port}`, "posix", dir], { stdio: "ignore" });
  await waitForPort(port, child);
  return { url: `http://127.0.0.1:${port}`, port, dir, stop: stopper(child, dir) };
}

/** goaws SQS emulator with one queue. */
export async function startSqs(queue: string): Promise<RunningServer> {
  const dir = tempDir("katkee-test-sqs-");
  const port = await freePort();
  const configFile = path.join(dir, "goaws.yaml");
  fs.writeFileSync(configFile, [
    "Local:", "  Host: 127.0.0.1", `  Port: ${port}`, "  Region: ap-south-1", '  AccountId: "000000000000"', "  LogToFile: false",
    "  QueueAttributeDefaults:", "    VisibilityTimeout: 30", "    ReceiveMessageWaitTimeSeconds: 0",
    "  Queues:", `    - Name: ${queue}`, "",
  ].join("\n"));
  const child = spawn(GOAWS_BIN, ["-config", configFile, "Local"], { stdio: "ignore" });
  await waitForPort(port, child);
  return { url: `http://127.0.0.1:${port}`, port, dir, stop: stopper(child, dir) };
}
