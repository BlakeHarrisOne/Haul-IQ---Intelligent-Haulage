/**
 * computeCircuit: route → travel times (spreadsheet table or rimpull physics) → cycle → productivity → fleet.
 *
 * Spreadsheet mode reproduces 'Travel Time' + 'ActiveRoute' of calc.xlsm exactly (spec 01 §5–6), operation for
 * operation, so every number matches Excel to the last bits:
 *   C4 = Σ ((d/1000)/v_L)·60·60 · C5 = Σ ((d/1000)/v_U)·60·60 · C7 = (C4 + C5)/C6 · C14 = C7 + C8 + C9 + C10 + C12
 *   C15 = C14/60 · C16 = (60/C15)·C21 · C17 = C20/C16 · C19 = rate·I34 · C24 = C17/C22 · C26 = C20/rate
 *   C28 = C22/2 − C26/2 (generalised to shiftsPerDay)
 * Rimpull mode replaces the table by force balance (steady) or a forward–backward kinematic pass, keeping the
 * same cycle / productivity / fleet chain so the two modes are directly comparable.
 */
import type { Circuit, CircuitParams, LimitReason, Material, Scenario, TruckModel } from '@/core/types';
import {
  LOADER_ASSUMPTION_CELLS, WORKBOOK_SPEED_RANGES, WORKBOOK_SPEEDS, WORKBOOK_TRUCK_LOADS, workbookLoaderKey,
} from '@/data/tables';
import type {
  CircuitParamsExt, CircuitResultExt, DirPhysics, MotionModel, OutOfRangeMode, PenaltyStop, QueueModel, SegmentResultExt,
  TravelInterval, TravelProfile, TruckModelExt,
} from '../types';
import { fleetOption, fleetOptions, type FleetCtx } from '../fleet/options';
import { queueEstimate } from '../fleet/queue';
import { fmt, StepLog, type StepInput } from '../util/steps';
import { kinematicLeg, type KinOpts, type LegSeg } from './kinematic';
import { payloadFor, steadySpeed, type SteadySolve } from './physics';
import { buildRoute, stopsPerCycle, type Route } from './route';
import { tableSpeed } from './spreadsheet';
import { truckPhysics } from './truck';

export interface CircuitOptions {
  /** Evaluate on another haul string (long/short haul alternatives) instead of circuit.haulStringId. */
  haulStringId?: string;
  /** Evaluate at this many trucks instead of circuit.trucks. */
  trucks?: number;
  speedModel?: CircuitParams['speedModel'];
  /** Max trucks to tabulate in options (default: max(12, recommended + 3)). */
  maxTrucks?: number;
  /** Spreadsheet mode out-of-range rule (overrides params.outOfRange). 'clamp' = the "use 12/14 km/h" fix. */
  outOfRange?: OutOfRangeMode;
  /** Rimpull mode motion model (overrides params.motion). */
  motion?: MotionModel;
  /** Fleet production model (overrides params.queueModel). */
  queueModel?: QueueModel;
}

/** Kinematic defaults (spec 04 §B.6 / B.10, [EST]). */
export const KINEMATIC_DEFAULTS = { accelMaxMs2: 0.6, decelLoadedMs2: 0.6, decelEmptyMs2: 0.8, tractionCoeff: 0.5, stopDwellS: 5, kRot: 0.05, dsMaxM: 10 };

const emptyOptionExt = (n: number) => ({
  trucks: n, truckCapacityBcmDay: 0, bcmPerDay: 0, loaderPtHrsDay: 0, lostLoaderPtHrsShift: 0, truckQueueHrsShift: 0, matchFactor: 0,
  loaderUtil: 0, status: 'balanced' as const, goalSeekBcmDay: 0, capped: false, truckHoursReq: 0, trucksNeeded: 0, idealBcmDay: 0,
  queueModel: 'deterministic' as const, loaderBusy: 0, queueWaitMinPerLoad: 0,
});

const emptyProfile = (): TravelProfile => ({ intervals: [], lengthM: 0, timeS: 0 });

/**
 * Full calculation for one circuit.
 * @param scenario the scenario (strings, fleet, materials)
 * @param circuit the circuit
 * @param opts evaluation overrides (alternative string, trucks, models)
 */
export function computeCircuit(scenario: Scenario, circuit: Circuit, opts: CircuitOptions = {}): CircuitResultExt {
  const p = circuit.params as CircuitParamsExt;
  const speedModel = opts.speedModel ?? p.speedModel ?? 'spreadsheet';
  const outOfRange: OutOfRangeMode = opts.outOfRange ?? p.outOfRange ?? 'drop';
  const motion: MotionModel = opts.motion ?? p.motion ?? 'kinematic';
  const queueModel: QueueModel = opts.queueModel ?? p.queueModel ?? 'deterministic';
  const haulStringId = opts.haulStringId ?? circuit.haulStringId;
  const hs = scenario.strings.find(s => s.id === haulStringId);
  const truck = scenario.fleet.trucks.find(t => t.id === circuit.truckModelId);
  const material = scenario.materials.find(m => m.id === circuit.materialId);
  const la = scenario.fleet.loaderAssumptions.find(l => l.unitId === circuit.loaderUnitId);
  const log = new StepLog();
  const warnings: string[] = [];
  const base: CircuitResultExt = {
    circuitId: circuit.id, ok: false, speedModel, segments: [], lengthM: 0, riseM: 0, fallM: 0, travelLoadedS: 0, travelEmptyS: 0,
    haulTimeS: 0, stopsS: 0, cycleS: 0, cycleMin: 0, truckProdBcmPerPtHr: 0, truckHoursReq: 0, trucksExact: 0, trucksRecommended: 0,
    loaderPtHrs: 0, lostPtHrsShift: 0, assigned: emptyOptionExt(0), options: [], steps: log.steps, warnings,
    haulStringId, truckModelId: circuit.truckModelId, idealDailyBcm: 0, desiredDailyBcm: p.desiredDailyBcm, loaderPtTargetHrs: 0,
    truckLoadBcm: p.truckLoadBcm, serviceS: p.spotS + p.loadS, droppedSegments: [], queueModel, stopsModelled: 0, penaltyStops: [],
    profiles: { loaded: emptyProfile(), empty: emptyProfile() },
    ...(speedModel === 'spreadsheet' ? { outOfRange } : { motion }),
  };
  const route = buildRoute(hs, p);
  warnings.push(...route.warnings);
  if (route.error) return { ...base, error: route.error };
  if (!truck) return { ...base, error: `Truck model "${circuit.truckModelId}" not found in the fleet library`, lengthM: route.lengthM };
  const bad = validateParams(p);
  if (bad) return { ...base, error: bad, lengthM: route.lengthM };

  const src = sources(scenario, circuit, truck, material);
  log.add('route', 'route.length', 'Route length (3D slope distance)', 'L = Σ √(ΔE² + ΔN² + ΔZ²)', route.lengthM, 'm', {
    substituted: `Σ over ${route.segs.length} segments of "${hs?.name}"`, sheetRef: "'Travel Time'!A:A",
    inputs: [{ label: 'Haul string', value: hs?.name ?? '', source: hs?.source === 'imported' ? 'Imported string' : 'Haul string' },
      { label: 'Rise', value: +route.riseM.toFixed(2), unit: 'm' }, { label: 'Fall', value: +route.fallM.toFixed(2), unit: 'm' }],
    note: 'Grade per segment = ΔZ / 3D slope distance (sin θ), positive uphill dig → dump (Travel Time!B).',
  });

  const travel = speedModel === 'spreadsheet'
    ? spreadsheetTravel(route, truck, material, p, outOfRange, log, warnings)
    : rimpullTravel(route, truck, material, p, motion, log, warnings);

  const tl = travel.loadedS, te = travel.emptyS;
  // stop signs: kinematic mode models stop points as real stops; the rest use the per-stop penalty
  const stopsModelled = travel.stopsModelled;
  const penaltyCount = Math.max(0, p.stopSigns - stopsModelled);
  const stopsS = speedModel === 'spreadsheet' ? p.stopPenaltyS * p.stopSigns : p.stopPenaltyS * penaltyCount;
  const haul = (tl + te) / p.haulEff;
  const cycle = haul + p.dumpS + p.spotS + p.loadS + stopsS;
  const cycleMin = cycle / 60;
  const prod = (60 / cycleMin) * p.truckLoadBcm;
  const loaderPtTarget = p.loaderPtHrsPerDay ?? p.truckPtHrsPerDay;
  const ideal = p.plannedRateBcmPerPtHr * loaderPtTarget;
  const desired = p.desiredDailyBcm;
  const truckHrs = desired / prod;
  const trucksExact = truckHrs / p.truckPtHrsPerDay;
  const loaderPt = desired / p.plannedRateBcmPerPtHr;
  const s = p.shiftsPerDay > 0 ? p.shiftsPerDay : 2;
  const lostDesired = loaderPtTarget / s - loaderPt / s;
  const trucksRecommended = Math.ceil(trucksExact - 1e-9);

  // ── cycle steps
  const tlSheet = speedModel === 'spreadsheet' ? "'Travel Time'!F15 → ActiveRoute!C4" : undefined;
  log.add('cycle', 'cycle.haul', 'Haul time', 'T_haul = (T_loaded + T_empty) / η', haul, 's', {
    substituted: `(${fmt(tl)} + ${fmt(te)}) / ${fmt(p.haulEff, 3)}`, sheetRef: 'ActiveRoute!C7',
    inputs: [{ label: 'T_loaded', value: +tl.toFixed(3), unit: 's', source: tlSheet ?? 'Travel (loaded)' },
      { label: 'T_empty', value: +te.toFixed(3), unit: 's', source: speedModel === 'spreadsheet' ? "'Travel Time'!H15 → ActiveRoute!C5" : 'Travel (empty)' },
      { label: 'η haul efficiency', value: p.haulEff, source: 'Circuit params (ActiveRoute!C6)' }],
    note: 'Efficiency divides travel time only (workbook Q8): fixed times and stop penalties are not adjusted.',
  });
  log.add('cycle', 'cycle.dump', 'Dump time', 'T_dump', p.dumpS, 's', { inputs: [{ label: 'Dump', value: p.dumpS, unit: 's', source: src.dump }], sheetRef: 'ActiveRoute!C8' });
  log.add('cycle', 'cycle.spot', 'Spot time', 'T_spot', p.spotS, 's', { inputs: [{ label: 'Spot', value: p.spotS, unit: 's', source: src.spot }], sheetRef: 'ActiveRoute!C9' });
  log.add('cycle', 'cycle.load', 'Loading time', 'T_load', p.loadS, 's', { inputs: [{ label: 'Load', value: p.loadS, unit: 's', source: src.load }], sheetRef: 'ActiveRoute!C10' });
  if (speedModel === 'spreadsheet') {
    log.add('cycle', 'cycle.stops', 'Stop sign + start/stop accel', 'T_stops = penalty × stops', stopsS, 's', {
      substituted: `${fmt(p.stopPenaltyS)} × ${fmt(p.stopSigns)}`, sheetRef: 'ActiveRoute!C12',
      inputs: [{ label: 'Stop signs (incl. return)', value: p.stopSigns, source: 'Circuit params (ActiveRoute!C11)' },
        { label: 'Penalty per stop', value: p.stopPenaltyS, unit: 's', source: 'Circuit params (ActiveRoute!C12 hard-codes 60)' }],
    });
  } else {
    log.add('cycle', 'cycle.stops', 'Stop signs not modelled as real stops', 'T_stops = penalty × max(0, stops − modelled)', stopsS, 's', {
      substituted: `${fmt(p.stopPenaltyS)} × max(0, ${fmt(p.stopSigns)} − ${stopsModelled})`,
      inputs: [{ label: 'Stop signs (incl. return)', value: p.stopSigns, source: 'Circuit params (ActiveRoute!C11)' },
        { label: 'Stops modelled kinematically', value: stopsModelled, source: 'Haul string stop points' },
        { label: 'Penalty per stop', value: p.stopPenaltyS, unit: 's', source: 'Circuit params' }],
      note: stopsModelled ? 'Stop points on the string are simulated as decelerate → stop → accelerate (in travel time).' : undefined,
    });
  }
  log.add('cycle', 'cycle.total', 'Total cycle time', 'T_cycle = T_haul + T_dump + T_spot + T_load + T_stops', cycle, 's', {
    substituted: `${fmt(haul)} + ${fmt(p.dumpS)} + ${fmt(p.spotS)} + ${fmt(p.loadS)} + ${fmt(stopsS)}`, sheetRef: 'ActiveRoute!C14',
  });
  log.add('cycle', 'cycle.min', 'Total cycle time (min)', 'T_cycle / 60', cycleMin, 'min', { substituted: `${fmt(cycle)} / 60`, sheetRef: 'ActiveRoute!C15' });
  log.add('productivity', 'prod.load', 'Truck load', 'Truck load bcm', p.truckLoadBcm, 'bcm', {
    inputs: [{ label: `${truck.name} · ${material?.name ?? circuit.materialId}`, value: p.truckLoadBcm, unit: 'bcm', source: src.truckLoad }], sheetRef: 'ActiveRoute!C21',
  });
  log.add('productivity', 'prod.truck', 'Truck productivity', 'P = (60 / T_cycle,min) × load', prod, 'bcm/truck·PT h', {
    substituted: `(60 / ${fmt(cycleMin, 4)}) × ${fmt(p.truckLoadBcm)}`, sheetRef: 'ActiveRoute!C16',
  });
  log.add('fleet', 'fleet.ideal', 'Ideal daily volume', 'V_ideal = planned rate × loader PT', ideal, 'bcm/day', {
    substituted: `${fmt(p.plannedRateBcmPerPtHr)} × ${fmt(loaderPtTarget)}`, sheetRef: 'ActiveRoute!C19',
    inputs: [{ label: 'Planned rate', value: p.plannedRateBcmPerPtHr, unit: 'bcm/PT h', source: src.rate },
      { label: 'Loader PT target', value: loaderPtTarget, unit: 'h/day', source: p.loaderPtHrsPerDay != null ? 'Circuit params (loader PT)' : 'Circuit params (ActiveRoute!I34)' }],
  });
  log.add('fleet', 'fleet.desired', 'Desired daily volume', 'V_desired', desired, 'bcm/day', {
    inputs: [{ label: 'Desired', value: desired, unit: 'bcm/day', source: 'Circuit params (ActiveRoute!C20)' }], sheetRef: 'ActiveRoute!C20',
    note: desired > ideal + 1e-9 ? 'Desired exceeds the ideal volume: the loader cannot reach it at its planned rate (C26 > C22).' : undefined,
  });
  log.add('fleet', 'fleet.truckHours', 'Truck hours required', 'H_trucks = V_desired / P', truckHrs, 'truck PT h/day', {
    substituted: `${fmt(desired)} / ${fmt(prod, 3)}`, sheetRef: 'ActiveRoute!C17',
  });
  log.add('fleet', 'fleet.trucks', 'Trucks needed', 'N = H_trucks / PT_truck', trucksExact, 'trucks', {
    substituted: `${fmt(truckHrs, 3)} / ${fmt(p.truckPtHrsPerDay)}`, sheetRef: 'ActiveRoute!C24',
    inputs: [{ label: 'Truck PT', value: p.truckPtHrsPerDay, unit: 'h/day', source: 'Circuit params (ActiveRoute!C22 = I34)' }],
    note: 'Fractional, no availability or bunching allowance (workbook Q10).',
  });
  log.add('fleet', 'fleet.recommended', 'Trucks (rounded up)', 'ROUNDUP(N, 0)', trucksRecommended, 'trucks', { substituted: `ROUNDUP(${fmt(trucksExact, 3)}, 0)`, sheetRef: 'TABLE!C22' });
  log.add('loader', 'loader.pt', 'Loader PT at planned rate', 'PT_loader = V_desired / rate', loaderPt, 'h/day', {
    substituted: `${fmt(desired)} / ${fmt(p.plannedRateBcmPerPtHr)}`, sheetRef: 'ActiveRoute!C26',
  });
  log.add('loader', 'loader.lost', 'Loader PT lost per shift (at desired volume)', 'Lost = PT_target / shifts − PT_loader / shifts', lostDesired, 'h/shift', {
    substituted: `${fmt(loaderPtTarget)} / ${s} − ${fmt(loaderPt, 3)} / ${s}`, sheetRef: 'ActiveRoute!C28',
    note: s !== 2 ? 'The workbook hard-codes 2 shifts/day; generalised here.' : undefined,
  });
  if (loaderPt > p.truckPtHrsPerDay + 1e-9) {
    warnings.push(`${circuit.loaderUnitId}: loader PT needed ${loaderPt.toFixed(2)} h exceeds truck production time ${p.truckPtHrsPerDay} h (ActiveRoute C26 > C22, red).`);
  }

  // ── fleet options (macro buttons)
  const ctx: FleetCtx = {
    prod, truckPt: p.truckPtHrsPerDay, rate: p.plannedRateBcmPerPtHr, idealBcm: ideal, loaderPtTarget, shifts: s, cycleS: cycle,
    serviceS: p.spotS + p.loadS, loadBcm: p.truckLoadBcm, queueModel,
  };
  const maxN = opts.maxTrucks ?? Math.max(12, trucksRecommended + 3);
  const options = fleetOptions(maxN, ctx);
  const nAssigned = Math.max(0, Math.round(opts.trucks ?? circuit.trucks));
  const assigned = nAssigned >= 1 && nAssigned <= options.length ? options[nAssigned - 1] : fleetOption(nAssigned, ctx);
  log.add('fleet', 'fleet.assigned', `Assigned ${nAssigned} trucks (macro button ${nAssigned})`, 'C20 = MIN(n × C22 × C16, C19)', assigned.bcmPerDay, 'bcm/day', {
    substituted: queueModel === 'deterministic'
      ? `MIN(${nAssigned} × ${fmt(p.truckPtHrsPerDay)} × ${fmt(prod, 3)}, ${fmt(ideal)}) = MIN(${fmt(assigned.goalSeekBcmDay, 1)}, ${fmt(ideal)})`
      : `MIN(X_${queueModel}(${nAssigned}) × ${fmt(p.truckLoadBcm)} × ${fmt(p.truckPtHrsPerDay)}, ${fmt(ideal)}) = MIN(${fmt(assigned.goalSeekBcmDay, 1)}, ${fmt(ideal)})`,
    sheetRef: 'ActiveRoute!Macro_n (C20)',
    note: `${assigned.capped ? 'Capped at the ideal volume: trucks queue' : 'Truck-limited: loader hangs'} · C24 = ${fmt(assigned.trucksNeeded, 3)} · C26 = ${fmt(assigned.loaderPtHrsDay, 2)} h · `
      + `C28 = ${fmt(assigned.lostLoaderPtHrsShift, 2)} h lost/shift · truck queue ${fmt(assigned.truckQueueHrsShift, 2)} h/shift · MF ${fmt(assigned.matchFactor, 2)} · ${assigned.status}`,
  });
  log.add('fleet', 'fleet.matchFactor', 'Match factor (assigned)', 'MF = n × t_L / c,  t_L = spot + load', assigned.matchFactor, '', {
    substituted: `${nAssigned} × (${fmt(p.spotS)} + ${fmt(p.loadS)}) / ${fmt(cycle)}`,
    note: 'MF < 1 under-trucked (loader hangs), > 1 over-trucked (trucks queue). Morgan & Peterson (1968).',
  });
  if (speedModel === 'rimpull' || queueModel !== 'deterministic') queueSteps(log, nAssigned, p, cycle, queueModel);

  const lengthM = route.lengthM;
  return {
    ...base, ok: true, segments: travel.segments, lengthM, riseM: route.riseM, fallM: route.fallM, travelLoadedS: tl, travelEmptyS: te,
    haulTimeS: haul, stopsS, cycleS: cycle, cycleMin, truckProdBcmPerPtHr: prod, truckHoursReq: truckHrs, trucksExact, trucksRecommended,
    loaderPtHrs: loaderPt, lostPtHrsShift: assigned.lostLoaderPtHrsShift, assigned, options, idealDailyBcm: ideal, desiredDailyBcm: desired,
    loaderPtTargetHrs: loaderPtTarget, droppedSegments: travel.dropped, stopsModelled,
    penaltyStops: penaltyStops(route, speedModel === 'spreadsheet' ? p.stopSigns : penaltyCount, p.stopPenaltyS, speedModel !== 'spreadsheet' && motion === 'kinematic'),
    profiles: travel.profiles, payloadT: travel.payloadT, massLoadedT: travel.massLoadedT, massEmptyT: travel.massEmptyT, bindingShare: travel.bindingShare,
  };
}

function validateParams(p: CircuitParams): string | undefined {
  const pos: (keyof CircuitParams)[] = ['haulEff', 'truckLoadBcm', 'plannedRateBcmPerPtHr', 'truckPtHrsPerDay'];
  for (const k of pos) {
    const v = p[k] as number;
    if (!(Number.isFinite(v) && v > 0)) return `Circuit parameter ${String(k)} must be > 0 (got ${v})`;
  }
  for (const k of ['spotS', 'loadS', 'dumpS', 'stopSigns', 'stopPenaltyS', 'desiredDailyBcm'] as (keyof CircuitParams)[]) {
    const v = p[k] as number;
    if (!(Number.isFinite(v) && v >= 0)) return `Circuit parameter ${String(k)} must be ≥ 0 (got ${v})`;
  }
  return undefined;
}

interface TravelOut {
  segments: SegmentResultExt[];
  loadedS: number;
  emptyS: number;
  dropped: number[];
  stopsModelled: number;
  profiles: { loaded: TravelProfile; empty: TravelProfile };
  payloadT?: number;
  massLoadedT?: number;
  massEmptyT?: number;
  bindingShare?: { loaded: Record<string, number>; empty: Record<string, number> };
}

// ─────────────────────────────────────────────────────────────── spreadsheet mode

function spreadsheetTravel(route: Route, truck: TruckModel, material: Material | undefined, p: CircuitParams, outOfRange: OutOfRangeMode, log: StepLog, warnings: string[]): TravelOut {
  const tbl = truck.spreadsheetSpeeds?.loaded?.length && truck.spreadsheetSpeeds.empty?.length ? truck.spreadsheetSpeeds : WORKBOOK_SPEEDS;
  const tblSource = tbl === WORKBOOK_SPEEDS ? `Workbook speed table (${WORKBOOK_SPEED_RANGES.loaded} / ${WORKBOOK_SPEED_RANGES.empty})` : `Truck model · ${truck.name} · spreadsheet speed table`;
  const clamp = outOfRange === 'clamp';
  const segs: SegmentResultExt[] = [];
  const dropped: number[] = [];
  let tl = 0, te = 0, limited = 0;
  const bands = { loaded: new Map<number, number>(), empty: new Map<number, number>() };
  for (const sg of route.segs) {
    const L = tableSpeed(tbl.loaded, sg.grade, clamp);
    const E = tableSpeed(tbl.empty, -sg.grade, clamp);
    let vl = L.kmh, ve = E.kmh;
    let limL: LimitReason = L.outOfRange ? 'table-out-of-range' : 'table';
    let limE: LimitReason = E.outOfRange ? 'table-out-of-range' : 'table';
    // the workbook has no speed limits; only an explicit limit below the table speed is applied (flagged)
    if (vl != null && sg.speedLimitKmh > 0 && sg.speedLimitKmh < vl) { vl = sg.speedLimitKmh; limL = 'speed-limit'; limited++; }
    if (ve != null && sg.speedLimitKmh > 0 && sg.speedLimitKmh < ve) { ve = sg.speedLimitKmh; limE = 'speed-limit'; limited++; }
    const tL = vl == null ? 0 : ((sg.d3 / 1000) / vl) * 60 * 60;
    const tE = ve == null ? 0 : ((sg.d3 / 1000) / ve) * 60 * 60;
    tl += tL;
    te += tE;
    if (vl != null) bands.loaded.set(vl, (bands.loaded.get(vl) ?? 0) + 1);
    if (ve != null) bands.empty.set(ve, (bands.empty.get(ve) ?? 0) + 1);
    const row = sg.i + 4;
    const rec: SegmentResultExt = {
      i: sg.i, from: sg.from, to: sg.to, chainageM: sg.chainage, dist3dM: sg.d3, distPlanM: sg.dPlan, grade: sg.grade, rrPct: sg.rrPct,
      effGradeLoaded: sg.grade + sg.rrPct / 100, effGradeEmpty: -sg.grade + sg.rrPct / 100, speedLoadedKmh: vl ?? 0, speedEmptyKmh: ve ?? 0,
      timeLoadedS: tL, timeEmptyS: tE, limitLoaded: limL, limitEmpty: limE, speedLimitKmh: sg.speedLimitKmh, zone: sg.zone,
      gradeRoundedLoaded: L.rounded, gradeRoundedEmpty: E.rounded, sheetRow: row,
    };
    if (L.outOfRange || E.outOfRange) {
      if (!clamp) {
        rec.droppedLoaded = vl == null;
        rec.droppedEmpty = ve == null;
        dropped.push(sg.i);
        const pct = `${(L.rounded * 100).toFixed(0)} %`;
        warnings.push(`DROPPED segment ${sg.i + 1} (Travel Time row ${row}, chainage ${sg.chainage.toFixed(1)} m, ${sg.d3.toFixed(2)} m long): `
          + `ROUND(grade, 2) = ${pct} is outside the speed table (±16 %), so Excel counts its time as 0 s. `
          + `Enable "use 12/14 km/h for out-of-range" to time it.`);
        log.add('travel', `travel.dropped.${sg.i}`, `Segment ${sg.i + 1} dropped from travel time`, 'VLOOKUP(ROUND(grade,2)) → #N/A → IFERROR "" → 0 s', 0, 's', {
          substituted: `ROUND(${fmt(sg.grade, 4)}, 2) = ${fmt(L.rounded, 2)} (loaded), ${fmt(E.rounded, 2)} (return): not in −0.16…+0.16`,
          sheetRef: `'Travel Time'!D${row}`,
          inputs: [{ label: 'Distance', value: +sg.d3.toFixed(3), unit: 'm', source: `'Travel Time'!A${row}` }, { label: 'Grade', value: +sg.grade.toFixed(4), source: `'Travel Time'!B${row}` }],
          note: `At the steepest-row speeds this segment would add ${fmt(((sg.d3 / 1000) / edgeSpeed(tbl.loaded, L.rounded)) * 3600, 2)} s loaded and ${fmt(((sg.d3 / 1000) / edgeSpeed(tbl.empty, E.rounded)) * 3600, 2)} s return.`,
        });
      } else {
        warnings.push(`Segment ${sg.i + 1} (row ${row}) grade ${(L.rounded * 100).toFixed(0)} % is outside the table: timed at the steepest row (${vl ?? '–'} / ${ve ?? '–'} km/h) instead of being dropped (differs from Excel).`);
      }
    }
    segs.push(rec);
  }
  if (limited) warnings.push(`${limited} segment-direction(s) capped by a speed limit below the table speed (the workbook has no speed limits).`);
  const bandText = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[0] - a[0]).map(([v, n]) => `${n} @ ${v} km/h`).join(', ');
  log.add('travel', 'travel.loaded', 'Travel time loaded (dig → dump)', 'T_loaded = Σ ((d/1000) / v_table(ROUND(grade,2))) × 60 × 60', tl, 's', {
    substituted: `${route.segs.length} segments: ${bandText(bands.loaded)}${dropped.length ? `; ${dropped.length} dropped` : ''}`,
    sheetRef: "'Travel Time'!F15 → ActiveRoute!C4", inputs: [{ label: 'Speed table (loaded)', value: tbl === WORKBOOK_SPEEDS ? WORKBOOK_SPEED_RANGES.loaded : truck.name, source: tblSource }],
    note: 'One table for every truck type (workbook Q4); exact-match lookup on the grade rounded half away from zero.',
  });
  log.add('travel', 'travel.empty', 'Travel time empty (dump → dig)', 'T_empty = Σ ((d/1000) / v_table(ROUND(−grade,2))) × 60 × 60', te, 's', {
    substituted: `${route.segs.length} segments: ${bandText(bands.empty)}${dropped.length ? `; ${dropped.length} dropped` : ''}`,
    sheetRef: "'Travel Time'!H15 → ActiveRoute!C5", inputs: [{ label: 'Speed table (unloaded)', value: tbl === WORKBOOK_SPEEDS ? WORKBOOK_SPEED_RANGES.empty : truck.name, source: tblSource }],
  });
  // masses for plotting table speeds on the rimpull chart (not used by the workbook calculation)
  const pl = payloadFor(p.truckLoadBcm, material?.bankDensity, truck.payloadT);
  return {
    segments: segs, loadedS: tl, emptyS: te, dropped, stopsModelled: 0, profiles: constantProfiles(segs),
    payloadT: pl.payloadT, massLoadedT: truck.emptyMassT + pl.payloadT, massEmptyT: truck.emptyMassT,
  };
}

function edgeSpeed(tbl: [number, number][], rounded: number): number {
  const sorted = [...tbl].sort((a, b) => a[0] - b[0]);
  return rounded > 0 ? sorted[sorted.length - 1][1] : sorted[0][1];
}

/** Piecewise-constant speed profiles from segment speeds/times (spreadsheet + steady modes). */
function constantProfiles(segs: SegmentResultExt[]): { loaded: TravelProfile; empty: TravelProfile } {
  const mk = (loaded: boolean): TravelProfile => {
    const order = loaded ? segs : [...segs].reverse();
    const intervals: TravelInterval[] = [];
    let s = 0, t = 0;
    for (const g of order) {
      const dt = loaded ? g.timeLoadedS : g.timeEmptyS;
      const v = dt > 0 ? g.dist3dM / dt : 0;
      intervals.push({ s0: s, ds: g.dist3dM, t0: t, dt, v0: v, v1: v, seg: g.i });
      s += g.dist3dM;
      t += dt;
    }
    return { intervals, lengthM: s, timeS: t };
  };
  return { loaded: mk(true), empty: mk(false) };
}

// ─────────────────────────────────────────────────────────────── rimpull mode

function rimpullTravel(route: Route, truck: TruckModel, material: Material | undefined, p: CircuitParamsExt, motion: MotionModel, log: StepLog, warnings: string[]): TravelOut {
  const tp = truckPhysics(truck);
  const tx = truck as TruckModelExt;
  const pl = payloadFor(p.truckLoadBcm, material?.bankDensity, truck.payloadT);
  if (pl.ratio > 1.1 || pl.capped || !material) warnings.push(`${truck.name}: ${pl.note}.`);
  const mL = truck.emptyMassT + pl.payloadT, mE = truck.emptyMassT;
  const est = (f: string) => (truck.estimated?.includes(f) ? ' (ESTIMATED)' : '');
  log.add('travel', 'phys.payload', 'Payload', 'payload = truck load × bank density', pl.payloadT, 't', {
    substituted: material ? `${fmt(p.truckLoadBcm)} bcm × ${fmt(material.bankDensity, 3)} t/bcm${pl.capped ? ' (capped at 120 % of nominal)' : ''}` : 'nominal payload (no material density)',
    inputs: [{ label: 'Truck load', value: p.truckLoadBcm, unit: 'bcm', source: 'Circuit params' },
      { label: 'Bank density', value: material?.bankDensity ?? '–', unit: 't/bcm', source: material ? `Material · ${material.name}` : 'missing' },
      { label: 'Nominal payload', value: truck.payloadT, unit: 't', source: `Truck model · ${truck.name}${est('payloadT')}` }],
    note: pl.note + (material ? ` · loose volume ${fmt(p.truckLoadBcm * material.swell, 1)} m³ vs heaped body ${truck.bodyHeapedM3 ?? '–'} m³` : ''),
  });
  log.add('travel', 'phys.mass', 'Gross mass loaded / empty', 'GVW = empty mass + payload', mL, 't', {
    substituted: `${fmt(truck.emptyMassT, 1)} + ${fmt(pl.payloadT, 1)} (empty leg: ${fmt(mE, 1)} t)`,
    inputs: [{ label: 'Empty mass', value: truck.emptyMassT, unit: 't', source: `Truck model · ${truck.name}${est('emptyMassT')}` },
      { label: 'Rated GVW', value: truck.gvwT, unit: 't', source: `Truck model · ${truck.name}` }],
  });
  const lim = (sg: Route['segs'][number]) => sg.speedLimitKmh;
  const steadyL: SteadySolve[] = route.segs.map(sg => steadySpeed(tp, mL, sg.grade, sg.rrPct, lim(sg)));
  const steadyE: SteadySolve[] = route.segs.map(sg => steadySpeed(tp, mE, -sg.grade, sg.rrPct, lim(sg)));
  const warnSet = new Set<string>();
  steadyL.forEach((r, k) => { if (r.warning) warnSet.add(`Loaded, segment ${route.segs[k].i + 1}: ${r.warning}`); });
  steadyE.forEach((r, k) => { if (r.warning) warnSet.add(`Empty, segment ${route.segs[k].i + 1}: ${r.warning}`); });
  warnings.push(...[...warnSet].slice(0, 12));
  if (warnSet.size > 12) warnings.push(`… and ${warnSet.size - 12} more physics warnings`);

  const segs: SegmentResultExt[] = route.segs.map((sg, k) => ({
    i: sg.i, from: sg.from, to: sg.to, chainageM: sg.chainage, dist3dM: sg.d3, distPlanM: sg.dPlan, grade: sg.grade, rrPct: sg.rrPct,
    effGradeLoaded: sg.grade + sg.rrPct / 100, effGradeEmpty: -sg.grade + sg.rrPct / 100,
    speedLoadedKmh: steadyL[k].kmh, speedEmptyKmh: steadyE[k].kmh,
    timeLoadedS: sg.d3 / (steadyL[k].kmh / 3.6), timeEmptyS: sg.d3 / (steadyE[k].kmh / 3.6),
    limitLoaded: steadyL[k].limit, limitEmpty: steadyE[k].limit, speedLimitKmh: sg.speedLimitKmh, zone: sg.zone,
    physLoaded: dirPhys(mL, steadyL[k]), physEmpty: dirPhys(mE, steadyE[k]),
  }));
  let tl = 0, te = 0, stopsModelled = 0;
  let profiles: { loaded: TravelProfile; empty: TravelProfile };
  let bindingShare: TravelOut['bindingShare'];
  if (motion === 'kinematic') {
    const stopL = new Set(route.stops.filter(s => s.oneWay !== 'empty').map(s => s.k));
    const stopE = new Set(route.stops.filter(s => s.oneWay !== 'loaded').map(s => s.k));
    stopsModelled = stopsPerCycle(route);
    const ko = (loaded: boolean): KinOpts => ({
      massT: loaded ? mL : mE, accelMax: p.accelMaxMs2 ?? KINEMATIC_DEFAULTS.accelMaxMs2,
      decel: loaded ? (p.decelLoadedMs2 ?? KINEMATIC_DEFAULTS.decelLoadedMs2) : (p.decelEmptyMs2 ?? KINEMATIC_DEFAULTS.decelEmptyMs2),
      kRot: KINEMATIC_DEFAULTS.kRot, mu: p.tractionCoeff ?? KINEMATIC_DEFAULTS.tractionCoeff,
      driveShare: loaded ? tp.driveShare.loaded : tp.driveShare.empty, dwellS: p.stopDwellS ?? KINEMATIC_DEFAULTS.stopDwellS, dsMax: KINEMATIC_DEFAULTS.dsMaxM,
    });
    const legL: LegSeg[] = route.segs.map((sg, k) => ({ segIndex: sg.i, len: sg.d3, sin: sg.grade, rrPct: sg.rrPct, steady: steadyL[k], stopAtEnd: stopL.has(sg.i + 1) }));
    const legE: LegSeg[] = route.segs.map((sg, k) => ({ segIndex: sg.i, len: sg.d3, sin: -sg.grade, rrPct: sg.rrPct, steady: steadyE[k], stopAtEnd: stopE.has(sg.i) })).reverse();
    const rl = kinematicLeg(tp, legL, ko(true));
    const re = kinematicLeg(tp, legE, ko(false));
    warnings.push(...rl.warnings.map(w => `Loaded: ${w}`), ...re.warnings.map(w => `Empty: ${w}`));
    const n = segs.length;
    for (let k = 0; k < n; k++) {
      const a = rl.perSeg[k], b = re.perSeg[n - 1 - k], g = segs[k];
      g.timeLoadedS = a.timeS;
      g.timeEmptyS = b.timeS;
      g.speedLoadedKmh = a.timeS > 0 ? (g.dist3dM / a.timeS) * 3.6 : 0;
      g.speedEmptyKmh = b.timeS > 0 ? (g.dist3dM / b.timeS) * 3.6 : 0;
      Object.assign(g.physLoaded!, { vEntryKmh: a.vEntryKmh, vExitKmh: a.vExitKmh, vMaxKmh: a.vMaxKmh, shares: a.shares });
      Object.assign(g.physEmpty!, { vEntryKmh: b.vEntryKmh, vExitKmh: b.vExitKmh, vMaxKmh: b.vMaxKmh, shares: b.shares });
    }
    tl = rl.timeS;
    te = re.timeS;
    profiles = { loaded: { intervals: rl.intervals, lengthM: route.lengthM, timeS: rl.timeS }, empty: { intervals: re.intervals, lengthM: route.lengthM, timeS: re.timeS } };
    bindingShare = { loaded: rl.shares, empty: re.shares };
  } else {
    for (const g of segs) { tl += g.timeLoadedS; te += g.timeEmptyS; }
    profiles = constantProfiles(segs);
  }
  // transparency: method, worked examples (steepest climb / descent), binding shares
  const shareText = (sh?: Record<string, number>) => sh ? Object.entries(sh).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)} %`).join(', ') : '';
  const curveSrc = `Truck model · ${truck.name} · rimpull${tp.rimpullEstimated ? ' (ESTIMATED curve)' : ''}`;
  const retSrc = `Truck model · ${truck.name} · retarder${tp.retarderEstimated ? ' (ESTIMATED curve)' : ''}${tx.retarderPowerKW ? `, ${tx.retarderPowerKW} kW` : ''}, ${tp.descentRule}`;
  log.add('travel', 'travel.loaded', 'Travel time loaded (dig → dump)', motion === 'kinematic'
    ? 'Forward–backward pass: a = min(a_max, (min(F_rim(v), μ·m·g·cosθ·w) − F_res)/(m(1+k))), braking at d to each limit'
    : 'T = Σ d / v*,  v* = sup{v : F_rim(v) ≥ m·g·(sinθ + cosθ·RR)} (or retarder), capped by limits', tl, 's', {
    substituted: motion === 'kinematic' ? `time share: ${shareText(bindingShare?.loaded)}` : `${segs.length} segments at steady balance speed`,
    inputs: [{ label: 'Gross mass', value: +mL.toFixed(1), unit: 't' }, { label: 'Rimpull', value: truck.name, source: curveSrc }, { label: 'Retarder', value: truck.name, source: retSrc },
      ...(motion === 'kinematic' ? kinInputs(p, true) : [])],
    note: motion === 'kinematic' ? 'Starts from rest at the loader, ends at rest at the dump; stop points are real stops.' : 'Steady-state: no acceleration or braking losses (switch to kinematic for them).',
  });
  log.add('travel', 'travel.empty', 'Travel time empty (dump → dig)', motion === 'kinematic' ? 'Forward–backward pass (empty mass)' : 'T = Σ d / v* (empty mass)', te, 's', {
    substituted: motion === 'kinematic' ? `time share: ${shareText(bindingShare?.empty)}` : `${segs.length} segments`,
    inputs: [{ label: 'Gross mass', value: +mE.toFixed(1), unit: 't' }, ...(motion === 'kinematic' ? kinInputs(p, false) : [])],
  });
  workedExamples(log, route, steadyL, steadyE, mL, mE, curveSrc, retSrc);
  return { segments: segs, loadedS: tl, emptyS: te, dropped: [], stopsModelled, profiles, payloadT: pl.payloadT, massLoadedT: mL, massEmptyT: mE, bindingShare };
}

function kinInputs(p: CircuitParamsExt, loaded: boolean): StepInput[] {
  return [
    { label: 'a_max', value: p.accelMaxMs2 ?? KINEMATIC_DEFAULTS.accelMaxMs2, unit: 'm/s²', source: 'Kinematic default [EST]' },
    { label: 'd (planning decel)', value: loaded ? (p.decelLoadedMs2 ?? KINEMATIC_DEFAULTS.decelLoadedMs2) : (p.decelEmptyMs2 ?? KINEMATIC_DEFAULTS.decelEmptyMs2), unit: 'm/s²', source: 'Kinematic default [EST]' },
    { label: 'μ traction', value: p.tractionCoeff ?? KINEMATIC_DEFAULTS.tractionCoeff, source: 'Kinematic default [EST]' },
    { label: 'k_rot', value: KINEMATIC_DEFAULTS.kRot, source: 'Rotating-mass factor [EST]' },
  ];
}

function dirPhys(massT: number, r: SteadySolve): DirPhysics {
  return { massT, resistanceKN: r.resistanceKN, mode: r.mode, steadyKmh: r.kmh, forceAvailKN: r.forceAvailKN, gear: r.gear, binding: r.binding };
}

function workedExamples(log: StepLog, route: Route, sL: SteadySolve[], sE: SteadySolve[], mL: number, mE: number, curveSrc: string, retSrc: string) {
  let up = -1, down = -1;
  route.segs.forEach((sg, k) => {
    if (up < 0 || sg.grade > route.segs[up].grade) up = k;
    if (down < 0 || sg.grade < route.segs[down].grade) down = k;
  });
  const ex = (k: number, loaded: boolean) => {
    const sg = route.segs[k];
    const r = loaded ? sL[k] : sE[k];
    const g = loaded ? sg.grade : -sg.grade;
    const m = loaded ? mL : mE;
    const dir = loaded ? 'loaded' : 'empty';
    if (r.mode === 'propel') {
      log.add('travel', `phys.example.${dir}.up`, `Steepest climb ${dir} (segment ${sg.i + 1}, ${(g * 100).toFixed(1)} %)`,
        'F_res = m·g·(sinθ + cosθ·RR/100);  v* = sup{v : F_rim(v) ≥ F_res}', r.kmh, 'km/h', {
          substituted: `${fmt(m, 1)} × 9.81 × (${fmt(g, 4)} + ${fmt(Math.sqrt(1 - g * g), 4)} × ${fmt(sg.rrPct, 2)}/100) = ${fmt(r.resistanceKN, 1)} kN → F_rim(${fmt(r.kmh, 1)}) = ${fmt(r.forceAvailKN, 1)} kN`,
          inputs: [{ label: 'Rimpull curve', value: r.gear != null ? `gear ${r.gear}` : 'envelope', source: curveSrc }],
          note: `Binding: ${r.binding}${r.limit !== 'rimpull' ? ` (force-limited speed ${fmt(r.forceLimitedKmh, 1)} km/h capped by ${r.capReason})` : ''}.`,
        });
    } else {
      log.add('travel', `phys.example.${dir}.down`, `Steepest descent ${dir} (segment ${sg.i + 1}, ${(g * 100).toFixed(1)} %)`,
        'F_req = −m·g·(sinθ + cosθ·RR/100);  v* from the retarder curve (descent rule)', r.kmh, 'km/h', {
          substituted: `F_req = ${fmt(-r.resistanceKN, 1)} kN → retarder ${fmt(r.forceAvailKN, 1)} kN at ${fmt(r.kmh, 1)} km/h`,
          inputs: [{ label: 'Retarder', value: r.gear != null ? `gear ${r.gear}` : 'envelope', source: retSrc }],
          note: `Binding: ${r.binding}.`,
        });
    }
  };
  if (up >= 0 && route.segs[up].grade > 0) ex(up, true);
  if (down >= 0 && route.segs[down].grade < 0) { ex(down, true); ex(down, false); }
  if (up >= 0 && route.segs[up].grade > 0) ex(up, false);
}

// ─────────────────────────────────────────────────────────────── queue steps, stops, sources

function queueSteps(log: StepLog, n: number, p: CircuitParams, cycle: number, used: QueueModel) {
  const tL = p.spotS + p.loadS;
  for (const m of ['deterministic', 'mm1n', 'binomial'] as QueueModel[]) {
    const q = queueEstimate(m, n, tL, cycle);
    const formula = m === 'deterministic' ? 'X = min(N/c, 1/t_L)' : m === 'mm1n' ? 'ρ = t_L/t_A; P0 = [Σ N!/(N−k)! ρ^k]⁻¹; X = (1 − P0)/t_L' : 'p = t_L/c; X = (1 − (1 − p)^N)/t_L';
    log.add('fleet', `queue.${m}`, `Loads/h at ${n} trucks · ${m === 'mm1n' ? 'finite-source M/M/1//N' : m}${m === used ? ' (used)' : ''}`, formula, q.loadsPerHr, 'loads/h', {
      substituted: `t_L = ${fmt(tL)} s, c = ${fmt(cycle, 1)} s, N = ${n} → loader busy ${(q.loaderBusy * 100).toFixed(0)} %, queue wait ${fmt(q.waitS / 60, 2)} min/load`,
      note: m === 'mm1n' ? 'Exponential times (CV = 1): a pessimistic bunching bound. Real loading CV ≈ 0.1–0.3.'
        : m === 'binomial' ? 'Independent truck positions: crude lower bound used by legacy spreadsheets.'
          : 'No bunching: optimistic bound; the workbook model (production capped by the planned rate).',
    });
  }
}

/** Where stop-sign penalty dwells are spent in the shift animation (spreadsheet / steady modes). */
function penaltyStops(route: Route, count: number, durS: number, kinematic: boolean): PenaltyStop[] {
  const out: PenaltyStop[] = [];
  if (count <= 0 || durS <= 0) return out;
  const L = route.lengthM;
  if (!kinematic) {
    for (const st of route.stops) {
      if (st.oneWay !== 'empty' && out.length < count) out.push({ leg: 'loaded', s: st.chainage, durS });
      if (st.oneWay !== 'loaded' && out.length < count) out.push({ leg: 'empty', s: L - st.chainage, durS });
    }
  }
  const rem = count - out.length;
  const nl = Math.ceil(rem / 2), ne = rem - nl;
  for (let k = 0; k < nl; k++) out.push({ leg: 'loaded', s: (L * (k + 1)) / (nl + 1), durS });
  for (let k = 0; k < ne; k++) out.push({ leg: 'empty', s: (L * (k + 1)) / (ne + 1), durS });
  return out.sort((a, b) => (a.leg === b.leg ? a.s - b.s : a.leg === 'loaded' ? -1 : 1));
}

function sources(scenario: Scenario, circuit: Circuit, truck: TruckModel, material: Material | undefined) {
  const la = scenario.fleet.loaderAssumptions.find(l => l.unitId === circuit.loaderUnitId);
  const key = workbookLoaderKey(circuit.loaderUnitId);
  const cells = key ? LOADER_ASSUMPTION_CELLS[key] : undefined;
  const p = circuit.params;
  const from = (field: 'dumpS' | 'spotS' | 'loadS' | 'plannedRateBcmPerPtHr', cell?: string) =>
    la && la[field] === p[field] ? `Loader assumptions · ${circuit.loaderUnitId}${cell ? ` (${cell})` : ''}` : 'Circuit override';
  const wl = WORKBOOK_TRUCK_LOADS[truck.id];
  const matKey = material?.id === 'CL' ? 'CL' : material?.id === 'OB' ? 'OB' : undefined;
  const tlDefault = truck.loadBcmByMaterial?.[circuit.materialId];
  const truckLoad = tlDefault === p.truckLoadBcm
    ? `Truck model · ${truck.name} · ${circuit.materialId}${wl && matKey && wl[matKey] === p.truckLoadBcm ? ` (${wl.cells[matKey]})` : ''}`
    : 'Circuit override';
  return {
    dump: from('dumpS', cells?.dump), spot: from('spotS', cells?.spot), load: from('loadS', cells?.load), rate: from('plannedRateBcmPerPtHr', cells?.rate), truckLoad,
  };
}
