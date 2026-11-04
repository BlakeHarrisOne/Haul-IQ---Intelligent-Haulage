/**
 * hAIul SIM - shared contracts.
 *
 * Every module (engine, geom/io, scene, UI features) talks through these types.
 * Change them only in coordination with the integrator: they are the seams between modules.
 *
 * Conventions
 *  - World coordinates are site grid metres: E (easting), N (northing), Z (RL, elevation). Vec3 = [E, N, Z].
 *  - Three.js scene coordinates are local: x = E - origin.E, y = Z, z = -(N - origin.N)  (see core/frame.ts).
 *  - Grades are fractions (0.10 = 10 %), positive = uphill in the direction of travel.
 *  - Times in seconds unless the field name says otherwise (…Min, …Hrs). Speeds km/h. Forces kN. Masses tonnes.
 *  - Volumes: bcm (bank cubic metres) unless named lcm. Densities t/bcm unless named.
 */

export type Id = string;
export type Vec3 = [number, number, number];

// ─────────────────────────────────────────────────────────────── Meshes & imported assets

/** A triangulation in world coordinates. */
export interface MeshData {
  /** Flattened [E, N, Z, E, N, Z, …] float64 world coordinates. */
  verts: Float64Array;
  /** 0-based triangle vertex indices, 3 per triangle. */
  tris: Uint32Array;
}

export interface BBox3 { min: Vec3; max: Vec3 }

export interface MeshStats {
  vertexCount: number;
  triangleCount: number;
  bbox: BBox3;
  /** Plan (2D) area of the triangulation, m². */
  planArea: number;
  /** True when every edge is shared by exactly two triangles (a closed solid). */
  closed: boolean;
  boundaryEdges: number;
  /** Enclosed volume, m³ (closed meshes only; signed-volume method, abs). */
  volume?: number;
  /** Volume centroid (closed) or area-weighted surface centroid (open). */
  centroid: Vec3;
}

export type AssetKind = 'surface' | 'solid';
export type AssetRole = 'topo' | 'dig' | 'dump' | 'design' | 'other';
export type DepletionMode = 'face-advance' | 'bench-down' | 'bottom-up';

/** Extra properties for dig and dump solids. */
export interface BlockProps {
  materialId: MaterialId;
  /** How the block is consumed (dig) or filled (dump) over time. */
  depletionMode: DepletionMode;
  /** Plan direction the face advances / the tip face moves, degrees clockwise from grid north. */
  advanceAzimuthDeg: number;
  /** Override of the solid's volume when the plan quantity differs from the solid (bcm). */
  plannedBcm?: number;
  /** Loader unit working this block (dig) or the circuit filling it (dump). */
  loaderUnitId?: string;
}

export interface MeshAsset {
  id: Id;
  name: string;
  fileName?: string;
  kind: AssetKind;
  role: AssetRole;
  mesh: MeshData;
  stats: MeshStats;
  /** CSS colour used in the scene and legends. */
  color: string;
  visible: boolean;
  opacity: number;
  block?: BlockProps;
  source: 'import' | 'demo' | 'generated';
  importedAt: string;
}

// ─────────────────────────────────────────────────────────────── Haul strings (digitised routes)

export type SegmentZone = 'pit' | 'ramp' | 'road' | 'dump' | 'crusher' | 'intersection';

/** Overrides applying to the segment that STARTS at this point. Unset = circuit default. */
export interface SegmentOverrides {
  speedLimitKmh?: number;
  rrPct?: number;
  zone?: SegmentZone;
}

export interface StringPoint {
  id: Id;
  e: number;
  n: number;
  z: number;
  /** True when z was taken from the topo surface (snapped); false when typed/imported. */
  snapped?: boolean;
  seg?: SegmentOverrides;
  /** A stop sign / give-way at this point (counted both ways unless stopOneWay). */
  stop?: boolean;
  stopOneWay?: 'loaded' | 'empty';
  label?: string;
}

/** A haul string runs from the dig (loading point, first point) to the dump (last point). */
export interface HaulString {
  id: Id;
  name: string;
  color: string;
  points: StringPoint[];
  digId?: Id;
  dumpId?: Id;
  source: 'drawn' | 'imported' | 'auto-route' | 'demo';
  visible: boolean;
  locked?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────── Equipment

export type MaterialId = string; // 'OB' | 'CL' | 'IB' | 'PT' | 'RJ' | …

export interface Material {
  id: MaterialId;
  name: string;
  /** In-situ (bank) density t/bcm. */
  bankDensity: number;
  /** Swell factor lcm/bcm. */
  swell: number;
  color: string;
}

/** [speed km/h, force kN] */
export type CurvePoint = [number, number];
/** [grade fraction, speed km/h] - the spreadsheet's grade → max speed lookup. */
export type GradeSpeedPoint = [number, number];

export interface Source { title: string; url?: string }

export interface TruckModel {
  id: Id;
  name: string;            // 'CAT 789D'
  make: string;
  model: string;
  drive: 'mechanical' | 'electric';
  emptyMassT: number;
  payloadT: number;
  gvwT: number;
  enginePowerKW: number;
  topSpeedKmh: number;
  gears?: { gear: number; maxKmh: number }[];
  /** Rimpull envelope (max tractive effort at the wheels) vs speed. */
  rimpull: CurvePoint[];
  /** Continuous retarding effort vs speed. */
  retarder: CurvePoint[];
  bodyHeapedM3?: number;
  /** Nominal truck load per material, bcm (the spreadsheet's "Truck Load BCM"). */
  loadBcmByMaterial?: Record<MaterialId, number>;
  /** The spreadsheet's grade → max speed tables (loaded / empty). */
  spreadsheetSpeeds?: { loaded: GradeSpeedPoint[]; empty: GradeSpeedPoint[] };
  dims: { length: number; width: number; height: number; eyeHeight: number; eyeBack?: number; eyeRight?: number; tyre?: string };
  /** Body colour for the 3D model. */
  color: string;
  sources: Source[];
  /** Field names whose values are estimated rather than read from an OEM document. */
  estimated: string[];
}

export type LoaderType = 'excavator' | 'shovel' | 'loader';

export interface LoaderModel {
  id: Id;
  name: string;            // 'HIT EX5600'
  make: string;
  model: string;
  type: LoaderType;
  classLabel?: string;     // '550-ton class'
  bucketM3: number;
  cycleS: number;
  operatingMassT?: number;
  sources: Source[];
  estimated: string[];
}

export type UnitKind = 'truck' | 'loader' | 'dozer' | 'wheelDozer' | 'grader' | 'waterCart' | 'lv' | 'other';

export interface FleetUnit {
  id: string;              // 'EX09', 'DT124'
  modelId: Id;
  kind: UnitKind;
  ownership: 'own' | 'hire';
  /** Mechanical availability 0..1. */
  availability: number;
  /** False when the unit is parked / not planned this shift (default true). */
  active?: boolean;
  notes?: string;
}

/** Per-loader site assumptions (the spreadsheet's EXCAVATOR ASSUMPTIONS block). */
export interface LoaderAssumptions {
  unitId: string;
  dumpS: number;
  spotS: number;
  loadS: number;
  plannedRateBcmPerPtHr: number;
  /** Planned PT hours/day for this loader ('perfect day', dry). */
  ptHrsPerDay: number;
}

// ─────────────────────────────────────────────────────────────── Circuits

export type SpeedModel = 'spreadsheet' | 'rimpull';

export interface CircuitParams {
  haulEff: number;               // haul efficiency factor applied to travel time (0.85)
  stopSigns: number;             // stop signs per cycle, incl. return
  stopPenaltyS: number;          // seconds per stop sign (incl. decel/accel) - spreadsheet: 60
  spotS: number;
  loadS: number;
  dumpS: number;
  truckLoadBcm: number;
  plannedRateBcmPerPtHr: number; // loader planned dig rate
  truckPtHrsPerDay: number;      // truck production hours/day (spreadsheet C22 = 20)
  desiredDailyBcm: number;
  rrPct: number;                 // default rolling resistance %
  speedLimitKmh: number;         // global speed cap
  speedModel: SpeedModel;
  shiftsPerDay: number;          // 2

  // ── optional engine options (defaults in parentheses) ──
  /** Spreadsheet mode, |ROUND(grade,2)| > 0.16: 'drop' = Excel behaviour, segment time 0 ('drop'); 'clamp' = steepest row. */
  outOfRange?: 'drop' | 'clamp';
  /** Rimpull mode: kinematic forward–backward accel/decel pass with real stops, or steady balance speed ('kinematic'). */
  motion?: 'kinematic' | 'steady';
  /** Production model per truck count: workbook deterministic, finite-source M/M/1//N, or binomial ('deterministic'). */
  queueModel?: 'deterministic' | 'mm1n' | 'binomial';
  /** Loader target PT h/day (defaults to truckPtHrsPerDay - the workbook's I34 feeds both). */
  loaderPtHrsPerDay?: number;
  /** Kinematic: max operator acceleration, m/s² (0.6). */
  accelMaxMs2?: number;
  /** Kinematic: planning deceleration loaded / empty, m/s² (0.6 / 0.8). */
  decelLoadedMs2?: number;
  decelEmptyMs2?: number;
  /** Kinematic: tyre–road traction coefficient μ (0.5). */
  tractionCoeff?: number;
  /** Kinematic: dwell at a modelled stop sign, s (5). */
  stopDwellS?: number;
}

export interface Circuit {
  id: Id;
  name: string;                  // 'EX09 OB → S51 West'
  loaderUnitId: string;          // 'EX09'
  loaderModelId: Id;
  truckModelId: Id;
  materialId: MaterialId;
  haulStringId?: Id;
  /** Alternative routes (long / short haul options) considered by the priority planner. */
  altHaulStringIds?: Id[];
  digId?: Id;
  dumpId?: Id;
  /** Trucks deliberately assigned (may be over- or under-trucked). */
  trucks: number;
  /** 1 = highest priority. */
  priority: number;
  active: boolean;
  params: CircuitParams;
  color: string;
  tags?: string[];
}

// ─────────────────────────────────────────────────────────────── Calculation results (engine output)

export type CalcGroup = 'route' | 'travel' | 'cycle' | 'productivity' | 'fleet' | 'loader' | 'manning' | 'priority' | 'shift';

/** One transparent calculation step - rendered verbatim on the Assumptions tab. */
export interface CalcStep {
  id: string;
  group: CalcGroup;
  label: string;
  /** Symbolic formula, e.g. "Haul time = (T_loaded + T_empty) / η". */
  formula: string;
  /** The same with numbers substituted, e.g. "(171.6 + 163.9) / 0.85". */
  substituted?: string;
  value: number;
  unit: string;
  inputs?: { label: string; value: number | string; unit?: string; source?: string }[];
  /** Spreadsheet cell this mirrors, e.g. "ActiveRoute!C7". */
  sheetRef?: string;
  note?: string;
}

export type LimitReason = 'rimpull' | 'retarder' | 'speed-limit' | 'top-speed' | 'table' | 'table-out-of-range';

export interface SegmentResult {
  i: number;
  from: Vec3;
  to: Vec3;
  chainageM: number;        // cumulative 3D distance at segment start
  dist3dM: number;
  distPlanM: number;
  /** dZ / dist3d in the loaded direction (spreadsheet convention). */
  grade: number;
  rrPct: number;
  effGradeLoaded: number;   // grade + rr
  effGradeEmpty: number;    // -grade + rr
  speedLoadedKmh: number;
  speedEmptyKmh: number;
  timeLoadedS: number;
  timeEmptyS: number;
  limitLoaded: LimitReason;
  limitEmpty: LimitReason;
  speedLimitKmh: number;
  zone?: SegmentZone;
}

export type TruckingStatus = 'under' | 'balanced' | 'over';

/** One row of the "# trucks" chooser (the spreadsheet's row-28 tick boxes, generalised). */
export interface FleetOption {
  trucks: number;
  /** Production the trucks can haul per day at their PT hours (bcm/day). */
  truckCapacityBcmDay: number;
  /** Production actually achieved = min(truck capacity, loader capacity) (bcm/day). */
  bcmPerDay: number;
  /** Loader PT hours/day achieved. */
  loaderPtHrsDay: number;
  /** Loader PT lost per shift vs its target because of too few trucks (hang time). */
  lostLoaderPtHrsShift: number;
  /** Truck hours lost per shift queuing because of too many trucks. */
  truckQueueHrsShift: number;
  matchFactor: number;
  loaderUtil: number;
  status: TruckingStatus;
}

export interface CircuitResult {
  circuitId: Id;
  ok: boolean;
  error?: string;
  speedModel: SpeedModel;
  segments: SegmentResult[];
  lengthM: number;
  riseM: number;
  fallM: number;
  travelLoadedS: number;
  travelEmptyS: number;
  haulTimeS: number;          // (loaded + empty) / η
  stopsS: number;
  cycleS: number;
  cycleMin: number;
  truckProdBcmPerPtHr: number;
  truckHoursReq: number;
  trucksExact: number;
  trucksRecommended: number;
  loaderPtHrs: number;
  /** At the assigned number of trucks. */
  lostPtHrsShift: number;
  assigned: FleetOption;
  options: FleetOption[];
  steps: CalcStep[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────── Crew / manning

export type CrewRole =
  | 'truck' | 'excavator' | 'loader' | 'pushDozer' | 'dumpDozer' | 'coalDozer' | 'wheelDozer'
  | 'waterCart' | 'grader' | 'supervisor' | 'oce' | 'utility' | 'other';

export type RuleScope = 'site' | 'per-circuit' | 'per-active-loader' | 'per-material' | 'per-dump' | 'per-truck';

export interface CrewRuleCondition {
  materialIds?: MaterialId[];
  loaderTypes?: LoaderType[];
  loaderUnitIds?: string[];
  minTrucks?: number;
  tags?: string[];
}

export interface CrewRule {
  id: Id;
  name: string;
  enabled: boolean;
  scope: RuleScope;
  when?: CrewRuleCondition;
  role: CrewRole;
  /** People required each time the rule fires. */
  count: number;
  /** For per-truck style rules: one person per N units (ceil). */
  perUnits?: number;
  note?: string;
  /** Mirrors a spreadsheet cell / rule, for transparency. */
  sheetRef?: string;
  /**
   * People per firing as an expression, replacing `count` (workbook bulk-push rule). Tiny language: numbers, + − * /,
   * comparisons, && || !, parentheses, max/min/ceil/floor/abs/if(c,a,b) and identifiers totals.trucks · totals.circuits ·
   * totals.activeLoaders · fleet.trucksAvailable · params.<name> · roles.<role> · rules.<ruleId> · circuit.trucks · circuit.priority.
   */
  expr?: string;
  /** Extra gate in the same language; the rule fires only when it evaluates truthy. */
  whenExpr?: string;
  params?: Record<string, number>;
  /** Site-task priority (1 = highest): the priority planner sheds such a role like a circuit, lowest first. */
  priority?: number;
  /** Production per person on this rule, bcm/day (lost-production reporting when shed). */
  bcmPerUnitDay?: number;
}

export interface ShiftCrew {
  id: Id;
  name: string;              // 'A Crew – Day'
  available: number;         // total operators on shift
  /** Optional cap per role (tickets / licences). */
  byRole?: Partial<Record<CrewRole, number>>;
}

export interface ManningLine {
  circuitId?: Id;
  role: CrewRole;
  count: number;
  ruleId: Id;
  reason: string;
}

export interface ManningResult {
  required: Record<CrewRole, number>;
  total: number;
  available: number;
  surplus: number;           // negative = shortfall
  lines: ManningLine[];
  steps: CalcStep[];
}

// ─────────────────────────────────────────────────────────────── Priority planner

export interface PriorityAllocation {
  circuitId: Id;
  priority: number;
  requestedTrucks: number;
  allocatedTrucks: number;
  crewRequested: number;
  crewAllocated: number;
  status: 'full' | 'reduced' | 'parked';
  bcmDayPlanned: number;
  bcmDayAchieved: number;
  bcmDayLost: number;
  lostPtHrsShift: number;
  /** Alternative haul options evaluated for a reduced/parked circuit. */
  alternatives: { haulStringId: Id; name: string; trucksNeeded: number; bcmDay: number; deltaBcmDay: number }[];
}

/** A prioritised site task (a crew rule with a priority, e.g. bulk push dozers) planned like a circuit. */
export interface PriorityTask {
  ruleId: Id;
  name: string;
  priority: number;
  requested: number;
  allocated: number;
  bcmDayLost: number;
}

export interface PriorityResult {
  crewAvailable: number;
  crewUsed: number;
  trucksAvailable: number;
  trucksUsed: number;
  allocations: PriorityAllocation[];
  narrative: string[];
  steps: CalcStep[];
  tasks?: PriorityTask[];
  crewRequired?: number;
  bcmDayPlanned?: number;
  bcmDayAchieved?: number;
  warnings?: string[];
}

// ─────────────────────────────────────────────────────────────── Shift / time

export type ShiftEventKind = 'prestart' | 'crib' | 'fuel' | 'changeover' | 'blast' | 'other';

export interface ShiftEvent {
  id: Id;
  label: string;
  kind: ShiftEventKind;
  startMin: number;          // minutes after shift start
  durMin: number;
  /** Fraction of fleet stopped during the event (1 = all stop, 0.5 = hot-seat/staggered). */
  fleetStopFraction: number;
}

export interface ShiftProfile {
  name: string;              // 'Day shift'
  startHour: number;         // 6 = 06:00
  lengthH: number;           // 12
  events: ShiftEvent[];
}

/** Production state at a moment in the shift (drives the depletion slider). */
export interface ShiftState {
  tMin: number;              // minutes after shift start
  clock: string;             // '09:30'
  productiveFraction: number;    // cumulative productive minutes / shift productive minutes
  activeEvent?: ShiftEvent;
  perCircuit: { circuitId: Id; bcmSoFar: number; bcmShift: number; digFraction: number; dumpFraction: number; loads: number }[];
}

// ─────────────────────────────────────────────────────────────── Scenario (the saved document)

export interface SiteInfo {
  name: string;
  /** Local origin subtracted for rendering precision (world → scene). */
  origin: Vec3;
  crs?: string;              // 'GDA2020 / MGA zone 56'
}

export interface ScenarioSettings {
  verticalExaggeration: number;
  contourIntervalM: number;
  theme: 'light' | 'dark' | 'system';
  showGradeColours: boolean;
}

export interface Scenario {
  schema: 'haiul-sim/scenario@1';
  id: Id;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  site: SiteInfo;
  assets: MeshAsset[];
  strings: HaulString[];
  circuits: Circuit[];
  materials: Material[];
  fleet: {
    trucks: TruckModel[];
    loaders: LoaderModel[];
    units: FleetUnit[];
    loaderAssumptions: LoaderAssumptions[];
    /** Trucks available to operate (after availability), the spreadsheet's 'balance to 12'. */
    trucksAvailable: number;
  };
  crew: {
    rules: CrewRule[];
    shifts: ShiftCrew[];
    activeShiftId: Id;
  };
  shift: ShiftProfile;
  settings: ScenarioSettings;
}

/** Lightweight listing entry for the scenario library. */
export interface ScenarioMeta {
  id: Id;
  name: string;
  description?: string;
  updatedAt: string;
  circuits: number;
  strings: number;
  assets: number;
  thumbnail?: string;        // data URL
}
