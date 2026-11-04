/**
 * Truck-curve maths for the Truck curves tab (pure, unit-tested).
 *
 * Mirrors the engine's documented method (docs/spec/04 §B.1–B.4, oem-curves.json conventions) so the chart's
 * intersections, crosshair gradeability and payload / RR what-ifs are exact and instant:
 *   F_res = m·g·(sin θ + cos θ·RR/100)       (kN; m in t; sin θ = ΔZ / slope distance)
 *   propel:  v* = sup { v : F_rim(v) ≥ F_res }                       rimpull envelope, power-space interpolation
 *   retard:  'discrete_gear' v* = max { v_max,g : F_ret,g(v_max,g) ≥ F_req }   (Cat ARC)
 *            'continuous'    v* = sup { v : F_ret(v) ≥ F_req }                    (Komatsu ARSC / electric)
 * Operating points on the chart come from the engine's own SegmentResults.
 */
import type { CurvePoint, LimitReason, TruckModel } from '@/core/types';

export const G = 9.81;

export interface GearCurveX { gear: number; maxKmh: number; points: CurvePoint[] }
/** Optional physics fields the engine/data layer adds to TruckModel (engine TruckModelExt; read structurally). */
export interface TruckX extends TruckModel {
  rimpullGears?: GearCurveX[];
  retarderGears?: GearCurveX[];
  retarderPowerKW?: number;
  retarderCapKN?: number;
  descentRule?: 'discrete_gear' | 'continuous';
  dataQuality?: Record<string, string>;
  estimationMethod?: string;
  netPowerKW?: number;
  siteAliases?: string[];
}

const sorted = (c: CurvePoint[]) => (c.every((p, i) => i === 0 || c[i - 1][0] <= p[0]) ? c : [...c].sort((a, b) => a[0] - b[0]));

/** Force at speed v on a [km/h, kN] curve; power-space interpolation; 0 outside the curve's speed band (governor). */
export function curveForce(curve: CurvePoint[], v: number, clampLow = true): number {
  const c = sorted(curve);
  if (!c.length) return 0;
  if (v < c[0][0]) return clampLow ? c[0][1] : 0;
  if (v > c[c.length - 1][0]) return 0;
  for (let i = 1; i < c.length; i++) {
    const [v0, f0] = c[i - 1], [v1, f1] = c[i];
    if (v > v1) continue;
    if (v1 - v0 < 1e-9) return Math.max(f0, f1);
    const t = (v - v0) / (v1 - v0);
    if (v0 <= 1e-9 || v <= 1e-9) return f0 + (f1 - f0) * t; // pieces from rest: linear in F
    const p = f0 * v0 + (f1 * v1 - f0 * v0) * t;
    return p / v;
  }
  return c[c.length - 1][1];
}

/** Highest speed with F(v) ≥ force, scanning down from the curve's top speed (curves step down at upshifts). */
export function supSpeed(curve: CurvePoint[], force: number, step = 0.02): number | undefined {
  const c = sorted(curve);
  if (!c.length) return undefined;
  const vmax = c[c.length - 1][0];
  if (c[c.length - 1][1] >= force) return vmax;
  for (let v = vmax; v >= 0; v -= step) if (curveForce(c, v) >= force - 1e-9) return Math.max(0, v);
  return undefined;
}

export function resistanceKN(massT: number, sinTheta: number, rrPct: number): number {
  const s = Math.max(-1, Math.min(1, sinTheta));
  return massT * G * (s + Math.sqrt(1 - s * s) * rrPct / 100);
}

/** Chart convention (Cat performance charts): total resistance at an effective grade, F = m·g·G_eff. */
export const effGradeForce = (massT: number, effGradePct: number) => massT * G * effGradePct / 100;
/** Inverse: effective grade a force can hold at mass m, %. */
export const gradeability = (forceKN: number, massT: number) => (massT > 0 ? (forceKN / (massT * G)) * 100 : 0);

export function gearAt(gears: GearCurveX[] | undefined, v: number): number | undefined {
  if (!gears?.length) return undefined;
  let best: { g: number; f: number } | undefined;
  for (const g of gears) {
    const lo = g.points[0]?.[0] ?? 0;
    if (v < lo - 1e-9 || v > g.maxKmh + 1e-9) continue;
    const f = curveForce(g.points, v, false);
    if (!best || f > best.f) best = { g: g.gear, f };
  }
  return best?.g;
}

export interface Balance {
  kmh: number;
  limit: LimitReason | 'stall';
  mode: 'propel' | 'retard';
  gear?: number;
  /** Resistance (propel) or required braking (retard), kN, positive. */
  forceKN: number;
  /** Rimpull / retarder available at kmh, kN. */
  availKN: number;
}

export function descentRuleOf(t: TruckX): 'discrete_gear' | 'continuous' {
  if (t.descentRule) return t.descentRule;
  return t.drive === 'mechanical' && /cat|caterpillar/i.test(t.make) ? 'discrete_gear' : 'continuous';
}

/** Balance speed for a signed resistance force (kN; < 0 = net downhill). */
export function balanceForForce(t: TruckX, fRes: number, speedLimitKmh = Infinity): Balance {
  const top = Math.min(t.topSpeedKmh || Infinity, speedLimitKmh);
  const capReason = (t.topSpeedKmh || Infinity) <= speedLimitKmh ? 'top-speed' : 'speed-limit';
  if (fRes >= 0) {
    const v = supSpeed(t.rimpull, fRes);
    if (v == null || v <= 0.05) return { kmh: 0, limit: 'stall', mode: 'propel', forceKN: fRes, availKN: curveForce(t.rimpull, 0) };
    if (v >= top - 1e-9) return { kmh: top, limit: capReason, mode: 'propel', forceKN: fRes, availKN: curveForce(t.rimpull, top), gear: gearAt(t.rimpullGears, top) };
    return { kmh: v, limit: 'rimpull', mode: 'propel', forceKN: fRes, availKN: curveForce(t.rimpull, v), gear: gearAt(t.rimpullGears, v) };
  }
  const req = -fRes;
  if (descentRuleOf(t) === 'discrete_gear' && t.retarderGears?.length) {
    const ok = [...t.retarderGears].sort((a, b) => b.gear - a.gear).find(g => curveForce(g.points, g.maxKmh, false) >= req - 1e-9);
    if (!ok) return { kmh: 0, limit: 'stall', mode: 'retard', forceKN: req, availKN: 0 };
    const v = Math.min(ok.maxKmh, top);
    return { kmh: v, limit: v < ok.maxKmh ? capReason : 'retarder', mode: 'retard', forceKN: req, availKN: curveForce(ok.points, ok.maxKmh, false), gear: ok.gear };
  }
  const v = supSpeed(t.retarder, req);
  if (v == null) return { kmh: 0, limit: 'stall', mode: 'retard', forceKN: req, availKN: 0 };
  const retTop = t.retarder.length ? t.retarder[t.retarder.length - 1][0] : 0;
  if (v >= top - 1e-9 || (v >= retTop - 1e-9 && retTop >= top - 0.5)) return { kmh: top, limit: capReason, mode: 'retard', forceKN: req, availKN: curveForce(t.retarder, top) };
  return { kmh: v, limit: 'retarder', mode: 'retard', forceKN: req, availKN: curveForce(t.retarder, v), gear: gearAt(t.retarderGears, v) };
}

/** Balance speed on a grade (fraction, + uphill in direction of travel) at mass m and RR %. */
export function balanceOnGrade(t: TruckX, massT: number, grade: number, rrPct: number, speedLimitKmh = Infinity): Balance {
  return balanceForForce(t, resistanceKN(massT, grade, rrPct), speedLimitKmh);
}

/** Physics speed vs grade table (grades as fractions). */
export function physicsSpeedCurve(t: TruckX, massT: number, rrPct: number, grades: number[], speedLimitKmh = Infinity): { grade: number; b: Balance }[] {
  return grades.map(grade => ({ grade, b: balanceOnGrade(t, massT, grade, rrPct, speedLimitKmh) }));
}

/** Workbook lookup at a grade: exact match on ROUND(grade, 2); undefined when outside the table (dropped). */
export function tableSpeed(tbl: [number, number][] | undefined, roundedGrade: number): number | undefined {
  return tbl?.find(p => Math.abs(p[0] - roundedGrade) < 1e-9)?.[1];
}

export const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; v <= b + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
};
