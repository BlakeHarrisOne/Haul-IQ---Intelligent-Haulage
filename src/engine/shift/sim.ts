/**
 * Deterministic discrete-event shift simulation of one circuit (drives the 3D animation and the depletion slider).
 *
 * Each truck cycles  queue → spot → load → haul (loaded travel profile ÷ η, stop dwells) → dump → return.
 *  · One truck at the loader at a time (spot + load); next truck = earliest feasible start (FIFO when nobody is paused).
 *  · The loader may not exceed its planned rate: successive spot starts are ≥ t_gap of loader-active time apart,
 *      t_gap = 3600 × load / rate × max(1, loader active min / loader PT target min)
 *    so a loader-limited circuit digs exactly rate × PT per shift (the workbook's C19 / shifts).
 *  · Shift events: every truck stops for f × duration (staggered across the window; f = 1 → all trucks, whole window)
 *    wherever it is, except under the loader: a truck whose own pause would fall inside its spot + load sits it out in
 *    the queue and the next truck is served (the loader is not held). Events with f = 1 also stop the loader.
 *  · Circuit standby: when the profile has more fleet productive minutes than the circuit's PT target (e.g. LDR 18 h/day
 *    = 540 min/shift vs 600), the circuit (loader + its trucks) stands by for the difference mid-shift.
 *  · Trucks start the shift empty, queued at the loader (pipeline fill at the dump comes naturally).
 * Cached per (scenario identity, circuit result identity).
 */
import type { CalcStep, Circuit, CircuitResult, Id, Scenario, Vec3 } from '@/core/types';
import type { CircuitResultExt, PenaltyStop, PhaseRecord, ShiftSim, TravelProfile, TruckPhase, TruckState, TruckTimeline } from '../types';
import { fmt, StepLog } from '../util/steps';
import {
  activeBetween, advance, loaderDownWindows, mergeWindows, nextActive, pauseAt, productiveMinutes, productiveMinutesAt, truckPauses,
} from './profile';

/** Queue geometry along the string (m from the dig): slot q waits at min(L/2, QUEUE_FRONT_M + QUEUE_GAP_M × q). */
export const QUEUE_FRONT_M = 30;
export const QUEUE_GAP_M = 15;

interface SimIv { s0: number; ds: number; t0: number; dt: number; v0: number; v1: number }
interface SimLeg { iv: SimIv[]; durS: number; lengthM: number }

interface SimInternal extends ShiftSim {
  legL: SimLeg;
  legE: SimLeg;
  /** Per truck: pauses that apply while it is at the loader (spot/load): loader-down windows only — a truck's own rolling
   *  pauses never fall inside its spot + load (it sits them out in the queue). */
  svcPauses: [number, number, string][][];
  route: { ch: number[]; from: Vec3[]; to: Vec3[]; len: number[] };
  spotS: number;
  loadS: number;
  dumpS: number;
  unitIds: (string | undefined)[];
}

const cache = new WeakMap<Scenario, Map<Id, { r: CircuitResult | undefined; sim: SimInternal }>>();

/**
 * Simulate one circuit over the scenario's shift profile at its assigned trucks.
 * @param scenario scenario (shift profile, circuits, units)
 * @param results circuit results (computeAllCircuits)
 * @param circuitId circuit to simulate
 */
export function simulateShift(scenario: Scenario, results: Record<Id, CircuitResult>, circuitId: Id): ShiftSim {
  return simInternal(scenario, results, circuitId);
}

function simInternal(scenario: Scenario, results: Record<Id, CircuitResult>, circuitId: Id): SimInternal {
  let m = cache.get(scenario);
  if (!m) { m = new Map(); cache.set(scenario, m); }
  const r = results[circuitId];
  const hit = m.get(circuitId);
  if (hit && hit.r === r) return hit.sim;
  const sim = runSim(scenario, scenario.circuits.find(c => c.id === circuitId), r as CircuitResultExt | undefined, circuitId);
  m.set(circuitId, { r, sim });
  return sim;
}

function emptySim(circuitId: Id, shiftS: number, productiveMin: number, why: string): SimInternal {
  const leg: SimLeg = { iv: [], durS: 0, lengthM: 0 };
  return {
    circuitId, trucks: 0, shiftS, productiveMin, serviceS: 0, loaderGapS: 0, cycleS: 0, truckLoadBcm: 0, timelines: [], loadStartsS: [],
    loadEndsS: [], dumpEndsS: [], loads: 0, bcm: 0, dumpedBcm: 0, loaderDown: [], steps: [], warnings: why ? [why] : [],
    legL: leg, legE: leg, svcPauses: [], route: { ch: [], from: [], to: [], len: [] }, spotS: 0, loadS: 0, dumpS: 0, unitIds: [],
  };
}

function runSim(scenario: Scenario, c: Circuit | undefined, r: CircuitResultExt | undefined, circuitId: Id): SimInternal {
  const prof = scenario.shift;
  const H = prof.lengthH * 3600;
  const prodMin = productiveMinutes(prof);
  if (!c) return emptySim(circuitId, H, prodMin, 'circuit not found');
  if (!c.active) return emptySim(circuitId, H, prodMin, '');
  if (!r?.ok) return emptySim(circuitId, H, prodMin, r?.error ?? 'no result');
  const n = Math.max(0, Math.round(c.trucks));
  const p = c.params;
  const log = new StepLog();
  const warnings: string[] = [];
  const eta = p.haulEff > 0 ? p.haulEff : 1;
  const legL = simLeg(r.profiles.loaded, eta, r.penaltyStops.filter(s => s.leg === 'loaded'));
  const legE = simLeg(r.profiles.empty, eta, r.penaltyStops.filter(s => s.leg === 'empty'));
  const route = { ch: r.segments.map(s => s.chainageM), from: r.segments.map(s => s.from), to: r.segments.map(s => s.to), len: r.segments.map(s => s.dist3dM) };
  const unitIds = assignUnits(scenario, c, n);
  const base: SimInternal = { ...emptySim(circuitId, H, prodMin, ''), legL, legE, route, spotS: p.spotS, loadS: p.loadS, dumpS: p.dumpS, unitIds, cycleS: r.cycleS, serviceS: p.spotS + p.loadS, truckLoadBcm: p.truckLoadBcm };
  if (n === 0) return { ...base, warnings: ['no trucks assigned'] };

  // loader availability: fleet-wide stops + circuit standby
  const shifts = p.shiftsPerDay > 0 ? p.shiftsPerDay : 2;
  const ptTargetMin = (r.loaderPtTargetHrs / shifts) * 60;
  const standbyMin = Math.max(0, prodMin - ptTargetMin);
  let standby: ShiftSim['standby'];
  const fleetDown = loaderDownWindows(prof);
  let standbyWin: [number, number, string][] = [];
  if (standbyMin > 0.5) {
    const tm = timeAtProductive(prof, prodMin / 2);
    standby = { startMin: tm, durMin: standbyMin, reason: `PT target ${fmt(ptTargetMin / 60, 2)} h/shift < ${fmt(prodMin / 60, 2)} h productive in the profile` };
    standbyWin = [[tm * 60, (tm + standbyMin) * 60, `${c.loaderUnitId} standby`]];
  }
  const loaderDown = mergeWindows([...fleetDown, ...standbyWin]);
  const loaderActiveS = activeBetween(0, H, loaderDown);
  const gapBase = (3600 * p.truckLoadBcm) / p.plannedRateBcmPerPtHr;
  const scale = ptTargetMin > 0 ? Math.max(1, loaderActiveS / 60 / ptTargetMin) : 1;
  const gap = gapBase * scale;
  if (ptTargetMin > prodMin + 0.5) warnings.push(`PT target ${fmt(ptTargetMin / 60, 2)} h/shift exceeds the profile's ${fmt(prodMin / 60, 2)} productive hours: the simulation produces less than the calculation.`);

  const pauses = Array.from({ length: n }, (_, k) => mergeWindows([...truckPauses(prof, k, n), ...standbyWin]));
  // a truck may only start spot/load when neither it nor the loader is paused …
  const svc = pauses.map(pz => mergeWindows([...pz, ...loaderDown]));
  // … and only if its own (rolling) pauses — the parts outside loader-down windows — fall clear of the whole spot + load:
  // a truck due for its fuel stop sits it out in the queue and the next queued truck is served, so the loader is never
  // held by one truck's personal pause. Only loader-down windows (whole-fleet stops, standby) stretch spot and load.
  const own = pauses.map(pz => subtractWindows(pz, loaderDown));
  const serviceEnd = (st: number) => advance(advance(st, p.spotS, loaderDown), p.loadS, loaderDown);
  const startFor = (k: number, from: number): number => {
    let st = nextActive(from, svc[k]);
    for (let g = 0; g < 1000 && st < H; g++) {
      const end = serviceEnd(st);
      const w = own[k].find(x => x[0] < end - 1e-9 && x[1] > st + 1e-9);
      if (!w) break;
      st = nextActive(Math.max(st, w[1]), svc[k]);
    }
    return st;
  };
  const timelines: TruckTimeline[] = Array.from({ length: n }, (_, k) => ({ truckIndex: k, unitId: unitIds[k], records: [], pauses: pauses[k] }));
  const arr = new Array<number>(n).fill(0);
  const done = new Array<boolean>(n).fill(false);
  const loadStarts: number[] = [], loadEnds: number[] = [], dumpEnds: number[] = [];
  let loaderFree = 0, lastSpot = -Infinity;
  let guard = 0;
  while (guard++ < 100000) {
    // loader ready time from the rate governor
    let ready = loaderFree;
    if (Number.isFinite(lastSpot)) ready = Math.max(ready, advance(lastSpot, gap, loaderDown));
    let best = -1, bestStart = Infinity;
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      const st = startFor(k, Math.max(arr[k], ready));
      if (st < bestStart - 1e-9 || (Math.abs(st - bestStart) <= 1e-9 && best >= 0 && arr[k] < arr[best])) { best = k; bestStart = st; }
    }
    if (best < 0) break;
    const k = best;
    const tl = timelines[k];
    if (bestStart >= H) {
      // nobody can be served before the end of the shift: everyone left waits
      for (let j = 0; j < n; j++) if (!done[j]) { pushRec(timelines[j], 'queue', arr[j], Math.max(arr[j], H)); done[j] = true; }
      break;
    }
    pushRec(tl, 'queue', arr[k], bestStart);
    const spotEnd = advance(bestStart, p.spotS, loaderDown);
    const loadEnd = advance(spotEnd, p.loadS, loaderDown);
    pushRec(tl, 'spot', bestStart, spotEnd);
    pushRec(tl, 'load', spotEnd, loadEnd);
    loadStarts.push(spotEnd);
    loadEnds.push(loadEnd);
    loaderFree = loadEnd;
    lastSpot = bestStart;
    const haulEnd = advance(loadEnd, legL.durS, pauses[k]);
    const dumpEnd = advance(haulEnd, p.dumpS, pauses[k]);
    const retEnd = advance(dumpEnd, legE.durS, pauses[k]);
    pushRec(tl, 'haul', loadEnd, haulEnd);
    pushRec(tl, 'dump', haulEnd, dumpEnd);
    pushRec(tl, 'return', dumpEnd, retEnd);
    dumpEnds.push(dumpEnd);
    arr[k] = retEnd;
    if (retEnd >= H) { done[k] = true; }
  }
  // queue slots at arrival (for presentation)
  const queues = timelines.flatMap(t => t.records.filter(x => x.phase === 'queue').map(x => ({ x, k: t.truckIndex })));
  for (const q of queues) {
    q.x.queueSlot = queues.filter(o => o !== q && o.x.t0 <= q.x.t0 + 1e-9 && o.x.t1 > q.x.t0 + 1e-9 && (o.x.t0 < q.x.t0 - 1e-9 || o.k < q.k)).length;
  }
  loadEnds.sort((a, b) => a - b);
  loadStarts.sort((a, b) => a - b);
  dumpEnds.sort((a, b) => a - b);
  const loads = upperBound(loadEnds, H);
  const inProg = partialAt(loadStarts, loadEnds, H);
  const bcm = (loads + inProg) * p.truckLoadBcm;
  const dumped = upperBound(dumpEnds, H) * p.truckLoadBcm;
  const analytic = r.assigned.bcmPerDay / shifts;

  log.add('shift', 'shift.productive', 'Fleet productive minutes in the shift', 'T_prod = shift − Σ event × fleetStopFraction', prodMin, 'min', {
    substituted: `${prof.lengthH * 60} − ${fmt(prof.lengthH * 60 - prodMin, 1)}`, inputs: prof.events.map(e => ({ label: e.label, value: `${e.durMin} min × ${e.fleetStopFraction}`, source: 'Shift profile' })),
  });
  log.add('shift', 'shift.gap', 'Loader rate governor (min time between loads)', 't_gap = 3600 × load / rate × max(1, T_loader / T_PT)', gap, 's', {
    substituted: `3600 × ${fmt(p.truckLoadBcm)} / ${fmt(p.plannedRateBcmPerPtHr)} × max(1, ${fmt(loaderActiveS / 60, 1)} / ${fmt(ptTargetMin, 1)})`,
    note: 'Keeps the simulated loader at its planned rate; loader active minutes exclude fleet-wide stops and standby.',
  });
  if (standby) log.add('shift', 'shift.standby', `${c.loaderUnitId} standby`, 'T_standby = T_prod − PT target / shifts', standbyMin, 'min', { substituted: `${fmt(prodMin, 1)} − ${fmt(ptTargetMin, 1)}`, note: standby.reason });
  log.add('shift', 'shift.bcm', 'Simulated production this shift', 'V = loads × truck load', bcm, 'bcm', {
    substituted: `${loads}${inProg > 0 ? ` + ${fmt(inProg, 2)}` : ''} × ${fmt(p.truckLoadBcm)}`,
    note: `Calculation: ${fmt(analytic, 0)} bcm/shift (${fmt(r.assigned.bcmPerDay, 0)} bcm/day ÷ ${shifts}); difference ${fmt(bcm - analytic, 0)} bcm (start-up, end-of-shift and event bunching).`,
  });
  return {
    ...base, trucks: n, loaderGapS: gap, timelines, loadStartsS: loadStarts, loadEndsS: loadEnds, dumpEndsS: dumpEnds, loads, bcm, dumpedBcm: dumped,
    loaderDown, standby, steps: log.steps as CalcStep[], warnings, svcPauses: pauses.map(() => loaderDown),
  };
}

/** Parts of windows `w` outside every window of `cut` (both sorted and merged). */
function subtractWindows(w: [number, number, string][], cut: [number, number, string][]): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const [a0, b, label] of w) {
    let a = a0;
    for (const [c, d] of cut) {
      if (d <= a) continue;
      if (c >= b) break;
      if (c > a) out.push([a, c, label]);
      a = Math.max(a, d);
      if (a >= b) break;
    }
    if (a < b) out.push([a, b, label]);
  }
  return out;
}

function pushRec(tl: TruckTimeline, phase: TruckPhase, t0: number, t1: number) {
  if (t1 - t0 > 1e-9 || phase !== 'queue') tl.records.push({ phase, t0, t1 });
}

/** Time (min) at which `target` productive minutes have elapsed. */
function timeAtProductive(prof: Scenario['shift'], target: number): number {
  let lo = 0, hi = prof.lengthH * 60;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (productiveMinutesAt(prof, mid) < target) lo = mid; else hi = mid; }
  return hi;
}

function assignUnits(scenario: Scenario, c: Circuit, n: number): (string | undefined)[] {
  const units = scenario.fleet.units.filter(u => u.kind === 'truck' && u.modelId === c.truckModelId);
  // spread units over circuits using the same model, in circuit order
  const before = scenario.circuits.filter(x => x.active && x.truckModelId === c.truckModelId).findIndex(x => x.id === c.id);
  const offset = scenario.circuits.filter(x => x.active && x.truckModelId === c.truckModelId).slice(0, Math.max(0, before)).reduce((a, x) => a + Math.max(0, x.trucks), 0);
  return Array.from({ length: n }, (_, k) => units[offset + k]?.id);
}

// ─────────────────────────────────────────────────────────────── legs (profile ÷ η + penalty dwells)

function simLeg(prof: TravelProfile, eta: number, stops: PenaltyStop[]): SimLeg {
  let iv: SimIv[] = prof.intervals.map(x => ({ s0: x.s0, ds: x.ds, t0: 0, dt: x.dt / eta, v0: x.v0 * eta, v1: x.v1 * eta }));
  for (const st of [...stops].sort((a, b) => a.s - b.s)) iv = insertDwell(iv, Math.max(0, Math.min(prof.lengthM, st.s)), st.durS);
  let t = 0;
  for (const x of iv) { x.t0 = t; t += x.dt; }
  return { iv, durS: t, lengthM: prof.lengthM };
}

function insertDwell(iv: SimIv[], s: number, dur: number): SimIv[] {
  const out: SimIv[] = [];
  let placed = false;
  for (const x of iv) {
    if (!placed && s <= x.s0 + 1e-9) { out.push({ s0: x.s0, ds: 0, t0: 0, dt: dur, v0: 0, v1: 0 }); placed = true; }
    if (!placed && s < x.s0 + x.ds - 1e-9) {
      const d = s - x.s0;
      const [a, b] = splitIv(x, d);
      out.push(a, { s0: s, ds: 0, t0: 0, dt: dur, v0: 0, v1: 0 }, b);
      placed = true;
      continue;
    }
    out.push(x);
  }
  if (!placed) out.push({ s0: s, ds: 0, t0: 0, dt: dur, v0: 0, v1: 0 });
  return out;
}

function splitIv(x: SimIv, d: number): [SimIv, SimIv] {
  const a = x.dt > 0 ? (x.v1 - x.v0) / x.dt : 0;
  let tau: number, vd: number;
  if (x.dt <= 0) { tau = 0; vd = x.v0; }
  else if (Math.abs(a) < 1e-9) { tau = x.ds > 0 ? (x.dt * d) / x.ds : 0; vd = x.v0; }
  else { vd = Math.sqrt(Math.max(0, x.v0 * x.v0 + 2 * a * d)); tau = (vd - x.v0) / a; }
  return [{ s0: x.s0, ds: d, t0: 0, dt: tau, v0: x.v0, v1: vd }, { s0: x.s0 + d, ds: x.ds - d, t0: 0, dt: x.dt - tau, v0: vd, v1: x.v1 }];
}

/** Position (m from the leg start) and speed (m/s) after `tau` s of moving time on a leg. */
function legAt(leg: SimLeg, tau: number): { s: number; v: number } {
  const iv = leg.iv;
  if (!iv.length) return { s: 0, v: 0 };
  if (tau <= 0) return { s: 0, v: iv[0].v0 };
  if (tau >= leg.durS) return { s: leg.lengthM, v: 0 };
  let lo = 0, hi = iv.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (iv[mid].t0 <= tau) lo = mid; else hi = mid - 1; }
  const x = iv[lo];
  const u = Math.min(Math.max(tau - x.t0, 0), x.dt);
  if (x.dt <= 0) return { s: x.s0 + x.ds, v: x.v1 };
  const a = (x.v1 - x.v0) / x.dt;
  const s = Math.min(x.s0 + x.ds, x.s0 + x.v0 * u + 0.5 * a * u * u);
  return { s, v: x.v0 + a * u };
}

// ─────────────────────────────────────────────────────────────── queries

function upperBound(a: number[], t: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Fraction of the load in progress at t (at most one truck loads at a time). */
function partialAt(starts: number[], ends: number[], t: number): number {
  const k = upperBound(ends, t); // loads finished
  if (k < starts.length && starts[k] <= t && t < ends[k]) return (t - starts[k]) / Math.max(1e-9, ends[k] - starts[k]);
  return 0;
}

/**
 * Cumulative production of a circuit at tMin (dig accounting incl. the load in progress, and dump accounting).
 * @returns loads completed, bcm dug, bcm dumped
 */
export function simProductionAt(sim: ShiftSim, tMin: number): { loads: number; bcm: number; dumpedBcm: number } {
  const t = Math.max(0, Math.min(tMin * 60, sim.shiftS));
  const loads = upperBound(sim.loadEndsS, t);
  const part = partialAt(sim.loadStartsS, sim.loadEndsS, t);
  return { loads, bcm: (loads + part) * sim.truckLoadBcm, dumpedBcm: upperBound(sim.dumpEndsS, t) * sim.truckLoadBcm };
}

/**
 * Truck states of a circuit at tMin (minutes after shift start) for the 3D scene.
 * @param scenario scenario
 * @param results circuit results
 * @param circuitId circuit
 * @param tMin minutes after shift start
 */
export function truckStatesAt(scenario: Scenario, results: Record<Id, CircuitResult>, circuitId: Id, tMin: number): TruckState[] {
  const sim = simInternal(scenario, results, circuitId);
  const t = Math.max(0, Math.min(tMin * 60, sim.shiftS));
  const L = sim.legL.lengthM;
  const raw = sim.timelines.map(tl => { const i = recordIndexAt(tl.records, t); return { tl, i, rec: i >= 0 ? tl.records[i] : undefined }; });
  // queue order at t
  const queued = raw.filter(x => x.rec?.phase === 'queue').sort((a, b) => a.rec!.t0 - b.rec!.t0 || a.tl.truckIndex - b.tl.truckIndex);
  const qIndex = new Map(queued.map((x, i) => [x.tl.truckIndex, i]));
  const slotCh = (q: number) => Math.min(L / 2, QUEUE_FRONT_M + QUEUE_GAP_M * q);
  return raw.map(({ tl, i, rec }) => {
    const k = tl.truckIndex;
    const pz = rec && (rec.phase === 'spot' || rec.phase === 'load') ? sim.svcPauses[k] : tl.pauses;
    const pw = pauseAt(t, pz);
    let phase: TruckPhase = rec?.phase ?? 'parked';
    let ch = 0, v = 0, dir: 1 | -1 | 0 = 0, loaded = false, fill = 0;
    let t0 = rec?.t0 ?? 0, t1 = rec?.t1 ?? sim.shiftS;
    if (rec) {
      const act = activeBetween(rec.t0, t, pz);
      const dur = Math.max(1e-9, activeBetween(rec.t0, rec.t1, pz));
      const u = Math.min(1, act / dur);
      switch (rec.phase) {
        case 'queue': ch = slotCh(qIndex.get(k) ?? 0); break;
        case 'spot': ch = slotCh(0) * (1 - u); v = pw ? 0 : (slotCh(0) / Math.max(1, sim.spotS)) * 3.6; dir = pw ? 0 : -1; break;
        case 'load': ch = 0; fill = u; break;
        case 'haul': { const q = legAt(sim.legL, act); ch = q.s; v = pw ? 0 : q.v * 3.6; dir = v > 0.05 ? 1 : 0; loaded = true; fill = 1; break; }
        case 'dump': ch = L; loaded = u < 1; fill = 1 - u; break;
        case 'return': {
          const q = legAt(sim.legE, act);
          // stop at the back of the queue (or the spot entry) instead of driving to the loader and jumping back
          const next = tl.records[i + 1];
          const stopAt = next?.phase === 'queue' ? slotCh(next.queueSlot ?? 0) : slotCh(0);
          ch = Math.max(0, L - q.s);
          v = pw ? 0 : q.v * 3.6;
          if (ch < stopAt) { ch = stopAt; v = 0; }
          dir = v > 0.05 ? -1 : 0;
          break;
        }
      }
    } else {
      phase = 'parked';
      t0 = 0; t1 = sim.shiftS;
    }
    const { pos, heading } = pointAt(sim.route, ch, dir === -1 || phase === 'return' || phase === 'queue' || phase === 'spot');
    const loads = sim.loadEndsS.length ? countLoads(tl.records, t) : 0;
    const st: TruckState = {
      truckIndex: k, unitId: tl.unitId, phase, paused: !!pw, pauseLabel: pw?.[2], chainageM: ch, speedKmh: v, loaded, dir, pos, heading,
      loads, phaseStartMin: t0 / 60, phaseEndMin: t1 / 60, fill,
    };
    if (phase === 'queue') st.queueIndex = qIndex.get(k);
    return st;
  });
}

function recordIndexAt(recs: PhaseRecord[], t: number): number {
  if (!recs.length) return -1;
  let lo = 0, hi = recs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (recs[mid].t0 <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

function countLoads(recs: PhaseRecord[], t: number): number {
  let n = 0;
  for (const r of recs) if (r.phase === 'load' && r.t1 <= t) n++;
  return n;
}

/** World point at chainage along the route and the unit heading (reversed for the empty direction). */
function pointAt(route: SimInternal['route'], ch: number, reverse: boolean): { pos: Vec3; heading: Vec3 } {
  const n = route.ch.length;
  if (!n) return { pos: [0, 0, 0], heading: [1, 0, 0] };
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (route.ch[mid] <= ch) lo = mid; else hi = mid - 1; }
  const a = route.from[lo], b = route.to[lo], len = route.len[lo] || 1;
  const u = Math.max(0, Math.min(1, (ch - route.ch[lo]) / len));
  const pos: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const sgn = reverse ? -1 : 1;
  const heading: Vec3 = [((b[0] - a[0]) / len) * sgn, ((b[1] - a[1]) / len) * sgn, ((b[2] - a[2]) / len) * sgn];
  return { pos, heading };
}
