/**
 * Truck states along the shift for the 3D animation (pure, deterministic, no DOM).
 *
 * Interim presentation model built from the engine's CircuitResult segment times; the actors module switches to the
 * engine's own shift simulation (`truckStatesAt`) when it is exported from '@/engine' and keeps this file for the
 * presentation-only parts (turn-around arcs, queue line, tray tip, heap fill, parking at the roadside).
 *
 * Model: one loader serves N trucks. Effective cycle C = max(cycle, N·(spot + load)); a truck waits W = C − cycle in the
 * queue each cycle; truck k starts the shift k·C/N into its cycle. Within a cycle: queue → spot → load → haul (loaded,
 * per-segment times / η, dwell at stop signs) → dump (turn, tip, lower) → return (empty, reverse). During shift events
 * the first round(N·fleetStopFraction) trucks park at the roadside and their cycle clock stops.
 */
import type { TruckPhase } from '../strings/bus';

export interface SegTimes {
  /** 3D length (m, path scale). */
  len: number;
  loadedS: number;
  emptyS: number;
  speedLoadedKmh: number;
  speedEmptyKmh: number;
}

export interface PlanInput {
  trucks: number;
  spotS: number;
  loadS: number;
  dumpS: number;
  haulEff: number;
  /** Stop-sign seconds per cycle (both directions). */
  stopsS: number;
  segments: SegTimes[];
  /** Stop-sign chainages along the path (m) and their direction filter. */
  stops: { s: number; oneWay?: 'loaded' | 'empty' }[];
  /** Loader cycle (s) - passes per load = loadS / loaderCycleS. */
  loaderCycleS: number;
  /** Shift events in minutes. */
  events: { startMin: number; durMin: number; fleetStopFraction: number; kind?: string; label?: string }[];
  /** Keep-left lane offset from the centreline (m); default LANE_M. Wider roads run the lanes further apart. */
  laneM?: number;
  /** Roadside (shoulder) offset where a stopped truck pulls over (m); default lane + PARK_M. */
  shoulderM?: number;
  /** Spacing of the end-of-shift park-up slots along the park-up line (m); default 18. */
  parkGapM?: number;
}

interface Travel {
  /** Keyframe times (s) and chainages (m). */
  t: number[];
  s: number[];
  /** Speed on keyframe leg j (km/h). */
  v: number[];
  dur: number;
}

export interface CircuitPlan {
  N: number;
  spotS: number;
  loadS: number;
  dumpS: number;
  cycleS: number;
  effCycleS: number;
  queueS: number;
  headwayS: number;
  lengthM: number;
  haul: Travel;
  ret: Travel;
  passes: number;
  events: { start: number; end: number; frac: number; parkUp: boolean; label?: string }[];
  laneM: number;
  shoulderM: number;
  parkGapM: number;
}

export interface TruckSimState {
  phase: TruckPhase;
  /** Chainage along the path (m, may extrapolate a few m past either end during turns). */
  s: number;
  /** Lateral offset (m), positive = right of the dig → dump direction. */
  lateral: number;
  /** 0 = facing the dump (forward), 1 = facing the dig. */
  rev: number;
  speedKmh: number;
  loaded: boolean;
  /** Body tip 0..1. */
  tray: number;
  /** Heap in the body 0..1. */
  fill: number;
  /** Distance travelled within the cycle (m) - drives wheel spin. */
  wheelDist: number;
  dir: 1 | -1 | 0;
  phaseElapsedS: number;
  phaseRemainS: number;
  etaDumpS: number;
  queueIndex?: number;
}

/** Spot / queue geometry (m). */
export const SPOT_ENTRY_M = 30;
export const QUEUE_FRONT_M = 46;
export const QUEUE_GAP_M = 15;
/** Keep-left traffic: lane offset of a truck from the centreline, to the left of its own travel direction (m). */
export const LANE_M = 3.2;
export const PARK_M = 10;

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);

function travel(segs: SegTimes[], loaded: boolean, eff: number, stopDwell: number, stops: PlanInput['stops'], spread: number): Travel {
  const t: number[] = [0], s: number[] = [0], v: number[] = [];
  const order = loaded ? segs.map((_, i) => i) : segs.map((_, i) => segs.length - 1 - i);
  // chainage of the start of each segment in the forward direction
  const ch: number[] = [];
  let acc = 0;
  for (const g of segs) { ch.push(acc); acc += g.len; }
  const L = acc;
  let T = 0, S = 0;
  const myStops = stops.filter(x => !x.oneWay || x.oneWay === (loaded ? 'loaded' : 'empty'));
  for (const i of order) {
    const g = segs[i];
    // stop signs at the start of this segment in the direction of travel
    const s0 = loaded ? ch[i] : L - (ch[i] + g.len);
    for (const st of myStops) {
      const along = loaded ? st.s : L - st.s;
      if (stopDwell > 0 && along >= s0 - 1e-6 && along < s0 + g.len - 1e-6 && Math.abs(along - S) < g.len + 1e-6) {
        // dwell at the point where the stop is (split the segment)
        const d = along - S;
        if (d > 1e-6) {
          const dt = ((loaded ? g.loadedS : g.emptyS) / eff) * spread * (d / g.len);
          T += dt; S += d; t.push(T); s.push(S); v.push(loaded ? g.speedLoadedKmh : g.speedEmptyKmh);
        }
        T += stopDwell; t.push(T); s.push(S); v.push(0);
      }
    }
    const rest = s0 + g.len - S;
    if (rest > 1e-6) {
      const dt = ((loaded ? g.loadedS : g.emptyS) / eff) * spread * (rest / g.len);
      T += dt; S += rest; t.push(T); s.push(S); v.push(loaded ? g.speedLoadedKmh : g.speedEmptyKmh);
    }
  }
  return { t, s, v, dur: T };
}

export function buildPlan(inp: PlanInput): CircuitPlan {
  const N = Math.max(0, Math.round(inp.trucks));
  const eff = inp.haulEff > 0 ? inp.haulEff : 1;
  const L = inp.segments.reduce((a, g) => a + g.len, 0);
  const nLoaded = inp.stops.filter(x => x.oneWay !== 'empty').length;
  const nEmpty = inp.stops.filter(x => x.oneWay !== 'loaded').length;
  const nStops = nLoaded + nEmpty;
  const dwell = nStops > 0 ? inp.stopsS / nStops : 0;
  const travelRaw = inp.segments.reduce((a, g) => a + (g.loadedS + g.emptyS) / eff, 0);
  const spread = nStops === 0 && travelRaw > 0 ? (travelRaw + inp.stopsS) / travelRaw : 1;
  const haul = travel(inp.segments, true, eff, dwell, inp.stops, spread);
  const ret = travel(inp.segments, false, eff, dwell, inp.stops, spread);
  const cycleS = inp.spotS + inp.loadS + haul.dur + inp.dumpS + ret.dur;
  const loaderBusy = inp.spotS + inp.loadS;
  const effCycleS = Math.max(cycleS, N * loaderBusy, 1);
  return {
    N, spotS: inp.spotS, loadS: inp.loadS, dumpS: inp.dumpS, cycleS, effCycleS,
    queueS: effCycleS - cycleS, headwayS: N > 0 ? effCycleS / N : effCycleS, lengthM: L, haul, ret,
    passes: Math.max(1, Math.round(inp.loadS / Math.max(1, inp.loaderCycleS))),
    events: inp.events.map(e => ({ start: e.startMin * 60, end: (e.startMin + e.durMin) * 60, frac: e.fleetStopFraction, parkUp: isParkUp(e), label: e.label })),
    laneM: inp.laneM ?? LANE_M,
    shoulderM: inp.shoulderM ?? (inp.laneM ?? LANE_M) + PARK_M,
    parkGapM: inp.parkGapM ?? 18,
  };
}

/** An end-of-shift park-up (or changeover) event: trucks drive to the park-up line instead of stopping on the road. */
export function isParkUp(e: { kind?: string; label?: string }): boolean {
  return e.kind === 'changeover' || /park[\s-]?up|end[\s-]of[\s-]shift/i.test(e.label ?? '');
}

/** Park-up line near the loader: slot k's chainage and lateral offset (left of a truck facing the dig). */
export function parkSlot(plan: Pick<CircuitPlan, 'lengthM' | 'shoulderM' | 'parkGapM'>, k: number): { s: number; lateral: number } {
  const s0 = QUEUE_FRONT_M - 6;
  return { s: Math.min(s0 + k * plan.parkGapM, Math.max(s0, plan.lengthM * 0.5)), lateral: plan.shoulderM };
}

/** When the truck's own pause began / ends (min) and whether it is a park-up (from the engine's pause windows). */
export interface PauseInfo { startMin: number; endMin: number; parkUp: boolean }

/** Speed of the drive to the park-up line (km/h) and the time taken to turn round / pull in (s). */
const PARK_DRIVE_KMH = 28, PARK_TURN_S = 14;

function travelAt(tr: Travel, tt: number): { s: number; v: number } {
  if (tr.t.length < 2) return { s: 0, v: 0 };
  if (tt <= 0) return { s: 0, v: tr.v[0] ?? 0 };
  if (tt >= tr.dur) return { s: tr.s[tr.s.length - 1], v: 0 };
  let lo = 0, hi = tr.t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] <= tt) lo = m; else hi = m; }
  const dt = tr.t[hi] - tr.t[lo];
  const u = dt > 0 ? (tt - tr.t[lo]) / dt : 1;
  return { s: tr.s[lo] + (tr.s[hi] - tr.s[lo]) * u, v: tr.v[lo] };
}

/** The truck's own cycle clock (s) at shift time tSec, and its parking state. */
export function truckClock(plan: CircuitPlan, k: number, tSec: number): { tau: number; parked: number; parkElapsed: number; parkRemain: number } {
  let lost = 0, parked = 0, parkElapsed = 0, parkRemain = 0;
  for (const ev of plan.events) {
    const nPark = Math.round(plan.N * ev.frac);
    if (k >= nPark || ev.end <= ev.start) continue;
    if (tSec >= ev.end) lost += ev.end - ev.start;
    else if (tSec > ev.start) {
      lost += tSec - ev.start;
      parkElapsed = tSec - ev.start; parkRemain = ev.end - tSec;
      parked = Math.min(clamp01(parkElapsed / 18), clamp01(parkRemain / 18));
    }
  }
  const start = plan.N > 0 ? (k * plan.effCycleS) / plan.N : 0;
  const t = Math.max(0, tSec - lost) + start;
  const tau = ((t % plan.effCycleS) + plan.effCycleS) % plan.effCycleS;
  return { tau, parked, parkElapsed, parkRemain };
}

export function truckStateAt(plan: CircuitPlan, k: number, tMin: number): TruckSimState {
  const tSec = tMin * 60;
  const clk = truckClock(plan, k, tSec);
  const st = cycleState(plan, clk.tau);
  if (clk.parkElapsed > 0) {
    const side = st.lateral >= 0 ? 1 : -1;
    st.lateral += side * (plan.shoulderM - plan.laneM) * clk.parked;
    st.phase = 'parked';
    st.speedKmh = 0;
    st.dir = 0;
    st.phaseElapsedS = clk.parkElapsed;
    st.phaseRemainS = clk.parkRemain;
    st.etaDumpS += clk.parkRemain;
  }
  return st;
}

/** Queue slot of a truck `tau` seconds into its queue wait: trucks ahead leave one per headway; it moves up smoothly. */
export function queuePos(plan: CircuitPlan, tau: number): { s: number; lateral: number; ahead: number; move: number } {
  const W = plan.queueS, h = plan.headwayS;
  const ahead = Math.max(0, Math.ceil((W - tau) / h - 1e-9) - 1);
  const since = h - ((W - tau) - ahead * h);
  const move = ease(clamp01(since / 10));
  const idx = ahead + 1 - move;
  const latOf = (i: number) => plan.laneM + (i % 2) * Math.min(3.5, Math.max(0, plan.shoulderM - plan.laneM));     // staggered line
  return { s: QUEUE_FRONT_M + Math.max(0, idx) * QUEUE_GAP_M, lateral: latOf(ahead + 1) * (1 - move) + latOf(ahead) * move, ahead, move };
}

/** State at a time `tau` into the effective cycle. */
export function cycleState(plan: CircuitPlan, tau: number): TruckSimState {
  const L = plan.lengthM;
  const W = plan.queueS, sp = plan.spotS, ld = plan.loadS, H = plan.haul.dur, D = plan.dumpS, R = plan.ret.dur;
  const tHaul0 = W + sp + ld, tDump0 = tHaul0 + H, tRet0 = tDump0 + D, C = plan.effCycleS;
  const etaDump = (x: number) => (x < tDump0 ? tDump0 - x : x < tRet0 ? 0 : C - x + tDump0);
  const base = (phase: TruckPhase, elapsed: number, dur: number): TruckSimState => ({
    phase, s: 0, lateral: 0, rev: 0, speedKmh: 0, loaded: false, tray: 0, fill: 0, wheelDist: 0, dir: 0,
    phaseElapsedS: elapsed, phaseRemainS: Math.max(0, dur - elapsed), etaDumpS: etaDump(tau),
  });
  if (tau < W) {
    const st = base('queue', tau, W);
    const q = queuePos(plan, tau);
    st.s = q.s; st.lateral = q.lateral; st.rev = 1; st.queueIndex = q.ahead;
    st.wheelDist = 2 * L + st.s;
    st.speedKmh = q.move > 0 && q.move < 1 ? 5 : 0;
    st.dir = st.speedKmh > 0 ? -1 : 0;
    return st;
  }
  if (tau < W + sp) {
    const u = (tau - W) / Math.max(1e-6, sp), e = ease(u);
    const st = base('spot', tau - W, sp);
    const s0 = W > 0 ? QUEUE_FRONT_M : SPOT_ENTRY_M;
    st.s = s0 * (1 - e);
    st.lateral = plan.laneM * (1 - e) + 9 * Math.sin(Math.PI * e);
    st.rev = 1 - e;
    st.speedKmh = sp > 0 ? (s0 / sp) * 3.6 * 1.4 * Math.sin(Math.PI * u) : 0;
    st.dir = -1;
    st.wheelDist = 2 * L + s0 + s0 * e;
    return st;
  }
  if (tau < tHaul0) {
    const el = tau - W - sp;
    const st = base('load', el, ld);
    // a bucket lands in the body ~60 % into each pass (the excavator's dump, see machines.excavatorPass)
    st.fill = Math.max(0, Math.min(1, Math.ceil((el / Math.max(1e-6, ld)) * plan.passes - 0.6) / plan.passes));
    st.loaded = st.fill > 0;
    st.wheelDist = 0;
    return st;
  }
  if (tau < tDump0) {
    const el = tau - tHaul0;
    const tr = travelAt(plan.haul, el);
    const st = base('haul', el, H);
    st.s = tr.s; st.speedKmh = tr.v; st.loaded = true; st.fill = 1; st.dir = 1;
    // pull into the left lane over the first 25 m
    st.lateral = -plan.laneM * ease(st.s / 25);
    st.wheelDist = st.s;
    return st;
  }
  if (tau < tRet0) {
    const el = tau - tDump0, u = el / Math.max(1e-6, D);
    const st = base('dump', el, D);
    // 0..0.32 turn and reverse to the tip edge, 0.32..0.8 tip, 0.8..1 lower and pull away
    const ut = ease(clamp01(u / 0.32));
    st.s = L + 10 * Math.sin(Math.PI * ut) * 0.6 + 4 * ut;
    st.lateral = -plan.laneM * (1 - ut) + plan.laneM * ut - 8 * Math.sin(Math.PI * ut);
    st.rev = ut;
    const tipUp = ease(clamp01((u - 0.34) / 0.22)), tipDown = ease(clamp01((u - 0.78) / 0.2));
    st.tray = tipUp * (1 - tipDown);
    st.fill = 1 - ease(clamp01((u - 0.45) / 0.25));
    st.loaded = st.fill > 0.02;
    st.speedKmh = u < 0.32 ? 8 * Math.sin(Math.PI * ut) : 0;
    st.dir = u < 0.32 ? 1 : 0;
    st.wheelDist = L + 12 * ut;
    return st;
  }
  const el = tau - tRet0;
  const tr = travelAt(plan.ret, el);
  const st = base('return', el, R);
  const sAlong = tr.s;                       // from the dump towards the dig
  const end = W > 0 ? queuePos(plan, 0) : { s: SPOT_ENTRY_M, lateral: plan.laneM };
  const endS = end.s;
  st.s = Math.max(endS, L + 4 - sAlong * ((L + 4) / Math.max(1e-6, L)));
  st.rev = 1;
  // keep left; drift to the queue slot's offset over the last 30 m
  st.lateral = plan.laneM + (end.lateral - plan.laneM) * ease(1 - (st.s - endS) / 30);
  st.speedKmh = st.s <= endS + 1e-6 ? 0 : tr.v;
  st.dir = st.speedKmh > 0 ? -1 : 0;
  st.wheelDist = L + 12 + sAlong;
  return st;
}

// ── engine shift simulation → presentation ───────────────────────────────────────────

/** The fields of the engine's TruckState ('@/engine' truckStatesAt) the scene uses. */
export interface EngineTruckState {
  truckIndex: number;
  unitId?: string;
  phase: TruckPhase;
  paused: boolean;
  pauseLabel?: string;
  chainageM: number;
  speedKmh: number;
  loaded: boolean;
  dir: 1 | -1 | 0;
  queueIndex?: number;
  fill: number;
  phaseStartMin: number;
  phaseEndMin: number;
}

/**
 * Presentation of one engine truck state: the engine decides WHERE and WHAT (phase, chainage, speed, load, pauses);
 * this adds HOW it looks - keep-left lanes, the turn-around arcs while spotting and at the tip, the staggered queue,
 * body tip and a bucket-by-bucket heap. `scale` maps engine chainage onto the scene path; `plan` supplies typical
 * phase durations for the ETA to the dump.
 *
 * Pauses (`pause`, the truck's own pause window from the engine): a truck on the road pulls over to the shoulder
 * where it stopped and pulls back out before the event ends; at an end-of-shift park-up every truck turns round and
 * drives to its slot on the park-up line beside the road near its loader (`parkSlot`) and parks there.
 */
export function presentEngineState(es: EngineTruckState, tMin: number, L: number, scale: number, plan: CircuitPlan, pause?: PauseInfo): TruckSimState {
  const dur = Math.max(1e-6, (es.phaseEndMin - es.phaseStartMin) * 60);
  const el = Math.max(0, Math.min(dur, (tMin - es.phaseStartMin) * 60));
  const u = el / dur, e = ease(u);
  const s = es.chainageM * scale;
  const lane = plan.laneM;
  const st: TruckSimState = {
    phase: es.phase, s, lateral: 0, rev: 0, speedKmh: es.speedKmh, loaded: es.loaded, tray: 0, fill: Math.max(0, Math.min(1, es.fill)),
    wheelDist: 0, dir: es.dir, phaseElapsedS: el, phaseRemainS: Math.max(0, dur - el), etaDumpS: 0, queueIndex: es.queueIndex,
  };
  const H = plan.haul.dur;
  switch (es.phase) {
    case 'queue': {
      const q = es.queueIndex ?? 0;
      st.lateral = lane + (q % 2) * Math.min(3.5, Math.max(0, plan.shoulderM - lane)); st.rev = 1; st.wheelDist = 2 * L + s;
      st.etaDumpS = st.phaseRemainS + plan.spotS + plan.loadS + H;
      break;
    }
    case 'spot':
      st.lateral = lane * (1 - e) + 9 * Math.sin(Math.PI * e); st.rev = 1 - e; st.wheelDist = 2 * L + s;
      st.etaDumpS = st.phaseRemainS + plan.loadS + H;
      break;
    case 'load':
      st.s = 0;
      st.fill = Math.max(0, Math.min(1, Math.ceil(u * plan.passes - 0.6) / plan.passes));
      st.loaded = st.fill > 0;
      st.etaDumpS = st.phaseRemainS + H;
      break;
    case 'haul':
      st.lateral = -lane * ease(s / 25); st.wheelDist = s; st.fill = 1;
      st.etaDumpS = st.phaseRemainS;
      break;
    case 'dump': {
      const ut = ease(Math.min(1, u / 0.32));
      st.s = L + 10 * Math.sin(Math.PI * ut) * 0.6 + 4 * ut;
      st.lateral = -lane * (1 - ut) + lane * ut - 8 * Math.sin(Math.PI * ut);
      st.rev = ut;
      st.tray = ease(Math.min(1, Math.max(0, (u - 0.34) / 0.22))) * (1 - ease(Math.min(1, Math.max(0, (u - 0.78) / 0.2))));
      st.fill = 1 - ease(Math.min(1, Math.max(0, (u - 0.45) / 0.25)));
      st.loaded = st.fill > 0.02;
      st.speedKmh = u < 0.32 && !es.paused ? 8 * Math.sin(Math.PI * ut) : 0;
      st.wheelDist = L + 12 * ut;
      st.etaDumpS = 0;
      break;
    }
    case 'return':
      st.rev = 1; st.lateral = lane; st.wheelDist = 2 * L - s;
      // ease out of the dump's turn-around point (L + 4) over the first 30 m
      if (s > L - 30) st.s = s + 4 * ease(1 - (L - s) / 30);
      st.etaDumpS = st.phaseRemainS + plan.spotS + plan.loadS + H;
      break;
    case 'parked':
      st.rev = 1; st.lateral = plan.shoulderM; st.s = Math.max(s, QUEUE_FRONT_M);
      break;
  }
  if (es.paused) {
    st.speedKmh = 0; st.dir = 0;
    st.phase = 'parked';
    if (pause) applyPause(st, es, tMin, plan, pause);
  }
  return st;
}

/** Roadside pull-over (any stop) or the drive to the park-up line (end of shift) for a paused truck. */
function applyPause(st: TruckSimState, es: EngineTruckState, tMin: number, plan: CircuitPlan, p: PauseInfo) {
  const since = Math.max(0, (tMin - p.startMin) * 60), left = Math.max(0, (p.endMin - tMin) * 60);
  if (!p.parkUp) {
    // only trucks out on the road pull over; at the loader, in the queue or at the tip they wait in place
    if (es.phase !== 'haul' && es.phase !== 'return') return;
    const k = Math.min(ease(since / 15), ease(left / 15));
    const side = st.lateral >= 0 ? 1 : -1;
    st.lateral += (side * plan.shoulderM - st.lateral) * k;
    return;
  }
  // park-up: turn round (if facing the dump), drive back along the road to the slot, pull in beside it
  const slot = parkSlot(plan, es.truckIndex);
  const s0 = st.s, lat0 = st.lateral, rev0 = st.rev;
  const dist = Math.abs(s0 - slot.s);
  const driveS = dist / (PARK_DRIVE_KMH / 3.6);
  const T = Math.max(20, Math.min(PARK_TURN_S * 2 + driveS, Math.max(20, (p.endMin - p.startMin) * 60 * 0.9)));
  const uu = Math.min(1, since / T);
  const turn = ease(Math.min(1, uu / 0.18)), along = ease(Math.max(0, Math.min(1, (uu - 0.08) / 0.84))), pullIn = ease(Math.max(0, (uu - 0.86) / 0.14));
  const towardsDig = slot.s <= s0;
  st.rev = rev0 + ((towardsDig ? 1 : 0) - rev0) * turn;
  st.s = s0 + (slot.s - s0) * along;
  // out onto the keep-left lane for the drive (with a turn-around swing), then onto the park-up line
  const laneLat = towardsDig ? plan.laneM : -plan.laneM;
  const swing = rev0 < 0.5 && towardsDig ? -8 * Math.sin(Math.PI * turn) : 0;
  st.lateral = lat0 + (laneLat - lat0) * turn + swing;
  st.lateral += (slot.lateral - st.lateral) * pullIn;
  st.tray = 0;
  st.wheelDist += Math.abs(st.s - s0) + 12 * turn;
  if (uu < 1) {
    // moving: speed from the eased chainage rate
    const dAlong = 1 / (0.84 * T);
    const v = Math.abs(slot.s - s0) * dAlong * 6 * Math.max(0, Math.min(1, (uu - 0.08) / 0.84)) * (1 - Math.max(0, Math.min(1, (uu - 0.08) / 0.84)));
    st.speedKmh = Math.max(turn < 1 ? 6 : 0, v * 3.6);
    st.dir = towardsDig ? -1 : 1;
    st.phase = 'return';
  }
  st.phaseElapsedS = since; st.phaseRemainS = left;
  st.etaDumpS = left + plan.spotS + plan.loadS + plan.haul.dur;
}
