/**
 * Haul-string tools: snapping to the surface, densify / simplify, metrics, editing and grade classes.
 *
 * Conventions (match the engine and core/types.ts):
 *  - grade = dZ / 3D distance (the spreadsheet convention), positive uphill from first point to last;
 *  - chainage = cumulative 3D distance from the first point (m);
 *  - a point's `seg` overrides apply to the segment that STARTS at that point.
 * Editing functions never mutate their input; they return new arrays (unchanged points keep identity).
 */
import type { StringPoint, Vec3 } from '@/core/types';
import { uid } from '@/core/ids';
import type { XYZ } from './types';
import { heightAt, type HeightIndex } from './heightIndex';
import { douglasPeuckerMask } from './polyline';

/** Plain [E, N, Z] points → StringPoints with fresh ids. */
export function fromVec3(pts: ReadonlyArray<ArrayLike<number>>, opts: { snapped?: boolean; idPrefix?: string } = {}): StringPoint[] {
  return pts.map(p => ({ id: uid(opts.idPrefix ?? 'pt'), e: p[0], n: p[1], z: p[2] ?? 0, snapped: opts.snapped ?? false }));
}

/** Points → plain [E, N, Z] arrays. */
export function toVec3(points: ReadonlyArray<XYZ>): Vec3[] {
  return points.map(p => [p.e, p.n, p.z]);
}

/**
 * Sets every point's z to the surface height below it (snapped = true). Points off the surface keep
 * their z and get snapped = false. Returns new point objects.
 */
export function snapPoints<P extends XYZ & { snapped?: boolean }>(index: HeightIndex, points: readonly P[]): P[] {
  return points.map(p => {
    const z = heightAt(index, p.e, p.n);
    return z == null ? { ...p, snapped: false } : { ...p, z, snapped: true };
  });
}

function newPoint(e: number, n: number, z: number, snapped: boolean, src?: StringPoint): StringPoint {
  const p: StringPoint = { id: uid('pt'), e, n, z, snapped };
  if (src?.seg) p.seg = { ...src.seg };
  return p;
}

/**
 * Inserts points so no segment is longer than `stepM` in plan, keeping every original point unchanged.
 * Inserted points are evenly spaced, take the surface height when `index` is given and the point is on
 * the surface (snapped = true), else the straight-line height; they inherit the split segment's overrides.
 */
export function densify(index: HeightIndex | null, points: readonly StringPoint[], stepM: number): StringPoint[] {
  if (points.length < 2 || !(stepM > 0)) return points.slice();
  const out: StringPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const L = Math.hypot(b.e - a.e, b.n - a.n);
    const k = Math.ceil(L / stepM - 1e-9);
    for (let j = 1; j < k; j++) {
      const f = j / k, e = a.e + (b.e - a.e) * f, n = a.n + (b.n - a.n) * f;
      const zs = index ? heightAt(index, e, n) : null;
      out.push(newPoint(e, n, zs ?? a.z + (b.z - a.z) * f, zs != null, a));
    }
    out.push(b);
  }
  return out;
}

/**
 * Douglas–Peucker simplification in 3D: keeps the points needed to stay within `tolM` metres (3D) of the
 * original polyline. Always keeps the first and last points. Returns a subset of the input objects.
 */
export function simplify3d<P extends XYZ>(points: readonly P[], tolM: number): P[] {
  if (points.length < 3) return points.slice();
  const keep = douglasPeuckerMask(points.length, tolM, (i, a, b) => pointSegDist3(points[i], points[a], points[b]));
  return points.filter((_, i) => keep[i]);
}

function pointSegDist3(p: XYZ, a: XYZ, b: XYZ): number {
  const dx = b.e - a.e, dy = b.n - a.n, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
  let t = L2 > 0 ? ((p.e - a.e) * dx + (p.n - a.n) * dy + (p.z - a.z) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.e - a.e - t * dx, p.n - a.n - t * dy, p.z - a.z - t * dz);
}

/** Metrics of one segment (from point i to point i + 1). */
export interface StringSegmentMetrics {
  i: number;
  /** 3D length (m). */
  dist3d: number;
  /** Plan length (m). */
  distPlan: number;
  /** Height change (m), positive uphill. */
  dz: number;
  /** dZ / dist3d (fraction; 0 for zero-length segments). */
  grade: number;
  /** 3D chainage at the segment start (m). */
  chainage: number;
}

/** Whole-string metrics. Grades are fractions (0.1 = 10 %). */
export interface StringMetrics {
  segments: StringSegmentMetrics[];
  /** Total 3D length (m). */
  length: number;
  /** Total plan length (m). */
  planLength: number;
  /** Sum of uphill height gains (m). */
  rise: number;
  /** Sum of downhill height losses (m, positive). */
  fall: number;
  /** Steepest uphill segment grade (≥ 0 unless every segment falls). */
  maxGrade: number;
  /** Steepest downhill segment grade (≤ 0 unless every segment rises). */
  minGrade: number;
  /** Largest |grade| of any segment. */
  maxAbsGrade: number;
  /** Net grade: (z_last − z_first) / length. */
  averageGrade: number;
  /** Length-weighted mean |grade|: (rise + fall) / length. */
  meanAbsGrade: number;
}

/** Per-segment and total distance / grade metrics for a string (see module conventions). */
export function stringMetrics(points: ReadonlyArray<XYZ>): StringMetrics {
  const segments: StringSegmentMetrics[] = [];
  let length = 0, planLength = 0, rise = 0, fall = 0, maxG = -Infinity, minG = Infinity, maxAbs = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const distPlan = Math.hypot(b.e - a.e, b.n - a.n), dz = b.z - a.z;
    const dist3d = Math.hypot(distPlan, dz);
    const grade = dist3d > 0 ? dz / dist3d : 0;
    segments.push({ i, dist3d, distPlan, dz, grade, chainage: length });
    length += dist3d; planLength += distPlan;
    if (dz > 0) rise += dz; else fall -= dz;
    if (dist3d > 0) {
      if (grade > maxG) maxG = grade;
      if (grade < minG) minG = grade;
      if (Math.abs(grade) > maxAbs) maxAbs = Math.abs(grade);
    }
  }
  const n = points.length;
  return {
    segments, length, planLength, rise, fall,
    maxGrade: Number.isFinite(maxG) ? maxG : 0,
    minGrade: Number.isFinite(minG) ? minG : 0,
    maxAbsGrade: maxAbs,
    averageGrade: length > 0 && n > 1 ? (points[n - 1].z - points[0].z) / length : 0,
    meanAbsGrade: length > 0 ? (rise + fall) / length : 0,
  };
}

/**
 * Reverses the direction of a string. Segment overrides move with their segment (the override that
 * started segment i→i+1 now starts at the reversed position of point i+1). Other point fields stay.
 */
export function reversePoints(points: readonly StringPoint[]): StringPoint[] {
  const n = points.length;
  const out: StringPoint[] = [];
  for (let k = 0; k < n; k++) {
    const src = points[n - 1 - k];
    const p: StringPoint = { ...src };
    delete p.seg;
    // reversed segment k→k+1 is original segment (n-2-k)→(n-1-k)
    const seg = k < n - 1 ? points[n - 2 - k].seg : undefined;
    if (seg) p.seg = { ...seg };
    out.push(p);
  }
  return out;
}

/**
 * Inserts a point at array position `at` (0 … length). Its height comes from the surface when given and
 * covered (snapped = true), else is interpolated between the neighbours. It inherits the overrides of the
 * segment it splits.
 */
export function insertPoint(
  points: readonly StringPoint[], at: number, e: number, n: number, index: HeightIndex | null = null,
): StringPoint[] {
  const k = Math.max(0, Math.min(points.length, Math.round(at)));
  const prev = points[k - 1], next = points[k];
  let z = index ? heightAt(index, e, n) : null;
  const snapped = z != null;
  if (z == null) {
    if (prev && next) {
      const L = Math.hypot(next.e - prev.e, next.n - prev.n);
      const t = L > 0 ? Math.max(0, Math.min(1, ((e - prev.e) * (next.e - prev.e) + (n - prev.n) * (next.n - prev.n)) / (L * L))) : 0;
      z = prev.z + (next.z - prev.z) * t;
    } else z = (prev ?? next)?.z ?? 0;
  }
  const p = newPoint(e, n, z, snapped, prev && next ? prev : undefined);
  return [...points.slice(0, k), p, ...points.slice(k)];
}

/** Removes the point at index i (no-op when out of range). */
export function removePoint(points: readonly StringPoint[], i: number): StringPoint[] {
  if (i < 0 || i >= points.length) return points.slice();
  return [...points.slice(0, i), ...points.slice(i + 1)];
}

/**
 * Moves point i to (e, n), re-snapping its height to the surface when `index` is given and covers the
 * new position; otherwise keeps its old z (snapped = false).
 */
export function movePoint(points: readonly StringPoint[], i: number, e: number, n: number, index: HeightIndex | null = null): StringPoint[] {
  if (i < 0 || i >= points.length) return points.slice();
  const z = index ? heightAt(index, e, n) : null;
  const out = points.slice();
  out[i] = z == null ? { ...points[i], e, n, snapped: false } : { ...points[i], e, n, z, snapped: true };
  return out;
}

/** Result of `nearestOnString`. */
export interface NearestOnString {
  /** Segment index (point i → i + 1). */
  segment: number;
  /** Fraction along the segment, 0 … 1. */
  t: number;
  /** Plan distance from the query to the string (m). */
  distance: number;
  /** 3D chainage of the nearest point (m). */
  chainage: number;
  /** The nearest point on the string [E, N, Z]. */
  point: Vec3;
}

/** Nearest point on the string to plan position (e, n). Null for an empty string. */
export function nearestOnString(points: ReadonlyArray<XYZ>, e: number, n: number): NearestOnString | null {
  if (!points.length) return null;
  if (points.length === 1) {
    const p = points[0];
    return { segment: 0, t: 0, distance: Math.hypot(e - p.e, n - p.n), chainage: 0, point: [p.e, p.n, p.z] };
  }
  let best: NearestOnString | null = null, chain = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.e - a.e, dy = b.n - a.n, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((e - a.e) * dx + (n - a.n) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.e + dx * t, py = a.n + dy * t, pz = a.z + (b.z - a.z) * t;
    const d = Math.hypot(e - px, n - py);
    const L3 = Math.hypot(dx, dy, b.z - a.z);
    if (!best || d < best.distance) best = { segment: i, t, distance: d, chainage: chain + L3 * t, point: [px, py, pz] };
    chain += L3;
  }
  return best;
}

/**
 * Vertical smoothing: each interior point's z becomes the triangular-kernel weighted mean of the
 * heights within ±windowM/2 of plan chainage. End points are fixed. Changed points get snapped = false.
 */
export function smoothGrades(points: readonly StringPoint[], windowM: number): StringPoint[] {
  const n = points.length;
  if (n < 3 || !(windowM > 0)) return points.slice();
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(points[i].e - points[i - 1].e, points[i].n - points[i - 1].n);
  const h = windowM / 2;
  const out = points.slice();
  let lo = 0;
  for (let i = 1; i < n - 1; i++) {
    while (s[lo] < s[i] - h) lo++;
    let sw = 0, sz = 0;
    for (let j = lo; j < n && s[j] <= s[i] + h; j++) {
      const w = 1 - Math.abs(s[j] - s[i]) / h;
      if (w > 0) { sw += w; sz += w * points[j].z; }
    }
    const z = sw > 0 ? sz / sw : points[i].z;
    if (Math.abs(z - points[i].z) > 1e-6) out[i] = { ...points[i], z, snapped: false };
  }
  return out;
}

/** Grade classes for colouring and warnings. */
export type GradeClass = 'flat' | 'moderate' | 'steep' | 'excessive';

/** Upper bounds (|grade| fractions) of the grade classes: flat ≤ 4 %, moderate ≤ 8 %, steep ≤ 10 %, excessive > 10 %. */
export const GRADE_CLASS_LIMITS = { flat: 0.04, moderate: 0.08, steep: 0.10 } as const;

/** Classifies |grade| (fraction): ≤ 4 % flat, ≤ 8 % moderate, ≤ 10 % steep, > 10 % excessive. */
export function gradeClass(grade: number): GradeClass {
  const g = Math.abs(grade);
  if (g <= GRADE_CLASS_LIMITS.flat + 1e-12) return 'flat';
  if (g <= GRADE_CLASS_LIMITS.moderate + 1e-12) return 'moderate';
  if (g <= GRADE_CLASS_LIMITS.steep + 1e-12) return 'steep';
  return 'excessive';
}
