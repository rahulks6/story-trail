import type { IncomingMessage, ServerResponse } from "node:http";
import type { ObjectRange, ObjectStore } from "./storage";

export interface StreamableObject {
  key: string;
  mimeType: string;
  size: number;
  etag: string;
}

/** Call only after checking media/Story/ad authorization, including every range request. */
export async function streamObject(req: IncomingMessage, res: ServerResponse, object: StreamableObject, store: ObjectStore): Promise<void> {
  const { size, etag } = object;
  const header = req.headers.range;
  let range: ObjectRange | undefined;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, no-store");
  if (header && (!req.headers["if-range"] || req.headers["if-range"] === etag)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] ? (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) : size - 1;
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start && !(m[1] === "" && Number(m[2]) === 0)) range = { start, end };
    }
    if (!range) {
      res.writeHead(416, { "Content-Range": `bytes */${size}`, "Content-Length": 0 });
      res.end();
      return;
    }
  }
  // Open the object before committing to a status, so a missing object is a clean error.
  const stream = await store.read(object.key, range);
  res.setHeader("Content-Type", object.mimeType);
  res.setHeader("Content-Length", range ? range.end - range.start + 1 : size);
  if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  res.statusCode = range ? 206 : 200;
  await new Promise<void>((resolve) => {
    const close = () => {
      stream.destroy();
      resolve();
    };
    res.once("close", close);
    res.once("finish", close);
    stream.once("error", () => {
      res.off("close", close);
      res.off("finish", close);
      res.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}
