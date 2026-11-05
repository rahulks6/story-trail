/**
 * A minimal ZIP writer: entries are stored, not compressed (photos and videos already are, and
 * the JSON is small), written straight to a file so a large archive never sits in memory.
 * Plain ZIP (no ZIP64), so the whole archive stays under 4 GiB; callers keep to MAX_ZIP_BYTES.
 */
import { createReadStream, promises as fsp } from "node:fs";
import { crc32 } from "node:zlib";

export const MAX_ZIP_BYTES = 3.5 * 1024 ** 3;

interface Entry { name: Buffer; crc: number; size: number; offset: number }

// Entry times are when the archive was made (UTC), as ZIP stores them.
function dosTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private offset = 0;
  private readonly stamp = dosTime(new Date());
  private constructor(private readonly handle: fsp.FileHandle) {}

  static async create(file: string): Promise<ZipWriter> {
    return new ZipWriter(await fsp.open(file, "w"));
  }

  /** Bytes written so far (the archive's size before the directory). */
  get size(): number {
    return this.offset;
  }

  private async write(buffer: Buffer): Promise<void> {
    await this.handle.write(buffer, 0, buffer.length, this.offset);
    this.offset += buffer.length;
  }

  private header(name: Buffer, crc: number, size: number): Buffer {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4); // version needed
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(0, 8); // stored
    h.writeUInt16LE(this.stamp.time, 10);
    h.writeUInt16LE(this.stamp.day, 12);
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(size, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    return Buffer.concat([h, name]);
  }

  private static safeName(name: string): Buffer {
    if (!/^[A-Za-z0-9_\-./ ]+$/.test(name) || name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Unsafe ZIP entry name: ${name}`);
    return Buffer.from(name, "utf8");
  }

  async addBuffer(name: string, data: Buffer): Promise<void> {
    const n = ZipWriter.safeName(name);
    const entry = { name: n, crc: crc32(data), size: data.length, offset: this.offset };
    await this.write(this.header(n, entry.crc, entry.size));
    await this.write(data);
    this.entries.push(entry);
  }

  /** A file on disk, streamed through (its checksum computed on the way). */
  async addFile(name: string, file: string): Promise<void> {
    const n = ZipWriter.safeName(name);
    const { size } = await fsp.stat(file);
    const start = this.offset;
    await this.write(this.header(n, 0, size)); // checksum patched in below
    let crc = 0;
    for await (const chunk of createReadStream(file)) {
      crc = crc32(chunk as Buffer, crc);
      await this.write(chunk as Buffer);
    }
    const fixed = Buffer.alloc(4);
    fixed.writeUInt32LE(crc >>> 0, 0);
    await this.handle.write(fixed, 0, 4, start + 14);
    this.entries.push({ name: n, crc, size, offset: start });
  }

  async close(): Promise<number> {
    const directoryStart = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(0, 10);
      c.writeUInt16LE(this.stamp.time, 12);
      c.writeUInt16LE(this.stamp.day, 14);
      c.writeUInt32LE(e.crc >>> 0, 16);
      c.writeUInt32LE(e.size, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([c, e.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - directoryStart, 12);
    end.writeUInt32LE(directoryStart, 16);
    await this.write(end);
    await this.handle.close();
    return this.offset;
  }
}
