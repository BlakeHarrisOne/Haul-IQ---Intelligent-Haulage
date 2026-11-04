/**
 * TEST HELPER (not shipped behaviour): a tiny FastLZ level-1 compressor and a vulZ container builder, so the
 * decoder can be round-trip tested on multi-page images, pointer-table nodes and back-to-back page runs.
 */

/** FastLZ level-1 block: greedy matches found with an exact 3-byte hash; literal runs of ≤ 32 bytes. */
export function fastlzCompress(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const n = input.length;
  const MAX_DIST = 8191, MAX_LEN = 264;
  const last = new Map<number, number>();
  const literals = (from: number, to: number) => {
    while (from < to) {
      const len = Math.min(32, to - from);
      out.push(len - 1);
      for (let k = 0; k < len; k++) out.push(input[from + k]);
      from += len;
    }
  };
  let ip = 0, anchor = 0;
  while (ip + 2 < n) {
    const key = input[ip] | (input[ip + 1] << 8) | (input[ip + 2] << 16);
    const ref = last.get(key);
    last.set(key, ip);
    if (ref !== undefined && ip > 0 && ip - ref - 1 <= MAX_DIST) {
      let len = 3;
      while (ip + len < n && len < MAX_LEN && input[ref + len] === input[ip + len]) len++;
      literals(anchor, ip);
      const dist = ip - ref - 1, m = len - 2;
      if (m < 7) out.push((m << 5) | (dist >> 8), dist & 255);
      else out.push((7 << 5) | (dist >> 8), m - 7, dist & 255);
      ip += len;
      anchor = ip;
    } else ip++;
  }
  literals(anchor, n);
  return Uint8Array.from(out);
}

export interface VulZBuildOptions {
  /** Logical page size (default 1024, the minimum the reader accepts). */
  pageSize?: number;
  /** 'flat': root names every page; 'tree': root → nodes of `perNode` pages; 'run': root names page 0 only. */
  layout?: 'flat' | 'tree' | 'run';
  perNode?: number;
  /** Write page numbers in the trailers (default true); false writes 0 (older files). */
  numbered?: boolean;
  /** Store pages in reverse file order (names stay in logical order). */
  reverseStorage?: boolean;
  /** Append the FA FB FC FD end marker after each page number. */
  endMarker?: boolean;
  /** Use stored (literal-only) blocks instead of real compression. */
  literalOnly?: boolean;
}

function literalBlock(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 32) {
    const len = Math.min(32, data.length - i);
    out.push(len - 1);
    for (let k = 0; k < len; k++) out.push(data[i + k]);
  }
  return Uint8Array.from(out);
}

/** Wraps a raw image in a vulZ container. Returns the file bytes. */
export function buildVulZ(image: Uint8Array, o: VulZBuildOptions = {}): ArrayBuffer {
  const pageSize = o.pageSize ?? 1024, layout = o.layout ?? 'flat', perNode = o.perNode ?? 3;
  const numbered = o.numbered ?? true;
  const pages: Uint8Array[] = [];
  for (let p = 0; p * pageSize < image.length; p++) {
    const chunk = new Uint8Array(pageSize);
    chunk.set(image.subarray(p * pageSize, Math.min(image.length, (p + 1) * pageSize)));
    // the last page may be stored short (exactly the remaining length) or full; store it full
    pages.push(o.literalOnly ? literalBlock(chunk) : fastlzCompress(chunk));
  }
  const P = pages.length;
  const trailer = 4 + (o.endMarker ? 4 : 0);
  // tables
  const nodes: number[][] = [];
  if (layout === 'tree') for (let p = 0; p < P; p += perNode) nodes.push(Array.from({ length: Math.min(perNode, P - p) }, (_, k) => p + k));
  const rootEntries = layout === 'flat' ? P : layout === 'tree' ? nodes.length : 1;
  let off = 60 + (rootEntries + 1) * 8;
  const nodeOff = nodes.map(nd => { const at = off; off += (nd.length + 1) * 8; return at; });
  const order = Array.from({ length: P }, (_, k) => k);
  if (o.reverseStorage && layout !== 'run') order.reverse();
  const pageOff = new Array<number>(P);
  for (const p of order) { pageOff[p] = off; off += 8 + pages[p].length + trailer; }
  const buf = new ArrayBuffer(off);
  const dv = new DataView(buf), b = new Uint8Array(buf);
  b.set([0xea, 0xfb, 0xa7, 0x8a, 0x76, 0x75, 0x6c, 0x5a], 0);
  dv.setUint32(20, pageSize, true);
  dv.setUint32(32, image.length % 4294967296, true);
  dv.setUint32(36, Math.floor(image.length / 4294967296), true);
  const root = layout === 'flat' ? pageOff : layout === 'tree' ? nodeOff : [pageOff[0]];
  root.forEach((t, i) => dv.setUint32(60 + i * 8, t, true));
  nodes.forEach((nd, i) => nd.forEach((p, k) => dv.setUint32(nodeOff[i] + k * 8, pageOff[p], true)));
  for (let p = 0; p < P; p++) {
    const at = pageOff[p];
    dv.setUint32(at, pages[p].length, true);
    dv.setUint32(at + 4, pages[p].length + trailer, true);
    b.set(pages[p], at + 8);
    dv.setUint32(at + 8 + pages[p].length, numbered ? p : 0, true);
    if (o.endMarker) dv.setUint32(at + 12 + pages[p].length, 0xfdfcfbfa, true);
  }
  return buf;
}
