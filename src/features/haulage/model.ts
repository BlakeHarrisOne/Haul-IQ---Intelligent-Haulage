/**
 * Haulage feature - pure helpers (no React, no DOM). Unit-tested in model.test.ts.
 *
 *  - point rows → segments (segment i starts at point i, like SegmentOverrides),
 *  - spreadsheet drop detection (|ROUND(grade, 2)| > 16 % → the workbook silently times the segment at 0 s),
 *  - per-segment override application (speed limit / RR / zone / stop flags),
 *  - fleet chooser rows (the spreadsheet's row-28 "# trucks" buttons, generalised),
 *  - loader defaults + changed-vs-default detection for circuit assumptions,
 *  - chart scales for the long section (vertical exaggeration) and the true-scale cross-section,
 *  - a kinematic truck phase model for the truck card.
 */
import type {
  Circuit, CircuitParams, CircuitResult, FleetOption, Id, Scenario, SegmentOverrides, SegmentResult,
  SegmentZone, StringPoint, TruckingStatus,
} from '@/core/types';
import { linear, type Scale } from '@/ui/chart';
import { uid } from '@/core/ids';
import { excelRound } from '@/engine';

export interface XYZ { e: number; n: number; z: number }

// ─────────────────────────────────────────────────────────────── spreadsheet rounding / drops

/** The grade lookup tables stop at ±16 %; anything that ROUNDs beyond is dropped (Q3). */
export const SHEET_MAX_GRADE = 0.16;

/** True when the spreadsheet would drop this segment's travel time (|ROUND(grade,2)| > 0.16). */
export const sheetDrops = (grade: number) => Number.isFinite(grade) && Math.abs(excelRound(grade, 2)) > SHEET_MAX_GRADE + 1e-12;

// ─────────────────────────────────────────────────────────────── rows → segments

export interface SegRow {
  /** Index of the start point (segment i runs point i → i + 1). */
  i: number;
  dist3d: number;
  distPlan: number;
  dz: number;
  /** dZ / 3D slope distance (spreadsheet convention), loaded direction. */
  grade: number;
  /** Cumulative 3D chainage at the segment start (m). */
  chainage: number;
  /** The spreadsheet would drop this segment's time (|grade| rounds above 16 %). */
  dropped: boolean;
  /** Coincident points: zero length (skipped by every calculation). */
  zero: boolean;
}

/** One SegRow per consecutive point pair (N − 1 rows). */
export function segmentsOf(points: readonly XYZ[]): SegRow[] {
  const out: SegRow[] = [];
  let ch = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const dp = Math.hypot(b.e - a.e, b.n - a.n);
    const dz = b.z - a.z;
    const d = Math.hypot(dp, dz);
    const zero = d <= 1e-9;
    const g = zero ? 0 : dz / d;
    out.push({ i, dist3d: d, distPlan: dp, dz, grade: g, chainage: ch, dropped: !zero && sheetDrops(g), zero });
    ch += d;
  }
  return out;
}

/** Cumulative 3D chainage at every point (length N). */
export function chainagesOf(points: readonly XYZ[]): number[] {
  const out = new Array<number>(points.length);
  let ch = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) { const a = points[i - 1], b = points[i]; ch += Math.hypot(b.e - a.e, b.n - a.n, b.z - a.z); }
    out[i] = ch;
  }
  return out;
}

export interface StringStats {
  points: number;
  lengthM: number;
  planM: number;
  riseM: number;
  fallM: number;
  /** Steepest uphill / downhill grade in the dig → dump direction (fractions; maxDown ≤ 0). */
  maxUp: number;
  maxDown: number;
  /** Net grade dig → dump (ΔZ / length). */
  netGrade: number;
  /** Length-weighted mean |grade|. */
  meanAbsGrade: number;
  droppedCount: number;
  droppedM: number;
  zeroCount: number;
  startZ: number;
  endZ: number;
}

export function stringStats(points: readonly XYZ[]): StringStats {
  const segs = segmentsOf(points);
  let L = 0, P = 0, rise = 0, fall = 0, up = 0, down = 0, absW = 0, dc = 0, dm = 0, zc = 0;
  for (const s of segs) {
    L += s.dist3d; P += s.distPlan;
    if (s.dz > 0) rise += s.dz; else fall -= s.dz;
    if (s.grade > up) up = s.grade;
    if (s.grade < down) down = s.grade;
    absW += Math.abs(s.grade) * s.dist3d;
    if (s.dropped) { dc++; dm += s.dist3d; }
    if (s.zero) zc++;
  }
  const z0 = points[0]?.z ?? 0, z1 = points[points.length - 1]?.z ?? 0;
  return {
    points: points.length, lengthM: L, planM: P, riseM: rise, fallM: fall, maxUp: up, maxDown: down,
    netGrade: L > 0 ? (z1 - z0) / L : 0, meanAbsGrade: L > 0 ? absW / L : 0, droppedCount: dc, droppedM: dm, zeroCount: zc,
    startZ: z0, endZ: z1,
  };
}

/** Engine segment results indexed by their start point (the engine skips zero-length segments). */
export function resultByPoint(nPoints: number, segs: readonly SegmentResult[] | undefined): (SegmentResult | undefined)[] {
  const out = new Array<SegmentResult | undefined>(Math.max(0, nPoints)).fill(undefined);
  if (!segs) return out;
  for (const s of segs) if (s.i >= 0 && s.i < nPoints) out[s.i] = s;
  return out;
}

/** Index of the vertex nearest to a chainage. */
export function nearestVertex(chainages: readonly number[], ch: number): number {
  let lo = 0, hi = chainages.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (chainages[mid] <= ch) lo = mid; else hi = mid; }
  return Math.abs(chainages[lo] - ch) <= Math.abs(chainages[hi] - ch) ? lo : hi;
}

/** Index of the segment containing a chainage (clamped to [0, N − 2]). */
export function segmentAt(chainages: readonly number[], ch: number): number {
  const n = chainages.length;
  if (n < 2) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (chainages[mid] <= ch) lo = mid; else hi = mid; }
  return Math.min(lo, n - 2);
}

// ─────────────────────────────────────────────────────────────── overrides & point edits

export const ZONES: SegmentZone[] = ['pit', 'ramp', 'road', 'dump', 'crusher', 'intersection'];

export interface EffectiveSeg {
  speedLimitKmh: number;
  rrPct: number;
  zone?: SegmentZone;
  overridden: { speed: boolean; rr: boolean; zone: boolean };
}

/** Circuit defaults with the point's per-segment overrides applied. */
export function effectiveSeg(p: StringPoint, defaults: Pick<CircuitParams, 'speedLimitKmh' | 'rrPct'>): EffectiveSeg {
  const o = p.seg ?? {};
  return {
    speedLimitKmh: o.speedLimitKmh ?? defaults.speedLimitKmh,
    rrPct: o.rrPct ?? defaults.rrPct,
    zone: o.zone,
    overridden: { speed: o.speedLimitKmh != null, rr: o.rrPct != null, zone: o.zone != null },
  };
}

type SegPatch = { [K in keyof SegmentOverrides]?: SegmentOverrides[K] | null };

/** Merge (value) or clear (null / undefined) per-segment overrides on point i; drops an empty `seg`. */
export function withSegOverride(points: readonly StringPoint[], i: number, patch: SegPatch): StringPoint[] {
  return points.map((p, k) => {
    if (k !== i) return p;
    const seg: SegmentOverrides = { ...(p.seg ?? {}) };
    for (const key of Object.keys(patch) as (keyof SegmentOverrides)[]) {
      const v = patch[key];
      if (v == null) delete seg[key];
      else (seg as Record<string, unknown>)[key] = v;
    }
    const { seg: _old, ...rest } = p;
    return Object.keys(seg).length ? { ...rest, seg } : rest;
  });
}

export function withStop(points: readonly StringPoint[], i: number, on: boolean): StringPoint[] {
  return points.map((p, k) => {
    if (k !== i) return p;
    if (on) return { ...p, stop: true };
    const { stop: _s, stopOneWay: _o, ...rest } = p;
    return rest;
  });
}

/** Edit coordinates of point i. Editing Z by hand clears `snapped`. */
export function withXYZ(points: readonly StringPoint[], i: number, patch: Partial<XYZ>, snapped?: boolean): StringPoint[] {
  return points.map((p, k) => {
    if (k !== i) return p;
    const next: StringPoint = { ...p, ...patch };
    if (snapped !== undefined) next.snapped = snapped;
    else if (patch.z !== undefined) next.snapped = false;
    return next;
  });
}

/** Stop signs a string contributes per cycle (both directions unless one-way). */
export const stopsPerCycle = (points: readonly StringPoint[]) =>
  points.reduce((a, p) => a + (p.stop ? (p.stopOneWay ? 1 : 2) : 0), 0);

/** Midpoint insert after i (Z interpolated, overrides of i copied to the new segment). */
export function insertAfter(points: readonly StringPoint[], i: number): StringPoint[] {
  const a = points[i], b = points[i + 1];
  if (!a) return points.slice();
  const p: StringPoint = b
    ? { id: uid('pt'), e: (a.e + b.e) / 2, n: (a.n + b.n) / 2, z: (a.z + b.z) / 2, snapped: false, ...(a.seg ? { seg: { ...a.seg } } : {}) }
    : { id: uid('pt'), e: a.e + 10, n: a.n, z: a.z, snapped: false };
  return [...points.slice(0, i + 1), p, ...points.slice(i + 1)];
}

export function removeAt(points: readonly StringPoint[], i: number): StringPoint[] {
  return points.filter((_, k) => k !== i);
}

// ─────────────────────────────────────────────────────────────── fleet chooser

export type FleetRowKind = 'under' | 'recommended' | 'over';

export interface FleetRow {
  opt: FleetOption;
  kind: FleetRowKind;
  /** n − recommended (negative = deliberately under-trucked). */
  delta: number;
  assigned: boolean;
  /** 0..1 of the bar scale. */
  achieved: number;
  capacity: number;
  target: number;
}

/** Smallest n at which the loader loses no PT (the spreadsheet's "click until 0 h lost"). */
export function recommendedTrucks(r: CircuitResult): number {
  const hit = r.options.find(o => o.lostLoaderPtHrsShift <= 0.005);
  if (hit) return hit.trucks;
  return Math.max(1, r.trucksRecommended || Math.ceil(r.trucksExact - 1e-9));
}

/** Rows for the chooser, from 1 to max(assigned, recommended) + extra. */
export function fleetRows(r: CircuitResult, assigned: number, targetBcmDay: number, extra = 2): FleetRow[] {
  const rec = recommendedTrucks(r);
  const maxN = Math.min(r.options.length, Math.max(rec + extra, assigned + 1, 4));
  const opts = r.options.slice(0, maxN);
  const scale = Math.max(targetBcmDay, ...opts.map(o => o.truckCapacityBcmDay), 1) * 1.04;
  return opts.map(o => ({
    opt: o,
    kind: o.trucks < rec ? 'under' : o.trucks === rec ? 'recommended' : 'over',
    delta: o.trucks - rec,
    assigned: o.trucks === assigned,
    achieved: o.bcmPerDay / scale,
    capacity: Math.min(1, o.truckCapacityBcmDay / scale),
    target: targetBcmDay / scale,
  }));
}

export interface TruckingCall { tone: 'ok' | 'bad' | 'warn'; title: string; detail: string }

/** Plain-language verdict for an assigned truck count. */
export function truckingCall(n: number, rec: number, o: FleetOption | undefined): TruckingCall {
  if (!o) return { tone: 'warn', title: 'No result', detail: 'The circuit could not be calculated.' };
  const d = n - rec;
  if (d < 0) {
    return {
      tone: 'bad',
      title: `Deliberately under-trucked by ${-d}`,
      detail: `${fmt1(o.lostLoaderPtHrsShift)} h/shift of loader hang time. Schedule it, or look for a shorter haul.`,
    };
  }
  if (d > 0) {
    return {
      tone: 'warn',
      title: `Deliberately over-trucked by ${d}`,
      detail: `${fmt1(o.truckQueueHrsShift)} truck-h/shift queuing at the loader. Free a truck for another circuit.`,
    };
  }
  return { tone: 'ok', title: 'Balanced', detail: 'Fewest trucks with no loader PT lost.' };
}
const fmt1 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export const statusTone = (s: TruckingStatus): 'ok' | 'bad' | 'warn' => (s === 'under' ? 'bad' : s === 'over' ? 'warn' : 'ok');
export const statusLabel = (s: TruckingStatus) => (s === 'under' ? 'Under-trucked' : s === 'over' ? 'Over-trucked' : 'Balanced');

// ─────────────────────────────────────────────────────────────── defaults

/** Site-wide defaults (spreadsheet values) for parameters that are not per loader. */
export const GLOBAL_DEFAULTS = {
  haulEff: 0.85,
  stopSigns: 2,
  stopPenaltyS: 60,
  truckPtHrsPerDay: 20,
  rrPct: 2,
  speedLimitKmh: 60,
  speedModel: 'spreadsheet',
  shiftsPerDay: 2,
} as const satisfies Partial<CircuitParams>;

/** Defaults for a circuit: loader assumptions (spot/load/dump/rate/PT) + truck load + global values. */
export function loaderDefaults(s: Scenario, loaderUnitId: string, truckModelId: Id, materialId: string): CircuitParams {
  const la = s.fleet.loaderAssumptions.find(a => a.unitId === loaderUnitId);
  const truck = s.fleet.trucks.find(t => t.id === truckModelId);
  const pt = la?.ptHrsPerDay ?? GLOBAL_DEFAULTS.truckPtHrsPerDay;
  const rate = la?.plannedRateBcmPerPtHr ?? 1000;
  const load = truck?.loadBcmByMaterial?.[materialId] ?? truck?.loadBcmByMaterial?.OB ?? 100;
  return {
    ...GLOBAL_DEFAULTS,
    spotS: la?.spotS ?? 30,
    loadS: la?.loadS ?? 120,
    dumpS: la?.dumpS ?? 60,
    plannedRateBcmPerPtHr: rate,
    truckPtHrsPerDay: GLOBAL_DEFAULTS.truckPtHrsPerDay,
    desiredDailyBcm: rate * pt,
    truckLoadBcm: load,
  };
}

/** Parameter keys whose value differs from the defaults (speed model excluded: it is a mode, not an input). */
export function changedParams(p: CircuitParams, d: CircuitParams): Set<keyof CircuitParams> {
  const out = new Set<keyof CircuitParams>();
  for (const k of Object.keys(d) as (keyof CircuitParams)[]) {
    if (k === 'speedModel') continue;
    const a = p[k], b = d[k];
    if (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b)) : a !== b) out.add(k);
  }
  return out;
}

export interface NewCircuitInput {
  loaderUnitId: string;
  truckModelId: Id;
  materialId: string;
  haulStringId?: Id;
  digId?: Id;
  dumpId?: Id;
  name?: string;
  color?: string;
}

/** Circuit colours as literal hex (the scene needs hex), in the CAT order. */
export const CIRCUIT_HEX = ['#0A6FE6', '#B8692E', '#3E8A5A', '#7B5EA7', '#1F8A8A', '#B5564C', '#A88A1E', '#5B6B7F'];

export function suggestCircuitName(s: Scenario, inp: NewCircuitInput): string {
  const dump = s.assets.find(a => a.id === inp.dumpId)?.name;
  const mat = inp.materialId;
  return `${inp.loaderUnitId} ${mat}${dump ? ` → ${dump}` : ''}`;
}

export function buildCircuit(s: Scenario, inp: NewCircuitInput): Circuit {
  const unit = s.fleet.units.find(u => u.id === inp.loaderUnitId);
  const used = new Set(s.circuits.map(c => c.color.toLowerCase()));
  const color = inp.color ?? CIRCUIT_HEX.find(c => !used.has(c.toLowerCase())) ?? CIRCUIT_HEX[s.circuits.length % CIRCUIT_HEX.length];
  const params = loaderDefaults(s, inp.loaderUnitId, inp.truckModelId, inp.materialId);
  const draft: Circuit = {
    id: uid('cir'),
    name: inp.name?.trim() || suggestCircuitName(s, inp),
    loaderUnitId: inp.loaderUnitId,
    loaderModelId: unit?.modelId ?? s.fleet.loaders[0]?.id ?? '',
    truckModelId: inp.truckModelId,
    materialId: inp.materialId,
    haulStringId: inp.haulStringId,
    digId: inp.digId,
    dumpId: inp.dumpId,
    trucks: 1,
    priority: s.circuits.length + 1,
    active: true,
    params,
    color,
  };
  return draft;
}

/** Circuits that reference a string (main or alternative), an asset (dig/dump) or a loader. */
export const circuitsUsingString = (s: Scenario, id: Id) =>
  s.circuits.filter(c => c.haulStringId === id || c.altHaulStringIds?.includes(id));
export const circuitsUsingAsset = (s: Scenario, id: Id) => s.circuits.filter(c => c.digId === id || c.dumpId === id);

// ─────────────────────────────────────────────────────────────── chart scales

export type VE = 'fit' | 1 | 2 | 5 | 10;
export const VE_OPTIONS: VE[] = ['fit', 1, 2, 5, 10];

export interface Box { left: number; right: number; top: number; bottom: number }

export interface ProfileScales {
  x: Scale;
  y: Scale;
  /** Exaggeration at which the data exactly fills the plot height. */
  veFit: number;
  /** Exaggeration actually drawn (a fixed VE that does not fit is capped at veFit). */
  veUsed: number;
  capped: boolean;
}

/**
 * Long-section scales: chainage always spans the full width; RL is drawn at `ve` × the horizontal scale,
 * centred on the data. A VE that would overflow the plot is capped at the fit value.
 */
export function profileScales(x0: number, x1: number, zMin: number, zMax: number, box: Box, ve: VE, padFrac = 0.1): ProfileScales {
  const W = Math.max(1, box.right - box.left), H = Math.max(1, box.bottom - box.top);
  const span = Math.max(x1 - x0, 1e-6);
  const pxPerM = W / span;
  const zSpan = Math.max(zMax - zMin, 0.5);
  const veFit = H / (zSpan * (1 + 2 * padFrac)) / pxPerM;
  const want = ve === 'fit' ? veFit : ve;
  const veUsed = Math.min(want, veFit);
  const visible = H / (pxPerM * veUsed);
  const mid = (zMin + zMax) / 2;
  return {
    x: linear([x0, x1], [box.left, box.right]),
    y: linear([mid - visible / 2, mid + visible / 2], [box.bottom, box.top]),
    veFit,
    veUsed,
    capped: ve !== 'fit' && want > veFit + 1e-9,
  };
}

/**
 * Cross-section scales. trueScale: one metre is the same number of pixels on both axes (the plot shrinks
 * horizontally and is centred when the relief needs it); otherwise RL is stretched to fill the height.
 */
export function sectionScales(d0: number, d1: number, zMin: number, zMax: number, box: Box, trueScale: boolean, padFrac = 0.08) {
  const W = Math.max(1, box.right - box.left), H = Math.max(1, box.bottom - box.top);
  const span = Math.max(d1 - d0, 1e-6);
  const zSpan = Math.max(zMax - zMin, 0.5) * (1 + 2 * padFrac);
  const mid = (zMin + zMax) / 2;
  if (!trueScale) {
    return { x: linear([d0, d1], [box.left, box.right]), y: linear([mid - zSpan / 2, mid + zSpan / 2], [box.bottom, box.top]), ve: (H / zSpan) / (W / span) };
  }
  const k = Math.min(W / span, H / zSpan);
  const w = span * k, h = H / k;
  const left = box.left + (W - w) / 2;
  return { x: linear([d0, d1], [left, left + w]), y: linear([mid - h / 2, mid + h / 2], [box.bottom, box.top]), ve: 1 };
}

/** Step-line points for per-segment values (x0, v) (x1, v) … */
export function stepPoints(segs: readonly { chainageM: number; dist3dM: number }[], val: (i: number) => number): [number, number][] {
  const out: [number, number][] = [];
  segs.forEach((s, i) => { const v = val(i); out.push([s.chainageM, v], [s.chainageM + s.dist3dM, v]); });
  return out;
}

// ─────────────────────────────────────────────────────────────── truck phase model

export type TruckPhase = 'spot' | 'load' | 'haul' | 'dump' | 'return';

export interface TruckState {
  phase: TruckPhase;
  loaded: boolean;
  speedKmh: number;
  /** Seconds to the end of the current phase. */
  phaseLeftS: number;
  /** Seconds until the truck is next under the loader (spot starts). */
  toLoaderS: number;
  chainageM: number;
  cycleS: number;
  /** 0..1 through the cycle. */
  cycleFrac: number;
}

/**
 * Where truck k of n is at time t (s since shift start), spacing trucks evenly through the cycle.
 * Travel legs are stretched by 1/η and the stop-sign penalty is shared between them, so the phases add up to
 * the engine's cycle time.
 */
export function truckStateAt(r: CircuitResult, p: CircuitParams, n: number, k: number, tS: number): TruckState | undefined {
  if (!r.ok || r.cycleS <= 0 || !r.segments.length) return undefined;
  const eff = p.haulEff || 1;
  const haulS = r.travelLoadedS / eff + r.stopsS / 2;
  const retS = r.travelEmptyS / eff + r.stopsS / 2;
  const phases: [TruckPhase, number][] = [['spot', p.spotS], ['load', p.loadS], ['haul', haulS], ['dump', p.dumpS], ['return', retS]];
  const cyc = phases.reduce((a, [, d]) => a + d, 0);
  const t = (((tS + (k / Math.max(1, n)) * cyc) % cyc) + cyc) % cyc;
  let acc = 0;
  for (let pi = 0; pi < phases.length; pi++) {
    const [ph, d] = phases[pi];
    if (t < acc + d || pi === phases.length - 1) {
      const into = t - acc;
      const left = Math.max(0, d - into);
      const toLoader = ph === 'spot' || ph === 'load' ? 0 : cyc - t;
      let speed = 0, ch = ph === 'dump' ? r.lengthM : 0;
      if (ph === 'haul' || ph === 'return') {
        const loaded = ph === 'haul';
        const total = loaded ? r.travelLoadedS : r.travelEmptyS;
        const f = d > 0 ? into / d : 0;
        let tt = f * total, run = 0;
        const segs = loaded ? r.segments : [...r.segments].reverse();
        for (const sg of segs) {
          const st = loaded ? sg.timeLoadedS : sg.timeEmptyS;
          if (tt <= run + st || sg === segs[segs.length - 1]) {
            const g = st > 0 ? Math.min(1, (tt - run) / st) : 0;
            speed = loaded ? sg.speedLoadedKmh : sg.speedEmptyKmh;
            ch = loaded ? sg.chainageM + g * sg.dist3dM : sg.chainageM + (1 - g) * sg.dist3dM;
            break;
          }
          run += st;
        }
      }
      return { phase: ph, loaded: ph === 'haul' || ph === 'dump', speedKmh: speed, phaseLeftS: left, toLoaderS: toLoader, chainageM: ch, cycleS: cyc, cycleFrac: t / cyc };
    }
    acc += d;
  }
  return undefined;
}

export const PHASE_LABEL: Record<TruckPhase, string> = { spot: 'Spotting', load: 'Loading', haul: 'Hauling loaded', dump: 'Dumping', return: 'Returning empty' };

// ─────────────────────────────────────────────────────────────── misc

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
