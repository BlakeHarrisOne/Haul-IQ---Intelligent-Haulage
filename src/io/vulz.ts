/**
 * Maptek Vulcan "vulZ" container reader (compressed .00t), ported from the team's Rain Model (RMVulZ).
 *
 * Container fields are little-endian; the expanded image is the raw big-endian .00t (see vulcan00t.ts).
 *   0x00  magic EA FB A7 8A 76 75 6C 5A ("….vulZ")
 *   0x14  u32 page size (1 KiB … 4 MiB)
 *   0x20  u64 expanded length (lo u32 @0x20, hi u32 @0x24)
 *   0x3C  root of the pointer tree (8-byte records (first, second), little-endian u32 pairs):
 *         second == 0 → pointer block of up to 256 (target, 0) entries; second != 0 → page header
 *         (stored length, advance) followed by a FastLZ level-1/2 stream and a trailer whose first word is
 *         the page's logical number (0xFDFCFBFA = end marker, no number).
 * Live pages are those the tree names (never scan for orphans). Flat / older files name only the first page
 * of each back-to-back run; those runs are followed (page header at off + 8 + advance) without overwriting
 * tree-named pages. Every logical page must be covered, else the file is rejected.
 * Format research: https://github.com/brentbuffham/vulcan-00t-tri (00T_FORMAT.md).
 */

const MAGIC = [0xea, 0xfb, 0xa7, 0x8a, 0x76, 0x75, 0x6c, 0x5a];
const MAX_IMAGE = 1024 * 1024 * 1024;
const MAX_PAGE = 4 * 1024 * 1024;
const ROOT = 60;
const END_MARKER = 0xfdfcfbfa;

function fail(reason: string): never {
  throw new Error(`Cannot read this compressed Vulcan .00t (${reason})`);
}

/** True when the buffer starts with the vulZ magic bytes. */
export function isVulZ(buf: ArrayBuffer): boolean {
  if (!buf || buf.byteLength < 8) return false;
  const b = new Uint8Array(buf, 0, 8);
  for (let i = 0; i < 8; i++) if (b[i] !== MAGIC[i]) return false;
  return true;
}

/** Container header summary (validated, nothing decoded). */
export interface VulZInfo { pageSize: number; length: number; pages: number }

/** Reads and validates the vulZ header. @throws on a malformed header */
export function inspectVulZ(buf: ArrayBuffer): VulZInfo {
  if (!isVulZ(buf)) fail('unrecognized container');
  if (buf.byteLength < 68) fail('the header is cut short');
  const d = new DataView(buf);
  const pageSize = d.getUint32(20, true);
  const length = d.getUint32(32, true) + d.getUint32(36, true) * 4294967296;
  if (pageSize < 1024 || pageSize > MAX_PAGE) fail('unsupported page size');
  if (!Number.isSafeInteger(length) || length < 120) fail('invalid expanded length');
  if (length > MAX_IMAGE) fail('expanded surface exceeds the 1 GiB import limit');
  return { pageSize, length, pages: Math.ceil(length / pageSize) };
}

/**
 * Decodes one FastLZ (level 1 or 2) block into `output`; returns the number of bytes written.
 * Every input and output range is checked before it is touched; back-references copy byte by byte
 * (overlapping copies are the run-length trick).
 */
export function expandFastLZ(input: Uint8Array, output: Uint8Array): number {
  if (!input.length) fail('empty compressed page');
  const level = (input[0] >> 5) + 1;
  if (level !== 1 && level !== 2) fail('unsupported compression level');
  let ip = 1, op = 0, control = input[0] & 31;
  const byte = () => { if (ip >= input.length) fail('compressed page is cut short'); return input[ip++]; };
  for (;;) {
    if (control < 32) {
      const literal = control + 1;
      if (ip + literal > input.length) fail('literal is cut short');
      if (op + literal > output.length) fail('page expands beyond its declared size');
      output.set(input.subarray(ip, ip + literal), op);
      ip += literal; op += literal;
    } else {
      let count = control >> 5, distance = (control & 31) << 8, code: number;
      if (count === 7) { do { code = byte(); count += code; } while (level === 2 && code === 255); }
      code = byte();
      distance += code;
      if (level === 2 && code === 255 && (control & 31) === 31) distance = (byte() << 8) + byte() + 8191;
      count += 2;
      let from = op - distance - 1;
      if (from < 0) fail('invalid compressed back-reference');
      if (op + count > output.length) fail('page expands beyond its declared size');
      for (let n = 0; n < count; n++) output[op++] = output[from++];
    }
    if (ip === input.length) return op;
    control = byte();
  }
}

/** Result of `decodeVulZ`. */
export interface VulZDecoded { buffer: ArrayBuffer; pages: number; expandedBytes: number }

interface PageRef { next: number; slot: number }

/** Expands a vulZ container into the raw .00t image. @throws "Cannot read this compressed Vulcan .00t (…)" */
export function decodeVulZ(buf: ArrayBuffer): VulZDecoded {
  const info = inspectVulZ(buf);
  const dv = new DataView(buf), bytes = new Uint8Array(buf);
  const stack: Array<{ off: number; depth: number }> = [{ off: ROOT, depth: 0 }];
  const seen = new Set<number>(), named: number[] = [];
  // the tree defines live pages; never select an orphan by scanning for page-like bytes
  while (stack.length) {
    const { off, depth } = stack.pop()!;
    if (depth > 64) fail('pointer tree is too deep');
    if (off < ROOT || off > bytes.length - 8) fail('page pointer is outside the file');
    if (seen.has(off)) fail('repeated or cyclic page pointer');
    seen.add(off);
    if (seen.size > info.pages * 4 + 1024) fail('too many page pointers');
    const second = dv.getUint32(off + 4, true);
    if (second !== 0) { named.push(off); continue; }
    const targets: number[] = [];
    for (let i = 0; i < 256; i++) {
      const at = off + i * 8;
      if (at > bytes.length - 8) fail('pointer table is cut short');
      const target = dv.getUint32(at, true), tail = dv.getUint32(at + 4, true);
      if (!target || tail !== 0) break;
      targets.push(target);
    }
    if (!targets.length) fail('empty page pointer table');
    for (let k = targets.length - 1; k >= 0; k--) stack.push({ off: targets[k], depth: depth + 1 });
  }
  if (!named.length || named.length > info.pages) fail('invalid number of live pages');
  const image = new Uint8Array(info.length), scratch = new Uint8Array(info.pageSize);
  const covered = new Uint8Array(info.pages), owners = new Map<number, number>(), decoded = new Set<number>();
  const namedSet = new Set(named);
  let countPages = 0;
  // canonical trailers number every page; older files can omit the number (all zero)
  const numbered = named.some(off => {
    const size = dv.getUint32(off, true), advance = dv.getUint32(off + 4, true), at = off + 8 + size;
    if (advance < size + 4 || at > bytes.length - 4) return false;
    const number = dv.getUint32(at, true);
    return number > 0 && number < info.pages;
  });
  const page = (off: number, fallbackSlot: number, authoritative: boolean): PageRef | null => {
    if (off < ROOT || off > bytes.length - 8) { if (authoritative) fail('page header is cut short'); return null; }
    const stored = dv.getUint32(off, true), advance = dv.getUint32(off + 4, true);
    if (!stored || stored > MAX_PAGE || advance < stored || advance > stored + 16384 || off + 8 + stored > bytes.length) {
      if (authoritative) fail('invalid or truncated page');
      return null;
    }
    const trailerAt = off + 8 + stored;
    let number: number | null = null;
    if (advance >= stored + 4 && trailerAt + 4 <= bytes.length) {
      number = dv.getUint32(trailerAt, true);
      if (number === END_MARKER) number = null;
    }
    const slot = number == null || (number === 0 && !numbered) ? fallbackSlot : number;
    if (slot >= info.pages) { if (authoritative) fail('page number is outside the surface'); return null; }
    if (authoritative && owners.has(slot) && owners.get(slot) !== off) fail('conflicting live page numbers');
    if (authoritative) owners.set(slot, off);
    if (!decoded.has(off) && (authoritative || !covered[slot])) {
      const size = expandFastLZ(bytes.subarray(off + 8, off + 8 + stored), scratch);
      const required = Math.min(info.pageSize, info.length - slot * info.pageSize);
      if (size !== info.pageSize && size !== required) fail('expanded page has the wrong length');
      image.set(scratch.subarray(0, required), slot * info.pageSize);
      if (!covered[slot]) { covered[slot] = 1; countPages++; }
      decoded.add(off);
    }
    return { next: off + 8 + advance, slot };
  };
  // decode every tree-named page first, so back-to-back runs cannot overwrite them
  const starts: Array<PageRef | null> = named.map((off, p) => page(off, p, true));
  if (countPages < info.pages) {
    for (const start of starts) {
      let cur = start;
      const runSeen = new Set<number>();
      while (cur && countPages < info.pages && !namedSet.has(cur.next)) {
        if (runSeen.has(cur.next)) fail('cyclic page run');
        runSeen.add(cur.next);
        cur = page(cur.next, cur.slot + 1, false);
      }
    }
  }
  if (countPages !== info.pages) fail('missing compressed pages; copy or export the file again');
  return { buffer: image.buffer, pages: countPages, expandedBytes: info.length };
}
