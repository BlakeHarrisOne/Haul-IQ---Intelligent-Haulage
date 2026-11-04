/**
 * Haul string → segments (spreadsheet 'Travel Time' columns A/B/J/K) with phantom-segment guards.
 *
 * Segment i runs from point i to point i+1 in the loaded direction (dig → dump). Distance is the 3D slope
 * distance √(ΔE² + ΔN² + ΔZ²); grade = ΔZ / d3D (= sin θ, the workbook convention, positive = uphill loaded).
 */
import type { CircuitParams, HaulString, SegmentZone, StringPoint, Vec3 } from '@/core/types';

/** A segment before any speed model is applied. */
export interface RawSegment {
  /** Index of the start point (Travel Time row = i + 4). */
  i: number;
  from: Vec3;
  to: Vec3;
  /** 3D slope length, m. */
  d3: number;
  /** Plan length, m. */
  dPlan: number;
  /** ΔZ, m. */
  dz: number;
  /** ΔZ / d3 (sin θ), fraction. */
  grade: number;
  /** Cumulative 3D distance at the segment start, m. */
  chainage: number;
  /** Rolling resistance %, point override or circuit default. */
  rrPct: number;
  /** Effective speed limit km/h = min(segment override, circuit global). */
  speedLimitKmh: number;
  /** True when the limit comes from a per-segment override. */
  segLimit: boolean;
  zone?: SegmentZone;
}

export interface Route {
  segs: RawSegment[];
  lengthM: number;
  riseM: number;
  fallM: number;
  /** Stop points as segment-boundary indices along the loaded leg (k = point index) with direction filter. */
  stops: { k: number; chainage: number; oneWay?: 'loaded' | 'empty' }[];
  warnings: string[];
  error?: string;
}

/** A single digitised segment longer than this is treated as a phantom (e.g. a blank row → (0,0,0)), m. */
export const PHANTOM_SEGMENT_M = 5000;
/** A segment longer than this and 20× the median length is flagged as suspicious, m. */
export const SUSPICIOUS_SEGMENT_M = 500;

/**
 * Build route segments from a haul string.
 * @param hs haul string (first point = dig, last = dump)
 * @param p circuit params (rrPct, speedLimitKmh defaults)
 */
export function buildRoute(hs: HaulString | undefined, p: Pick<CircuitParams, 'rrPct' | 'speedLimitKmh'>): Route {
  const out: Route = { segs: [], lengthM: 0, riseM: 0, fallM: 0, stops: [], warnings: [] };
  if (!hs || hs.points.length < 2) { out.error = 'No haul string with at least 2 points'; return out; }
  const pts = hs.points;
  for (let k = 0; k < pts.length; k++) {
    const q = pts[k];
    if (!Number.isFinite(q.e) || !Number.isFinite(q.n) || !Number.isFinite(q.z)) {
      out.error = `Point ${k + 1} of "${hs.name}" has a non-finite coordinate (${q.e}, ${q.n}, ${q.z}); fix or delete it.`;
      return out;
    }
  }
  // the workbook's blank-row bug: a point at the grid origin among real site coordinates
  const far = pts.filter(q => Math.abs(q.e) + Math.abs(q.n) > 1000).length;
  const origin = pts.findIndex(q => q.e === 0 && q.n === 0);
  if (origin >= 0 && far >= pts.length / 2) {
    out.error = `Point ${origin + 1} of "${hs.name}" is at the grid origin (0, 0) while the rest are site coordinates: a blank row? `
      + `(the workbook would measure a phantom segment from (0,0,0)).`;
    return out;
  }
  let chain = 0;
  const lens: number[] = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const dx = b.e - a.e, dy = b.n - a.n, dz = b.z - a.z;
    const d3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d3 <= 0) {
      out.warnings.push(`Points ${k + 1} and ${k + 2} of "${hs.name}" are identical; zero-length segment skipped (Excel: grade "" → time "").`);
      continue;
    }
    if (d3 > PHANTOM_SEGMENT_M) {
      out.error = `Phantom segment ${k + 1} of "${hs.name}": ${Math.round(d3).toLocaleString('en-AU')} m between points ${k + 1} and ${k + 2} `
        + `(the workbook's blank-row bug measures from (0,0,0)). Check the points before trusting any result.`;
      return out;
    }
    const seg = a.seg;
    const lim = seg?.speedLimitKmh;
    const segLimit = lim != null && Number.isFinite(lim) && lim > 0 && lim < p.speedLimitKmh;
    out.segs.push({
      i: k, from: [a.e, a.n, a.z], to: [b.e, b.n, b.z], d3, dPlan: Math.sqrt(dx * dx + dy * dy), dz, grade: dz / d3, chainage: chain,
      rrPct: seg?.rrPct != null && Number.isFinite(seg.rrPct) ? seg.rrPct : p.rrPct,
      speedLimitKmh: segLimit ? (lim as number) : p.speedLimitKmh, segLimit, zone: seg?.zone,
    });
    lens.push(d3);
    chain += d3;
    if (dz > 0) out.riseM += dz; else out.fallM -= dz;
  }
  out.lengthM = chain;
  if (!out.segs.length) { out.error = `"${hs.name}" has no segment with non-zero length`; return out; }
  // suspicious long segments (relative to the string's own spacing)
  const med = [...lens].sort((x, y) => x - y)[lens.length >> 1];
  for (const s of out.segs) {
    if (s.d3 > SUSPICIOUS_SEGMENT_M && s.d3 > 20 * med) {
      out.warnings.push(`Segment ${s.i + 1} of "${hs.name}" is ${Math.round(s.d3)} m long (median spacing ${med.toFixed(1)} m); check for a missing or misplaced point.`);
    }
  }
  // stop signs at interior points (the dig and dump ends are stops anyway)
  let ch = 0;
  const chainAt: number[] = [0];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    ch += Math.sqrt((b.e - a.e) ** 2 + (b.n - a.n) ** 2 + (b.z - a.z) ** 2);
    chainAt.push(ch);
  }
  pts.forEach((q: StringPoint, k) => {
    if (q.stop && k > 0 && k < pts.length - 1) out.stops.push({ k, chainage: chainAt[k], oneWay: q.stopOneWay });
  });
  return out;
}

/** Number of stop-sign stops per cycle implied by the string's stop points (both ways unless one-way). */
export function stopsPerCycle(route: Route): number {
  return route.stops.reduce((a, s) => a + (s.oneWay ? 1 : 2), 0);
}
