/**
 * Truck physics view: rimpull / retarder envelopes, per-gear curves and the descent rule, prepared once per
 * TruckModel (cached by object identity).
 */
import type { CurvePoint, TruckModel } from '@/core/types';
import type { DescentRule, GearCurve, TruckModelExt } from '../types';
import { envelopeOf, gearForce } from '../util/curve';

export interface TruckPhysics {
  truck: TruckModelExt;
  /** Rimpull envelope [km/h, kN] (max over gears). */
  rimpull: CurvePoint[];
  /** Continuous retarder envelope [km/h, kN]. */
  retarder: CurvePoint[];
  rimpullGears: GearCurve[];
  retarderGears: GearCurve[];
  descentRule: DescentRule;
  /** Top speed, km/h. */
  topKmh: number;
  driveShare: { loaded: number; empty: number };
  retarderPowerKW?: number;
  /** Curve fields flagged as estimated (for CalcStep sources). */
  rimpullEstimated: boolean;
  retarderEstimated: boolean;
}

const cache = new WeakMap<TruckModel, TruckPhysics>();

const sortCurve = (c: CurvePoint[] | undefined): CurvePoint[] =>
  (c ?? []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]] as CurvePoint).sort((a, b) => a[0] - b[0]);

/** Prepared physics for a truck model. */
export function truckPhysics(truck: TruckModel): TruckPhysics {
  const hit = cache.get(truck);
  if (hit) return hit;
  const t = truck as TruckModelExt;
  const rimpullGears = (t.rimpullGears ?? []).map(g => ({ ...g, points: sortCurve(g.points) })).sort((a, b) => a.gear - b.gear);
  const retarderGears = (t.retarderGears ?? []).map(g => ({ ...g, points: sortCurve(g.points) })).sort((a, b) => a.gear - b.gear);
  let rimpull = sortCurve(t.rimpull);
  if (!rimpull.length && rimpullGears.length) rimpull = envelopeOf(rimpullGears.map(g => g.points));
  let retarder = sortCurve(t.retarder);
  if (!retarder.length && retarderGears.length) retarder = envelopeOf(retarderGears.map(g => g.points));
  const descentRule: DescentRule = t.descentRule
    ?? (retarderGears.length > 1 && /cat/i.test(t.make) ? 'discrete_gear' : 'continuous');
  const est = new Set(t.estimated ?? []);
  const tp: TruckPhysics = {
    truck: t, rimpull, retarder, rimpullGears, retarderGears, descentRule,
    topKmh: t.topSpeedKmh > 0 ? t.topSpeedKmh : (rimpull.length ? rimpull[rimpull.length - 1][0] : 60),
    driveShare: t.driveAxleShare ?? { loaded: 0.67, empty: 0.5 },
    retarderPowerKW: t.retarderPowerKW,
    rimpullEstimated: est.has('rimpull'),
    retarderEstimated: est.has('retarder'),
  };
  cache.set(truck, tp);
  return tp;
}

/** Gear delivering the most rimpull at v (the transmission picks the best gear); undefined for gearless drives. */
export function rimpullGearAt(tp: TruckPhysics, vKmh: number): number | undefined {
  let best: number | undefined, bestF = -1;
  for (const g of tp.rimpullGears) {
    const f = gearForce(g.points, vKmh);
    if (f > bestF + 1e-9) { bestF = f; best = g.gear; }
  }
  return bestF > 0 ? best : undefined;
}

/** Gear whose retarder band contains v (highest such gear). */
export function retarderGearAt(tp: TruckPhysics, vKmh: number): number | undefined {
  let best: number | undefined;
  for (const g of tp.retarderGears) {
    const lo = g.points[0]?.[0] ?? 0, hi = g.points[g.points.length - 1]?.[0] ?? 0;
    if (vKmh >= lo - 1e-9 && vKmh <= hi + 1e-9) best = g.gear;
  }
  return best;
}

/** Gear governed top speed, km/h (from the rimpull gear table or TruckModel.gears). */
export function gearMaxKmh(tp: TruckPhysics, gear: number): number | undefined {
  return tp.rimpullGears.find(g => g.gear === gear)?.maxKmh ?? tp.truck.gears?.find(g => g.gear === gear)?.maxKmh;
}
