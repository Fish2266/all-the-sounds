/* ============================================================================
   ZIP — a small writer and reader built on the platform's own deflate.

   Chrome, Safari 16.4+ and Firefox 113+ all ship CompressionStream with the
   'deflate-raw' format, which is exactly what a zip entry stores. That means no
   third-party zip library: we assemble the headers ourselves and let the
   browser do the compression. Where deflate-raw is missing we fall back to
   stored (method 0) entries, which every unzip tool — and Minecraft — accepts.
   ========================================================================= */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const CAN_DEFLATE = (() => {
  try { new CompressionStream('deflate-raw'); return true; } catch { return false; }
})();

/* ---- CRC32 -------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, seed = 0) {
  let c = (~seed) >>> 0;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (~c) >>> 0;
}

/* ---- deflate helpers ---------------------------------------------------- */
async function deflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---- DOS timestamp ------------------------------------------------------ */
function dosTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/* ========================================================================= */
/* WRITER                                                                    */
/* ========================================================================= */

export class ZipWriter {
  /**
   * @param {object} opts
   *   compress  – deflate when it actually helps (default true)
   *   comment   – archive comment string
   *   onProgress – (done, total, path) => void
   */
  constructor(opts = {}) {
    this.entries = [];
    this.compress = opts.compress !== false && CAN_DEFLATE;
    this.comment = opts.comment || '';
    this.onProgress = opts.onProgress || null;
    this._pending = [];
  }

  /** Queue a file. `content` may be a string, ArrayBuffer, TypedArray or Blob. */
  file(path, content, opts = {}) {
    this._pending.push({ path: normalizePath(path), content, store: !!opts.store, date: opts.date });
    return this;
  }

  /** Convenience for JSON with stable, readable formatting. */
  json(path, value, indent = 2) {
    return this.file(path, JSON.stringify(value, null, indent) + '\n');
  }

  /** Explicit directory entry — most tools infer these, but some editors like them. */
  folder(path) {
    const p = normalizePath(path).replace(/\/?$/, '/');
    this._pending.push({ path: p, content: new Uint8Array(0), store: true, dir: true });
    return this;
  }

  get size() { return this._pending.length; }
  has(path) { return this._pending.some(e => e.path === normalizePath(path)); }

  async #toBytes(content) {
    if (content == null) return new Uint8Array(0);
    if (typeof content === 'string') return enc.encode(content);
    if (content instanceof Uint8Array) return content;
    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    if (content instanceof Blob) return new Uint8Array(await content.arrayBuffer());
    return enc.encode(String(content));
  }

  /** Build the archive. Returns a Blob of type application/zip. */
  async blob() {
    const parts = [];
    const central = [];
    let offset = 0;
    const total = this._pending.length;
    let done = 0;

    for (const item of this._pending) {
      const raw = await this.#toBytes(item.content);
      const nameBytes = enc.encode(item.path);
      const crc = crc32(raw);
      const { time, date } = dosTime(item.date || new Date());

      let method = 0, payload = raw;
      if (!item.dir && !item.store && this.compress && raw.length > 96) {
        try {
          const d = await deflateRaw(raw);
          // Only keep the compressed form when it is genuinely smaller.
          if (d.length < raw.length - 8) { payload = d; method = 8; }
        } catch { /* keep stored */ }
      }

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, method === 8 ? 20 : 10, true);   // version needed
      lv.setUint16(6, 0x0800, true);                    // UTF-8 names
      lv.setUint16(8, method, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, payload.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      parts.push(local, payload);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 0x031E, true);                    // made by: unix, zip 3.0
      cv.setUint16(6, method === 8 ? 20 : 10, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, payload.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);                        // extra
      cv.setUint16(32, 0, true);                        // comment
      cv.setUint16(34, 0, true);                        // disk
      cv.setUint16(36, 0, true);                        // internal attrs
      cv.setUint32(38, item.dir ? 0x41ED0010 : 0x81A40000, true); // unix mode
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + payload.length;
      done++;
      this.onProgress?.(done, total, item.path);
      if (done % 8 === 0) await new Promise(r => setTimeout(r, 0)); // keep the UI alive
    }

    const cdBytes = central.reduce((n, c) => n + c.length, 0);
    const commentBytes = enc.encode(this.comment);
    const eocd = new Uint8Array(22 + commentBytes.length);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdBytes, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, commentBytes.length, true);
    eocd.set(commentBytes, 22);

    return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
  }

  /** Estimated uncompressed footprint, for the export preview. */
  async plan() {
    const rows = [];
    for (const item of this._pending) {
      const raw = await this.#toBytes(item.content);
      rows.push({ path: item.path, size: raw.length, dir: !!item.dir });
    }
    return rows;
  }
}

/* ========================================================================= */
/* READER                                                                    */
/* ========================================================================= */

/**
 * Read a zip into a Map of path -> Uint8Array.
 * Only stored and deflated entries are supported (which is all a pack uses).
 */
export async function unzip(input, opts = {}) {
  const bytes = input instanceof Uint8Array ? input
    : input instanceof ArrayBuffer ? new Uint8Array(input)
    : new Uint8Array(await input.arrayBuffer());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Find EOCD by scanning backwards (comment can be up to 64 KB).
  let eocd = -1;
  const scanFrom = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-archive record found).');

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const out = new Map();
  const { onProgress, filter } = opts;
  let lastTick = performance.now();

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method   = dv.getUint16(ptr + 10, true);
    const csize    = dv.getUint32(ptr + 20, true);
    const usize    = dv.getUint32(ptr + 24, true);
    const nameLen  = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const cmtLen   = dv.getUint16(ptr + 32, true);
    const local    = dv.getUint32(ptr + 42, true);
    const name     = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + cmtLen;

    if (name.endsWith('/')) continue;
    // A caller that only wants part of a large archive can skip the rest
    // before paying to decompress it.
    if (filter && !filter(name)) continue;

    const lNameLen  = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);

    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      try { data = await inflateRaw(raw); }
      catch (e) { throw new Error(`Could not decompress "${name}" — ${e.message}`); }
    } else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);

    if (usize && data.length !== usize) {
      console.warn(`[zip] size mismatch for ${name}: ${data.length} vs ${usize}`);
    }
    out.set(name, data);

    if (onProgress) {
      const now = performance.now();
      if (now - lastTick > 60) { lastTick = now; onProgress(n / count, name); await Promise.resolve(); }
    }
  }
  onProgress?.(1, '');
  return out;
}

export function textOf(bytes) { return bytes ? dec.decode(bytes) : ''; }
export function jsonOf(bytes) { try { return JSON.parse(textOf(bytes)); } catch { return null; } }

function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

/** Nest a flat list of paths into a tree for the export preview. */
export function pathsToTree(rows) {
  const root = { name: '', dir: true, children: new Map(), size: 0 };
  for (const r of rows) {
    const parts = r.path.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const key = parts[i];
      if (!node.children.has(key)) {
        node.children.set(key, { name: key, dir: !last, children: new Map(), size: 0 });
      }
      node = node.children.get(key);
      if (last) { node.dir = false; node.size = r.size; }
    }
  }
  const rollup = n => {
    if (!n.dir) return n.size;
    let s = 0;
    for (const c of n.children.values()) s += rollup(c);
    n.size = s; return s;
  };
  rollup(root);
  return root;
}
