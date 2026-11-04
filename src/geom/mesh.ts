/**
 * Mesh analysis: topology (closed / boundary edges), statistics (bbox, plan area, volume, centroid),
 * vertex welding, surface-vs-solid classification and Float32 render buffers.
 *
 * Inputs are world-coordinate MeshData (E, N, Z metres, float64). Sums are accumulated relative to the
 * bounding-box centre so MGA-sized coordinates (~236 000 / 7 051 000) do not lose precision.
 */
import type { AssetKind, BBox3, MeshData, MeshStats, Vec3 } from '@/core/types';

/** Edge-level topology of a triangulation. */
export interface MeshTopology {
  /** Distinct undirected edges (edges of degenerate triangles excluded). */
  edges: number;
  /** Edges used by exactly one triangle. */
  boundaryEdges: number;
  /** Edges used by three or more triangles. */
  nonManifoldEdges: number;
  /** Two-triangle edges traversed in the same direction by both (inconsistent winding). */
  inconsistentEdges: number;
  /** Triangles with a repeated vertex index (ignored for topology). */
  degenerateTriangles: number;
  /** True when every edge is shared by exactly two triangles. */
  closed: boolean;
}

/** Number of vertices in a mesh. */
export const vertexCount = (m: MeshData): number => (m.verts.length / 3) | 0;
/** Number of triangles in a mesh. */
export const triangleCount = (m: MeshData): number => (m.tris.length / 3) | 0;

/**
 * Edge topology via a per-vertex CSR edge list (no hash map): O(T) memory, fast for 2M triangles.
 * Each undirected edge is stored under its lower vertex index together with its traversal direction.
 */
export function meshTopology(mesh: MeshData): MeshTopology {
  const tris = mesh.tris;
  const V = vertexCount(mesh), T = triangleCount(mesh);
  const start = new Uint32Array(V + 1);
  let degenerate = 0;
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    if (a === b || b === c || c === a || a >= V || b >= V || c >= V) { degenerate++; continue; }
    start[(a < b ? a : b) + 1]++;
    start[(b < c ? b : c) + 1]++;
    start[(c < a ? c : a) + 1]++;
  }
  for (let v = 0; v < V; v++) start[v + 1] += start[v];
  const fill = start.slice(0, V);
  const nb = new Uint32Array(start[V]);
  const put = (p: number, q: number) => {
    // value = hi * 2 + (1 when traversed lo → hi)
    if (p < q) nb[fill[p]++] = q * 2 + 1;
    else nb[fill[q]++] = p * 2;
  };
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    if (a === b || b === c || c === a || a >= V || b >= V || c >= V) continue;
    put(a, b); put(b, c); put(c, a);
  }
  let edges = 0, boundary = 0, nonManifold = 0, inconsistent = 0;
  for (let v = 0; v < V; v++) {
    const s = start[v], e = start[v + 1];
    if (e - s > 1) sortSmall(nb, s, e);
    let i = s;
    while (i < e) {
      const hi = nb[i] >>> 1;
      let j = i, fwd = 0;
      while (j < e && nb[j] >>> 1 === hi) { fwd += nb[j] & 1; j++; }
      const k = j - i;
      edges++;
      if (k === 1) boundary++;
      else if (k === 2) { if (fwd !== 1) inconsistent++; }
      else nonManifold++;
      i = j;
    }
  }
  return {
    edges, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent,
    degenerateTriangles: degenerate, closed: edges > 0 && boundary === 0 && nonManifold === 0,
  };
}

function sortSmall(a: Uint32Array, s: number, e: number): void {
  if (e - s > 24) { a.subarray(s, e).sort(); return; }
  for (let i = s + 1; i < e; i++) {
    const x = a[i];
    let j = i - 1;
    while (j >= s && a[j] > x) { a[j + 1] = a[j]; j--; }
    a[j + 1] = x;
  }
}

/** Axis-aligned bounding box of the vertices (m). Empty meshes give a zero box at the origin. */
export function meshBBox(mesh: MeshData): BBox3 {
  const v = mesh.verts;
  if (v.length < 3) return { min: [0, 0, 0], max: [0, 0, 0] };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** Signed volume (m³) by the divergence theorem; positive when triangles wind outward (CCW seen from outside). */
export function signedVolume(mesh: MeshData): number {
  const { verts: v, tris } = mesh;
  const bb = meshBBox(mesh);
  const rx = (bb.min[0] + bb.max[0]) / 2, ry = (bb.min[1] + bb.max[1]) / 2, rz = (bb.min[2] + bb.max[2]) / 2;
  let s = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = v[a] - rx, ay = v[a + 1] - ry, az = v[a + 2] - rz;
    const bx = v[b] - rx, by = v[b + 1] - ry, bz = v[b + 2] - rz;
    const cx = v[c] - rx, cy = v[c + 1] - ry, cz = v[c + 2] - rz;
    s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return s / 6;
}

/** Result of `orientMesh`. */
export interface MeshOrientation {
  /**
   * The mesh with every orientable closed shell wound consistently (each shared edge traversed in opposite
   * directions). Same `verts`; `tris` is a copy when any triangle was flipped, else this is the input object.
   */
  mesh: MeshData;
  /** Edge topology of the input (identical to `meshTopology(input)`). */
  topology: MeshTopology;
  /** Triangles whose winding was reversed in `mesh` (single faces + whole inside-out shells). */
  flippedTriangles: number;
  /** Closed shells (edge-connected components) of a closed mesh; 0 when the mesh is not closed. */
  shells: number;
  /** Separate shells wound inside-out as a whole (not inside another shell, so not voids) that were flipped. */
  invertedShells: number;
  /** Shells that cannot be wound consistently (twisted / self-intersecting); left as in the input. */
  nonOrientableShells: number;
  /** User-facing notes for the import UI; empty when the winding needed no repair. */
  warnings: string[];
}

const orientCache = new WeakMap<MeshData, MeshOrientation>();
/** Point-triangle evaluations allowed for the nested-shell (void) test before it gives up. */
const NEST_BUDGET = 3e7;
const TAKEN = 0xffffffff;

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;

/**
 * Makes the triangle winding of a closed mesh consistent, so volumes, centroids, depletion planes and
 * clipped meshes are right for solids exported with some faces flipped (common in Vulcan solids).
 *
 * 1. Edge adjacency (per-vertex CSR, as `meshTopology`); a BFS over each shell flips triangles so every
 *    shared edge is traversed in opposite directions. Per shell the smaller of the two consistent flip sets
 *    is applied, i.e. the file's majority winding is kept (a mostly outward shell ends up outward; a file
 *    wound inward throughout is left alone, its volume sign is handled downstream as before).
 * 2. Shells wound opposite to the largest one are flipped as a whole unless they lie inside a larger shell
 *    (a void, which must wind opposite): bbox containment plus a winding-number test of sample points.
 * Only closed meshes are re-oriented: open surfaces have no inside, and non-manifold meshes (edges with 3+
 * triangles) are left as in the input with a warning. Non-orientable shells are left as in the input with a
 * warning (volumes then fall back to the absolute signed-volume sum). Cached per MeshData object.
 */
export function orientMesh(mesh: MeshData): MeshOrientation {
  const hit = orientCache.get(mesh);
  if (hit) return hit;
  const tris = mesh.tris, v = mesh.verts;
  const V = vertexCount(mesh), T = triangleCount(mesh);
  // ── adjacency: triangle edge slots s = 3t + j (tris[s] → next corner), listed under their lower vertex
  const start = new Uint32Array(V + 1);
  const valid = new Uint8Array(T);
  let degenerate = 0;
  for (let t = 0, s = 0; t < T; t++, s += 3) {
    const a = tris[s], b = tris[s + 1], c = tris[s + 2];
    if (a === b || b === c || c === a || a >= V || b >= V || c >= V) { degenerate++; continue; }
    valid[t] = 1;
    start[(a < b ? a : b) + 1]++;
    start[(b < c ? b : c) + 1]++;
    start[(c < a ? c : a) + 1]++;
  }
  for (let i = 0; i < V; i++) start[i + 1] += start[i];
  const fill = start.slice(0, V);
  const far = new Uint32Array(start[V]), slot = new Uint32Array(start[V]);
  for (let t = 0, s = 0; t < T; t++, s += 3) {
    if (!valid[t]) continue;
    const a = tris[s], b = tris[s + 1], c = tris[s + 2];
    let f: number;
    if (a < b) { f = fill[a]++; far[f] = b; } else { f = fill[b]++; far[f] = a; }
    slot[f] = s;
    if (b < c) { f = fill[b]++; far[f] = c; } else { f = fill[c]++; far[f] = b; }
    slot[f] = s + 1;
    if (c < a) { f = fill[c]++; far[f] = a; } else { f = fill[a]++; far[f] = c; }
    slot[f] = s + 2;
  }
  // link[s] = neighbour triangle · 2 + (1 when both traverse the edge the same way); only read for closed
  // meshes, where every slot of a valid triangle is set
  const link = new Uint32Array(T * 3);
  let edges = 0, boundary = 0, nonManifold = 0, inconsistent = 0;
  for (let i0 = 0; i0 < V; i0++) {
    const s0 = start[i0], e0 = start[i0 + 1];
    // a handful of entries per vertex: match by scanning; a high-valence (fan) vertex: sort first, then the
    // entries of one edge are adjacent and the scan stops at the first other far vertex
    const sorted = e0 - s0 > 32;
    if (sorted) sortGroup(far, slot, s0, e0);
    for (let i = s0; i < e0; i++) {
      const hi = far[i];
      if (hi === TAKEN) continue;
      let m = -1, k = 1;
      for (let j = i + 1; j < e0; j++) {
        if (far[j] === hi) { k++; m = j; far[j] = TAKEN; } else if (sorted) break;
      }
      edges++;
      if (k === 1) boundary++;
      else if (k === 2) {
        const a = slot[i], b = slot[m];
        const same = tris[a] === tris[b] ? 1 : 0;
        inconsistent += same;
        link[a] = ((b / 3) | 0) * 2 + same;
        link[b] = ((a / 3) | 0) * 2 + same;
      } else nonManifold++;
    }
  }
  const topology: MeshTopology = {
    edges, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent,
    degenerateTriangles: degenerate, closed: edges > 0 && boundary === 0 && nonManifold === 0,
  };
  const res: MeshOrientation = { mesh, topology, flippedTriangles: 0, shells: 0, invertedShells: 0, nonOrientableShells: 0, warnings: [] };
  if (nonManifold > 0) {
    res.warnings.push(`${count(nonManifold, 'edge')} ${nonManifold === 1 ? 'is' : 'are'} shared by three or more triangles (non-manifold): the mesh cannot be treated as a closed solid and its triangle winding was not checked.`);
  }
  if (!topology.closed) { orientCache.set(mesh, res); return res; }
  // ── BFS per shell: labels (comp = shell + 1, 0 = not reached) and flips; `order` lists each shell's
  // triangles contiguously from cStart[c]
  const comp = new Uint32Array(T);
  const flip = new Uint8Array(T);
  const order = new Uint32Array(T);
  const cStart: number[] = [], cFlips: number[] = [], cBad: boolean[] = [];
  let qt = 0;
  for (let seed = 0; seed < T; seed++) {
    if (!valid[seed] || comp[seed]) continue;
    const c = cStart.length;
    cStart.push(qt);
    comp[seed] = c + 1; order[qt++] = seed;
    let bad = false, flips = 0;
    for (let qh = cStart[c]; qh < qt; qh++) {
      const t = order[qh], ft = flip[t];
      flips += ft;
      for (let s = t * 3; s < t * 3 + 3; s++) {
        const L = link[s], u = L >>> 1, need = ft ^ (L & 1);
        if (!comp[u]) { comp[u] = c + 1; flip[u] = need; order[qt++] = u; }
        else if (flip[u] !== need) bad = true;
      }
    }
    cFlips.push(flips); cBad.push(bad);
  }
  const C = cStart.length;
  cStart.push(qt);
  // per shell: 0 = leave as in the input, 1 = apply the BFS flips, 2 = apply the complementary flips
  const mode = new Uint8Array(C);
  const faceFix = new Float64Array(C);
  let nonOrientable = 0, oriented = 0;
  for (let c = 0; c < C; c++) {
    if (cBad[c]) { nonOrientable++; continue; }
    const size = cStart[c + 1] - cStart[c];
    mode[c] = cFlips[c] * 2 > size ? 2 : 1;
    faceFix[c] = Math.min(cFlips[c], size - cFlips[c]);
    oriented++;
  }
  // ── several shells: one wound opposite to the largest is a void when nested in a larger shell, else inside-out
  let invertedShells = 0, invertedTris = 0, unchecked = 0;
  if (oriented > 1) {
    const bb = meshBBox(mesh);
    const rx = (bb.min[0] + bb.max[0]) / 2, ry = (bb.min[1] + bb.max[1]) / 2, rz = (bb.min[2] + bb.max[2]) / 2;
    const vol = new Float64Array(C);
    for (let t = 0, s = 0; t < T; t++, s += 3) {
      const c = comp[t] - 1;
      if (c < 0 || !mode[c]) continue;
      const d = det3(v, tris[s] * 3, tris[s + 1] * 3, tris[s + 2] * 3, rx, ry, rz);
      vol[c] += (flip[t] ^ (mode[c] - 1)) ? -d : d;
    }
    let dominant = -1;
    for (let c = 0; c < C; c++) if (mode[c] && (dominant < 0 || Math.abs(vol[c]) > Math.abs(vol[dominant]))) dominant = c;
    const gsign = Math.sign(vol[dominant]), minVol = 1e-9 * Math.abs(vol[dominant]);
    const opposite: number[] = [];
    for (let c = 0; c < C; c++) if (mode[c] && Math.abs(vol[c]) > minVol && Math.sign(vol[c]) !== gsign) opposite.push(c);
    if (opposite.length) {
      const sh = shellSamples(v, tris, order, cStart, mode);
      let work = 0;
      for (const i of opposite) {
        let nested = false, gaveUp = false;
        for (let j = 0; j < C && !nested && !gaveUp; j++) {
          if (j === i || !mode[j] || !(Math.abs(vol[j]) > Math.abs(vol[i])) || !boxInside(sh.box, i, j)) continue;
          const pts = sh.samples[i];
          work += (pts.length / 3) * (cStart[j + 1] - cStart[j]);
          if (work > NEST_BUDGET) { gaveUp = true; break; }
          nested = true;
          for (let p = 0; p < pts.length && nested; p += 3) {
            const w = windingNumber(v, tris, order, cStart[j], cStart[j + 1], flip, mode[j] - 1, pts[p], pts[p + 1], pts[p + 2]);
            if (!(Math.abs(w) > 0.5)) nested = false;
          }
        }
        if (nested) continue;
        if (gaveUp) { unchecked++; continue; }
        mode[i] = mode[i] === 1 ? 2 : 1;
        invertedShells++;
        invertedTris += cStart[i + 1] - cStart[i] - faceFix[i];
      }
    }
  }
  // ── apply
  let fixedFaces = 0;
  for (let c = 0; c < C; c++) if (mode[c]) fixedFaces += faceFix[c];
  const flipped = fixedFaces + invertedTris;
  if (flipped > 0) {
    const nt = tris.slice();
    for (let t = 0, s = 0; t < T; t++, s += 3) {
      const c = comp[t] - 1;
      if (c < 0 || !mode[c] || !(flip[t] ^ (mode[c] - 1))) continue;
      nt[s + 1] = tris[s + 2]; nt[s + 2] = tris[s + 1];
    }
    res.mesh = { verts: mesh.verts, tris: nt };
  }
  res.flippedTriangles = flipped;
  res.shells = C;
  res.invertedShells = invertedShells;
  res.nonOrientableShells = nonOrientable;
  if (fixedFaces > 0) {
    res.warnings.push(`Inconsistent triangle winding: ${count(fixedFaces, 'triangle')} of ${T.toLocaleString('en-AU')} faced the wrong way and ${fixedFaces === 1 ? 'was' : 'were'} re-oriented; volume, depletion and clipping use the corrected winding.`);
  }
  if (invertedShells > 0) {
    res.warnings.push(`${count(invertedShells, 'separate shell')} ${invertedShells === 1 ? 'was' : 'were'} wound inside-out and ${invertedShells === 1 ? 'was' : 'were'} flipped (${count(invertedTris, 'triangle')}) so ${invertedShells === 1 ? 'its' : 'their'} volume adds to the solid.`);
  }
  if (unchecked > 0) {
    res.warnings.push(`${count(unchecked, 'shell')} ${unchecked === 1 ? 'is' : 'are'} wound opposite to the main solid and could not be checked for nesting; treated as ${unchecked === 1 ? 'a void' : 'voids'} (volume subtracted). Check the solid.`);
  }
  if (nonOrientable > 0) {
    res.warnings.push(`${count(nonOrientable, 'shell')} cannot be wound consistently (twisted or self-intersecting triangles); the volume uses the file's winding and may be wrong. Check the solid.`);
  }
  orientCache.set(mesh, res);
  return res;
}

/** Sorts entries [s, e) by far vertex, carrying the edge slot (only for high-valence vertices). */
function sortGroup(far: Uint32Array, slot: Uint32Array, s: number, e: number): void {
  const idx = Array.from({ length: e - s }, (_, i) => s + i).sort((x, y) => far[x] - far[y]);
  const f = idx.map(i => far[i]), w = idx.map(i => slot[i]);
  far.set(f, s); slot.set(w, s);
}

/** det(a − r, b − r, c − r) for vertex offsets a, b, c (= 6 × the signed volume of the tetrahedron r a b c). */
function det3(v: ArrayLike<number>, a: number, b: number, c: number, rx: number, ry: number, rz: number): number {
  const ax = v[a] - rx, ay = v[a + 1] - ry, az = v[a + 2] - rz;
  const bx = v[b] - rx, by = v[b + 1] - ry, bz = v[b + 2] - rz;
  const cx = v[c] - rx, cy = v[c + 1] - ry, cz = v[c + 2] - rz;
  return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

/** Per oriented shell: bbox (6 values per shell) and sample points (its 6 extreme vertices + largest-face centroid). */
function shellSamples(
  v: ArrayLike<number>, tris: ArrayLike<number>, order: Uint32Array, cStart: number[], mode: Uint8Array,
): { box: Float64Array; samples: number[][] } {
  const C = mode.length;
  const box = new Float64Array(C * 6);
  const samples: number[][] = [];
  for (let c = 0; c < C; c++) {
    samples.push([]);
    if (!mode[c]) continue;
    const ext = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const at = [0, 0, 0, 0, 0, 0];
    let big = -1, bigA = -1;
    for (let q = cStart[c]; q < cStart[c + 1]; q++) {
      const t = order[q];
      for (let j = 0; j < 3; j++) {
        const i = tris[t * 3 + j] * 3;
        for (let k = 0; k < 3; k++) {
          const x = v[i + k];
          if (x < ext[k]) { ext[k] = x; at[k] = i; }
          if (x > ext[k + 3]) { ext[k + 3] = x; at[k + 3] = i; }
        }
      }
      const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, d = tris[t * 3 + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[d] - v[a], wy = v[d + 1] - v[a + 1], wz = v[d + 2] - v[a + 2];
      const ar = (uy * wz - uz * wy) ** 2 + (uz * wx - ux * wz) ** 2 + (ux * wy - uy * wx) ** 2;
      if (ar > bigA) { bigA = ar; big = t; }
    }
    box.set(ext, c * 6);
    const pts = samples[c];
    for (const i of new Set(at)) pts.push(v[i], v[i + 1], v[i + 2]);
    if (big >= 0) {
      const a = tris[big * 3] * 3, b = tris[big * 3 + 1] * 3, d = tris[big * 3 + 2] * 3;
      pts.push((v[a] + v[b] + v[d]) / 3, (v[a + 1] + v[b + 1] + v[d + 1]) / 3, (v[a + 2] + v[b + 2] + v[d + 2]) / 3);
    }
  }
  return { box, samples };
}

/** True when shell i's bbox lies within shell j's. */
const boxInside = (box: Float64Array, i: number, j: number): boolean =>
  box[i * 6] >= box[j * 6] && box[i * 6 + 1] >= box[j * 6 + 1] && box[i * 6 + 2] >= box[j * 6 + 2] &&
  box[i * 6 + 3] <= box[j * 6 + 3] && box[i * 6 + 4] <= box[j * 6 + 4] && box[i * 6 + 5] <= box[j * 6 + 5];

/**
 * Generalised winding number of point p about a consistently wound shell (order[s, e)): ±1 inside, 0 outside.
 * Sum of signed solid angles (Van Oosterom & Strackee), relative to p so MGA-sized coordinates keep precision.
 */
function windingNumber(
  v: ArrayLike<number>, tris: ArrayLike<number>, order: Uint32Array, s: number, e: number,
  flip: Uint8Array, inv: number, px: number, py: number, pz: number,
): number {
  let sum = 0;
  for (let q = s; q < e; q++) {
    const t = order[q];
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    const ax = v[a] - px, ay = v[a + 1] - py, az = v[a + 2] - pz;
    const bx = v[b] - px, by = v[b + 1] - py, bz = v[b + 2] - pz;
    const cx = v[c] - px, cy = v[c + 1] - py, cz = v[c + 2] - pz;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const num = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (ax * cx + ay * cy + az * cz) * lb + (bx * cx + by * cy + bz * cz) * la;
    const omega = 2 * Math.atan2(num, den);
    sum += (flip[t] ^ inv) ? -omega : omega;
  }
  return sum / (4 * Math.PI);
}

/**
 * Statistics for an asset: counts, bbox, plan area (m²), closedness, volume (m³, closed only) and centroid.
 * Plan area: open surfaces sum |plan area| of every triangle; closed solids report the footprint
 * (half the summed |plan area|, exact when the solid has no overhangs).
 * Centroid: volume centroid for closed solids, 3D-area-weighted surface centroid for open surfaces.
 * Closed meshes are first re-oriented (`orientMesh`) so faces wound the wrong way do not subtract from the
 * volume; `orientMesh(mesh).warnings` explains any repair (cached, free after this call).
 */
export function meshStats(mesh: MeshData, topology?: MeshTopology): MeshStats {
  const { verts: v } = mesh;
  const o = topology && !topology.closed ? null : orientMesh(mesh);
  topology ??= o!.topology;
  const tris = topology.closed && o ? o.mesh.tris : mesh.tris;
  const bbox = meshBBox(mesh);
  const rx = (bbox.min[0] + bbox.max[0]) / 2, ry = (bbox.min[1] + bbox.max[1]) / 2, rz = (bbox.min[2] + bbox.max[2]) / 2;
  let plan = 0, vol6 = 0, vcx = 0, vcy = 0, vcz = 0, area = 0, acx = 0, acy = 0, acz = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = v[a] - rx, ay = v[a + 1] - ry, az = v[a + 2] - rz;
    const bx = v[b] - rx, by = v[b + 1] - ry, bz = v[b + 2] - rz;
    const cx = v[c] - rx, cy = v[c + 1] - ry, cz = v[c + 2] - rz;
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    plan += Math.abs(nz) / 2;
    const ta = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    area += ta;
    acx += ta * (ax + bx + cx) / 3; acy += ta * (ay + by + cy) / 3; acz += ta * (az + bz + cz) / 3;
    const d = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    vol6 += d;
    vcx += d * (ax + bx + cx); vcy += d * (ay + by + cy); vcz += d * (az + bz + cz);
  }
  const closed = topology.closed;
  let centroid: Vec3;
  let volume: number | undefined;
  if (closed && Math.abs(vol6) > 1e-12) {
    volume = Math.abs(vol6) / 6;
    centroid = [rx + vcx / (4 * vol6), ry + vcy / (4 * vol6), rz + vcz / (4 * vol6)];
  } else if (area > 0) {
    if (closed) volume = 0;
    centroid = [rx + acx / area, ry + acy / area, rz + acz / area];
  } else {
    centroid = [rx, ry, rz];
  }
  return {
    vertexCount: vertexCount(mesh),
    triangleCount: triangleCount(mesh),
    bbox,
    planArea: closed ? plan / 2 : plan,
    closed,
    boundaryEdges: topology.boundaryEdges,
    volume,
    centroid,
  };
}

/** 'solid' for a closed mesh with positive volume, otherwise 'surface'. */
export function classifyMesh(mesh: MeshData, stats: MeshStats = meshStats(mesh)): AssetKind {
  return stats.closed && (stats.volume ?? 0) > 1e-9 ? 'solid' : 'surface';
}

/**
 * Merges vertices closer than `tolM` metres (3D) and remaps triangles, dropping triangles that become
 * degenerate. Uses a plan hash grid of cell ≥ tol (3×3 neighbourhood search). Returns a new mesh.
 */
export function weldVertices(mesh: MeshData, tolM: number): MeshData {
  const v = mesh.verts, V = vertexCount(mesh);
  if (V === 0) return { verts: new Float64Array(0), tris: new Uint32Array(0) };
  const bb = meshBBox(mesh);
  const ext = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], 1e-9);
  const tol = Math.max(tolM, 0);
  const cell = Math.max(tol, ext / 1e6, 1e-9);
  const ncol = Math.floor(ext / cell) + 3;
  const heads = new Map<number, number>();
  const next = new Int32Array(V).fill(-1);
  const remap = new Int32Array(V);
  const out: number[] = [];
  const tol2 = tol * tol;
  let reps = 0;
  for (let i = 0; i < V; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    const ci = Math.floor((x - bb.min[0]) / cell) + 1, cj = Math.floor((y - bb.min[1]) / cell) + 1;
    let found = -1;
    for (let dj = -1; dj <= 1 && found < 0; dj++) for (let di = -1; di <= 1 && found < 0; di++) {
      let r = heads.get((cj + dj) * ncol + ci + di);
      while (r !== undefined && r >= 0) {
        const p = remap[r] * 3;
        const ddx = out[p] - x, ddy = out[p + 1] - y, ddz = out[p + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= tol2) { found = remap[r]; break; }
        r = next[r];
      }
    }
    if (found >= 0) { remap[i] = found; continue; }
    remap[i] = reps++;
    out.push(x, y, z);
    const key = cj * ncol + ci;
    const h = heads.get(key);
    next[i] = h === undefined ? -1 : h;
    heads.set(key, i);
  }
  const t = mesh.tris, nt: number[] = [];
  for (let k = 0; k < t.length; k += 3) {
    const a = remap[t[k]], b = remap[t[k + 1]], c = remap[t[k + 2]];
    if (a !== b && b !== c && c !== a) nt.push(a, b, c);
  }
  return { verts: Float64Array.from(out), tris: Uint32Array.from(nt) };
}

/** Concatenates meshes into one (indices offset; no welding). */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  let nv = 0, nt = 0;
  for (const m of meshes) { nv += m.verts.length; nt += m.tris.length; }
  const verts = new Float64Array(nv), tris = new Uint32Array(nt);
  let ov = 0, ot = 0;
  for (const m of meshes) {
    verts.set(m.verts, ov);
    const base = ov / 3;
    for (let i = 0; i < m.tris.length; i++) tris[ot + i] = m.tris[i] + base;
    ov += m.verts.length; ot += m.tris.length;
  }
  return { verts, tris };
}

/** Returns a copy with every triangle's winding reversed (normals flipped). */
export function flipWinding(mesh: MeshData): MeshData {
  const t = mesh.tris.slice();
  for (let i = 0; i < t.length; i += 3) { const b = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = b; }
  return { verts: mesh.verts, tris: t };
}

/** Float32 render buffers in the Three.js scene frame. */
export interface LocalBuffers {
  /** [x, y, z, …] scene coordinates (m): x = E − E0, y = (Z − Z0)·vx, z = −(N − N0). */
  positions: Float32Array;
  /** 0-based triangle indices (a copy when faceUp flipped any triangle, else the mesh's own array). */
  index: Uint32Array;
}

/**
 * World mesh → Float32 scene buffers using the core/frame.ts convention (x = E − E0, y = (Z − Z0)·vx,
 * z = −(N − N0)). This mapping is a proper rotation, so winding (and outward normals) is preserved.
 * @param origin site origin [E0, N0, Z0] (m)
 * @param opts.verticalExaggeration multiplies heights (default 1)
 * @param opts.faceUp flip triangles whose normal points down (useful for surfaces with mixed winding)
 */
export function toLocalFloat32(
  mesh: MeshData, origin: Vec3, opts: { verticalExaggeration?: number; faceUp?: boolean } = {},
): LocalBuffers {
  const vx = opts.verticalExaggeration ?? 1;
  const v = mesh.verts, n = v.length / 3;
  const positions = new Float32Array(n * 3);
  const [e0, n0, z0] = origin;
  for (let i = 0; i < n; i++) {
    positions[i * 3] = v[i * 3] - e0;
    positions[i * 3 + 1] = (v[i * 3 + 2] - z0) * vx;
    positions[i * 3 + 2] = -(v[i * 3 + 1] - n0);
  }
  let index = mesh.tris;
  if (opts.faceUp) {
    let copied = false;
    const t = mesh.tris;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      const cz = (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a]);
      if (cz < 0) {
        if (!copied) { index = t.slice(); copied = true; }
        index[k + 1] = t[k + 2]; index[k + 2] = t[k + 1];
      }
    }
  }
  return { positions, index };
}

/**
 * Area-weighted per-vertex normals (unit, Float32) for rendering.
 * @param positions flat xyz (any frame)
 * @param index triangle indices
 */
export function computeNormals(positions: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const n = positions.length / 3;
  const acc = new Float64Array(n * 3);
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k] * 3, b = index[k + 1] * 3, c = index[k + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
    acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
    acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]);
    if (l > 0) { out[i] = acc[i] / l; out[i + 1] = acc[i + 1] / l; out[i + 2] = acc[i + 2] / l; }
    else out[i + 1] = 1;
  }
  return out;
}
