/**
 * Turns an uploaded original into what people actually see.
 *
 * Every variant is re-encoded from decoded pixels, so EXIF/GPS, XMP, maker notes,
 * ICC quirks and container tags (including QuickTime location atoms) never leave
 * the original. Hardening for untrusted input:
 *  - libvips may only run its JPEG, PNG and WebP loaders (no SVG/PDF/TIFF/HEIF...);
 *  - videos must be ISO-BMFF (MP4/MOV) by magic bytes, and ffmpeg/ffprobe open them
 *    with the mov demuxer only and the file protocol only, so a disguised playlist
 *    or concat script cannot make ffmpeg fetch URLs or read other local files;
 *  - pixel, duration and dimension limits are enforced before any heavy work;
 *  - every external process has a hard timeout.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { Metadata, Sharp } from "sharp";

sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({
  operation: [
    "VipsForeignLoadJpegFile", "VipsForeignLoadJpegBuffer",
    "VipsForeignLoadPngFile", "VipsForeignLoadPngBuffer",
    "VipsForeignLoadSpngFile", "VipsForeignLoadSpngBuffer",
    "VipsForeignLoadWebpFile", "VipsForeignLoadWebpBuffer",
  ],
});

export type VariantName = "display" | "thumbnail" | "poster" | "video_720" | "video_480";

export interface ProducedVariant {
  name: VariantName;
  file: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  bitrate?: number | undefined;
}

export interface ProcessedMedia {
  width: number;
  height: number;
  durationMs: number | null;
  checksumSha256: string;
  variants: ProducedVariant[];
}

export interface VideoTools {
  ffmpeg: string;
  ffprobe: string;
  maxSeconds: number;
  /** Absolute deadline (epoch ms) for all processes of this job. */
  deadline: number;
}

/** The file itself is unacceptable; retrying cannot help. `userMessage` is shown to the uploader. */
export class MediaRejectedError extends Error {
  constructor(readonly userMessage: string, detail?: string) {
    super(detail ? `${userMessage} (${detail})` : userMessage);
    this.name = "MediaRejectedError";
  }
}

export const PHOTO_MIME_TYPES: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];

const MAX_PHOTO_PIXELS = 100_000_000;
const MAX_VIDEO_EDGE = 4096;
const DISPLAY_BOX = { width: 1080, height: 1920 };
const THUMB_BOX = { width: 360, height: 640 };
const SHARP_INPUT = { failOn: "error" as const, limitInputPixels: MAX_PHOTO_PIXELS, sequentialRead: true };

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function jpegVariant(source: Sharp, box: { width: number; height: number }, quality: number, file: string, name: VariantName): Promise<ProducedVariant> {
  const info = await source
    .resize({ width: box.width, height: box.height, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(file);
  return { name, file, fileName: path.basename(file), mimeType: "image/jpeg", width: info.width, height: info.height, byteSize: info.size };
}

export async function processPhoto(input: string, workDir: string, declaredMime: string): Promise<ProcessedMedia> {
  let meta: Metadata;
  try {
    meta = await sharp(input, SHARP_INPUT).metadata();
  } catch (error) {
    const head = await readHead(input, 16);
    if (head.subarray(4, 12).toString("latin1").match(/^ftyp(heic|heix|hevc|mif1|msf1)/)) {
      throw new MediaRejectedError("HEIC photos aren't supported yet. Choose a JPEG, or set your camera to Most Compatible.");
    }
    throw new MediaRejectedError("We couldn't read this photo. Try a JPEG or PNG.", (error as Error).message);
  }
  const mimeType = meta.format ? PHOTO_MIME_TYPES[meta.format] : undefined;
  if (!mimeType) throw new MediaRejectedError("Only JPEG, PNG and WebP photos are supported.");
  if (mimeType !== declaredMime) throw new MediaRejectedError("This file isn't the type it claims to be.");
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!width || !height) throw new MediaRejectedError("We couldn't read this photo. Try a JPEG or PNG.");

  // rotate() applies the EXIF orientation; output is sRGB with all metadata removed.
  const base = () => sharp(input, SHARP_INPUT).rotate().flatten({ background: "#000000" });
  try {
    const display = await jpegVariant(base(), DISPLAY_BOX, 82, path.join(workDir, "display.jpg"), "display");
    const thumbnail = await jpegVariant(base(), THUMB_BOX, 72, path.join(workDir, "thumb.jpg"), "thumbnail");
    return { width, height, durationMs: null, checksumSha256: await sha256File(input), variants: [display, thumbnail] };
  } catch (error) {
    if (error instanceof MediaRejectedError) throw error;
    // A decode failure part-way through the pixels (truncated/corrupt data) is the file's fault.
    throw new MediaRejectedError("This photo is damaged and couldn't be processed.", (error as Error).message);
  }
}

class ProcessFailure extends Error {
  constructor(message: string, readonly killed: boolean, readonly stderr: string) {
    super(message);
  }
}

function run(command: string, args: string[], deadline: number): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) return Promise.reject(new ProcessFailure(`${command} not started: job deadline passed`, true, ""));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 4 * 1024 * 1024) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(new ProcessFailure(`${command}: ${error.message}`, true, stderr)); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ProcessFailure(`${path.basename(command)} ${timedOut ? "timed out" : signal ? `killed by ${signal}` : `exited ${code}`}`, timedOut || signal !== null, stderr));
    });
  });
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  color_transfer?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}
interface Probe { format?: { format_name?: string; duration?: string; bit_rate?: string }; streams?: ProbeStream[] }

/** Only the mov/mp4 demuxer, only local files: no playlists, no network, no data references. */
const SAFE_INPUT = ["-protocol_whitelist", "file", "-f", "mov"];

async function probe(file: string, tools: VideoTools): Promise<Probe> {
  const { stdout } = await run(tools.ffprobe, ["-v", "error", ...SAFE_INPUT, "-print_format", "json", "-show_format", "-show_streams", file], tools.deadline);
  return JSON.parse(stdout) as Probe;
}

function rotationOf(stream: ProbeStream): number {
  const raw = stream.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? Number(stream.tags?.rotate ?? 0);
  return (((Math.round(raw) % 360) + 360) % 360);
}

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/** Fits (w, h) inside a box whose short and long edges are capped, never enlarging. */
export function fitInside(width: number, height: number, shortMax: number, longMax: number): { width: number; height: number } {
  const scale = Math.min(1, shortMax / Math.min(width, height), longMax / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

function videoFilter(size: { width: number; height: number }, hdrTransfer: string | null): string {
  const scale = `scale=${size.width}:${size.height}:flags=lanczos`;
  if (!hdrTransfer) return `${scale},format=yuv420p`;
  // HLG/PQ (e.g. iPhone HDR) tone-mapped to SDR BT.709, otherwise it looks washed out.
  return `${scale},zscale=tin=${hdrTransfer}:min=2020_ncl:pin=2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,` +
    `tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`;
}

const RENDITIONS = [
  { name: "video_720" as const, shortMax: 720, longMax: 1280, crf: 23, maxrateK: 2500, audioK: 128 },
  { name: "video_480" as const, shortMax: 480, longMax: 854, crf: 26, maxrateK: 1200, audioK: 96 },
];

export async function processVideo(input: string, workDir: string, declaredMime: string, tools: VideoTools): Promise<ProcessedMedia> {
  if (!VIDEO_MIME_TYPES.includes(declaredMime)) throw new MediaRejectedError("Only MP4 and MOV videos are supported.");
  const head = await readHead(input, 12);
  if (head.length < 12 || head.subarray(4, 8).toString("latin1") !== "ftyp") {
    throw new MediaRejectedError("Only MP4 and MOV videos are supported.");
  }
  let info: Probe;
  try {
    info = await probe(input, tools);
  } catch (error) {
    if (error instanceof ProcessFailure && error.killed) throw error;
    throw new MediaRejectedError("We couldn't read this video. Try an MP4 or MOV file.", error instanceof ProcessFailure ? error.stderr.trim().slice(-300) : String(error));
  }
  const video = info.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video?.width || !video.height) throw new MediaRejectedError("This file doesn't contain a playable video.");
  const seconds = Number(info.format?.duration ?? video.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new MediaRejectedError("We couldn't read this video's length.");
  if (seconds > tools.maxSeconds + 0.5) throw new MediaRejectedError(`Videos can be up to ${tools.maxSeconds} seconds. Trim it and try again.`);
  const rotated = rotationOf(video) % 180 === 90;
  const width = rotated ? video.height : video.width;
  const height = rotated ? video.width : video.height;
  if (Math.max(width, height) > MAX_VIDEO_EDGE) throw new MediaRejectedError("Videos larger than 4K aren't supported.");
  const hdrTransfer = video.color_transfer === "arib-std-b67" || video.color_transfer === "smpte2084" ? video.color_transfer : null;
  const hasAudio = (info.streams ?? []).some((s) => s.codec_type === "audio");

  const variants: ProducedVariant[] = [];
  // ffmpeg applies the rotation itself (autorotate), so filters work in oriented dimensions.
  const encode = async (args: (filter: string) => string[], size: { width: number; height: number }) => {
    try {
      await run(tools.ffmpeg, args(videoFilter(size, hdrTransfer)), tools.deadline);
    } catch (error) {
      if (!(error instanceof ProcessFailure) || error.killed) throw error;
      if (hdrTransfer) {
        try {
          await run(tools.ffmpeg, args(videoFilter(size, null)), tools.deadline);
          return;
        } catch (fallback) {
          if (!(fallback instanceof ProcessFailure) || fallback.killed) throw fallback;
        }
      }
      throw new MediaRejectedError("This video is damaged or uses a format we can't convert.", error.stderr.trim().slice(-300));
    }
  };

  const posterSize = fitInside(width, height, DISPLAY_BOX.width, DISPLAY_BOX.height);
  const posterFile = path.join(workDir, "poster.jpg");
  await encode((filter) => ["-hide_banner", "-nostdin", "-y", ...SAFE_INPUT, "-i", input, "-map", "0:v:0", "-frames:v", "1",
    "-vf", filter, "-map_metadata", "-1", "-q:v", "3", posterFile], posterSize);
  const posterStat = await fsp.stat(posterFile);
  variants.push({ name: "poster", file: posterFile, fileName: "poster.jpg", mimeType: "image/jpeg", ...posterSize, byteSize: posterStat.size });
  variants.push(await jpegVariant(sharp(posterFile, SHARP_INPUT), THUMB_BOX, 72, path.join(workDir, "thumb.jpg"), "thumbnail"));

  for (const target of RENDITIONS) {
    // Sources that are already small get one rendition at (at most) their own size.
    if (target.name === "video_480" && Math.min(width, height) <= 540) continue;
    const size = fitInside(width, height, target.shortMax, target.longMax);
    const file = path.join(workDir, `${target.name}.mp4`);
    await encode((filter) => [
      "-hide_banner", "-nostdin", "-y", ...SAFE_INPUT, "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn",
      "-vf", filter, "-fpsmax", "30",
      "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-crf", String(target.crf),
      "-maxrate", `${target.maxrateK}k`, "-bufsize", `${target.maxrateK * 2}k`, "-g", "60",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", `${target.audioK}k`, "-ac", "2"] : []),
      "-movflags", "+faststart", "-t", String(tools.maxSeconds + 0.5), "-f", "mp4", file,
    ], size);
    const out = await probe(file, tools);
    const stat = await fsp.stat(file);
    const stream = out.streams?.find((s) => s.codec_type === "video");
    variants.push({
      name: target.name, file, fileName: `${target.name}.mp4`, mimeType: "video/mp4",
      width: stream?.width ?? size.width, height: stream?.height ?? size.height, byteSize: stat.size,
      bitrate: Number(out.format?.bit_rate) || undefined,
    });
  }

  return { width, height, durationMs: Math.round(seconds * 1000), checksumSha256: await sha256File(input), variants };
}

export { ProcessFailure };
