/**
 * Arc-length tables over haul strings (pure, no DOM / Three.js) - shared by the strings, actors, tools and cockpit modules.
 *
 * A PathTable is the 3D polyline of a string with cumulative 3D chainage. Sampling is O(log n) (binary search) and
 * extrapolates linearly past either end along the end tangent (queue lines, turn-around arcs, dozers past the tip).
 * World frame: E, N, Z metres. Plan heading: radians, 0 = east, positive towards north (= the scene heading convention
 * of FollowTarget: 0 = +x, positive towards −z).
 */

export interface XYZ { e: number; n: number; z: number }

export interface PathTable {
  /** Point count (≥ 1). Zero-length legs are dropped. */
  n: number;
  e: Float64Array;
  nn: Float64Array;
  z: Float64Array;
  /** Cumulative 3D chainage at each point (s[0] = 0). */
  s: Float64Array;
  /** Index of the source point each table point came from (for stop signs / overrides). */
  src: Int32Array;
  /** Total 3D length (m). */
  length: number;
  /** Total plan length (m). */
  planLength: number;
}

export interface PathSample {
  e: number;
  n: number;
  z: number;
  /** Leg index (0..n-2) the sample lies on (clamped at the ends). */
  i: number;
  /** Fraction along that leg (may be < 0 or > 1 when extrapolating). */
  t: number;
  /** Plan heading of the leg (rad). */
  heading: number;
  /** Grade of the leg dZ / d3D in the forward direction (fraction). */
  grade: number;
}

export function buildPath(points: readonly XYZ[]): PathTable {
  const keep: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.e) || !Number.isFinite(p.n) || !Number.isFinite(p.z)) continue;
    if (keep.length) {
      const q = points[keep[keep.length - 1]];
      if (Math.hypot(p.e - q.e, p.n - q.n, p.z - q.z) < 1e-6) continue;
    }
    keep.push(i);
  }
  const n = keep.length;
  const e = new Float64Array(n), nn = new Float64Array(n), z = new Float64Array(n), s = new Float64Array(n);
  const src = new Int32Array(n);
  let plan = 0;
  for (let k = 0; k < n; k++) {
    const p = points[keep[k]];
    e[k] = p.e; nn[k] = p.n; z[k] = p.z; src[k] = keep[k];
    if (k > 0) {
      const de = e[k] - e[k - 1], dn = nn[k] - nn[k - 1], dz = z[k] - z[k - 1];
      s[k] = s[k - 1] + Math.hypot(de, dn, dz);
      plan += Math.hypot(de, dn);
    }
  }
  return { n, e, nn, z, s, src, length: n ? s[n - 1] : 0, planLength: plan };
}

/** Leg index i such that s[i] ≤ chainage < s[i+1] (clamped to 0..n-2). */
export function legAt(p: PathTable, chainage: number): number {
  if (p.n < 2) return 0;
  let lo = 0, hi = p.n - 2;
  if (chainage <= p.s[1]) return 0;
  if (chainage >= p.s[p.n - 2]) return p.n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.s[mid] <= chainage) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Point at a chainage; past the ends the end legs are extended linearly. */
export function sampleAt(p: PathTable, chainage: number, out?: PathSample): PathSample {
  const o = out ?? { e: 0, n: 0, z: 0, i: 0, t: 0, heading: 0, grade: 0 };
  if (p.n === 0) { o.e = o.n = o.z = 0; o.i = 0; o.t = 0; o.heading = 0; o.grade = 0; return o; }
  if (p.n === 1) { o.e = p.e[0]; o.n = p.nn[0]; o.z = p.z[0]; o.i = 0; o.t = 0; o.heading = 0; o.grade = 0; return o; }
  const i = legAt(p, chainage);
  const len = p.s[i + 1] - p.s[i];
  const t = len > 0 ? (chainage - p.s[i]) / len : 0;
  const de = p.e[i + 1] - p.e[i], dn = p.nn[i + 1] - p.nn[i], dz = p.z[i + 1] - p.z[i];
  o.e = p.e[i] + de * t;
  o.n = p.nn[i] + dn * t;
  o.z = p.z[i] + dz * t;
  o.i = i;
  o.t = t;
  o.heading = Math.atan2(dn, de);
  o.grade = len > 0 ? dz / len : 0;
  return o;
}

/** Grade of leg i (dZ / d3D, forward). */
export function legGrade(p: PathTable, i: number): number {
  if (i < 0 || i >= p.n - 1) return 0;
  const len = p.s[i + 1] - p.s[i];
  return len > 0 ? (p.z[i + 1] - p.z[i]) / len : 0;
}

/** Nearest point on the path (plan distance) to a world plan point. */
export function nearestOnPath(p: PathTable, e: number, n: number): { chainage: number; dist: number; i: number; t: number } {
  let best = { chainage: 0, dist: Infinity, i: 0, t: 0 };
  if (p.n === 1) return { chainage: 0, dist: Math.hypot(e - p.e[0], n - p.nn[0]), i: 0, t: 0 };
  for (let i = 0; i < p.n - 1; i++) {
    const ax = p.e[i], ay = p.nn[i], bx = p.e[i + 1], by = p.nn[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((e - ax) * dx + (n - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + dx * t - e, ay + dy * t - n);
    if (d < best.dist) best = { chainage: p.s[i] + (p.s[i + 1] - p.s[i]) * t, dist: d, i, t };
  }
  return best;
}

export type GradeClass = 'flat' | 'mod' | 'steep' | 'max';
/** ≤ 4 % flat · ≤ 8 % moderate · ≤ 10 % steep · > 10 % over max (matches ui/chart gradeColor). */
export function gradeClassOf(g: number): GradeClass {
  const a = Math.abs(g);
  return a <= 0.04 + 1e-9 ? 'flat' : a <= 0.08 + 1e-9 ? 'mod' : a <= 0.10 + 1e-9 ? 'steep' : 'max';
}

/** Runs of consecutive legs with the same grade class: [startLeg, endLeg] inclusive, mean grade, length. */
export function gradeRuns(p: PathTable): { i0: number; i1: number; cls: GradeClass; grade: number; length: number; s0: number; s1: number }[] {
  const runs: { i0: number; i1: number; cls: GradeClass; grade: number; length: number; s0: number; s1: number }[] = [];
  for (let i = 0; i < p.n - 1; i++) {
    const g = legGrade(p, i), cls = gradeClassOf(g), len = p.s[i + 1] - p.s[i];
    const last = runs[runs.length - 1];
    // A run keeps its class and its rise direction (an up-ramp and a down-ramp are separate runs).
    if (last && last.cls === cls && Math.sign(last.grade || g) === Math.sign(g || last.grade)) {
      const dz = last.grade * last.length + g * len;
      last.i1 = i; last.length += len; last.s1 = p.s[i + 1]; last.grade = last.length > 0 ? dz / last.length : 0;
    } else {
      runs.push({ i0: i, i1: i, cls, grade: g, length: len, s0: p.s[i], s1: p.s[i + 1] });
    }
  }
  return runs;
}

/** Densify a polyline so no plan leg exceeds `step` m; new points take Z from `heightAt` (or linear when null). */
export function densifyPoints<T extends XYZ>(pts: readonly T[], step: number, heightAt: (e: number, n: number) => number | null,
  make: (e: number, n: number, z: number, snapped: boolean) => T): T[] {
  if (pts.length < 2 || !(step > 0)) return pts.slice();
  const out: T[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.e - a.e, b.n - a.n);
    const k = Math.ceil(d / step - 1e-9);
    for (let j = 1; j < k; j++) {
      const t = j / k, e = a.e + (b.e - a.e) * t, n = a.n + (b.n - a.n) * t;
      const h = heightAt(e, n);
      out.push(make(e, n, h ?? a.z + (b.z - a.z) * t, h != null));
    }
    out.push(b);
  }
  return out;
}

/** Summary of a measured polyline (measure tool, draw readout). */
export interface PolylineStats {
  length3d: number;
  lengthPlan: number;
  rise: number;
  fall: number;
  /** Net dZ / plan length (fraction). */
  avgGrade: number;
  maxGrade: number;
  legs: { d3: number; dPlan: number; dz: number; grade: number }[];
}

export function polylineStats(pts: readonly XYZ[]): PolylineStats {
  const legs: PolylineStats['legs'] = [];
  let l3 = 0, lp = 0, rise = 0, fall = 0, maxG = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dPlan = Math.hypot(b.e - a.e, b.n - a.n), dz = b.z - a.z, d3 = Math.hypot(dPlan, dz);
    const grade = d3 > 0 ? dz / d3 : 0;
    legs.push({ d3, dPlan, dz, grade });
    l3 += d3; lp += dPlan;
    if (dz > 0) rise += dz; else fall -= dz;
    if (Math.abs(grade) > Math.abs(maxG)) maxG = grade;
  }
  const net = pts.length > 1 ? pts[pts.length - 1].z - pts[0].z : 0;
  return { length3d: l3, lengthPlan: lp, rise, fall, avgGrade: lp > 0 ? net / lp : 0, maxGrade: maxG, legs };
}
