/**
 * Truck Curves tab API: envelopes, resistance lines, operating points and physics-derived speed tables.
 * All speeds km/h, forces kN, masses t, grades as fractions (0.10 = 10 %).
 */
import type { CircuitResult, CurvePoint, GradeSpeedPoint, LimitReason, Material, Source, SpeedModel, TruckModel } from '@/core/types';
import { WORKBOOK_SPEEDS } from '@/data/tables';
import { DEFAULT_MATERIALS } from '@/data/materials';
import type { CircuitResultExt, DescentRule, SegmentResultExt, TruckModelExt } from '../types';
import { G, payloadFor, resistanceKN, steadySpeed } from '../haul/physics';
import { tableSpeed } from '../haul/spreadsheet';
import { truckPhysics } from '../haul/truck';

export interface TruckEnvelope {
  truckId: string;
  name: string;
  drive: TruckModel['drive'];
  topSpeedKmh: number;
  /** Rimpull envelope (max over gears), [km/h, kN]. */
  rimpull: CurvePoint[];
  /** Continuous retarder envelope, [km/h, kN]. */
  retarder: CurvePoint[];
  /** Per-gear curves (empty for electric drives). */
  gears: { gear: number; maxKmh: number; rimpull: CurvePoint[]; retarder?: CurvePoint[] }[];
  retarderPowerKW?: number;
  descentRule: DescentRule;
  emptyMassT: number;
  /** Empty mass + nominal payload, t. */
  loadedMassT: number;
  gvwT: number;
  estimated: string[];
  dataQuality?: Record<string, string>;
  sources: Source[];
}

/**
 * Curves of a truck for charting.
 * @param truck truck model
 */
export function truckEnvelope(truck: TruckModel): TruckEnvelope {
  const tp = truckPhysics(truck);
  const t = truck as TruckModelExt;
  const gears = tp.rimpullGears.map(g => ({
    gear: g.gear, maxKmh: g.maxKmh, rimpull: g.points, retarder: tp.retarderGears.find(r => r.gear === g.gear)?.points,
  }));
  return {
    truckId: truck.id, name: truck.name, drive: truck.drive, topSpeedKmh: tp.topKmh, rimpull: tp.rimpull, retarder: tp.retarder, gears,
    retarderPowerKW: t.retarderPowerKW, descentRule: tp.descentRule, emptyMassT: truck.emptyMassT, loadedMassT: truck.emptyMassT + truck.payloadT,
    gvwT: truck.gvwT, estimated: truck.estimated ?? [], dataQuality: t.dataQuality, sources: truck.sources ?? [],
  };
}

/**
 * Grade-resistance force for a gross mass on an effective grade (chart form, as on OEM rimpull charts), kN.
 *   F = m · g · G_eff     (G_eff = grade + RR; negative = net retarding)
 * @param gvwT gross mass, t
 * @param effGrade effective grade, fraction
 */
export function resistanceForce(gvwT: number, effGrade: number): number {
  return gvwT * G * effGrade;
}

/**
 * Exact resistance on a slope (the engine's segment form), kN: m·g·(sinθ + cosθ·RR/100).
 * @param massT gross mass, t
 * @param grade ΔZ / slope distance
 * @param rrPct rolling resistance %
 */
export function resistanceForceExact(massT: number, grade: number, rrPct: number): number {
  return resistanceKN(massT, grade, rrPct);
}

export interface OperatingPointDir {
  speedKmh: number;
  /** |F_res| — force the truck must deliver (propel) or absorb (retard), kN. */
  forceKN: number;
  /** Force available from the curve at the steady speed, kN (NaN in spreadsheet mode). */
  availKN: number;
  mode: 'propel' | 'retard';
  effGrade: number;
  limit: LimitReason;
  binding?: string;
  gear?: number;
  massT: number;
}

export interface OperatingPoint {
  i: number;
  chainageM: number;
  lengthM: number;
  loaded: OperatingPointDir;
  empty: OperatingPointDir;
}

/**
 * Each segment's operating point (steady speed vs required force) for plotting on the rimpull/retarder chart.
 * Spreadsheet results plot the table speed against the force the grade would require at the payload mass.
 * @param result a circuit result
 */
export function operatingPoints(result: CircuitResult): OperatingPoint[] {
  const r = result as CircuitResultExt;
  const mL = r.massLoadedT ?? NaN, mE = r.massEmptyT ?? NaN;
  return (r.segments as SegmentResultExt[]).map(sg => {
    const dir = (loaded: boolean): OperatingPointDir => {
      const ph = loaded ? sg.physLoaded : sg.physEmpty;
      const g = loaded ? sg.grade : -sg.grade;
      const m = ph?.massT ?? (loaded ? mL : mE);
      const fRes = ph?.resistanceKN ?? resistanceKN(m, g, sg.rrPct);
      return {
        speedKmh: ph?.steadyKmh ?? (loaded ? sg.speedLoadedKmh : sg.speedEmptyKmh), forceKN: Math.abs(fRes), availKN: ph?.forceAvailKN ?? NaN,
        mode: fRes >= 0 ? 'propel' : 'retard', effGrade: loaded ? sg.effGradeLoaded : sg.effGradeEmpty, limit: loaded ? sg.limitLoaded : sg.limitEmpty,
        binding: ph?.binding, gear: ph?.gear, massT: m,
      };
    };
    return { i: sg.i, chainageM: sg.chainageM, lengthM: sg.dist3dM, loaded: dir(true), empty: dir(false) };
  });
}

export interface DerivedSpeedRow {
  /** Actual grade (fraction), + uphill in the direction of travel. */
  grade: number;
  /** Effective grade = grade + RR/100. */
  effGrade: number;
  kmh: number;
  limit: LimitReason;
  binding: string;
  gear?: number;
  /** The workbook table speed for the same grade (null when out of range). */
  spreadsheetKmh: number | null;
}

export interface DerivedTableOpts {
  materials?: Material[];
  /** Override payload, t. */
  payloadT?: number;
  /** Speed cap, km/h (default: none — truck top speed). */
  speedLimitKmh?: number;
  /** Grades to tabulate (default −0.16 … +0.16 step 0.01, the workbook rows). */
  grades?: number[];
}

/**
 * Physics grade → speed table comparable with the workbook's loaded/unloaded table.
 * @param truck truck model
 * @param loaded loaded (empty mass + payload) or empty
 * @param rrPct rolling resistance %
 * @param materialId payload = truck.loadBcmByMaterial[material] × bank density (else nominal payload)
 */
export function derivedSpeedTable(truck: TruckModel, loaded: boolean, rrPct: number, materialId?: string, opts: DerivedTableOpts = {}): DerivedSpeedRow[] {
  const tp = truckPhysics(truck);
  const mats = opts.materials ?? DEFAULT_MATERIALS;
  let payload = opts.payloadT ?? truck.payloadT;
  if (opts.payloadT == null && materialId) {
    const bcm = truck.loadBcmByMaterial?.[materialId];
    const mat = mats.find(m => m.id === materialId);
    if (bcm && mat) payload = payloadFor(bcm, mat.bankDensity, truck.payloadT).payloadT;
  }
  const m = truck.emptyMassT + (loaded ? payload : 0);
  const grades = opts.grades ?? Array.from({ length: 33 }, (_, k) => (k - 16) / 100);
  const tbl = truck.spreadsheetSpeeds ?? WORKBOOK_SPEEDS;
  return grades.map(g => {
    const r = steadySpeed(tp, m, g, rrPct, opts.speedLimitKmh ?? Infinity);
    const sp = tableSpeed(loaded ? tbl.loaded : tbl.empty, g, false);
    return { grade: g, effGrade: g + rrPct / 100, kmh: r.kmh, limit: r.limit, binding: r.binding, gear: r.gear, spreadsheetKmh: sp.kmh };
  });
}

/** The same as derivedSpeedTable as plain [grade, km/h] points. */
export function derivedSpeedPoints(truck: TruckModel, loaded: boolean, rrPct: number, materialId?: string, opts: DerivedTableOpts = {}): GradeSpeedPoint[] {
  return derivedSpeedTable(truck, loaded, rrPct, materialId, opts).map(r => [r.grade, r.kmh]);
}

/**
 * Speed on a grade for the Truck Curves tab and quick checks.
 *   'spreadsheet': workbook table on ROUND(grade, 2) (RR ignored, as in Excel); outside ±16 % the steepest row is
 *                  returned with limit 'table-out-of-range' (Excel would drop the segment).
 *   'rimpull':     steady balance speed at effective grade = grade + RR, empty mass or empty + payload.
 * @param truck truck model (undefined → 30 km/h table fallback)
 * @param grade grade fraction in the direction of travel
 * @param loaded loaded / empty
 * @param model speed model
 * @param rrPct rolling resistance % (rimpull only)
 * @param opts payload (t) and speed limit (km/h) overrides
 */
export function speedOnGrade(truck: TruckModel | undefined, grade: number, loaded: boolean, model: SpeedModel = 'spreadsheet', rrPct = 0,
  opts: { payloadT?: number; speedLimitKmh?: number } = {}): { kmh: number; limit: LimitReason; binding?: string; gear?: number } {
  if (model === 'rimpull' && truck) {
    const tp = truckPhysics(truck);
    const m = truck.emptyMassT + (loaded ? (opts.payloadT ?? truck.payloadT) : 0);
    const r = steadySpeed(tp, m, grade, rrPct, opts.speedLimitKmh ?? Infinity);
    return { kmh: r.kmh, limit: r.limit, binding: r.binding, gear: r.gear };
  }
  const tbl = truck?.spreadsheetSpeeds ?? WORKBOOK_SPEEDS;
  const r = tableSpeed(loaded ? tbl.loaded : tbl.empty, grade, true);
  if (r.kmh == null) return { kmh: 30, limit: 'table-out-of-range' };
  return { kmh: r.kmh, limit: r.outOfRange ? 'table-out-of-range' : 'table' };
}
