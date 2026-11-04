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

/**
 * Max-over-curves envelope sampled at every breakpoint of every curve (plus midpoints), with each curve
 * contributing only inside its own speed band. Used to build retarder envelopes from per-gear curves.
 */
export function envelopeOf(curves: CurvePoint[][]): CurvePoint[] {
  const vs = new Set<number>();
  for (const c of curves) for (let i = 0; i < c.length; i++) {
    vs.add(c[i][0]);
    if (i + 1 < c.length) vs.add((c[i][0] + c[i + 1][0]) / 2);
  }
  const sorted = [...new Set([...vs].map(round6))].sort((a, b) => a - b);
  const out: CurvePoint[] = [];
  for (const v of sorted) {
    let f = 0;
    for (const c of curves) f = Math.max(f, gearForce(c, v));
    out.push([v, round6(f)]);
  }
  return out;
}

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
