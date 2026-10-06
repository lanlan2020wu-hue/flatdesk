import { crc32 } from "node:zlib";

// A minimal zip writer for the full export: files are stored uncompressed and
// written one at a time, so an archive of any number of attachments streams
// without holding them all in memory. No zip64, so it stops at 65,535 files
// and 4 GB, which the export route checks before it starts.

export const ZIP_LIMITS = { files: 65_000, bytes: 4_000_000_000 };

type Entry = { name: Buffer; crc: number; size: number; offset: number };

// DOS date/time for the headers, in UTC.
function dosTime(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private readonly stamp = dosTime(new Date());

  // Returns the bytes for one file: its local header followed by its data.
  file(path: string, data: Buffer | string): Buffer[] {
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const name = Buffer.from(path, "utf8");
    const crc = crc32(body);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // names are UTF-8
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt16LE(this.stamp.time, 10);
    head.writeUInt16LE(this.stamp.date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(body.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    this.entries.push({ name, crc, size: body.length, offset: this.offset });
    this.offset += head.length + name.length + body.length;
    return [head, name, body];
  }

  // The central directory and end record, after the last file.
  finish(): Buffer {
    const parts: Buffer[] = [];
    let size = 0;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // made by
      h.writeUInt16LE(20, 6); // version needed
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      parts.push(h, e.name);
      size += h.length + e.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(this.offset, 16);
    return Buffer.concat([...parts, end]);
  }
}

// Keeps a file name safe inside the archive: no folders, no control characters.
export function safeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_").replace(/^\.+/, "_").trim();
  return clean.slice(0, 150) || "file";
}
