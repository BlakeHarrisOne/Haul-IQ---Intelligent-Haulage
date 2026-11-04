/**
 * Plan-position height queries on a triangulated surface, and rasterising a surface to a height grid.
 *
 * `buildHeightIndex` buckets triangles into a uniform plan grid (CSR arrays, two passes, no per-cell
 * objects) sized from the mean triangle extent, so each bucket holds a handful of triangles.
 * Queries are a bucket lookup plus barycentric tests; the highest surface wins where layers overlap.
 */
import type { BBox3, MeshData } from '@/core/types';
import type { Grid } from './types';
import { meshBBox } from './mesh';

/** Bucketed triangle index for `heightAt`. Immutable; safe to share between callers. */
export interface HeightIndex {
  readonly mesh: MeshData;
  /** Plan origin of bucket (0, 0) (m). */
  readonly x0: number;
  readonly y0: number;
  /** Bucket size (m). */
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  /** CSR offsets: bucket k holds cellTris[cellStart[k] .. cellStart[k+1]). */
  readonly cellStart: Uint32Array;
  readonly cellTris: Uint32Array;
  readonly bbox: BBox3;
}

const BARY_EPS = 1e-9;

/**
 * Builds a plan bucket index of the mesh's triangles (degenerate-in-plan triangles are skipped).
 * @param opts.cellM force a bucket size in metres (default: mean triangle plan extent, capped at 4 buckets/triangle)
 */
export function buildHeightIndex(mesh: MeshData, opts: { cellM?: number } = {}): HeightIndex {
  const v = mesh.verts, t = mesh.tris, T = t.length / 3;
  const bbox = meshBBox(mesh);
  const x0 = bbox.min[0], y0 = bbox.min[1];
  const W = Math.max(bbox.max[0] - x0, 1e-6), H = Math.max(bbox.max[1] - y0, 1e-6);
  let cell = opts.cellM ?? 0;
  if (!(cell > 0)) {
    let sum = 0;
    const sample = Math.max(1, Math.floor(T / 20000));
    let n = 0;
    for (let k = 0; k < T; k += sample) {
      const a = t[k * 3] * 3, b = t[k * 3 + 1] * 3, c = t[k * 3 + 2] * 3;
      const w = Math.max(v[a], v[b], v[c]) - Math.min(v[a], v[b], v[c]);
      const h = Math.max(v[a + 1], v[b + 1], v[c + 1]) - Math.min(v[a + 1], v[b + 1], v[c + 1]);
      sum += Math.max(w, h); n++;
    }
    cell = n ? sum / n : Math.max(W, H);
    if (!(cell > 0)) cell = Math.max(W, H, 1);
  }
  const maxCells = Math.max(1024, Math.min(4 * T, 1 << 24));
  while (Math.ceil(W / cell + 1e-9) * Math.ceil(H / cell + 1e-9) > maxCells) cell *= 1.25;
  const nx = Math.floor(W / cell) + 1, ny = Math.floor(H / cell) + 1;
  const counts = new Uint32Array(nx * ny + 1);
  const range = (k: number, out: Int32Array) => {
    const a = t[k * 3] * 3, b = t[k * 3 + 1] * 3, c = t[k * 3 + 2] * 3;
    const ax = v[a], ay = v[a + 1], bx = v[b], by = v[b + 1], cx = v[c], cy = v[c + 1];
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!(Math.abs(area2) > 1e-12)) return false;
    out[0] = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell));
    out[1] = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell));
    out[2] = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / cell));
    out[3] = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / cell));
    return true;
  };
  const r = new Int32Array(4);
  for (let k = 0; k < T; k++) {
    if (!range(k, r)) continue;
    for (let j = r[2]; j <= r[3]; j++) for (let i = r[0]; i <= r[1]; i++) counts[j * nx + i + 1]++;
  }
  for (let k = 0; k < nx * ny; k++) counts[k + 1] += counts[k];
  const cellStart = counts;
  const fill = cellStart.slice(0, nx * ny);
  const cellTris = new Uint32Array(cellStart[nx * ny]);
  for (let k = 0; k < T; k++) {
    if (!range(k, r)) continue;
    for (let j = r[2]; j <= r[3]; j++) for (let i = r[0]; i <= r[1]; i++) cellTris[fill[j * nx + i]++] = k;
  }
  return { mesh, x0, y0, cell, nx, ny, cellStart, cellTris, bbox };
}

/**
 * Surface height (m RL) at plan point (e, n): the highest triangle covering the point, interpolated
 * barycentrically (exact on planar triangles). Returns null off the surface.
 */
export function heightAt(index: HeightIndex, e: number, n: number): number | null {
  const fi = Math.floor((e - index.x0) / index.cell), fj = Math.floor((n - index.y0) / index.cell);
  if (!(fi >= 0 && fj >= 0 && fi < index.nx && fj < index.ny)) return null;
  const k = fj * index.nx + fi;
  const v = index.mesh.verts, t = index.mesh.tris, list = index.cellTris;
  let best = -Infinity;
  for (let p = index.cellStart[k], q = index.cellStart[k + 1]; p < q; p++) {
    const tri = list[p] * 3;
    const a = t[tri] * 3, b = t[tri + 1] * 3, c = t[tri + 2] * 3;
    const ax = v[a], ay = v[a + 1];
    const ux = v[b] - ax, uy = v[b + 1] - ay, wx = v[c] - ax, wy = v[c + 1] - ay;
    const px = e - ax, py = n - ay;
    const den = ux * wy - wx * uy;
    const s = (px * wy - wx * py) / den, r = (ux * py - px * uy) / den;
    if (s >= -BARY_EPS && r >= -BARY_EPS && s + r <= 1 + BARY_EPS) {
      const za = v[a + 2];
      const z = za + s * (v[b + 2] - za) + r * (v[c + 2] - za);
      if (z > best) best = z;
    }
  }
  return best === -Infinity ? null : best;
}

/** One sample of `heightsAlong`. */
export interface HeightSample {
  /** Plan chainage from the first point (m). */
  s: number;
  e: number;
  n: number;
  /** Surface height (m RL) or null off the surface. */
  z: number | null;
}

/**
 * Samples the surface along a plan polyline every `stepM` metres (plan) and at every vertex.
 * @param pts polyline vertices ([E, N] or [E, N, Z]; Z ignored)
 */
export function heightsAlong(
  index: HeightIndex, pts: ReadonlyArray<ArrayLike<number>>, stepM: number,
): HeightSample[] {
  const out: HeightSample[] = [];
  if (!pts.length) return out;
  const step = stepM > 0 ? stepM : Infinity;
  let s = 0;
  out.push({ s: 0, e: pts[0][0], n: pts[0][1], z: heightAt(index, pts[0][0], pts[0][1]) });
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
    const L = Math.hypot(bx - ax, by - ay);
    const k = Number.isFinite(step) ? Math.max(1, Math.ceil(L / step - 1e-9)) : 1;
    for (let j = 1; j <= k; j++) {
      const f = j / k, e = ax + (bx - ax) * f, n = ay + (by - ay) * f;
      out.push({ s: s + L * f, e, n, z: heightAt(index, e, n) });
    }
    s += L;
  }
  return out;
}

const MAX_CELLS = 60_000_000;

/**
 * Rasterises a surface to a height grid: each node takes the highest triangle covering it (NaN off-surface).
 * Defaults: x0 = floor(min E), y0 = floor(min N), extent covering the mesh. A grid TIN rasterised at its own
 * spacing with matching origin reproduces its vertex heights exactly.
 * @param cellM node spacing (m, > 0)
 * @throws when cellM is not positive or the grid would exceed 60 M nodes (a stray far-away point)
 */
export function rasterize(
  mesh: MeshData, cellM: number, bounds?: { x0: number; y0: number; nx: number; ny: number },
): Grid {
  if (!(typeof cellM === 'number' && Number.isFinite(cellM) && cellM > 0))
    throw new Error(`Grid size must be a number of metres above 0 (got ${String(cellM)})`);
  const v = mesh.verts, t = mesh.tris, dx = cellM;
  let x0: number, y0: number, nx: number, ny: number;
  if (bounds) ({ x0, y0, nx, ny } = bounds);
  else {
    const bb = meshBBox(mesh);
    if (!(v.length >= 3) || !Number.isFinite(bb.min[0] + bb.max[0] + bb.min[1] + bb.max[1]))
      throw new Error('Cannot grid a surface with no valid vertices');
    x0 = Math.floor(bb.min[0]); y0 = Math.floor(bb.min[1]);
    nx = Math.ceil((bb.max[0] - x0) / dx - 1e-9) + 1; ny = Math.ceil((bb.max[1] - y0) / dx - 1e-9) + 1;
  }
  const cells = nx * ny;
  if (!(cells <= MAX_CELLS))
    throw new Error(`That survey is too large to grid at ${dx} m (${cells} cells). Check for stray points far from the pit.`);
  const z = new Float32Array(cells).fill(NaN);
  const E = -1e-9;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const xa = v[a] - x0, ya = v[a + 1] - y0, za = v[a + 2];
    const xb = v[b] - x0, yb = v[b + 1] - y0, zb = v[b + 2];
    const xc = v[c] - x0, yc = v[c + 1] - y0, zc = v[c + 2];
    const den = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc);
    if (!(Math.abs(den) > 1e-9)) continue;
    let ix0 = Math.ceil(Math.min(xa, xb, xc) / dx - 1e-9), ix1 = Math.floor(Math.max(xa, xb, xc) / dx + 1e-9);
    let iy0 = Math.ceil(Math.min(ya, yb, yc) / dx - 1e-9), iy1 = Math.floor(Math.max(ya, yb, yc) / dx + 1e-9);
    if (ix1 < 0 || iy1 < 0 || ix0 >= nx || iy0 >= ny) continue;
    if (ix0 < 0) ix0 = 0; if (iy0 < 0) iy0 = 0;
    if (ix1 > nx - 1) ix1 = nx - 1; if (iy1 > ny - 1) iy1 = ny - 1;
    const inv = 1 / den;
    for (let j = iy0; j <= iy1; j++) {
      const py = j * dx, row = j * nx;
      for (let i = ix0; i <= ix1; i++) {
        const px = i * dx;
        const l1 = ((yb - yc) * (px - xc) + (xc - xb) * (py - yc)) * inv;
        const l2 = ((yc - ya) * (px - xc) + (xa - xc) * (py - yc)) * inv;
        const l3 = 1 - l1 - l2;
        if (l1 >= E && l2 >= E && l3 >= E) {
          const zz = l1 * za + l2 * zb + l3 * zc;
          const cur = z[row + i];
          if (!(cur >= zz)) z[row + i] = zz;
        }
      }
    }
  }
  return { x0, y0, dx, nx, ny, z };
}

/**
 * Bilinear grid height (m RL) at plan point (e, n). Missing (NaN) corners are dropped and the remaining
 * weights renormalised; null when all four corners are missing or the point is outside the grid.
 */
export function gridHeightAt(g: Grid, e: number, n: number): number | null {
  const fx = (e - g.x0) / g.dx, fy = (n - g.y0) / g.dx;
  if (!(fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1)) return null;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i >= g.nx - 1) i = g.nx - 2;
  if (j >= g.ny - 1) j = g.ny - 2;
  if (i < 0 || j < 0) {
    // 1-node-wide grid
    const v = g.z[Math.max(0, j) * g.nx + Math.max(0, i)];
    return Number.isFinite(v) ? v : null;
  }
  const tx = fx - i, ty = fy - j, k = j * g.nx + i;
  const z00 = g.z[k], z10 = g.z[k + 1], z01 = g.z[k + g.nx], z11 = g.z[k + g.nx + 1];
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  if (z00 === z00 && z10 === z10 && z01 === z01 && z11 === z11) return z00 * w00 + z10 * w10 + z01 * w01 + z11 * w11;
  let s = 0, w = 0;
  if (z00 === z00) { s += z00 * w00; w += w00; }
  if (z10 === z10) { s += z10 * w10; w += w10; }
  if (z01 === z01) { s += z01 * w01; w += w01; }
  if (z11 === z11) { s += z11 * w11; w += w11; }
  return w > 1e-12 ? s / w : null;
}

/**
 * Converts a height grid into a TIN: two triangles per cell whose four corners are finite
 * (CCW seen from above, so normals point up). Vertices are emitted for every node (NaN nodes unused).
 */
export function gridToMesh(g: Omit<Grid, 'z'> & { z: ArrayLike<number> }): MeshData {
  const { nx, ny, x0, y0, dx, z } = g;
  const verts = new Float64Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    verts[k * 3] = x0 + i * dx; verts[k * 3 + 1] = y0 + j * dx; verts[k * 3 + 2] = z[k];
  }
  const tris = new Uint32Array(Math.max(0, (nx - 1) * (ny - 1) * 6));
  let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
    if (!(z[a] === z[a] && z[b] === z[b] && z[c] === z[c] && z[d] === z[d])) continue;
    tris[p++] = a; tris[p++] = b; tris[p++] = c;
    tris[p++] = a; tris[p++] = c; tris[p++] = d;
  }
  // drop vertices never referenced (NaN nodes) so the mesh carries only finite coordinates
  const used = new Int32Array(nx * ny).fill(-1);
  let nv = 0;
  for (let q = 0; q < p; q++) if (used[tris[q]] < 0) used[tris[q]] = nv++;
  if (nv === nx * ny) return { verts, tris: tris.subarray(0, p).slice() };
  const outV = new Float64Array(nv * 3);
  for (let k = 0; k < nx * ny; k++) if (used[k] >= 0) {
    const o = used[k] * 3;
    outV[o] = verts[k * 3]; outV[o + 1] = verts[k * 3 + 1]; outV[o + 2] = verts[k * 3 + 2];
  }
  const outT = new Uint32Array(p);
  for (let q = 0; q < p; q++) outT[q] = used[tris[q]];
  return { verts: outV, tris: outT };
}
