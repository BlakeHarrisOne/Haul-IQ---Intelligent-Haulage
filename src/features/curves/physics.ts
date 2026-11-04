/**
 * Drawing helpers for the truck-curve charts (pure, unit-tested): curve sampling with power-space interpolation
 * (oem-curves.json convention, same as the engine), gear lookup and force ↔ effective-grade conversion
 * (F = m·g·G_eff, the OEM chart form). Speeds themselves come from the engine (see ./model).
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

/** Workbook lookup at a grade: exact match on ROUND(grade, 2); undefined when outside the table (dropped). */
export function tableSpeed(tbl: [number, number][] | undefined, roundedGrade: number): number | undefined {
  return tbl?.find(p => Math.abs(p[0] - roundedGrade) < 1e-9)?.[1];
}

export const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; v <= b + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
};
