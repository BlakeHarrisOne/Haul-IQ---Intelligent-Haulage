/**
 * Vulcan .00t triangulation reader / writer.
 *
 * Raw image (all geometry big-endian):
 *   0x00  120-byte header; u32 vertex count @0x48, u32 triangle count @0x60
 *   0x78  vertices: 3 × f64 (E, N, Z), 24 bytes each
 *   …     triangles: 3 × u32 vertex indices + 12 opaque bytes, 24 bytes each
 *   …     optional trailing attributes (ignored)
 * Indices are 1-based in canonical Vulcan files; 0-based files are detected (min 0, max < V).
 * Real Vulcan files are usually the compressed "vulZ" container (vulz.ts), decoded transparently.
 */
import type { MeshData } from '@/core/types';
import { orientMesh } from '@/geom/mesh';
import { decodeVulZ, isVulZ } from './vulz';

const PREFIX = "That file isn't a Vulcan .00t surface";
const HEADER = 0x78;
const REC = 24;

/** Result of `parse00t`. */
export interface Parsed00t {
  mesh: MeshData;
  format: 'raw' | 'vulZ';
  /**
   * Non-fatal notes for the user (index base, degenerate triangles, page count, triangle winding repaired
   * or not checkable …). `mesh` is the file as written; volumes and depletion re-orient it (`orientMesh`).
   */
  warnings: string[];
}

function bad(reason: string): never {
  throw new Error(`${PREFIX} (${reason})`);
}

/**
 * Parses a .00t file (raw or vulZ-compressed) into world-coordinate MeshData.
 * @param input the file bytes (an ArrayBuffer, or a typed-array view such as a Node Buffer)
 * @throws Error with a user-facing message ("That file isn't a Vulcan .00t surface (…)" or
 *   "Cannot read this compressed Vulcan .00t (…)")
 */
export function parse00t(input: ArrayBuffer | ArrayBufferView): Parsed00t {
  let buf: ArrayBuffer;
  if (ArrayBuffer.isView(input)) buf = new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer;
  else if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') buf = input as ArrayBuffer;
  else bad('no file data');
  const warnings: string[] = [];
  let format: Parsed00t['format'] = 'raw';
  if (isVulZ(buf)) {
    const d = decodeVulZ(buf);
    buf = d.buffer;
    format = 'vulZ';
    warnings.push(`Compressed Vulcan file: ${d.pages} page${d.pages === 1 ? '' : 's'}, ${d.expandedBytes.toLocaleString('en-AU')} bytes expanded`);
  }
  if (buf.byteLength < HEADER) bad('the file is cut short');
  const dv = new DataView(buf);
  const V = dv.getUint32(0x48, false), T = dv.getUint32(0x60, false);
  if (!V || !T) bad('no triangles');
  const need = HEADER + (V + T) * REC;
  if (!Number.isSafeInteger(need) || buf.byteLength < need) bad('the file is cut short');
  const verts = new Float64Array(V * 3);
  let off = HEADER;
  for (let i = 0; i < V * 3; i++, off += 8) {
    const x = dv.getFloat64(off, false);
    if (!Number.isFinite(x)) bad('non-finite vertex coordinate');
    verts[i] = x;
  }
  const tris = new Uint32Array(T * 3);
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < T; t++, off += REC) {
    for (let j = 0; j < 3; j++) {
      const k = dv.getUint32(off + j * 4, false);
      tris[t * 3 + j] = k;
      if (k < min) min = k;
      if (k > max) max = k;
    }
  }
  if (min >= 1 && max <= V) {
    for (let k = 0; k < tris.length; k++) tris[k] -= 1;
  } else if (min === 0 && max < V) {
    warnings.push('Triangle indices are 0-based (non-canonical); read as such');
  } else bad('triangle index out of range');
  let degenerate = 0;
  for (let t = 0; t < tris.length; t += 3) if (tris[t] === tris[t + 1] || tris[t + 1] === tris[t + 2] || tris[t] === tris[t + 2]) degenerate++;
  if (degenerate) warnings.push(`${degenerate} degenerate triangle${degenerate === 1 ? '' : 's'} (repeated vertex)`);
  if (buf.byteLength > need) warnings.push('Trailing attributes after the triangles were ignored');
  const mesh: MeshData = { verts, tris };
  // winding check (cached on the mesh, so the importer's meshStats reuses it)
  warnings.push(...orientMesh(mesh).warnings);
  return { mesh, format, warnings };
}

/** True when the buffer looks like a .00t (vulZ magic, or a raw header whose counts fit the file size). */
export function looksLike00t(buf: ArrayBuffer): boolean {
  if (isVulZ(buf)) return true;
  if (buf.byteLength < HEADER) return false;
  const dv = new DataView(buf);
  const V = dv.getUint32(0x48, false), T = dv.getUint32(0x60, false);
  return V > 0 && T > 0 && HEADER + (V + T) * REC <= buf.byteLength;
}

/**
 * Writes a raw (uncompressed) .00t image: 120-byte header, big-endian f64 vertices, 1-based u32 indices
 * with 12 zero bytes per triangle. Readable by `parse00t` and by consumers of the raw form.
 */
export function write00t(mesh: MeshData): ArrayBuffer {
  const V = mesh.verts.length / 3, T = mesh.tris.length / 3;
  const buf = new ArrayBuffer(HEADER + (V + T) * REC);
  const dv = new DataView(buf);
  dv.setUint32(0x48, V, false);
  dv.setUint32(0x60, T, false);
  let off = HEADER;
  for (let i = 0; i < V * 3; i++, off += 8) dv.setFloat64(off, mesh.verts[i], false);
  for (let t = 0; t < T; t++, off += REC) {
    dv.setUint32(off, mesh.tris[t * 3] + 1, false);
    dv.setUint32(off + 4, mesh.tris[t * 3 + 1] + 1, false);
    dv.setUint32(off + 8, mesh.tris[t * 3 + 2] + 1, false);
  }
  return buf;
}
