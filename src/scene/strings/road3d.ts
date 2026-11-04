/**
 * The haul road as a real road for the ride cameras (POV / chase): a compacted-gravel carriageway at the string's
 * `roadWidthM` with a slight crown, worn wheel tracks along the keep-left lanes, a faint centreline when the road is
 * two-way, rubble windrows (bunds) at `bundHeightM` on both edges (opening at the dig / dump ends and where another road
 * joins) with fill batters down to the ground, and delineator posts every 50 m on both edges (red reflector on the
 * driver's left, white on the right; they glow at night). The grade colour stays on the map ribbon and the HUD profile.
 *
 * Geometry is built once per string revision in world → scene space; the look is one MeshStandardMaterial with a
 * procedural gravel albedo (tileable noise texture, no image assets) so it takes the scene's sun, sky, fog, shadows and
 * the headlights like the terrain does.
 */
import * as THREE from 'three';
import type { HaulString, Scenario } from '@/core/types';
import { worldToScene, type Frame } from '@/core/frame';
import type { PathTable } from './path';
import { circuitOfString } from './palette';

// ── dimensions shared with the actors (lanes, shoulder, wheel tracks) ───────────────────────────────────────────────

export interface RoadDims {
  /** Carriageway width (m). */
  widthM: number;
  /** Windrow height (m), 0 = none. */
  bundM: number;
  /** Wide enough for two-way traffic (≥ 3 × the widest truck): draws a centreline. */
  twoWay: boolean;
  /** Keep-left lane centre offset from the centreline (m). */
  laneM: number;
  /** Where a stopped truck pulls over (m from the centreline). */
  shoulderM: number;
  /** Half the spacing between a truck's left and right wheel tracks (m). */
  trackM: number;
  /** Widest truck on the road (m). */
  truckW: number;
}

export const DEFAULT_ROAD_WIDTH_M = 30;
export const DEFAULT_BUND_M = 1.8;

/** Road dimensions of a string (defaults: 30 m wide, 1.8 m windrows), sized to the trucks that use it. */
export function roadDims(s: Scenario, hs: HaulString): RoadDims {
  const widthM = Math.max(6, hs.roadWidthM ?? DEFAULT_ROAD_WIDTH_M);
  const bundM = Math.max(0, hs.bundHeightM ?? DEFAULT_BUND_M);
  let truckW = 0;
  for (const c of s.circuits) {
    if (c.haulStringId !== hs.id && !c.altHaulStringIds?.includes(hs.id)) continue;
    const m = s.fleet.trucks.find(t => t.id === c.truckModelId);
    if (m) truckW = Math.max(truckW, m.dims.width);
  }
  if (!truckW) {
    const c = circuitOfString(s, hs.id);
    truckW = s.fleet.trucks.find(t => t.id === c?.truckModelId)?.dims.width ?? Math.max(0, ...s.fleet.trucks.map(t => t.dims.width));
  }
  truckW = truckW > 1 ? truckW : 7.6;
  const half = widthM / 2;
  const laneM = Math.max(Math.min(3.2, half - truckW / 2), Math.min(widthM / 4, 9));
  const shoulderM = Math.max(laneM, Math.min(laneM + 10, half - truckW / 2 - 0.8));
  return { widthM, bundM, twoWay: widthM >= 3 * truckW, laneM, shoulderM, trackM: 0.36 * truckW, truckW };
}

// ── centreline smoothing ────────────────────────────────────────────────────────────────────────────────────────────

interface Centre { e: number[]; n: number[]; z: number[]; s: number[]; tx: number[]; ty: number[] }

/**
 * Rounds the string's corners for the road surface (quadratic Bézier over at most 22 m either side of each vertex, so
 * the road never strays far from the line the trucks drive) and resamples it every ≤ `step` m of plan length.
 */
export function smoothCentre(path: PathTable, step = 4): Centre {
  const n = path.n;
  const P: [number, number, number][] = [];
  const push = (e: number, nn: number, z: number) => {
    const q = P[P.length - 1];
    if (!q || Math.hypot(e - q[0], nn - q[1]) > 0.05) P.push([e, nn, z]);
  };
  const line = (a: [number, number, number], b: [number, number, number]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= k; j++) { const t = j / k; push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); }
  };
  if (n < 2) return { e: [], n: [], z: [], s: [], tx: [], ty: [] };
  push(path.e[0], path.nn[0], path.z[0]);
  let cur: [number, number, number] = [path.e[0], path.nn[0], path.z[0]];
  for (let i = 1; i < n - 1; i++) {
    const v: [number, number, number] = [path.e[i], path.nn[i], path.z[i]];
    const a = [path.e[i - 1], path.nn[i - 1], path.z[i - 1]], b = [path.e[i + 1], path.nn[i + 1], path.z[i + 1]];
    const lin = Math.hypot(v[0] - a[0], v[1] - a[1]), lout = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const d = Math.min(22, lin * 0.45, lout * 0.45);
    if (d < 0.5 || lin < 1e-6 || lout < 1e-6) { line(cur, v); cur = v; continue; }
    const A: [number, number, number] = [v[0] + (a[0] - v[0]) * (d / lin), v[1] + (a[1] - v[1]) * (d / lin), v[2] + (a[2] - v[2]) * (d / lin)];
    const B: [number, number, number] = [v[0] + (b[0] - v[0]) * (d / lout), v[1] + (b[1] - v[1]) * (d / lout), v[2] + (b[2] - v[2]) * (d / lout)];
    line(cur, A);
    const k = Math.max(2, Math.ceil((2 * d) / Math.max(1.5, step * 0.6)));
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      push(u * u * A[0] + 2 * u * t * v[0] + t * t * B[0], u * u * A[1] + 2 * u * t * v[1] + t * t * B[1], u * u * A[2] + 2 * u * t * v[2] + t * t * B[2]);
    }
    cur = B;
  }
  line(cur, [path.e[n - 1], path.nn[n - 1], path.z[n - 1]]);
  const m = P.length;
  const c: Centre = { e: new Array(m), n: new Array(m), z: new Array(m), s: new Array(m), tx: new Array(m), ty: new Array(m) };
  let acc = 0;
  for (let i = 0; i < m; i++) {
    c.e[i] = P[i][0]; c.n[i] = P[i][1]; c.z[i] = P[i][2];
    if (i) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    c.s[i] = acc;
    const a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    c.tx[i] = dx / l; c.ty[i] = dy / l;
  }
  return c;
}

// ── plan-distance lookups between roads (junctions: open the windrows; overlaps: one surface wins) ─────────────────

class SegIndex {
  private cells = new Map<string, number[]>();
  private seg: number[] = [];
  constructor(private readonly cell = 40) {}
  add(c: Centre, tag: number) {
    for (let i = 0; i < c.e.length - 1; i++) {
      const k = this.seg.length;
      this.seg.push(c.e[i], c.n[i], c.e[i + 1], c.n[i + 1], tag);
      const x0 = Math.floor(Math.min(c.e[i], c.e[i + 1]) / this.cell), x1 = Math.floor(Math.max(c.e[i], c.e[i + 1]) / this.cell);
      const y0 = Math.floor(Math.min(c.n[i], c.n[i + 1]) / this.cell), y1 = Math.floor(Math.max(c.n[i], c.n[i + 1]) / this.cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        let a = this.cells.get(key);
        if (!a) { a = []; this.cells.set(key, a); }
        a.push(k);
      }
    }
  }
  /** Smallest plan distance from (e, n) to a segment of a road whose tag passes `use`, within `r` m (else Infinity). */
  near(e: number, n: number, r: number, use: (tag: number) => boolean): { d: number; tag: number } {
    let best = Infinity, bt = -1;
    const x0 = Math.floor((e - r) / this.cell), x1 = Math.floor((e + r) / this.cell), y0 = Math.floor((n - r) / this.cell), y1 = Math.floor((n + r) / this.cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const a = this.cells.get(`${x},${y}`);
      if (!a) continue;
      for (const k of a) {
        const tag = this.seg[k + 4];
        if (!use(tag)) continue;
        const ax = this.seg[k], ay = this.seg[k + 1], bx = this.seg[k + 2], by = this.seg[k + 3];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((e - ax) * dx + (n - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(ax + dx * t - e, ay + dy * t - n);
        if (d < best) { best = d; bt = tag; }
      }
    }
    return { d: best, tag: bt };
  }
}

// ── geometry ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RoadInput { id: string; path: PathTable; dims: RoadDims }

export interface DelineatorPost { x: number; y: number; z: number; yaw: number; side: 1 | -1 }

export interface BuiltRoad { geometry: THREE.BufferGeometry; posts: DelineatorPost[]; dims: RoadDims }

const hash = (x: number) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Windrow cross-section: offsets out from the carriageway edge (× run) and height fractions. */
const BUND_D = [0, 0.3, 0.7, 1.0, 1.0, 1.0, 1.3, 1.7, 2.0];
const BUND_H = [0, 0.3, 0.76, 0.97, 1.0, 0.97, 0.76, 0.3, 0];
const CREST = 0.55;
/** Ground probes round a carriageway vertex: [along, across] m. */
const GROUND_PROBE: [number, number][] = [[0, 0], [2.1, 0], [-2.1, 0], [0, 1.3], [0, -1.3]];

/**
 * Builds every road together (windrows open where another road's carriageway reaches them; where two carriageways
 * overlap the earlier string's surface sits on top).
 */
export function buildRoads(roads: RoadInput[], frame: Frame, heightAt: (e: number, n: number) => number | null): Map<string, BuiltRoad> {
  const centres = roads.map(r => smoothCentre(r.path, 4));
  const idx = new SegIndex();
  centres.forEach((c, i) => idx.add(c, i));
  const out = new Map<string, BuiltRoad>();
  roads.forEach((r, ri) => {
    const c = centres[ri];
    if (c.e.length < 2) return;
    out.set(r.id, buildOne(r, c, ri, roads, idx, frame, heightAt));
  });
  return out;
}

function buildOne(r: RoadInput, c: Centre, ri: number, roads: RoadInput[], idx: SegIndex, frame: Frame, heightAt: (e: number, n: number) => number | null): BuiltRoad {
  const { widthM, bundM } = r.dims;
  const hw = widthM / 2, m = c.e.length, L = c.s[m - 1];
  const run = Math.max(0.6, 1.35 * bundM);
  const crown = Math.min(0.14, 0.01 * hw);
  const COLS = 13;                                   // carriageway columns
  const NB = BUND_D.length;
  const pos: number[] = [], aRoad: number[] = [], uv: number[] = [], index: number[] = [];
  const posts: DelineatorPost[] = [];
  const S = (e: number, n: number, z: number) => worldToScene(frame, e, n, z);
  /** aRoad = (lateral m, chainage m, distance beyond the carriageway edge m (< 0 on the road), windrow factor 0..1). */
  const vert = (e: number, n: number, z: number, lat: number, ch: number, edge: number, bf: number) => {
    const p = S(e, n, z);
    pos.push(p[0], p[1], p[2]);
    aRoad.push(lat, ch, edge, bf);
    uv.push(lat / 2.6, ch / 2.6);
  };
  const sheet = (base: number, cols: number) => {
    for (let i = 0; i < m - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const a = base + i * cols + j, b = a + 1, d = a + cols, e = d + 1;
      index.push(a, b, d, b, e, d);
    }
  };
  const halfOf = (tag: number) => roads[tag].dims.widthM / 2;
  const zc = (i: number, l: number) => c.z[i] + 0.04 + crown * (1 - Math.min(1, (l / hw) ** 2));

  // per side: where the ground rises into a cut bank, the carriageway ends at its toe and there is no windrow
  // (the bank is the barrier); elsewhere the full width and a windrow, opening at the ends and at junctions
  const hwS: number[][] = [[], []], cut: boolean[][] = [[], []];
  for (const [si, side] of [[0, -1], [1, 1]] as const) {
    for (let i = 0; i < m; i++) {
      const rx = c.ty[i], ry = -c.tx[i];
      let cutAt = Infinity;
      for (let l = 0.4 * hw; l <= hw + run * 2 + CREST; l += 1) {
        const zt = heightAt(c.e[i] + rx * side * l, c.n[i] + ry * side * l);
        if (zt != null && zt > zc(i, Math.min(l, hw)) + 0.7) { cutAt = l; break; }
      }
      hwS[si][i] = cutAt < hw ? Math.max(0.45 * hw, cutAt - 0.4) : hw;
      cut[si][i] = cutAt < hw + run;
    }
    // smooth the edge along the road
    const raw = hwS[si].slice();
    for (let i = 0; i < m; i++) {
      let a = 0, w = 0;
      for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < m) { const wk = 4 - Math.abs(k); a += raw[j] * wk; w += wk; } }
      hwS[si][i] = Math.min(raw[i] + 1.5, a / w);
    }
  }
  const f: number[][] = [[], []];
  for (const [si, side] of [[0, -1], [1, 1]] as const) {
    const raw: number[] = [];
    for (let i = 0; i < m; i++) {
      const rx = c.ty[i], ry = -c.tx[i];
      const lm = side * (hwS[si][i] + run + CREST / 2);
      const o = idx.near(c.e[i] + rx * lm, c.n[i] + ry * lm, 80, t => t !== ri);
      // open only where the windrow would stand inside another carriageway (a junction); a road sharing the same
      // corridor keeps it (its own windrow stands in the same place)
      const blocked = (o.tag >= 0 && o.d < halfOf(o.tag) - 0.5) || cut[si][i] || bundM <= 0.05;
      raw.push(blocked ? 0 : smooth(18, 48, c.s[i]) * smooth(18, 48, L - c.s[i]));
    }
    // taper the openings over ~20 m
    for (let i = 0; i < m; i++) {
      let lo = 1;
      for (let k = -5; k <= 5; k++) { const j = i + k; if (j >= 0 && j < m) lo = Math.min(lo, raw[j] + Math.abs(k) * 0.2); }
      f[si][i] = Math.min(raw[i], lo);
    }
  }

  // carriageway (columns left → right); conform up to small bumps of the ground so it never speckles through
  const edgeZ: number[][] = [[], []];
  for (let i = 0; i < m; i++) {
    const rx = c.ty[i], ry = -c.tx[i];
    const hl = hwS[0][i], hr = hwS[1][i];
    for (let j = 0; j < COLS; j++) {
      const l = -hl + ((hl + hr) * j) / (COLS - 1);
      const e = c.e[i] + rx * l, n = c.n[i] + ry * l;
      let z = zc(i, l);
      // the highest ground round the vertex (the terrain's own triangles must not poke up between road vertices)
      let zt: number | null = null;
      for (const [da, dl] of GROUND_PROBE) {
        const h = heightAt(e + c.tx[i] * da + rx * dl, n + c.ty[i] * da + ry * dl);
        if (h != null && (zt == null || h > zt)) zt = h;
      }
      if (zt != null && zt > z - 0.06 && zt < z + 0.9) z = zt + 0.08;
      // under an earlier road's carriageway: sit just below it so that surface wins
      const o = idx.near(e, n, hw + 30, t => t < ri);
      if (o.tag >= 0 && o.d < halfOf(o.tag) - 0.5) z -= 0.12;
      const edge = l < 0 ? -l - hl : l - hr;
      vert(e, n, z, l, c.s[i], edge, l < 0 ? f[0][i] : f[1][i]);
      if (j === 0) edgeZ[0][i] = z;
      if (j === COLS - 1) edgeZ[1][i] = z;
    }
  }
  sheet(0, COLS);

  // windrows (a flat skirt where there is none, so the edge still meets the ground)
  for (const [si, side] of [[0, -1], [1, 1]] as const) {
    const base = pos.length / 3;
    for (let i = 0; i < m; i++) {
      const rx = c.ty[i], ry = -c.tx[i];
      const ze = edgeZ[si][i], k = f[si][i];
      const bh = bundM * k * (0.86 + 0.28 * vnoise(c.s[i] / 11 + side * 17.3));
      // fill batter: when the ground falls away outside, the outer face runs down to it
      const lOut = side * (hwS[si][i] + run * 2 + CREST);
      const zt = heightAt(c.e[i] + rx * lOut, c.n[i] + ry * lOut);
      const drop = zt == null ? 0 : Math.max(0, Math.min(30, ze - zt));
      // left side columns run outer → inner so every sheet's columns increase to the right
      for (let jj = 0; jj < NB; jj++) {
        const j = side < 0 ? NB - 1 - jj : jj;
        const t = j >= 5 ? (j - 4) / 4 : 0;
        const dd = BUND_D[j] * run + (j === 4 ? CREST / 2 : j >= 5 ? CREST : 0) + drop * 1.35 * t;
        const lat = side * (hwS[si][i] + dd);
        const e = c.e[i] + rx * lat, n = c.n[i] + ry * lat;
        // no windrow (junction / ends): the skirt dips just below the road surface so it never shows through another road
        const z = ze - drop * t + BUND_H[j] * bh - (j === NB - 1 ? 0.25 : 0) - (1 - k) * 0.3 * Math.min(1, dd / run);
        vert(e, n, z, lat, c.s[i], dd, k);
      }
    }
    sheet(base, NB);
    // delineators every 50 m on the inner face of the windrow (none where a cut bank or a junction takes over)
    for (let s0 = 25; s0 < L - 20; s0 += 50) {
      let i = 0;
      while (i < m - 2 && c.s[i + 1] < s0) i++;
      if (f[si][i] < 0.9) continue;
      const t = (s0 - c.s[i]) / Math.max(1e-6, c.s[i + 1] - c.s[i]);
      const e0 = c.e[i] + (c.e[i + 1] - c.e[i]) * t, n0 = c.n[i] + (c.n[i + 1] - c.n[i]) * t;
      const rx = c.ty[i], ry = -c.tx[i];
      const lat = side * (hwS[si][i] + 0.5);
      // a later road sharing an earlier road's corridor leaves the posts to that road
      const earlier = idx.near(e0 + rx * lat, n0 + ry * lat, 60, tg => tg < ri);
      if (earlier.tag >= 0 && earlier.d < halfOf(earlier.tag) + 4) continue;
      const ze = edgeZ[si][i] + (edgeZ[si][i + 1] - edgeZ[si][i]) * t;
      const p = S(e0 + rx * lat, n0 + ry * lat, ze + (0.5 / run) * bundM * f[si][i] - 0.05);
      posts.push({ x: p[0], y: p[1], z: p[2], yaw: Math.atan2(c.ty[i], c.tx[i]), side });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(aRoad, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, posts, dims: r.dims };
}

// ── material ────────────────────────────────────────────────────────────────────────────────────────────────────────

let noiseTex: THREE.DataTexture | null = null;

/** 256² tileable noise: R gravel height (stones on a grain), G medium blotches, B stone tint, A coarse swell. */
export function gravelNoise(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lattice = (P: number) => { const a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const vn = (lat: Float32Array, P: number, x: number, y: number) => {
    const fx = (x / N) * P, fy = (y / N) * P;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number) => lat[((j % P) + P) % P * P + ((i % P) + P) % P];
    return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
  };
  const l64 = lattice(64), l32 = lattice(32), l8 = lattice(8), l4 = lattice(4), l16 = lattice(16);
  const height = new Float32Array(N * N), tint = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    height[k] = 0.32 * vn(l64, 64, x, y) + 0.16 * vn(l32, 32, x, y);
    tint[k] = vn(l16, 16, x, y);
  }
  // stones: discs of 1–4 px with their own tint, wrapped round the tile
  for (let s = 0; s < 2300; s++) {
    const cx = rnd() * N, cy = rnd() * N, r = 0.9 + rnd() ** 2 * 3.2, h = 0.45 + rnd() * 0.5, t = rnd();
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = (dx * dx + dy * dy) / (r * r);
      if (d2 > 1) continue;
      const x = ((Math.floor(cx) + dx) % N + N) % N, y = ((Math.floor(cy) + dy) % N + N) % N, k = y * N + x;
      const v = 0.3 + h * Math.sqrt(1 - d2);
      if (v > height[k]) { height[k] = v; tint[k] = t; }
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    data[4 * k] = Math.max(0, Math.min(255, Math.round(height[k] * 255)));
    data[4 * k + 1] = Math.round(vn(l8, 8, x, y) * 255);
    data[4 * k + 2] = Math.round(tint[k] * 255);
    data[4 * k + 3] = Math.round(vn(l4, 4, x, y) * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}

export interface RoadUniforms {
  /** Windrow run (toe → crest, m) and crest width. */
  uRun: THREE.IUniform<number>;
  uCrest: THREE.IUniform<number>;
  uTwoWay: THREE.IUniform<number>;
  uLane: THREE.IUniform<number>;
  uTrack: THREE.IUniform<number>;
}

const ROAD_COL = new THREE.Color('#B2AA9B'), BUND_COL = new THREE.Color('#8F8371'), LINE_COL = new THREE.Color('#E9E5DA'), TRACK_COL = new THREE.Color('#8E877B');

/** One material per road (its width / lanes as uniforms); every road shares the compiled program. */
export function makeRoadMaterial(d: RoadDims): THREE.MeshStandardMaterial & { userData: { road: RoadUniforms } } {
  const tex = gravelNoise();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, bumpMap: tex, bumpScale: 1.1 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  const ru: RoadUniforms = { uRun: { value: Math.max(0.6, 1.35 * d.bundM) }, uCrest: { value: CREST }, uTwoWay: { value: d.twoWay ? 1 : 0 }, uLane: { value: d.laneM }, uTrack: { value: d.trackM } };
  m.userData.road = ru;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, ru, {
      uNoise: { value: tex }, uRoadCol: { value: ROAD_COL }, uBundCol: { value: BUND_COL }, uLineCol: { value: LINE_COL }, uTrackCol: { value: TRACK_COL },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uNoise;
uniform float uRun, uCrest, uTwoWay, uLane, uTrack;
uniform vec3 uRoadCol, uBundCol, uLineCol, uTrackCol;
varying vec4 vRoad;
float hkTrack(float x, float c) { float t = (x - c) / 0.85; return exp(-t * t); }`)
      .replace('#include <map_fragment>', `
  vec2 rp = vRoad.xy;
  float lat = abs(rp.x), eD = vRoad.z, bf = vRoad.w;
  float dist = length(vViewPosition);
  vec4 nF = texture2D(uNoise, rp / 2.6);
  vec4 nN = texture2D(uNoise, rp / 0.85 + 0.37);
  vec4 nM = texture2D(uNoise, rp / 17.0 + 0.11);
  vec4 nC = texture2D(uNoise, rp / 71.0 + 0.53);
  float macro = nM.g * 0.55 + nC.a * 0.45;
  float bund = smoothstep(-0.15, 0.9, eD);
  // wheel tracks along the keep-left lanes (both duals of each lane), worn unevenly
  float lanes = uTwoWay > 0.5 ? 1.0 : 0.0;
  float tk = hkTrack(rp.x, -uLane * lanes - uTrack) + hkTrack(rp.x, -uLane * lanes + uTrack);
  if (lanes > 0.5) tk += hkTrack(rp.x, uLane - uTrack) + hkTrack(rp.x, uLane + uTrack);
  tk = clamp(tk, 0.0, 1.0) * (1.0 - bund) * (0.45 + 0.55 * smoothstep(0.25, 0.75, nM.b));
  // compacted gravel: fine speckle (fades with distance into the mip average), macro blotches
  float near = 1.0 - smoothstep(30.0, 140.0, dist);
  float speck = (nF.r - 0.45) * 0.34 + (nN.r - 0.45) * 0.16 * near;
  vec3 road = uRoadCol * (0.84 + 0.26 * macro) * (1.0 + speck * (1.0 - 0.55 * tk));
  road *= mix(vec3(1.0), vec3(1.04, 1.0, 0.95), (nF.b - 0.5) * 0.6);
  road = mix(road, uTrackCol * (0.9 + 0.2 * macro), tk * 0.62);
  // loose spill along the windrow toe
  float spill = smoothstep(-2.8, -0.1, eD) * (1.0 - bund);
  road = mix(road, uBundCol * (0.86 + 0.3 * nF.b), spill * (0.25 + 0.45 * nM.r) * (0.4 + 0.6 * bf));
  road *= 1.0 - 0.16 * bf * smoothstep(-1.8, 0.0, eD) * (1.0 - bund);       // the windrow's toe shade on the road
  // centreline (two-way roads only): faint, dashed, worn
  float cl = uTwoWay * (1.0 - smoothstep(0.09, 0.17, lat)) * step(fract(rp.y / 12.0), 0.38) * (0.35 + 0.65 * nN.b) * (1.0 - bund);
  road = mix(road, uLineCol, cl * 0.6);
  // windrow rubble: coarser, browner, more varied
  vec3 rub = uBundCol * (0.8 + 0.3 * nF.r + 0.1 * (nN.g - 0.5) * near) * (0.88 + 0.2 * macro);
  rub *= mix(vec3(1.0), vec3(1.07, 1.0, 0.92), nF.b - 0.5);
  // windrow modelling: darker at the toes, the crest catches the light
  float crest = smoothstep(0.55 * uRun, uRun, eD) * (1.0 - smoothstep(uRun + uCrest, 1.45 * uRun + uCrest, eD));
  rub *= mix(1.0, 0.74, bf * (1.0 - smoothstep(0.0, 0.8 * uRun, eD))) * (1.0 + 0.16 * bf * crest);
  diffuseColor.rgb *= mix(road, rub, bund);
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.8, tk * 0.8);`);
  };
  m.customProgramCacheKey = () => 'hk-road-v2';
  return m as THREE.MeshStandardMaterial & { userData: { road: RoadUniforms } };
}

// ── delineator posts (one instanced mesh for every road) ────────────────────────────────────────────────────────────

/**
 * Guide post (mine size, 1.6 m): white body, black top band carrying a red reflector on the face towards the dig end and
 * a white one towards the dump end (so each driver sees red on the left, white on the right), black cap.
 */
export function postGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], refl: number[] = [];
  const W = 0.16, H = 1.6;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: [number, number, number], r = 0) => {
    // x along the road, y up, z across
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    for (const f of faces) for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...v[f[k]]); col.push(...c); refl.push(r); }
  };
  box(-W / 2, W / 2, -0.3, H - 0.42, -W / 2, W / 2, [0.94, 0.94, 0.91]);
  box(-W / 2, W / 2, H - 0.42, H, -W / 2, W / 2, [0.07, 0.07, 0.08]);
  // reflectors (plates proud of the band): −x face red, +x face white
  box(-W / 2 - 0.014, -W / 2 - 0.002, H - 0.36, H - 0.1, -0.05, 0.05, [0.9, 0.05, 0.03], 1);
  box(W / 2 + 0.002, W / 2 + 0.014, H - 0.36, H - 0.1, -0.05, 0.05, [0.96, 0.96, 0.93], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aRefl', new THREE.Float32BufferAttribute(refl, 1));
  g.computeVertexNormals();
  return g;
}

export interface PostUniforms { uGlow: THREE.IUniform<number> }

/** Lambert with vertex colours; reflectors gain an emissive glow at night (they return the headlights). */
export function makePostMaterial(): THREE.MeshLambertMaterial & { userData: { post: PostUniforms } } {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pu: PostUniforms = { uGlow: { value: 0 } };
  m.userData.post = pu;
  m.onBeforeCompile = sh => {
    sh.uniforms.uGlow = pu.uGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRefl;\nvarying float vRefl;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRefl = aRefl;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vRefl;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vRefl * uGlow;');
  };
  m.customProgramCacheKey = () => 'hk-post-v1';
  return m as THREE.MeshLambertMaterial & { userData: { post: PostUniforms } };
}

/** Writes the posts into an instanced mesh (posts on the right of the dig → dump direction are turned round). */
export function writePosts(im: THREE.InstancedMesh, posts: DelineatorPost[]) {
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (const p of posts) {
    if (k >= im.instanceMatrix.count) break;
    // scene heading: world plan heading h → rotation about +y by h (x = E, z = −N); right-side posts face the other way
    Q.setFromAxisAngle(up, p.yaw + (p.side > 0 ? Math.PI : 0));
    M.compose(P.set(p.x, p.y, p.z), Q, S);
    im.setMatrixAt(k++, M);
  }
  im.count = k;
  im.instanceMatrix.needsUpdate = true;
}
