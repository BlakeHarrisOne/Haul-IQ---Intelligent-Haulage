/**
 * Engine extension types. Everything here EXTENDS a contract type from '@/core/types' with optional fields, so
 * objects stay assignable to the contracts (and JSON-serialisable in saved scenarios). Fields marked "contract
 * request" are proposed additions to core/types.ts; until then UI code can read them through these types.
 *
 * Units follow core/types.ts: seconds, km/h (data) / m/s (inside kinematics), kN, tonnes, bcm, metres.
 */
import type {
  CalcStep, CircuitParams, CircuitResult, CrewRule, CurvePoint, FleetOption, Id, SegmentResult, TruckModel, Vec3,
} from '@/core/types';

/** Spreadsheet mode: what to do with |ROUND(grade,2)| > 0.16 (outside the workbook table). */
export type OutOfRangeMode = 'drop' | 'clamp';
/** Rimpull mode: kinematic forward–backward pass (accel/decel, real stops) or steady balance speed per segment. */
export type MotionModel = 'kinematic' | 'steady';
/** Production model per number of trucks. 'deterministic' = the workbook (n × PT × productivity). */
export type QueueModel = 'deterministic' | 'mm1n' | 'binomial';
/** Downhill speed rule: Cat ARC holds the highest gear the retarder sustains; Komatsu ARSC / electric hold any speed. */
export type DescentRule = 'discrete_gear' | 'continuous';

/**
 * Circuit parameters as the engine reads them. The engine options (outOfRange, motion, queueModel, loaderPtHrsPerDay,
 * accelMaxMs2, decelLoadedMs2, decelEmptyMs2, tractionCoeff, stopDwellS) are now optional fields of the
 * CircuitParams contract itself; this alias is kept for existing imports.
 */
export type CircuitParamsExt = CircuitParams;

/** One gear's rimpull or retarder curve. */
export interface GearCurve {
  gear: number;
  /** Gear governed top speed, km/h. */
  maxKmh: number;
  /** [km/h, kN] within the gear band. */
  points: CurvePoint[];
}

/** Contract request: optional physics fields on TruckModel (built from oem-curves.json by '@/data'). */
export interface TruckModelExt extends TruckModel {
  /** Per-gear rimpull curves (mechanical drive). TruckModel.rimpull is the envelope (max over gears). */
  rimpullGears?: GearCurve[];
  /** Per-gear continuous retarder curves (mechanical). TruckModel.retarder is the envelope. */
  retarderGears?: GearCurve[];
  /** Continuous retarding power, kW. */
  retarderPowerKW?: number;
  /** Low-speed retarding force cap, kN. */
  retarderCapKN?: number;
  descentRule?: DescentRule;
  /** Share of the weight on the driven axle (traction limit), loaded / empty. */
  driveAxleShare?: { loaded: number; empty: number };
  netPowerKW?: number;
  /** Secondary colour for the 3D model (cab / chassis trim). */
  trimColor?: string;
  /** Per-field provenance: 'oem' | 'oem_derived' | 'third_party' | 'estimated'. */
  dataQuality?: Record<string, string>;
  estimationMethod?: string;
  siteAliases?: string[];
}

/**
 * Contract request: CrewRule additions for rules a fixed count cannot express (workbook R7 bulk push).
 * `expr` / `whenExpr` use a tiny language: numbers, + − * /, comparisons, && || !, parentheses,
 * max/min/ceil/floor/abs/if(c,a,b) and identifiers totals.trucks · totals.circuits · totals.activeLoaders ·
 * fleet.trucksAvailable · params.<name> · roles.<role> · rules.<ruleId> · circuit.trucks · circuit.priority.
 */
export interface CrewRuleExt extends CrewRule {
  /** People per firing, replacing `count` when present. */
  expr?: string;
  /** Extra gate; the rule fires only when it evaluates truthy. */
  whenExpr?: string;
  params?: Record<string, number>;
  /** Site-task priority (1 = highest). The priority planner sheds such a role like a circuit, lowest first. */
  priority?: number;
  /** Production per person on this rule, bcm/day (for lost-production reporting when shed). */
  bcmPerUnitDay?: number;
}

/** Physics detail for one direction of a segment (rimpull mode). */
export interface DirPhysics {
  /** Gross mass in this direction, t. */
  massT: number;
  /** Total resistance m·g·(sinθ + cosθ·RR) at steady speed, kN (negative = net downhill). */
  resistanceKN: number;
  mode: 'propel' | 'retard';
  /** Steady-state (balance) speed after limits, km/h. */
  steadyKmh: number;
  /** Rimpull (propel) or retarder force (retard) available at steadyKmh, kN. */
  forceAvailKN: number;
  gear?: number;
  /** Binding constraint, e.g. 'rimpull_g1', 'governor_g6', 'retarder_g3', 'speed-limit', 'top-speed', 'stall'. */
  binding: string;
  /** Kinematic only: speeds at the segment ends and the max reached, km/h. */
  vEntryKmh?: number;
  vExitKmh?: number;
  vMaxKmh?: number;
  /** Kinematic only: time share by binding constraint ('accel', 'decel', 'rimpull', 'retarder', 'speed-limit', …), 0..1. */
  shares?: Record<string, number>;
}

export interface SegmentResultExt extends SegmentResult {
  /** Spreadsheet mode: ROUND(grade, 2) loaded / empty. */
  gradeRoundedLoaded?: number;
  gradeRoundedEmpty?: number;
  /** Spreadsheet mode, outOfRange 'drop': this segment's loaded / empty time was dropped (0 s) like Excel. */
  droppedLoaded?: boolean;
  droppedEmpty?: boolean;
  /** Travel Time row this segment mirrors (row = i + 4). */
  sheetRow?: number;
  physLoaded?: DirPhysics;
  physEmpty?: DirPhysics;
}

/** A piece of a travel profile with constant acceleration. s in m, t in s, v in m/s. */
export interface TravelInterval {
  /** Distance along the leg at the interval start (loaded: from the dig; empty: from the dump). */
  s0: number;
  ds: number;
  t0: number;
  dt: number;
  v0: number;
  v1: number;
  /** Segment index (route order). */
  seg: number;
  /** A stationary dwell (stop sign). */
  dwell?: boolean;
}

/** Speed–distance–time profile of one leg (before the haul efficiency factor). */
export interface TravelProfile {
  intervals: TravelInterval[];
  lengthM: number;
  timeS: number;
}

/** A stop-sign penalty dwell placed on a leg (spreadsheet/steady modes: stopPenaltyS each). */
export interface PenaltyStop { leg: 'loaded' | 'empty'; s: number; durS: number }

export interface FleetOptionExt extends FleetOption {
  /** Macro goal-seek volume n × PT × productivity before the C19 cap (bcm/day). */
  goalSeekBcmDay: number;
  /** True when the macro capped C20 at C19 (ideal daily volume). */
  capped: boolean;
  /** C17 = C20 / C16 (truck PT hours needed for this option's volume). */
  truckHoursReq: number;
  /** C24 = C17 / C22 (may be fractional below n when capped). */
  trucksNeeded: number;
  idealBcmDay: number;
  queueModel: QueueModel;
  /** Loader busy fraction from the queue model (deterministic: min(1, MF)). */
  loaderBusy: number;
  /** Mean queue wait per load, min (queue models; deterministic: from the excess cycle). */
  queueWaitMinPerLoad: number;
}

export interface CircuitResultExt extends CircuitResult {
  segments: SegmentResultExt[];
  options: FleetOptionExt[];
  assigned: FleetOptionExt;
  haulStringId?: Id;
  truckModelId: Id;
  /** C19 ideal daily volume = planned rate × loader PT (bcm/day). */
  idealDailyBcm: number;
  /** C20 desired daily volume (bcm/day). */
  desiredDailyBcm: number;
  /** Loader PT target h/day (C22 in the workbook). */
  loaderPtTargetHrs: number;
  truckLoadBcm: number;
  /** Loader service time t_L = spot + load (s). */
  serviceS: number;
  droppedSegments: number[];
  outOfRange?: OutOfRangeMode;
  motion?: MotionModel;
  queueModel: QueueModel;
  /** Rimpull mode masses (t). */
  payloadT?: number;
  massLoadedT?: number;
  massEmptyT?: number;
  /** Stop signs modelled as real stops (kinematic) per cycle. */
  stopsModelled: number;
  penaltyStops: PenaltyStop[];
  profiles: { loaded: TravelProfile; empty: TravelProfile };
  /** Kinematic: time share by binding constraint per leg. */
  bindingShare?: { loaded: Record<string, number>; empty: Record<string, number> };
}

// ─────────────────────────────────────────────────────────────── shift simulation

/** Same set as the scene's TruckPhase. Event pauses are reported with `paused` (the phase is kept). */
export type TruckPhase = 'queue' | 'spot' | 'load' | 'haul' | 'dump' | 'return' | 'parked';

/** One phase of one truck's shift (times in s after shift start). */
export interface PhaseRecord {
  phase: TruckPhase;
  t0: number;
  t1: number;
  /** Queue slot when the truck joined the queue (0 = next to be served). */
  queueSlot?: number;
}

export interface TruckTimeline {
  truckIndex: number;
  unitId?: string;
  records: PhaseRecord[];
  /** Pause windows [start s, end s, label] when this truck is stopped by a shift event. */
  pauses: [number, number, string][];
}

/** Deterministic discrete-event simulation of one circuit over the shift profile. */
export interface ShiftSim {
  circuitId: Id;
  trucks: number;
  shiftS: number;
  /** Fleet productive minutes of the profile (events weighted by fleetStopFraction). */
  productiveMin: number;
  /** Loader service time spot + load (s). */
  serviceS: number;
  /** Minimum loader active time between successive spot starts so the planned rate is not exceeded (s). */
  loaderGapS: number;
  /** Free-flow cycle time incl. haul efficiency and stop penalties (s) = CircuitResult.cycleS. */
  cycleS: number;
  truckLoadBcm: number;
  timelines: TruckTimeline[];
  /** Sorted spot-start / load-end times of every load (s). */
  loadStartsS: number[];
  loadEndsS: number[];
  /** Sorted dump-end times (s). */
  dumpEndsS: number[];
  /** Loads completed by the end of the shift and their bcm. */
  loads: number;
  bcm: number;
  dumpedBcm: number;
  /** Loader down windows [start s, end s, label] (fleet-wide events and circuit standby). */
  loaderDown: [number, number, string][];
  standby?: { startMin: number; durMin: number; reason: string };
  steps: CalcStep[];
  warnings: string[];
}

/** Position and activity of one truck at a moment in the shift (drives the 3D animation). */
export interface TruckState {
  truckIndex: number;
  unitId?: string;
  phase: TruckPhase;
  /** Stopped by a shift event (crib, prestart, fuel…); position frozen. */
  paused: boolean;
  pauseLabel?: string;
  /** Distance along the haul string from the dig, m. */
  chainageM: number;
  speedKmh: number;
  loaded: boolean;
  /** +1 towards the dump, −1 towards the dig, 0 stationary. */
  dir: 1 | -1 | 0;
  /** World position on the string [E, N, Z] and unit travel direction. */
  pos: Vec3;
  heading: Vec3;
  queueIndex?: number;
  /** Loads this truck has completed so far. */
  loads: number;
  /** Body fill 0..1 (rises while loading, falls while dumping). */
  fill: number;
  phaseStartMin: number;
  phaseEndMin: number;
}
