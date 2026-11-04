/**
 * A small synthetic scenario mirroring the workbook's plan week (EX09 / EX04 / LDR1 with 5 / 4 / 3 trucks, EX06
 * parked, 14 trucks @ ~85 % = 12 available, crew rules R1-R10). Used by unit tests and by the dev harness until the
 * real demo (createDemoScenario) is available. Pure TS - no DOM.
 */
import type {
  Circuit, CircuitParams, FleetUnit, GradeSpeedPoint, HaulString, LoaderModel, Scenario, ShiftCrew, StringPoint, TruckModel,
} from '@/core/types';
import { workbookRules } from '@/features/manning/rules';

const T0 = '2026-11-04T00:00:00.000Z';

/** The workbook's grade → speed tables (spec 01 §5.3). */
function speedTable(loaded: boolean): GradeSpeedPoint[] {
  const out: GradeSpeedPoint[] = [];
  for (let i = -16; i <= 16; i++) {
    const g = i / 100, a = Math.abs(i);
    const v = a <= 5 ? 30 : a <= 7 ? 20 : loaded ? 12 : 14;
    out.push([g, v]);
  }
  return out;
}

interface Leg { len: number; grade: number; az: number; stop?: boolean }

/** Build a haul string from legs (slope length m, grade = dZ / slope length, plan azimuth deg) with ~25 m points. */
function buildString(id: string, name: string, color: string, start: [number, number, number], legs: Leg[], digId?: string, dumpId?: string): HaulString {
  const pts: StringPoint[] = [];
  let [e, n, z] = start;
  let k = 0;
  pts.push({ id: `${id}_p${k++}`, e, n, z, snapped: true });
  for (const leg of legs) {
    const steps = Math.max(1, Math.round(leg.len / 25));
    const d = leg.len / steps;
    const dz = d * leg.grade;
    const plan = Math.sqrt(Math.max(0, d * d - dz * dz));
    const a = (leg.az * Math.PI) / 180;
    for (let i = 0; i < steps; i++) {
      e += plan * Math.sin(a); n += plan * Math.cos(a); z += dz;
      pts.push({ id: `${id}_p${k++}`, e: +e.toFixed(3), n: +n.toFixed(3), z: +z.toFixed(3), snapped: true, stop: leg.stop && i === steps - 1 ? true : undefined });
    }
  }
  return { id, name, color, points: pts, digId, dumpId, source: 'demo', visible: true, createdAt: T0, updatedAt: T0 };
}

const params = (p: Partial<CircuitParams>): CircuitParams => ({
  haulEff: 0.85, stopSigns: 2, stopPenaltyS: 60, spotS: 30, loadS: 110, dumpS: 60, truckLoadBcm: 104, plannedRateBcmPerPtHr: 1800,
  truckPtHrsPerDay: 20, desiredDailyBcm: 36000, rrPct: 2, speedLimitKmh: 60, speedModel: 'spreadsheet', shiftsPerDay: 2, ...p,
});

function truckModel(id: string, name: string, make: string, model: string, payloadT: number, ob: number, cl: number, color: string): TruckModel {
  return {
    id, name, make, model, drive: 'mechanical', emptyMassT: 140, payloadT, gvwT: 140 + payloadT, enginePowerKW: 1566, topSpeedKmh: 60,
    rimpull: [[0, 900], [10, 500], [20, 260], [40, 120], [60, 80]], retarder: [[0, 0], [10, 900], [30, 600], [60, 300]],
    loadBcmByMaterial: { OB: ob, CL: cl }, spreadsheetSpeeds: { loaded: speedTable(true), empty: speedTable(false) },
    dims: { length: 12.2, width: 7.7, height: 6.2, eyeHeight: 5.1 }, color, sources: [{ title: 'Synthetic test fixture' }], estimated: ['rimpull', 'retarder'],
  };
}

function loaderModel(id: string, name: string, make: string, model: string, type: LoaderModel['type'], bucketM3: number, cycleS: number, classLabel: string): LoaderModel {
  return { id, name, make, model, type, bucketM3, cycleS, classLabel, sources: [{ title: 'Synthetic test fixture' }], estimated: [] };
}

export function syntheticScenario(): Scenario {
  const strings: HaulString[] = [
    buildString('hs_ex09', 'EX09 B7-9 OB → RL282', '#0A6FE6', [236000, 7051000, 230], [
      { len: 300, grade: 0, az: 80 }, { len: 650, grade: 0.08, az: 20 }, { len: 1100, grade: 0, az: 95, stop: true }, { len: 300, grade: 0, az: 140 },
    ], 'dig_b79', 'dump_rl282'),
    buildString('hs_ex09_short', 'EX09 B8-10 OB → T-Bridge RL295 (short haul)', '#4C95FF', [236000, 7051000, 230], [
      { len: 300, grade: 0, az: 80 }, { len: 400, grade: 0.08, az: 20 }, { len: 600, grade: 0, az: 60 },
    ], 'dig_b79'),
    buildString('hs_ex09_long', 'EX09 B8-10 OB → T-Bridge RL340 (long haul)', '#5B6B7F', [236000, 7051000, 230], [
      { len: 300, grade: 0, az: 80 }, { len: 650, grade: 0.08, az: 20 }, { len: 400, grade: 0.06, az: 40 }, { len: 1800, grade: 0, az: 95 },
    ], 'dig_b79'),
    buildString('hs_ex04', 'EX04 B10-B07 OB → RL325', '#B8692E', [235200, 7050600, 240], [
      { len: 200, grade: 0, az: 300 }, { len: 500, grade: 0.10, az: 330 }, { len: 60, grade: 0.11, az: 340 }, { len: 350, grade: 0.08, az: 350 },
      { len: 900, grade: 0, az: 270, stop: true },
    ], 'dig_b107', 'dump_rl325'),
    buildString('hs_ex04_west', 'EX04 B07-B10 OB → western RL325 (long haul)', '#D9914F', [235200, 7050600, 240], [
      { len: 200, grade: 0, az: 300 }, { len: 500, grade: 0.10, az: 330 }, { len: 60, grade: 0.11, az: 340 }, { len: 350, grade: 0.08, az: 350 },
      { len: 1700, grade: 0, az: 250 },
    ], 'dig_b107'),
    buildString('hs_ldr1', 'LDR1 B6-7 MA coal → ROM', '#3E8A5A', [236400, 7050200, 200], [
      { len: 400, grade: 0, az: 120 }, { len: 6, grade: 0.18, az: 120 }, { len: 1100, grade: 0.08, az: 60 }, { len: 1650, grade: 0, az: 10, stop: true },
    ], 'dig_b67', 'dump_rom'),
    buildString('hs_ldr1_b104', 'LDR1 B104 MA coal → ROM (short haul)', '#5DB27E', [236400, 7050200, 200], [
      { len: 250, grade: 0, az: 120 }, { len: 1100, grade: 0.08, az: 60 }, { len: 1100, grade: 0, az: 10 },
    ], 'dig_b104', 'dump_rom'),
  ];

  const trucks = [
    truckModel('cat789d', 'CAT 789D', 'Caterpillar', '789D', 181.9, 104, 100, '#E8B40C'),
    truckModel('kom1500', 'KOM HD1500-8', 'Komatsu', 'HD1500-8', 144, 89, 100, '#F2C744'),
  ];
  const loaders = [
    loaderModel('ex5600', 'HIT EX5600', 'Hitachi', 'EX5600-7', 'excavator', 34, 30, '550-ton class'),
    loaderModel('pc4000', 'KOM PC4000', 'Komatsu', 'PC4000-11', 'excavator', 22, 30, '400-ton class'),
    loaderModel('ex2600', 'HIT EX2600', 'Hitachi', 'EX2600-7', 'excavator', 15, 30, '250-ton class'),
    loaderModel('wa900', 'KOM WA900', 'Komatsu', 'WA900-8', 'loader', 13, 40, '100-ton class'),
    loaderModel('r9150', 'LIEB R9150', 'Liebherr', 'R9150', 'excavator', 8, 28, '50-ton class'),
  ];

  const u = (id: string, modelId: string, kind: FleetUnit['kind'], ownership: FleetUnit['ownership'], availability: number, notes?: string): FleetUnit =>
    ({ id, modelId, kind, ownership, availability, notes });
  const units: FleetUnit[] = [
    u('EX09', 'ex5600', 'loader', 'own', 0.9), u('EX04', 'pc4000', 'loader', 'own', 0.88), u('EX06', 'ex2600', 'loader', 'hire', 0.86, 'Dozer-push assist'),
    u('LDR1', 'wa900', 'loader', 'own', 0.9), u('LDR2', 'wa900', 'loader', 'own', 0.84),
    u('EX03', 'r9150', 'loader', 'hire', 0.92, 'Coal support EX'), u('EX08', 'r9150', 'loader', 'own', 0.9, 'Coal support EX (backup)'),
    ...['DT101', 'DT102', 'DT103', 'DT104', 'DT105', 'DT106', 'DT107', 'DT108'].map(id => u(id, 'cat789d', 'truck', 'own', 0.92)),
    ...['DT109', 'DT110', 'DT111'].map(id => u(id, 'cat789d', 'truck', 'hire', 0.85)),
    ...['DT121', 'DT122', 'DT123'].map(id => u(id, 'kom1500', 'truck', 'hire', 0.82)),
    ...['DZ201', 'DZ202', 'DZ203', 'DZ204'].map(id => u(id, 'CAT D11T', 'dozer', 'own', 0.88)),
    ...['DZ205', 'DZ206', 'DZ207'].map(id => u(id, 'KOM D475A-8', 'dozer', 'hire', 0.86)),
    ...['DZ208', 'DZ209'].map(id => u(id, 'KOM D375A-8', 'dozer', 'own', 0.87)),
    ...['DZ210', 'DZ211', 'DZ212', 'DZ213'].map(id => u(id, 'CAT D10T2', 'dozer', 'own', 0.9)),
    u('WD301', 'CAT 854K', 'wheelDozer', 'own', 0.9),
    u('GR401', 'CAT 24M', 'grader', 'own', 0.9), u('GR402', 'CAT 16M3', 'grader', 'hire', 0.88),
    u('WC601', 'CAT 785 WT', 'waterCart', 'own', 0.9), u('WC602', 'CAT 777 WT', 'waterCart', 'hire', 0.86),
  ];

  const circuits: Circuit[] = [
    { id: 'c_ex09', name: 'EX09 OB → RL282', loaderUnitId: 'EX09', loaderModelId: 'ex5600', truckModelId: 'cat789d', materialId: 'OB',
      haulStringId: 'hs_ex09', altHaulStringIds: ['hs_ex09_short', 'hs_ex09_long'], digId: 'dig_b79', dumpId: 'dump_rl282',
      trucks: 5, priority: 1, active: true, params: params({}), color: '#0A6FE6', tags: ['prestrip'] },
    { id: 'c_ex04', name: 'EX04 OB → RL325', loaderUnitId: 'EX04', loaderModelId: 'pc4000', truckModelId: 'cat789d', materialId: 'OB',
      haulStringId: 'hs_ex04', altHaulStringIds: ['hs_ex04_west'], digId: 'dig_b107', dumpId: 'dump_rl325',
      trucks: 4, priority: 2, active: true, params: params({ loadS: 116, plannedRateBcmPerPtHr: 1300, desiredDailyBcm: 26000 }), color: '#B8692E' },
    { id: 'c_ldr1', name: 'LDR1 coal → ROM', loaderUnitId: 'LDR1', loaderModelId: 'wa900', truckModelId: 'cat789d', materialId: 'CL',
      haulStringId: 'hs_ldr1', altHaulStringIds: ['hs_ldr1_b104'], digId: 'dig_b67', dumpId: 'dump_rom',
      trucks: 3, priority: 3, active: true,
      params: params({ loadS: 245, plannedRateBcmPerPtHr: 650, desiredDailyBcm: 11700, truckLoadBcm: 100, truckPtHrsPerDay: 18 }), color: '#3E8A5A', tags: ['coal'] },
    { id: 'c_ex06', name: 'EX06 OB → RL336', loaderUnitId: 'EX06', loaderModelId: 'ex2600', truckModelId: 'kom1500', materialId: 'OB',
      haulStringId: 'hs_ex04_west', trucks: 0, priority: 4, active: false,
      params: params({ loadS: 155, plannedRateBcmPerPtHr: 900, desiredDailyBcm: 18000, truckLoadBcm: 89 }), color: '#7B5EA7' },
  ];

  const shifts: ShiftCrew[] = [
    { id: 'sh_a', name: 'A Crew – Day', available: 34, byRole: { truck: 12, oce: 1 } },
    { id: 'sh_b', name: 'B Crew – Night', available: 36 },
    { id: 'sh_c', name: 'C Crew – Day', available: 28, byRole: { excavator: 3 } },
    { id: 'sh_d', name: 'D Crew – Night', available: 32 },
  ];

  return {
    schema: 'haiul-sim/scenario@1',
    id: 'scn_synthetic',
    name: 'Synthetic – workbook plan week',
    description: 'EX09 / EX04 / LDR1 at 5 / 4 / 3 trucks (12 operating), EX06 parked. Mirrors Targets & Haulage Priorities.',
    createdAt: T0, updatedAt: T0,
    site: { name: 'Synthetic pit', origin: [236000, 7051000, 250], crs: 'GDA2020 / MGA zone 56' },
    assets: [],
    strings,
    circuits,
    materials: [
      { id: 'OB', name: 'Overburden', bankDensity: 2.3, swell: 1.3, color: '#C79A6B' },
      { id: 'CL', name: 'Coal', bankDensity: 1.35, swell: 1.25, color: '#2E3238' },
    ],
    fleet: {
      trucks, loaders, units,
      loaderAssumptions: [
        { unitId: 'EX09', dumpS: 60, spotS: 30, loadS: 110, plannedRateBcmPerPtHr: 1800, ptHrsPerDay: 20 },
        { unitId: 'EX04', dumpS: 60, spotS: 30, loadS: 116, plannedRateBcmPerPtHr: 1300, ptHrsPerDay: 20 },
        { unitId: 'EX06', dumpS: 60, spotS: 30, loadS: 155, plannedRateBcmPerPtHr: 900, ptHrsPerDay: 20 },
        { unitId: 'LDR1', dumpS: 60, spotS: 30, loadS: 245, plannedRateBcmPerPtHr: 650, ptHrsPerDay: 18 },
      ],
      trucksAvailable: 12,
    },
    crew: { rules: workbookRules(), shifts, activeShiftId: 'sh_a' },
    shift: {
      name: 'Day shift', startHour: 6, lengthH: 12,
      events: [
        { id: 'ev_pre', label: 'Prestart', kind: 'prestart', startMin: 0, durMin: 20, fleetStopFraction: 1 },
        { id: 'ev_crib', label: 'Crib (hot seat)', kind: 'crib', startMin: 300, durMin: 30, fleetStopFraction: 0.5 },
        { id: 'ev_fuel', label: 'Fuel', kind: 'fuel', startMin: 420, durMin: 20, fleetStopFraction: 0.25 },
        { id: 'ev_co', label: 'Changeover', kind: 'changeover', startMin: 700, durMin: 20, fleetStopFraction: 1 },
      ],
    },
    settings: { verticalExaggeration: 1.5, contourIntervalM: 5, theme: 'light', showGradeColours: true },
  };
}
