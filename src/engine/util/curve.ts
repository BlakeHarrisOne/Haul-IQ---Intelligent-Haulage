/**
 * Force–speed curve helpers. Curves are [speed km/h, force kN] points sorted by speed.
 * Interpolation is in POWER space (P = F·v linear in v between points, then F = P/v), which follows the hyperbolic
 * shape of rimpull/retarder charts (oem-curves.json conventions); pieces that start at v = 0 interpolate F linearly.
 */
import type { CurvePoint } from '@/core/types';

/** Index i of the piece [i, i+1] containing v (binary search); −1 below, n−1 above. */
function piece(c: CurvePoint[], v: number): number {
  const n = c.length;
  if (v < c[0][0]) return -1;
  if (v >= c[n - 1][0]) return n - 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid][0] <= v) lo = mid; else hi = mid;
  }
  return lo;
}

/** Force on one piece at speed v (power-space interpolation; linear in F when the piece starts at 0 km/h). */
function pieceForce(a: CurvePoint, b: CurvePoint, v: number): number {
  const dv = b[0] - a[0];
  if (dv <= 1e-12) return Math.max(a[1], b[1]);
  const u = (v - a[0]) / dv;
  if (a[0] <= 1e-9 || v <= 1e-9) return a[1] + (b[1] - a[1]) * u;
  const p = a[1] * a[0] + (b[1] * b[0] - a[1] * a[0]) * u;
  return p / v;
}

/**
 * Force at speed v (kN), clamped to the end values outside the curve's speed range.
 * @param curve [km/h, kN] points sorted by speed
 * @param vKmh speed, km/h
 */
export function curveForce(curve: CurvePoint[], vKmh: number): number {
  const n = curve.length;
  if (!n) return 0;
  const i = piece(curve, vKmh);
  if (i < 0) return curve[0][1];
  if (i >= n - 1) return curve[n - 1][1];
  return pieceForce(curve[i], curve[i + 1], vKmh);
}

/** Force of a single gear at v (kN): 0 outside the gear's band (the gear cannot be used there). */
export function gearForce(curve: CurvePoint[], vKmh: number): number {
  const n = curve.length;
  if (!n || vKmh < curve[0][0] - 1e-9 || vKmh > curve[n - 1][0] + 1e-9) return 0;
  return curveForce(curve, vKmh);
}

/** Solve F(v) = f on one monotone piece (power space). */
function pieceSolve(a: CurvePoint, b: CurvePoint, f: number): number {
  const dv = b[0] - a[0];
  if (dv <= 1e-12) return a[0];
  if (a[0] <= 1e-9) {
    const dF = b[1] - a[1];
    if (Math.abs(dF) < 1e-12) return b[0];
    return clamp(a[0] + ((f - a[1]) * dv) / dF, a[0], b[0]);
  }
  const s = (b[1] * b[0] - a[1] * a[0]) / dv; // dP/dv
  const den = f - s;
  if (Math.abs(den) < 1e-12) return b[0];
  return clamp((a[1] * a[0] - s * a[0]) / den, a[0], b[0]);
}

/**
 * Highest speed at which the curve still delivers at least `forceKN`: sup { v : F(v) ≥ forceKN }.
 * The curve is treated as constant beyond its last point (so a retarder envelope ending at top speed with a
 * non-zero force returns +∞ when it can hold the load there; callers cap by top speed).
 * @returns { kmh, ok } — ok = false when no speed on the curve delivers the force (stall / retarder exceeded).
 */
export function maxSpeedForForce(curve: CurvePoint[], forceKN: number): { kmh: number; ok: boolean } {
  const n = curve.length;
  if (!n) return { kmh: 0, ok: false };
  if (curve[n - 1][1] >= forceKN) return { kmh: Infinity, ok: true };
  for (let i = n - 2; i >= 0; i--) {
    const a = curve[i], b = curve[i + 1];
    if (b[1] >= forceKN) return { kmh: b[0], ok: true };
    if (a[1] >= forceKN) return { kmh: pieceSolve(a, b, forceKN), ok: true };
  }
  return { kmh: 0, ok: false };
}

/** Knee width at a gear's band end (km/h): the envelope steps down to the next gear just past the last point. */
const KNEE_KMH = 1e-4;

/**
 * True upper envelope of per-gear curves: F_env(v) = max over gears of gearForce(gear, v) (each gear only inside its
 * own speed band), represented so that curveForce(envelope, v) reproduces that max.
 *   · every breakpoint of every curve, plus a knee just past each band end (the step down to the next gear) and just
 *     before each band start;
 *   · a dense grid (0.02 km/h below 1 km/h and 0.1 km/h below 5 km/h, where first-gear pieces are linear in force, then
 *     0.25 km/h) so that
 *     power-space interpolation between envelope points follows the gear curves;
 *   · the exact crossing speed wherever the best gear changes between two samples (bisection), so gear-change knees
 *     are kept instead of being interpolated across (which overstated rimpull just above each upshift).
 * Used to build rimpull and retarder envelopes from per-gear curves.
 */
export function envelopeOf(curves: CurvePoint[][]): CurvePoint[] {
  const cs = curves.filter(c => c.length > 0);
  if (!cs.length) return [];
  const lo = Math.min(...cs.map(c => c[0][0])), hi = Math.max(...cs.map(c => c[c.length - 1][0]));
  const fAt = (v: number) => { let f = 0; for (const c of cs) { const x = gearForce(c, v); if (x > f) f = x; } return f; };
  const best = (v: number) => { let k = -1, f = 0; for (let i = 0; i < cs.length; i++) { const x = gearForce(cs[i], v); if (x > f + 1e-12) { f = x; k = i; } } return k; };
  const vs = new Set<number>();
  const add = (v: number) => { if (v >= lo - 1e-12 && v <= hi + 1e-12) vs.add(round6(v)); };
  for (const c of cs) {
    for (const p of c) add(p[0]);
    add(c[c.length - 1][0] + KNEE_KMH);
    if (c[0][0] > lo) add(c[0][0] - KNEE_KMH);
  }
  for (let v = lo; v < hi; v += v < 1 ? 0.02 : v < 5 ? 0.1 : 0.25) add(v);
  let sorted = [...vs].sort((a, b) => a - b);
  // gear-change crossings between consecutive samples
  const cross: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    let a = sorted[i], b = sorted[i + 1];
    const ka = best(a), kb = best(b);
    if (ka === kb || ka < 0 || kb < 0 || b - a <= 2 * KNEE_KMH) continue;
    const d = (v: number) => gearForce(cs[ka], v) - gearForce(cs[kb], v);
    if (!(d(a) > 0 && d(b) < 0)) continue;   // a band end, not a crossing (handled by the knee points)
    for (let it = 0; it < 50 && b - a > 1e-7; it++) { const m = (a + b) / 2; if (d(m) > 0) a = m; else b = m; }
    cross.push(round6((a + b) / 2));
  }
  sorted = [...new Set([...sorted, ...cross])].sort((a, b) => a - b);
  return sorted.map(v => [v, round6(fAt(v))] as CurvePoint);
}

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
