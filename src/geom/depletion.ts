/**
 * Depletion of dig solids and filling of dump solids by a moving plane.
 *
 * Plane convention (see geom/types.ts Plane): the depletion plane's normal points the way the face MOVES.
 * The BACK side (normal·p < constant) is already dug (dig) or already placed (dump); the FRONT side is
 * still to dig / still to fill.
 *   - 'face-advance': normal = plan azimuth (degrees clockwise from grid north), horizontal;
 *   - 'bench-down'  : normal = (0, 0, −1), removal from the top down;
 *   - 'bottom-up'   : normal = (0, 0, +1), filling from the bottom up (dumps).
 *
 * Volumes use the divergence theorem with the reference point ON the plane, so the planar cap contributes
 * nothing and only the (clipped) mesh triangles are summed. `prepareSolid` caches per-direction tables:
 * triangles sorted by their furthest extent along the normal with prefix sums of their volume terms
 * (det(a,b,c) and (b−a)×(c−a)), plus a bucket list of triangles straddling each slab. A volume query is then
 * a binary search plus the triangles cut by the plane, so the slider can call `depletionPlane` every frame.
 */
import type { DepletionMode, MeshData, Vec3 } from '@/core/types';
import type { Plane } from './types';
import { meshBBox, orientMesh } from './mesh';
import { chainSegments } from './chain';
import { triangulatePolygon } from './triangulate';
import { pointInRing, ringArea } from './polyline';

interface DirTable {
  n: Vec3;
  proj: Float64Array;
  tmin: Float64Array;
  tmax: Float64Array;
  sortedMax: Float64Array;
  pd: Float64Array;
  pnx: Float64Array;
  pny: Float64Array;
  pnz: Float64Array;
  lo: number;
  hi: number;
  bins: number;
  binW: number;
  binStart: Uint32Array;
  binTris: Uint32Array;
  /** Volume behind the plane at each bin edge (bins + 1 values, m³), for fast inversion. */
  edgeVol: Float64Array;
}

/** Prepared, cached data for repeated depletion queries on one closed mesh. Create with `prepareSolid`. */
export interface SolidHandle {
  /**
   * The mesh the queries use: the input re-oriented by `orientMesh` (closed shells wound consistently), so
   * faces exported the wrong way round do not corrupt volumes, plane positions or clipped meshes.
   */
  readonly mesh: MeshData;
  /** Local origin used for precision (bounding-box centre, world m). */
  readonly ref: Vec3;
  /** Vertex coordinates relative to `ref`. */
  readonly local: Float64Array;
  /** Enclosed volume (m³, positive). */
  readonly volume: number;
  /** Volume centroid (world m). */
  readonly centroid: Vec3;
  /** +1 when the triangles wind outward (CCW seen from outside), −1 when inward. */
  readonly orientation: 1 | -1;
  /** True when every edge has exactly two triangles (volumes are only meaningful when closed). */
  readonly closed: boolean;
  /** Triangles re-oriented relative to the input (see `orientMesh`). */
  readonly flippedTriangles: number;
  /** User-facing notes on winding repairs or fallbacks (from `orientMesh`); empty when none were needed. */
  readonly warnings: readonly string[];
  /** Size of the bounding box diagonal (m), used for tolerances. */
  readonly extent: number;
  /** Per-direction tables (internal cache). */
  readonly tables: Map<string, DirTable>;
}

const handles = new WeakMap<MeshData, SolidHandle>();
const MAX_TABLES = 8;

/**
 * Precomputes what depletion queries need for a closed mesh (cached per MeshData object, so calling it
 * again with the same mesh is free). The mesh is re-oriented first (`orientMesh`), so volume, centroid,
 * depletion planes, caps and clipped meshes all use consistently wound triangles.
 */
export function prepareSolid(mesh: MeshData): SolidHandle {
  const hit = handles.get(mesh);
  if (hit) return hit;
  const bb = meshBBox(mesh);
  const ref: Vec3 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
  const v = mesh.verts, n = v.length / 3, local = new Float64Array(v.length);
  for (let i = 0; i < n; i++) {
    local[i * 3] = v[i * 3] - ref[0]; local[i * 3 + 1] = v[i * 3 + 1] - ref[1]; local[i * 3 + 2] = v[i * 3 + 2] - ref[2];
  }
  const o = orientMesh(mesh);
  const t = o.mesh.tris;
  let vol6 = 0, cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const d = det(local, a, b, c);
    vol6 += d;
    cx += d * (local[a] + local[b] + local[c]);
    cy += d * (local[a + 1] + local[b + 1] + local[c + 1]);
    cz += d * (local[a + 2] + local[b + 2] + local[c + 2]);
  }
  const orientation: 1 | -1 = vol6 < 0 ? -1 : 1;
  const centroid: Vec3 = Math.abs(vol6) > 0
    ? [ref[0] + cx / (4 * vol6), ref[1] + cy / (4 * vol6), ref[2] + cz / (4 * vol6)]
    : [...ref] as Vec3;
  const h: SolidHandle = {
    mesh: o.mesh, ref, local, volume: Math.abs(vol6) / 6, centroid, orientation,
    closed: o.topology.closed, flippedTriangles: o.flippedTriangles, warnings: o.warnings,
    extent: Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]),
    tables: new Map(),
  };
  handles.set(mesh, h);
  return h;
}

const asHandle = (x: MeshData | SolidHandle): SolidHandle => ('local' in x ? x : prepareSolid(x));

function det(p: Float64Array, a: number, b: number, c: number): number {
  const ax = p[a], ay = p[a + 1], az = p[a + 2], bx = p[b], by = p[b + 1], bz = p[b + 2], cx = p[c], cy = p[c + 1], cz = p[c + 2];
  return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

/** Unit normal of the depletion plane for a mode (see module notes). */
export function depletionNormal(mode: DepletionMode, azimuthDeg = 0): Vec3 {
  if (mode === 'bench-down') return [0, 0, -1];
  if (mode === 'bottom-up') return [0, 0, 1];
  const r = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r), 0];
}

function unit(n: Vec3): { n: Vec3; len: number } {
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 0)) throw new Error('Plane normal must be a non-zero vector');
  return { n: [n[0] / len, n[1] / len, n[2] / len], len };
}

function table(h: SolidHandle, n: Vec3): DirTable {
  const key = `${n[0].toFixed(12)},${n[1].toFixed(12)},${n[2].toFixed(12)}`;
  const hit = h.tables.get(key);
  if (hit) return hit;
  const p = h.local, t = h.mesh.tris, V = p.length / 3, T = t.length / 3;
  const proj = new Float64Array(V);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < V; i++) {
    const d = n[0] * p[i * 3] + n[1] * p[i * 3 + 1] + n[2] * p[i * 3 + 2];
    proj[i] = d; if (d < lo) lo = d; if (d > hi) hi = d;
  }
  if (!(hi >= lo)) { lo = 0; hi = 0; }
  const tmin = new Float64Array(T), tmax = new Float64Array(T);
  for (let k = 0; k < T; k++) {
    const a = proj[t[k * 3]], b = proj[t[k * 3 + 1]], c = proj[t[k * 3 + 2]];
    tmin[k] = Math.min(a, b, c); tmax[k] = Math.max(a, b, c);
  }
  const order = new Uint32Array(T);
  for (let k = 0; k < T; k++) order[k] = k;
  order.sort((x, y) => tmax[x] - tmax[y]);
  const sortedMax = new Float64Array(T);
  const pd = new Float64Array(T + 1), pnx = new Float64Array(T + 1), pny = new Float64Array(T + 1), pnz = new Float64Array(T + 1);
  for (let q = 0; q < T; q++) {
    const k = order[q];
    sortedMax[q] = tmax[k];
    const a = t[k * 3] * 3, b = t[k * 3 + 1] * 3, c = t[k * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    pd[q + 1] = pd[q] + det(p, a, b, c);
    pnx[q + 1] = pnx[q] + (uy * wz - uz * wy);
    pny[q + 1] = pny[q] + (uz * wx - ux * wz);
    pnz[q + 1] = pnz[q] + (ux * wy - uy * wx);
  }
  // straddler buckets: triangle k listed in every bin its [tmin, tmax] overlaps
  const span = Math.max(hi - lo, 1e-12);
  let bins = Math.max(1, Math.min(4096, Math.round(Math.sqrt(T) * 2)));
  const budget = Math.max(8 * T, 1 << 20);
  let total = 0;
  for (;;) {
    total = 0;
    const w = span / bins;
    for (let k = 0; k < T; k++) total += Math.min(bins - 1, Math.floor((tmax[k] - lo) / w)) - Math.min(bins - 1, Math.floor((tmin[k] - lo) / w)) + 1;
    if (total <= budget || bins === 1) break;
    bins = Math.max(1, bins >> 1);
  }
  const binW = span / bins;
  const binStart = new Uint32Array(bins + 1);
  const b0 = (x: number) => Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / binW)));
  for (let k = 0; k < T; k++) for (let b = b0(tmin[k]), e = b0(tmax[k]); b <= e; b++) binStart[b + 1]++;
  for (let b = 0; b < bins; b++) binStart[b + 1] += binStart[b];
  const fill = binStart.slice(0, bins);
  const binTris = new Uint32Array(binStart[bins]);
  for (let k = 0; k < T; k++) for (let b = b0(tmin[k]), e = b0(tmax[k]); b <= e; b++) binTris[fill[b]++] = k;
  const tab: DirTable = { n, proj, tmin, tmax, sortedMax, pd, pnx, pny, pnz, lo, hi, bins, binW, binStart, binTris, edgeVol: new Float64Array(bins + 1) };
  for (let b = 1; b < bins; b++) tab.edgeVol[b] = volumeBehind(h, tab, lo + b * binW);
  tab.edgeVol[bins] = h.volume;
  if (h.tables.size >= MAX_TABLES) h.tables.delete(h.tables.keys().next().value as string);
  h.tables.set(key, tab);
  return tab;
}

const binOf = (tab: DirTable, c: number) => Math.min(tab.bins - 1, Math.max(0, Math.floor((c - tab.lo) / tab.binW)));

/** Volume (m³, positive) of the part of the solid with n·x_local < c. */
function volumeBehind(h: SolidHandle, tab: DirTable, c: number): number {
  if (c <= tab.lo) return 0;
  if (c > tab.hi) return h.volume;
  const sm = tab.sortedMax;
  let a = 0, b = sm.length; // count of tmax < c
  while (a < b) { const m = (a + b) >> 1; if (sm[m] < c) a = m + 1; else b = m; }
  const [nx, ny, nz] = tab.n;
  const rx = nx * c, ry = ny * c, rz = nz * c;
  let vol6 = tab.pd[a] - (rx * tab.pnx[a] + ry * tab.pny[a] + rz * tab.pnz[a]);
  const p = h.local, t = h.mesh.tris, proj = tab.proj;
  const bin = binOf(tab, c);
  const poly = new Float64Array(12);
  for (let q = tab.binStart[bin], e = tab.binStart[bin + 1]; q < e; q++) {
    const k = tab.binTris[q];
    if (!(tab.tmin[k] < c && tab.tmax[k] >= c)) continue;
    let m = 0;
    for (let j = 0; j < 3; j++) {
      const i0 = t[k * 3 + j], i1 = t[k * 3 + ((j + 1) % 3)];
      const d0 = proj[i0] - c, d1 = proj[i1] - c;
      if (d0 < 0) { poly[m++] = p[i0 * 3] - rx; poly[m++] = p[i0 * 3 + 1] - ry; poly[m++] = p[i0 * 3 + 2] - rz; }
      if ((d0 < 0) !== (d1 < 0)) {
        const f = d0 / (d0 - d1);
        poly[m++] = p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * f - rx;
        poly[m++] = p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * f - ry;
        poly[m++] = p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * f - rz;
      }
    }
    for (let j = 3; j + 3 < m; j += 3) vol6 += det(poly, 0, j, j + 3);
  }
  return Math.max(0, Math.min(h.volume, (h.orientation * vol6) / 6));
}

function localConstant(h: SolidHandle, plane: Plane): { n: Vec3; c: number } {
  const { n, len } = unit(plane.normal);
  return { n, c: plane.constant / len - (n[0] * h.ref[0] + n[1] * h.ref[1] + n[2] * h.ref[2]) };
}

/** Volume (m³) of the solid on the FRONT side of the plane (normal·p > constant): still to dig / to fill. */
export function volumeBeyondPlane(mesh: MeshData | SolidHandle, plane: Plane): number {
  const h = asHandle(mesh);
  const { n, c } = localConstant(h, plane);
  return h.volume - volumeBehind(h, table(h, n), c);
}

/** Volume (m³) of the solid on the BACK side of the plane (normal·p < constant): dug / placed. */
export function volumeBehindPlane(mesh: MeshData | SolidHandle, plane: Plane): number {
  const h = asHandle(mesh);
  const { n, c } = localConstant(h, plane);
  return volumeBehind(h, table(h, n), c);
}

/** Result of `depletionPlane`. */
export interface DepletionPlane extends Plane {
  /** Unit normal: the direction the face moves (world). */
  normal: Vec3;
  /** A point on the plane (world m): the solid's centroid projected onto it. */
  point: Vec3;
  /** normal·p = constant for points p on the plane (world). */
  constant: number;
  /** Volume behind the plane: dug (dig) or placed (dump) (m³). */
  volumeRemoved: number;
  /** Whole solid volume (m³). */
  volumeTotal: number;
  /** volumeRemoved / volumeTotal achieved (within ±0.001 % of the request). */
  fraction: number;
}

/**
 * The plane at which `fraction` (0 … 1) of the solid has been removed (dig) or placed (dump): bracketed by
 * the cached bin-edge volume table, then refined by regula falsi / bisection to ±0.001 % of the solid volume.
 * @param azimuthDeg plan direction of a 'face-advance', degrees clockwise from grid north (ignored otherwise)
 */
export function depletionPlane(
  mesh: MeshData | SolidHandle, mode: DepletionMode, azimuthDeg: number, fraction: number,
): DepletionPlane {
  const h = asHandle(mesh);
  const n = depletionNormal(mode, azimuthDeg);
  const tab = table(h, n);
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const target = f * h.volume;
  let c: number, vol: number;
  if (f <= 0) { c = tab.lo; vol = 0; }
  else if (f >= 1) { c = tab.hi; vol = h.volume; }
  else {
    // bracket from the bin-edge table, then Illinois regula falsi (bisection fallback) inside one bin
    const ev = tab.edgeVol;
    let lo = 0, hi = tab.bins;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ev[m] < target) lo = m; else hi = m; }
    let a = tab.lo + lo * tab.binW, b = lo + 1 >= tab.bins ? tab.hi : tab.lo + (lo + 1) * tab.binW;
    let fa = ev[lo] - target, fb = ev[lo + 1] - target, side = 0;
    const tol = 1e-5 * h.volume;
    c = a; vol = ev[lo];
    for (let it = 0; it < 60; it++) {
      c = fb !== fa ? b - (fb * (b - a)) / (fb - fa) : (a + b) / 2;
      if (!(c > a && c < b)) c = (a + b) / 2;
      vol = volumeBehind(h, tab, c);
      const fc = vol - target;
      if (Math.abs(fc) <= tol || b - a < 1e-9 * Math.max(1, h.extent)) break;
      if ((fc < 0) === (fa < 0)) { a = c; fa = fc; if (side === -1) fb /= 2; side = -1; }
      else { b = c; fb = fc; if (side === 1) fa /= 2; side = 1; }
    }
  }
  const constant = c + n[0] * h.ref[0] + n[1] * h.ref[1] + n[2] * h.ref[2];
  const g = h.centroid, off = n[0] * g[0] + n[1] * g[1] + n[2] * g[2] - constant;
  return {
    normal: n, constant, point: [g[0] - off * n[0], g[1] - off * n[1], g[2] - off * n[2]],
    volumeRemoved: vol, volumeTotal: h.volume, fraction: h.volume > 0 ? vol / h.volume : 0,
  };
}

/** Which part of a clipped solid to keep. */
export type KeepSide = 'front' | 'back';

/** Result of `capLoops`. */
export interface CapResult {
  /** Closed cut loops (world m). Outer loops wind CCW about the cap normal, holes CW. */
  loops: Vec3[][];
  /** Cap triangulation (world coordinates) facing the cap normal. */
  mesh: MeshData;
  /** Cap area (m²). */
  area: number;
  /** Cap normal (outward from the kept side): −normal for keep 'front', +normal for 'back'. */
  normal: Vec3;
  /** Chains that did not close (the mesh is not closed along the cut). */
  openChains: number;
}

/** Nudges c off any vertex lying (numerically) on the plane, so every crossing is strictly inside an edge. */
function clearOfVertices(h: SolidHandle, proj: Float64Array, c: number, candidates: (c: number) => Iterable<number>): number {
  const eps = 1e-9 * Math.max(1, h.extent);
  for (let attempt = 0; attempt < 8; attempt++) {
    let hit = false;
    for (const i of candidates(c)) if (Math.abs(proj[i] - c) < eps) { hit = true; break; }
    if (!hit) return c;
    c += 3 * eps * (attempt + 1);
  }
  return c;
}

interface CutSegments {
  /** edge key per segment end */
  keys: number[];
  /** local crossing point per segment end (x, y, z) */
  pts: number[];
}

/** Plane–mesh crossing segments (local coordinates) for triangles strictly straddling c. */
function cutSegments(h: SolidHandle, tab: DirTable, c: number, all: boolean): CutSegments {
  const p = h.local, t = h.mesh.tris, proj = tab.proj, V = p.length / 3;
  const keys: number[] = [], pts: number[] = [];
  const visit = (k: number) => {
    if (!(tab.tmin[k] < c && tab.tmax[k] > c)) return;
    for (let j = 0; j < 3; j++) {
      const i0 = t[k * 3 + j], i1 = t[k * 3 + ((j + 1) % 3)];
      const d0 = proj[i0] - c, d1 = proj[i1] - c;
      if ((d0 < 0) !== (d1 < 0)) {
        const f = d0 / (d0 - d1);
        pts.push(p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * f, p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * f, p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * f);
        keys.push(i0 < i1 ? i0 * V + i1 : i1 * V + i0);
      }
    }
  };
  if (all) for (let k = 0; k < t.length / 3; k++) visit(k);
  else {
    const bin = binOf(tab, c);
    for (let q = tab.binStart[bin], e = tab.binStart[bin + 1]; q < e; q++) visit(tab.binTris[q]);
  }
  return { keys, pts };
}

function binVertices(h: SolidHandle, tab: DirTable): (c: number) => Iterable<number> {
  const t = h.mesh.tris;
  return function* (c: number) {
    const bin = binOf(tab, c);
    for (let q = tab.binStart[bin], e = tab.binStart[bin + 1]; q < e; q++) {
      const k = tab.binTris[q];
      yield t[k * 3]; yield t[k * 3 + 1]; yield t[k * 3 + 2];
    }
  };
}

/** Orthonormal plan basis (u, v) with u × v = m. */
function basis(m: Vec3): { u: Vec3; v: Vec3 } {
  const a: Vec3 = Math.abs(m[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u: Vec3 = [a[1] * m[2] - a[2] * m[1], a[2] * m[0] - a[0] * m[2], a[0] * m[1] - a[1] * m[0]];
  const l = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / l, u[1] / l, u[2] / l];
  const v: Vec3 = [m[1] * u[2] - m[2] * u[1], m[2] * u[0] - m[0] * u[2], m[0] * u[1] - m[1] * u[0]];
  return { u, v };
}

interface CapTriangulation {
  /** loops as lists of point ids, outer CCW / holes CW about m */
  loops: number[][];
  /** triangles (point ids), CCW about m */
  tris: number[];
  area: number;
  open: number;
}

/**
 * Chains segments into loops, orients them (even nesting depth = outer, odd = hole) and ear-clips each outer
 * loop with its holes. Point ids are segment-end ids resolved through `pointOf` (shared ends → same id).
 */
function triangulateCut(keys: number[], pts2: (end: number) => [number, number]): CapTriangulation {
  const chains = chainSegments(keys, keys.length / 2);
  const loops: number[][] = [];
  let open = 0;
  for (const ch of chains) { if (ch.closed && ch.ends.length >= 3) loops.push(ch.ends); else open++; }
  const flats = loops.map(l => { const f = new Float64Array(l.length * 2); l.forEach((e, i) => { const q = pts2(e); f[i * 2] = q[0]; f[i * 2 + 1] = q[1]; }); return f; });
  const areas = flats.map(f => ringArea(f));
  const depth = loops.map((_, i) => {
    let d = 0;
    for (let j = 0; j < loops.length; j++) if (j !== i && Math.abs(areas[j]) > Math.abs(areas[i]) && pointInRing(flats[i][0], flats[i][1], flats[j])) d++;
    return d;
  });
  // orient: outer CCW (area > 0), holes CW
  for (let i = 0; i < loops.length; i++) {
    const wantCcw = depth[i] % 2 === 0;
    if ((areas[i] > 0) !== wantCcw) {
      loops[i].reverse();
      const f = flats[i], n = f.length >> 1, g = new Float64Array(f.length);
      for (let k = 0; k < n; k++) { g[k * 2] = f[(n - 1 - k) * 2]; g[k * 2 + 1] = f[(n - 1 - k) * 2 + 1]; }
      flats[i] = g; areas[i] = -areas[i];
    }
  }
  const tris: number[] = [];
  let area = 0;
  for (let i = 0; i < loops.length; i++) {
    if (depth[i] % 2 !== 0) continue;
    const holes: number[] = [];
    for (let j = 0; j < loops.length; j++) {
      if (depth[j] !== depth[i] + 1) continue;
      if (Math.abs(areas[j]) < Math.abs(areas[i]) && pointInRing(flats[j][0], flats[j][1], flats[i])) holes.push(j);
    }
    const rings = [flats[i], ...holes.map(j => flats[j])];
    const ids = [loops[i], ...holes.map(j => loops[j])].flat();
    const tri = triangulatePolygon(rings);
    const all = rings.flatMap(r => Array.from(r));
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      area += ((all[b * 2] - all[a * 2]) * (all[c * 2 + 1] - all[a * 2 + 1]) - (all[b * 2 + 1] - all[a * 2 + 1]) * (all[c * 2] - all[a * 2])) / 2;
      tris.push(ids[a], ids[b], ids[c]);
    }
  }
  return { loops, tris, area, open };
}

/**
 * The planar cut face(s) of a closed solid on the plane, as closed loops and a triangulated cap, so the
 * renderer can draw the cut face of the kept part.
 * @param keep side whose cut face is wanted (cap faces away from it; default 'front' = remaining dig volume)
 */
export function capLoops(mesh: MeshData | SolidHandle, plane: Plane, keep: KeepSide = 'front'): CapResult {
  const h = asHandle(mesh);
  const lc = localConstant(h, plane);
  const tab = table(h, lc.n);
  const m: Vec3 = keep === 'front' ? [0 - lc.n[0], 0 - lc.n[1], 0 - lc.n[2]] : [...lc.n] as Vec3;
  const c = clearOfVertices(h, tab.proj, lc.c, binVertices(h, tab));
  const empty: CapResult = { loops: [], mesh: { verts: new Float64Array(0), tris: new Uint32Array(0) }, area: 0, normal: m, openChains: 0 };
  if (!(c > tab.lo && c < tab.hi)) return empty;
  const seg = cutSegments(h, tab, c, false);
  if (!seg.keys.length) return empty;
  const { u, v } = basis(m);
  const pts2 = (e: number): [number, number] => {
    const x = seg.pts[e * 3], y = seg.pts[e * 3 + 1], z = seg.pts[e * 3 + 2];
    return [x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]];
  };
  const cut = triangulateCut(seg.keys, pts2);
  // compact the used segment ends into a vertex list
  const idOf = new Map<number, number>();
  const verts: number[] = [];
  const vid = (e: number) => {
    let id = idOf.get(e);
    if (id === undefined) {
      id = verts.length / 3; idOf.set(e, id);
      verts.push(seg.pts[e * 3] + h.ref[0], seg.pts[e * 3 + 1] + h.ref[1], seg.pts[e * 3 + 2] + h.ref[2]);
    }
    return id;
  };
  const loops: Vec3[][] = cut.loops.map(l => l.map(e => { const i = vid(e) * 3; return [verts[i], verts[i + 1], verts[i + 2]] as Vec3; }));
  const tris = cut.tris.map(vid);
  return { loops, mesh: { verts: Float64Array.from(verts), tris: Uint32Array.from(tris) }, area: cut.area, normal: m, openChains: cut.open };
}

/**
 * Clips a closed solid by the plane, keeping one side, and closes it with a triangulated cap.
 * The result is a closed MeshData (world coordinates) wound like the handle's re-oriented mesh (the input's
 * majority winding). Use it instead of GPU clipping planes when the cut face must be drawn.
 */
export function clipMesh(mesh: MeshData | SolidHandle, plane: Plane, keep: KeepSide): MeshData {
  const h = asHandle(mesh);
  const lc = localConstant(h, plane);
  const tab = table(h, lc.n);
  const p = h.local, t = h.mesh.tris, V = p.length / 3, proj = tab.proj;
  const allVerts = function* () { for (let i = 0; i < V; i++) yield i; };
  const c = clearOfVertices(h, proj, lc.c, allVerts);
  const sideKeep = (d: number) => (keep === 'front' ? d > 0 : d < 0);
  const out: number[] = [];
  const newId = new Int32Array(V).fill(-1);
  const keepV = (i: number) => {
    if (newId[i] < 0) { newId[i] = out.length / 3; out.push(p[i * 3] + h.ref[0], p[i * 3 + 1] + h.ref[1], p[i * 3 + 2] + h.ref[2]); }
    return newId[i];
  };
  const edgeId = new Map<number, number>();
  const crossV = (i0: number, i1: number) => {
    const key = i0 < i1 ? i0 * V + i1 : i1 * V + i0;
    let id = edgeId.get(key);
    if (id === undefined) {
      const a = i0 < i1 ? i0 : i1, b = i0 < i1 ? i1 : i0; // same point whichever triangle asks
      const f = (proj[a] - c) / (proj[a] - proj[b]);
      id = out.length / 3; edgeId.set(key, id);
      out.push(
        p[a * 3] + (p[b * 3] - p[a * 3]) * f + h.ref[0],
        p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * f + h.ref[1],
        p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * f + h.ref[2],
      );
    }
    return { id, key };
  };
  const tris: number[] = [];
  const segKeys: number[] = [], segIds: number[] = [];
  const poly: number[] = [];
  for (let k = 0; k < t.length; k += 3) {
    const i = [t[k], t[k + 1], t[k + 2]];
    const kp = i.map(x => sideKeep(proj[x] - c));
    if (kp[0] && kp[1] && kp[2]) { tris.push(keepV(i[0]), keepV(i[1]), keepV(i[2])); continue; }
    if (!kp[0] && !kp[1] && !kp[2]) continue;
    poly.length = 0;
    for (let j = 0; j < 3; j++) {
      const a = i[j], b = i[(j + 1) % 3];
      if (kp[j]) poly.push(keepV(a));
      if (kp[j] !== kp[(j + 1) % 3]) {
        const x = crossV(a, b);
        poly.push(x.id);
        segKeys.push(x.key); segIds.push(x.id);
      }
    }
    for (let j = 1; j + 1 < poly.length; j++) tris.push(poly[0], poly[j], poly[j + 1]);
  }
  // cap: chain the crossing vertices (each straddling triangle contributed one segment = 2 ends)
  const m: Vec3 = keep === 'front' ? [0 - lc.n[0], 0 - lc.n[1], 0 - lc.n[2]] : [...lc.n] as Vec3;
  const { u, v } = basis(m);
  const pts2 = (e: number): [number, number] => {
    const q = segIds[e] * 3;
    const x = out[q] - h.ref[0], y = out[q + 1] - h.ref[1], z = out[q + 2] - h.ref[2];
    return [x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]];
  };
  const cut = triangulateCut(segKeys, pts2);
  for (let q = 0; q < cut.tris.length; q += 3) {
    const a = segIds[cut.tris[q]], b = segIds[cut.tris[q + 1]], cc = segIds[cut.tris[q + 2]];
    if (h.orientation > 0) tris.push(a, b, cc); else tris.push(a, cc, b);
  }
  return { verts: Float64Array.from(out), tris: Uint32Array.from(tris) };
}

/** A plane in Three.js convention: points with normal·p + constant ≥ 0 are kept (scene frame). */
export interface ScenePlane { normal: [number, number, number]; constant: number }

/**
 * Converts a world plane to a Three.js clipping plane in the scene frame of core/frame.ts
 * (x = E − E0, y = (Z − Z0)·vx, z = −(N − N0)).
 * @param keep side to keep visible: 'front' (still to dig / fill) or 'back' (dug / placed)
 */
export function toScenePlane(plane: Plane, origin: Vec3, verticalExaggeration = 1, keep: KeepSide = 'front'): ScenePlane {
  const { n, len } = unit(plane.normal);
  const c = plane.constant / len;
  const vx = verticalExaggeration;
  // world p = (x + E0, −z + N0, y / vx + Z0); n·p − c ≥ 0 keeps the front side
  let sn: [number, number, number] = [n[0], n[2] / vx, -n[1]];
  let sc = n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2] - c;
  const l = Math.hypot(sn[0], sn[1], sn[2]);
  sn = [sn[0] / l, sn[1] / l, sn[2] / l]; sc /= l;
  return keep === 'front' ? { normal: sn, constant: sc } : { normal: [-sn[0], -sn[1], -sn[2]], constant: -sc };
}
