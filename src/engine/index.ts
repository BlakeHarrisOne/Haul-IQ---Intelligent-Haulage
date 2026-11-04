/**
 * hAIul SIM calculation engine - PUBLIC API (pure TypeScript, no DOM; runs in the browser, workers and Node tests).
 *
 * OWNER: engine agent. UI code must import only from '@/engine'.
 * The bodies below are a provisional minimal 'spreadsheet' implementation so the UI can render; the engine
 * agent replaces them with the full implementation in src/engine/** (keeping these signatures).
 */
import type {
  Circuit, CircuitResult, FleetOption, Id, ManningResult, PriorityResult, Scenario, ShiftProfile, ShiftState,
  SpeedModel, TruckModel, LimitReason, CrewRole,
} from '@/core/types';

export interface CircuitOptions {
  /** Evaluate on another haul string (long/short haul alternatives) instead of circuit.haulStringId. */
  haulStringId?: Id;
  /** Evaluate at this many trucks instead of circuit.trucks. */
  trucks?: number;
  speedModel?: SpeedModel;
  /** Max trucks to tabulate in options (default: max(12, recommended + 3)). */
  maxTrucks?: number;
}

export function computeCircuit(scenario: Scenario, circuit: Circuit, opts: CircuitOptions = {}): CircuitResult {
  const p = circuit.params;
  const hs = scenario.strings.find(s => s.id === (opts.haulStringId ?? circuit.haulStringId));
  const truck = scenario.fleet.trucks.find(t => t.id === circuit.truckModelId);
  const base: CircuitResult = {
    circuitId: circuit.id, ok: false, speedModel: opts.speedModel ?? p.speedModel, segments: [], lengthM: 0, riseM: 0, fallM: 0,
    travelLoadedS: 0, travelEmptyS: 0, haulTimeS: 0, stopsS: 0, cycleS: 0, cycleMin: 0, truckProdBcmPerPtHr: 0,
    truckHoursReq: 0, trucksExact: 0, trucksRecommended: 0, loaderPtHrs: 0, lostPtHrsShift: 0,
    assigned: emptyOption(0), options: [], steps: [], warnings: [],
  };
  if (!hs || hs.points.length < 2) return { ...base, error: 'No haul string with at least 2 points' };
  let chain = 0, tl = 0, te = 0, rise = 0, fall = 0;
  for (let i = 1; i < hs.points.length; i++) {
    const a = hs.points[i - 1], b = hs.points[i];
    const d = Math.hypot(b.e - a.e, b.n - a.n, b.z - a.z);
    if (d <= 0) continue;
    const g = (b.z - a.z) / d;
    const sl = speedFromTable(truck, g, true), se = speedFromTable(truck, -g, false);
    const tL = (d / 1000 / sl.kmh) * 3600, tE = (d / 1000 / se.kmh) * 3600;
    base.segments.push({
      i: i - 1, from: [a.e, a.n, a.z], to: [b.e, b.n, b.z], chainageM: chain, dist3dM: d, distPlanM: Math.hypot(b.e - a.e, b.n - a.n),
      grade: g, rrPct: p.rrPct, effGradeLoaded: g + p.rrPct / 100, effGradeEmpty: -g + p.rrPct / 100,
      speedLoadedKmh: sl.kmh, speedEmptyKmh: se.kmh, timeLoadedS: tL, timeEmptyS: tE, limitLoaded: sl.limit, limitEmpty: se.limit,
      speedLimitKmh: p.speedLimitKmh,
    });
    chain += d; tl += tL; te += tE; if (b.z > a.z) rise += b.z - a.z; else fall += a.z - b.z;
  }
  const haul = (tl + te) / p.haulEff;
  const stops = p.stopSigns * p.stopPenaltyS;
  const cycle = haul + p.dumpS + p.spotS + p.loadS + stops;
  const prod = (60 / (cycle / 60)) * p.truckLoadBcm;
  const truckHrs = p.desiredDailyBcm / prod;
  const trucksExact = truckHrs / p.truckPtHrsPerDay;
  const loaderPt = p.desiredDailyBcm / p.plannedRateBcmPerPtHr;
  const maxN = opts.maxTrucks ?? Math.max(12, Math.ceil(trucksExact) + 3);
  const options: FleetOption[] = [];
  for (let n = 1; n <= maxN; n++) options.push(fleetOption(n, prod, p.truckPtHrsPerDay, p.plannedRateBcmPerPtHr, loaderPt, p.desiredDailyBcm, p.shiftsPerDay, cycle, p.loadS + p.spotS));
  const nAssigned = opts.trucks ?? circuit.trucks;
  const assigned = options[nAssigned - 1] ?? fleetOption(nAssigned, prod, p.truckPtHrsPerDay, p.plannedRateBcmPerPtHr, loaderPt, p.desiredDailyBcm, p.shiftsPerDay, cycle, p.loadS + p.spotS);
  return {
    ...base, ok: true, lengthM: chain, riseM: rise, fallM: fall, travelLoadedS: tl, travelEmptyS: te, haulTimeS: haul, stopsS: stops,
    cycleS: cycle, cycleMin: cycle / 60, truckProdBcmPerPtHr: prod, truckHoursReq: truckHrs, trucksExact,
    trucksRecommended: Math.ceil(trucksExact - 1e-9), loaderPtHrs: loaderPt, lostPtHrsShift: assigned.lostLoaderPtHrsShift, assigned, options,
  };
}

export function computeAllCircuits(scenario: Scenario): Record<Id, CircuitResult> {
  const out: Record<Id, CircuitResult> = {};
  for (const c of scenario.circuits) out[c.id] = computeCircuit(scenario, c);
  return out;
}

export function computeManning(scenario: Scenario, results: Record<Id, CircuitResult>, shiftId?: Id): ManningResult {
  const required = Object.fromEntries(ROLES.map(r => [r, 0])) as Record<CrewRole, number>;
  const lines: ManningResult['lines'] = [];
  for (const c of scenario.circuits.filter(c => c.active)) {
    required.truck += c.trucks; lines.push({ circuitId: c.id, role: 'truck', count: c.trucks, ruleId: 'base-trucks', reason: `${c.trucks} trucks assigned` });
    required.excavator += 1; lines.push({ circuitId: c.id, role: 'excavator', count: 1, ruleId: 'base-loader', reason: `${c.loaderUnitId} operator` });
  }
  const shift = scenario.crew.shifts.find(s => s.id === (shiftId ?? scenario.crew.activeShiftId));
  const total = Object.values(required).reduce((a, b) => a + b, 0);
  const available = shift?.available ?? 0;
  return { required, total, available, surplus: available - total, lines, steps: [] };
}

export function computePriority(scenario: Scenario, results: Record<Id, CircuitResult>, opts: { crewAvailable?: number; trucksAvailable?: number } = {}): PriorityResult {
  return { crewAvailable: opts.crewAvailable ?? 0, crewUsed: 0, trucksAvailable: opts.trucksAvailable ?? scenario.fleet.trucksAvailable, trucksUsed: 0, allocations: [], narrative: [], steps: [] };
}

export function productiveMinutes(profile: ShiftProfile): number {
  return profile.lengthH * 60 - profile.events.reduce((a, e) => a + e.durMin * e.fleetStopFraction, 0);
}

export function shiftStateAt(scenario: Scenario, results: Record<Id, CircuitResult>, tMin: number): ShiftState {
  const total = productiveMinutes(scenario.shift) || 1;
  let prodSoFar = 0;
  for (let m = 0; m < tMin; m++) {
    const ev = scenario.shift.events.find(e => m >= e.startMin && m < e.startMin + e.durMin);
    prodSoFar += 1 - (ev ? ev.fleetStopFraction : 0);
  }
  const f = Math.min(1, prodSoFar / total);
  const activeEvent = scenario.shift.events.find(e => tMin >= e.startMin && tMin < e.startMin + e.durMin);
  return {
    tMin, clock: '', productiveFraction: f, activeEvent,
    perCircuit: scenario.circuits.map(c => {
      const r = results[c.id];
      const shiftBcm = r?.ok ? r.assigned.bcmPerDay / c.params.shiftsPerDay : 0;
      return { circuitId: c.id, bcmSoFar: shiftBcm * f, bcmShift: shiftBcm, digFraction: f, dumpFraction: f, loads: Math.floor((shiftBcm * f) / c.params.truckLoadBcm) };
    }),
  };
}

/** Speed on an effective grade for the Truck Curves tab and segment solving. */
export function speedOnGrade(truck: TruckModel | undefined, grade: number, loaded: boolean, model: SpeedModel = 'spreadsheet', rrPct = 0): { kmh: number; limit: LimitReason } {
  return speedFromTable(truck, grade, loaded);
}

// ── provisional helpers ─────────────────────────────────────────────────────────────

export const ROLES: CrewRole[] = ['truck', 'excavator', 'loader', 'pushDozer', 'dumpDozer', 'coalDozer', 'wheelDozer', 'waterCart', 'grader', 'supervisor', 'oce', 'utility', 'other'];

function speedFromTable(truck: TruckModel | undefined, g: number, loaded: boolean): { kmh: number; limit: LimitReason } {
  const tbl = truck?.spreadsheetSpeeds?.[loaded ? 'loaded' : 'empty'];
  if (!tbl?.length) return { kmh: 30, limit: 'table' };
  const r = Math.round(g * 100) / 100;
  const hit = tbl.find(([gg]) => Math.abs(gg - r) < 1e-9);
  return hit ? { kmh: hit[1], limit: 'table' } : { kmh: tbl[tbl.length - 1][1], limit: 'table-out-of-range' };
}

function emptyOption(n: number): FleetOption {
  return { trucks: n, truckCapacityBcmDay: 0, bcmPerDay: 0, loaderPtHrsDay: 0, lostLoaderPtHrsShift: 0, truckQueueHrsShift: 0, matchFactor: 0, loaderUtil: 0, status: 'balanced' };
}

function fleetOption(n: number, prod: number, truckPt: number, rate: number, loaderPtTarget: number, desired: number, shifts: number, cycleS: number, loaderBusyS: number): FleetOption {
  const truckCap = n * truckPt * prod;
  const loaderCap = loaderPtTarget * rate;
  const bcm = Math.min(truckCap, loaderCap, desired);
  const loaderPt = bcm / rate;
  const lost = Math.max(0, (loaderPtTarget - loaderPt) / shifts);
  const mf = (n * loaderBusyS) / cycleS;
  const queue = Math.max(0, (truckCap - bcm) / prod / shifts);
  return {
    trucks: n, truckCapacityBcmDay: truckCap, bcmPerDay: bcm, loaderPtHrsDay: loaderPt, lostLoaderPtHrsShift: lost,
    truckQueueHrsShift: queue, matchFactor: mf, loaderUtil: loaderPt / loaderPtTarget,
    status: lost > 0.05 ? 'under' : queue > 0.05 ? 'over' : 'balanced',
  };
}
