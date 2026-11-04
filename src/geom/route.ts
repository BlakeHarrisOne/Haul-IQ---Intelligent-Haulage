/**
 * Least-cost haul route over a height grid (adapted from the Haul Road Lab "road follower").
 *
 * 1. Cost field per node: 1 + w_rough·roughness + w_slope·(over-steep slope) + w_centre / (1 + dist-to-wall / d0).
 *    Nodes steeper than `steepSlope` (walls, batters, bund flanks) or off the surface are impassable.
 * 2. A* on the 16-connected grid. A move costs plan distance × (mean node cost + w_grade·(grade / maxGrade)²)
 *    and is forbidden when its |rise / run| exceeds `maxGrade` (hard limit, default 10 %).
 * 3. String pulling: the path is straightened wherever a straight chord stays drivable (every sub-chord within
 *    the grade limit, no blocked node) and is no dearer than the path it replaces, then Chaikin-smoothed and
 *    simplified (each step re-validated), then resampled every `stepM` with heights from the grid.
 *
 * Grades here are rise / plan run (slightly stricter than the engine's dZ / 3D distance), so a route that
 * passes here passes the engine's ≤ 10 % too.
 */
import type { Vec3 } from '@/core/types';
import type { Grid, Vec2 } from './types';
import { gridHeightAt } from './heightIndex';
import { chaikin, simplify2d, subdivide } from './polyline';

/** Options for `autoRoute`. All lengths in metres, grades as fractions. */
export interface AutoRouteOptions {
  /** Hard maximum |rise / run| of every move and of the final string (default 0.10). */
  maxGrade?: number;
  /** Weight of the (grade / maxGrade)² penalty (default 1). */
  gradeWeight?: number;
  /** Cost per metre of local roughness |z − mean of 3×3| (default 3): smooth graded roads win. */
  roughWeight?: number;
  /** Weight for slopes between maxGrade and steepSlope (default 2): keeps off batter shoulders. */
  slopeWeight?: number;
  /** Node slope above which ground is a wall / batter and impassable (default 0.35). */
  steepSlope?: number;
  /** Pull towards the middle of roads, away from walls (default 0.5). */
  centreWeight?: number;
  /** Distance scale of the centre pull (default 6 m). */
  centreDistM?: number;
  /** 8 or 16 neighbour moves (default 16, smoother bearings). */
  connectivity?: 8 | 16;
  /** Intermediate plan points the route must pass through, in order. */
  via?: Vec2[];
  /** Ends on impassable ground move to the nearest drivable node within this radius (default 40 m). */
  snapRadiusM?: number;
  /** Output point spacing (default 25 m). */
  stepM?: number;
  /** Straighten and smooth the raw grid path (default true). */
  smooth?: boolean;
  /** Plan tolerance of the final simplification (default 1.5 m). */
  simplifyM?: number;
  /** Search window margin around the end/via points (default max(600 m, 0.8 × span)). */
  corridorM?: number;
}

/** Result of `autoRoute`. */
export interface AutoRouteResult {
  /** Route points [E, N, Z] (m), first ≈ from, last ≈ to, spaced ≤ stepM in plan. */
  points: Vec3[];
  /** Plan length (m). */
  planLengthM: number;
  /** 3D length (m). */
  lengthM: number;
  /** Largest |rise / run| between consecutive output points. */
  maxGrade: number;
  /** Mean A* cost per metre (1 = smooth flat road); high values mean the route leaves roads. */
  costPerM: number;
  /** Grid nodes expanded by A* (diagnostic). */
  expanded: number;
  warnings: string[];
}

interface Field {
  x0: number; y0: number; c: number; nx: number; ny: number;
  z: Float32Array; cost: Float32Array; blocked: Uint8Array;
}

const DEFAULTS = {
  maxGrade: 0.1, gradeWeight: 1, roughWeight: 3, slopeWeight: 2, steepSlope: 0.35, centreWeight: 0.5,
  centreDistM: 6, connectivity: 16 as 8 | 16, snapRadiusM: 40, stepM: 25, smooth: true, simplifyM: 1.5,
};

function buildField(g: Grid, i0: number, j0: number, nx: number, ny: number, o: typeof DEFAULTS): Field {
  const n = nx * ny, c = g.dx;
  const z = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = g.z[(j + j0) * g.nx + i + i0];
  const at = (i: number, j: number) => z[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const slope = new Float32Array(n), blocked = new Uint8Array(n), rough = new Float32Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, v = z[k];
    if (!(v === v)) { blocked[k] = 1; slope[k] = Infinity; continue; }
    const zl = at(i - 1, j), zr = at(i + 1, j), zd = at(i, j - 1), zu = at(i, j + 1);
    const gx = zl === zl && zr === zr ? (zr - zl) / (2 * c) : zr === zr ? (zr - v) / c : zl === zl ? (v - zl) / c : 0;
    const gy = zd === zd && zu === zu ? (zu - zd) / (2 * c) : zu === zu ? (zu - v) / c : zd === zd ? (v - zd) / c : 0;
    const s = Math.hypot(gx, gy);
    slope[k] = s;
    if (!(s <= o.steepSlope)) blocked[k] = 1;
    let sum = 0, q = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const w = at(i + a, j + b); if (w === w) { sum += w; q++; } }
    rough[k] = Math.abs(v - sum / q);
  }
  // chamfer distance (m) to the nearest blocked node
  const D = new Float32Array(n).fill(1e9), d1 = c, d2 = c * Math.SQRT2;
  for (let k = 0; k < n; k++) if (blocked[k]) D[k] = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + d1);
    if (j > 0) { v = Math.min(v, D[k - nx] + d1); if (i > 0) v = Math.min(v, D[k - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + d2); }
    D[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = D[k];
    if (i < nx - 1) v = Math.min(v, D[k + 1] + d1);
    if (j < ny - 1) { v = Math.min(v, D[k + nx] + d1); if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + d2); if (i > 0) v = Math.min(v, D[k + nx - 1] + d2); }
    D[k] = v;
  }
  const cost = new Float32Array(n);
  const over = Math.max(o.steepSlope - o.maxGrade, 1e-6);
  for (let k = 0; k < n; k++) {
    if (blocked[k]) { cost[k] = Infinity; continue; }
    const sp = slope[k] > o.maxGrade ? (slope[k] - o.maxGrade) / over : 0;
    cost[k] = 1 + o.roughWeight * rough[k] + o.slopeWeight * sp + o.centreWeight / (1 + D[k] / o.centreDistM);
  }
  return { x0: g.x0 + i0 * c, y0: g.y0 + j0 * c, c, nx, ny, z, cost, blocked };
}

const fieldCache = new WeakMap<Grid, Map<string, Field>>();

/**
 * Cost field for a search window, cached per grid (grids are treated as immutable). Windows covering most
 * of the grid use the whole grid, so repeated routes on one surface share a single field.
 */
function cachedField(g: Grid, i0: number, j0: number, i1: number, j1: number, o: typeof DEFAULTS): Field {
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 0.5 * g.nx * g.ny) { i0 = 0; j0 = 0; i1 = g.nx - 1; j1 = g.ny - 1; }
  const key = [i0, j0, i1, j1, o.maxGrade, o.roughWeight, o.slopeWeight, o.steepSlope, o.centreWeight, o.centreDistM].join(',');
  let m = fieldCache.get(g);
  if (!m) { m = new Map(); fieldCache.set(g, m); }
  let F = m.get(key);
  if (!F) {
    F = buildField(g, i0, j0, i1 - i0 + 1, j1 - j0 + 1, o);
    if (m.size >= 4) m.delete(m.keys().next().value as string);
    m.set(key, F);
  }
  return F;
}

/** Growable binary min-heap of (key, node). */
class Heap {
  keys = new Float64Array(1024);
  vals = new Int32Array(1024);
  size = 0;
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2); k.set(this.keys); this.keys = k;
      const v = new Int32Array(this.size * 2); v.set(this.vals); this.vals = v;
    }
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop(): number {
    const K = this.keys, V = this.vals, top = V[0];
    const n = --this.size;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1, m = r < n && K[r] < K[l] ? r : l;
        if (K[m] >= key) break;
        K[i] = K[m]; V[i] = V[m]; i = m;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  }
}

// 8 / 16 neighbour moves; corner and knight moves must also clear the nodes they pass
const MOVES8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MOVES16 = [...MOVES8, [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

function astar(F: Field, a: number, b: number, o: typeof DEFAULTS): { path: number[]; cost: number; expanded: number } | null {
  const { nx, ny, c, z, cost, blocked } = F, n = nx * ny;
  const g = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const bi = b % nx, bj = (b - bi) / nx;
  const list = o.connectivity === 8 ? MOVES8 : MOVES16, M = list.length;
  // flat move tables: offsets of the target and of the (up to two) nodes a corner / knight move passes
  const mdi = new Int32Array(M), mdj = new Int32Array(M), mOff = new Int32Array(M), p1 = new Int32Array(M), p2 = new Int32Array(M);
  const md = new Float64Array(M);
  list.forEach(([di, dj], m) => {
    mdi[m] = di; mdj[m] = dj; mOff[m] = dj * nx + di; md[m] = Math.hypot(di, dj) * c;
    if (Math.abs(di) + Math.abs(dj) < 2) { p1[m] = mOff[m]; p2[m] = mOff[m]; }
    else if (Math.abs(di) === Math.abs(dj)) { p1[m] = di; p2[m] = dj * nx; }
    else {
      p1[m] = Math.sign(dj) * (Math.abs(dj) >> 1) * nx + Math.sign(di) * (Math.abs(di) >> 1);
      p2[m] = Math.sign(dj) * nx + Math.sign(di);
    }
  });
  const maxG = o.maxGrade * (1 + 1e-9), wG = o.gradeWeight / (o.maxGrade * o.maxGrade);
  const heap = new Heap();
  g[a] = 0;
  heap.push(Math.hypot(a % nx - bi, ((a - (a % nx)) / nx) - bj) * c, a);
  let expanded = 0;
  while (heap.size) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1; expanded++;
    if (k === b) break;
    const i = k % nx, j = (k - i) / nx, zk = z[k], gk = g[k], ck = cost[k];
    for (let m = 0; m < M; m++) {
      const ii = i + mdi[m], jj = j + mdj[m];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const q = k + mOff[m];
      if (done[q] || blocked[q] || blocked[k + p1[m]] || blocked[k + p2[m]]) continue;
      const d = md[m], gr = Math.abs(z[q] - zk) / d;
      if (gr > maxG) continue;
      const v = gk + d * ((ck + cost[q]) * 0.5 + wG * gr * gr);
      if (v < g[q]) {
        g[q] = v; from[q] = k;
        const hx = ii - bi, hy = jj - bj;
        heap.push(v + Math.sqrt(hx * hx + hy * hy) * c, q);
      }
    }
  }
  if (!Number.isFinite(g[b])) return null;
  const path: number[] = [];
  for (let k = b; k !== -1; k = from[k]) path.push(k);
  path.reverse();
  return { path, cost: g[b], expanded };
}

function fieldHeight(F: Field, x: number, y: number): number {
  const fx = (x - F.x0) / F.c, fy = (y - F.y0) / F.c;
  let i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= F.nx - 1 || j >= F.ny - 1) {
    i = Math.max(0, Math.min(F.nx - 1, Math.round(fx))); j = Math.max(0, Math.min(F.ny - 1, Math.round(fy)));
    return F.z[j * F.nx + i];
  }
  const tx = fx - i, ty = fy - j, k = j * F.nx + i;
  return (F.z[k] * (1 - tx) + F.z[k + 1] * tx) * (1 - ty) + (F.z[k + F.nx] * (1 - tx) + F.z[k + F.nx + 1] * tx) * ty;
}

function nodeAt(F: Field, x: number, y: number): number {
  const i = Math.round((x - F.x0) / F.c), j = Math.round((y - F.y0) / F.c);
  return i < 0 || j < 0 || i >= F.nx || j >= F.ny ? -1 : j * F.nx + i;
}

/**
 * Straight chord a→b is drivable: samples every half node; no blocked node, every sub-chord of one node
 * length within the grade limit. Returns its cost (same metric as A*) or Infinity.
 */
function chordCost(F: Field, ax: number, ay: number, bx: number, by: number, o: typeof DEFAULTS): number {
  const L = Math.hypot(bx - ax, by - ay);
  if (L === 0) return 0;
  const steps = Math.max(2, Math.ceil(L / (F.c * 0.5)));
  const h = L / steps, lag = Math.max(1, Math.round(F.c / h));
  const zs = new Float64Array(steps + 1);
  const wG = o.gradeWeight / (o.maxGrade * o.maxGrade), maxG = o.maxGrade * (1 + 1e-9);
  let total = 0, prevCost = 0;
  for (let s = 0; s <= steps; s++) {
    const f = s / steps, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
    const k = nodeAt(F, x, y);
    if (k < 0 || F.blocked[k]) return Infinity;
    const z = fieldHeight(F, x, y);
    if (!(z === z)) return Infinity;
    zs[s] = z;
    const ck = F.cost[k];
    if (s >= lag && Math.abs(z - zs[s - lag]) / (lag * h) > maxG) return Infinity;
    if (s > 0) {
      const gr = Math.abs(z - zs[s - 1]) / h;
      total += h * ((ck + prevCost) * 0.5 + wG * gr * gr);
    }
    prevCost = ck;
  }
  if (Math.abs(zs[steps] - zs[0]) / L > maxG) return Infinity;
  return total;
}

function pull(F: Field, P: Vec2[], prefix: Float64Array, o: typeof DEFAULTS): Vec2[] {
  const out: Vec2[] = [P[0]];
  let i = 0;
  const last = P.length - 1;
  while (i < last) {
    let best = i + 1, misses = 0;
    for (let j = i + 2; j <= last && j - i <= 600; j++) {
      const cc = chordCost(F, P[i][0], P[i][1], P[j][0], P[j][1], o);
      if (cc <= prefix[j] - prefix[i] + 0.5) { best = j; misses = 0; }
      else if (++misses > 8) break;
    }
    out.push(P[best]);
    i = best;
  }
  return out;
}

function polylineOk(F: Field, P: readonly Vec2[], o: typeof DEFAULTS): boolean {
  for (let i = 1; i < P.length; i++) if (!Number.isFinite(chordCost(F, P[i - 1][0], P[i - 1][1], P[i][0], P[i][1], o))) return false;
  return true;
}

function snapNode(F: Field, x: number, y: number, radius: number): number {
  const k0 = nodeAt(F, x, y);
  if (k0 >= 0 && !F.blocked[k0]) return k0;
  const fi = (x - F.x0) / F.c, fj = (y - F.y0) / F.c, r = Math.ceil(radius / F.c);
  const ci = Math.round(fi), cj = Math.round(fj);
  let best = -1, bd = Infinity;
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 0 || j < 0 || i >= F.nx || j >= F.ny) continue;
    const k = j * F.nx + i;
    if (F.blocked[k]) continue;
    const d = Math.hypot(i - fi, j - fj) * F.c;
    if (d <= radius && d < bd) { bd = d; best = k; }
  }
  return best;
}

/**
 * Least-cost drivable route between two plan points over a height grid (see module notes).
 * Typical use: `autoRoute(rasterize(topo, 5), [e1, n1], [e2, n2])`. The grid's cost field is cached, so keep
 * reusing the same Grid object for a surface (and do not mutate it).
 * @throws Error with a user-facing message when an end is off the surface or no route meets the grade limit
 */
export function autoRoute(grid: Grid, from: Vec2, to: Vec2, opts: AutoRouteOptions = {}): AutoRouteResult {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) } as typeof DEFAULTS & AutoRouteOptions;
  const warnings: string[] = [];
  const stops: Vec2[] = [from, ...(o.via ?? []), to];
  // search window
  let span = 0;
  for (let i = 1; i < stops.length; i++) span += Math.hypot(stops[i][0] - stops[i - 1][0], stops[i][1] - stops[i - 1][1]);
  const margin = o.corridorM ?? Math.max(600, 0.8 * span);
  const xs = stops.map(p => p[0]), ys = stops.map(p => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - margin - grid.x0) / grid.dx));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - margin - grid.y0) / grid.dx));
  const i1 = Math.min(grid.nx - 1, Math.ceil((Math.max(...xs) + margin - grid.x0) / grid.dx));
  const j1 = Math.min(grid.ny - 1, Math.ceil((Math.max(...ys) + margin - grid.y0) / grid.dx));
  if (i1 < i0 + 1 || j1 < j0 + 1) throw new Error('Both ends of the route must be on the surface');
  const F = cachedField(grid, i0, j0, i1, j1, o);
  const nodes = stops.map(p => snapNode(F, p[0], p[1], o.snapRadiusM));
  nodes.forEach((k, s) => {
    if (k < 0) throw new Error(s === 0 ? 'The start of the route is not on drivable ground' : s === stops.length - 1 ? 'The end of the route is not on drivable ground' : `Via point ${s} is not on drivable ground`);
  });
  const nodeXY = (k: number): Vec2 => [F.x0 + (k % F.nx) * F.c, F.y0 + Math.floor(k / F.nx) * F.c];
  stops.forEach((p, s) => {
    const q = nodeXY(nodes[s]), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d > F.c) warnings.push(`${s === 0 ? 'Start' : s === stops.length - 1 ? 'End' : `Via point ${s}`} moved ${Math.round(d)} m to the nearest drivable ground`);
  });
  let path: number[] = [], total = 0, expanded = 0;
  for (let s = 1; s < nodes.length; s++) {
    const r = astar(F, nodes[s - 1], nodes[s], o);
    if (!r) throw new Error(`No drivable route under ${Math.round(o.maxGrade * 1000) / 10} % grade between those points`);
    path = path.concat(s > 1 ? r.path.slice(1) : r.path);
    total += r.cost; expanded += r.expanded;
  }
  // raw plan path (node positions) with exact clicked ends when they were drivable
  const P: Vec2[] = path.map(nodeXY);
  const startOk = Math.hypot(P[0][0] - from[0], P[0][1] - from[1]) <= F.c * 0.75;
  const endOk = Math.hypot(P[P.length - 1][0] - to[0], P[P.length - 1][1] - to[1]) <= F.c * 0.75;
  if (startOk && Number.isFinite(chordCost(F, from[0], from[1], P[0][0], P[0][1], o))) P[0] = [from[0], from[1]];
  if (endOk && Number.isFinite(chordCost(F, P[P.length - 1][0], P[P.length - 1][1], to[0], to[1], o))) P[P.length - 1] = [to[0], to[1]];
  const prefix = new Float64Array(P.length);
  for (let i = 1; i < P.length; i++) {
    const c = chordCost(F, P[i - 1][0], P[i - 1][1], P[i][0], P[i][1], o);
    prefix[i] = prefix[i - 1] + (Number.isFinite(c) ? c : Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) * 2);
  }
  // via points must survive straightening: pull each leg separately
  let line: Vec2[];
  if (o.smooth && P.length > 2) {
    const viaIdx: number[] = [0];
    for (let s = 1; s < nodes.length - 1; s++) { const q = path.indexOf(nodes[s], viaIdx[viaIdx.length - 1]); viaIdx.push(q < 0 ? viaIdx[viaIdx.length - 1] : q); }
    viaIdx.push(P.length - 1);
    line = [P[0]];
    for (let s = 1; s < viaIdx.length; s++) {
      const a = viaIdx[s - 1], b = viaIdx[s];
      if (b <= a) continue;
      const leg = P.slice(a, b + 1), pre = prefix.slice(a, b + 1).map(x => x - prefix[a]);
      // straighten, then smooth and simplify each leg on its own so via points stay where they are
      let L = pull(F, leg, pre, o);
      const smooth = chaikin(L, 2);
      if (polylineOk(F, smooth, o)) L = smooth;
      const simple = simplify2d(L, o.simplifyM);
      if (polylineOk(F, simple, o)) L = simple;
      line.push(...L.slice(1));
    }
  } else line = simplify2d(P, 0.01);
  const toPoints = (L: readonly Vec2[], step: number): Vec3[] => subdivide(L, step).map(([x, y]) => {
    const z = gridHeightAt(grid, x, y) ?? fieldHeight(F, x, y);
    return [x, y, z] as Vec3;
  });
  const maxGradeOf = (pts: Vec3[]) => {
    let m = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d > 1e-9) m = Math.max(m, Math.abs(pts[i][2] - pts[i - 1][2]) / d);
    }
    return m;
  };
  let points = toPoints(line, o.stepM);
  let mg = maxGradeOf(points);
  if (mg > o.maxGrade + 1e-6) {
    // fall back to the unsmoothed path at a finer spacing
    const alt = toPoints(simplify2d(P, 0.01), Math.min(o.stepM, grid.dx * 2));
    const ag = maxGradeOf(alt);
    if (ag < mg) { points = alt; mg = ag; }
    if (mg > o.maxGrade + 1e-6) warnings.push(`Steepest segment is ${(mg * 100).toFixed(1)} % (limit ${(o.maxGrade * 100).toFixed(1)} %)`);
  }
  let planLengthM = 0, lengthM = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    planLengthM += d; lengthM += Math.hypot(d, points[i][2] - points[i - 1][2]);
  }
  const rawLen = prefix.length ? P.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0), 0) : 0;
  const costPerM = rawLen > 0 ? total / rawLen : 1;
  if (costPerM > 3) warnings.push('The route leaves graded roads for much of its length; check it or add a via point');
  return { points, planLengthM, lengthM, maxGrade: mg, costPerM, expanded, warnings };
}
