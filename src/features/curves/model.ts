/**
 * Engine adapters for the Truck curves tab. Every speed, operating point and envelope shown on the tab comes from
 * '@/engine' (truckEnvelope / speedOnGrade / derivedSpeedTable / operatingPoints), so the charts show exactly what
 * the circuit calculations use. Local helpers in ./physics only draw curves and convert force ↔ effective grade.
 */
import type { CircuitResult, TruckModel } from '@/core/types';
import { curveForce, derivedSpeedTable, operatingPoints, speedOnGrade, truckEnvelope, type DerivedSpeedRow } from '@/engine';
import { withPhysics } from './oem';
import { effGradeForce, type TruckX } from './physics';
import type { OpPoint } from './RimpullChart';

/** TruckModel with the engine's envelopes and per-gear curves attached (falls back to the machine library). */
export function chartTruck(t: TruckModel): TruckX {
  const env = truckEnvelope(t);
  const lib = withPhysics(t);
  return {
    ...t,
    rimpull: env.rimpull.length ? env.rimpull : t.rimpull,
    retarder: env.retarder.length ? env.retarder : t.retarder,
    topSpeedKmh: env.topSpeedKmh || t.topSpeedKmh,
    rimpullGears: env.gears.length ? env.gears.map(g => ({ gear: g.gear, maxKmh: g.maxKmh, points: g.rimpull })) : lib.rimpullGears,
    retarderGears: env.gears.some(g => g.retarder?.length)
      ? env.gears.filter(g => g.retarder?.length).map(g => ({ gear: g.gear, maxKmh: g.maxKmh, points: g.retarder! }))
      : lib.retarderGears,
    descentRule: env.descentRule,
    retarderPowerKW: env.retarderPowerKW ?? lib.retarderPowerKW,
    dataQuality: env.dataQuality ?? lib.dataQuality,
    estimationMethod: (t as TruckX).estimationMethod ?? lib.estimationMethod,
  };
}

export interface Balance {
  kmh: number;
  limit: string;
  binding?: string;
  gear?: number;
  mode: 'propel' | 'retard';
  /** |resistance| (propel) or braking required (retard), kN. */
  forceKN: number;
  availKN: number;
}

/**
 * Balance speed at an EFFECTIVE grade (chart convention F = m·g·G_eff) for a gross mass, from the engine.
 * @param effGrade fraction, negative = net downhill (retarding)
 */
export function balanceAt(t: TruckX, massT: number, effGrade: number, speedLimitKmh?: number): Balance {
  const loaded = massT > t.emptyMassT + 1e-6;
  const r = speedOnGrade(t, effGrade, loaded, 'rimpull', 0, { payloadT: loaded ? massT - t.emptyMassT : undefined, speedLimitKmh });
  const mode = effGrade >= 0 ? 'propel' : 'retard';
  const curve = mode === 'propel' ? t.rimpull : t.retarder;
  return { kmh: r.kmh, limit: r.binding === 'stall' ? 'stall' : r.limit, binding: r.binding, gear: r.gear, mode, forceKN: Math.abs(effGradeForce(massT, effGrade * 100)), availKN: curveForce(curve, r.kmh) };
}

/** Physics speed per actual grade (+ RR) at a payload, with the workbook table speed alongside (engine). */
export function speedRows(t: TruckX, loaded: boolean, rrPct: number, payloadT: number, grades: number[], speedLimitKmh?: number): DerivedSpeedRow[] {
  return derivedSpeedTable(t, loaded, rrPct, undefined, { payloadT, speedLimitKmh, grades });
}

/** The circuit's segment operating points (engine) in chart form. */
export function chartPoints(result: CircuitResult | undefined): OpPoint[] {
  if (!result?.ok) return [];
  const segs = result.segments;
  return operatingPoints(result).flatMap(op => {
    const seg = segs.find(s => s.i === op.i)!;
    return (['loaded', 'empty'] as const).map(dir => {
      const d = op[dir];
      return {
        key: `${op.i}-${dir}`, seg, dir, v: d.speedKmh, f: d.forceKN, mode: d.mode, grade: dir === 'loaded' ? seg.grade : -seg.grade,
        limit: d.limit, time: dir === 'loaded' ? seg.timeLoadedS : seg.timeEmptyS, massT: d.massT, gear: d.gear, binding: d.binding,
      } satisfies OpPoint;
    });
  }).filter(p => p.v > 0 && Number.isFinite(p.f) && p.seg.dist3dM > 0);
}

export const limitShort = (b: { limit: string; binding?: string; gear?: number }) => {
  const bd = b.binding ?? '';
  if (bd === 'stall') return 'stall';
  if (bd === 'retarder-exceeded') return 'ret. exceeded';
  if (bd.startsWith('governor_g')) return `gov. G${b.gear ?? bd.slice(10)}`;
  if (bd.startsWith('rimpull_g')) return `G${b.gear ?? bd.slice(9)}`;
  if (bd.startsWith('retarder_g')) return `ret G${b.gear ?? bd.slice(10)}`;
  return b.limit === 'top-speed' ? 'top' : b.limit === 'speed-limit' ? 'limit' : b.limit === 'rimpull' ? (b.gear ? `G${b.gear}` : 'rimpull') : b.limit === 'retarder' ? (b.gear ? `ret G${b.gear}` : 'retarder') : b.limit;
};
