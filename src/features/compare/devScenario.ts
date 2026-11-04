/**
 * DEV-ONLY synthetic scenario for the analytics harness (harness.html). Never imported by the views.
 *
 * Built from the user's own workbook fixtures (docs/spec/fixtures) so the ledger can be checked against the
 * Haulage Calculator: circuit 1 is the current Data Dump string "EX09 - B7-9 to RL282" (117 points) with the
 * exact ActiveRoute inputs, so ActiveRoute!C4…C28 must reproduce (C4 171.567 s, C7 394.71 s, C24 3.436).
 * Used until '@/state/demo' createDemoScenario() returns circuits (geometry + data agents).
 */
import type {
  Circuit, CircuitParams, CurvePoint, GradeSpeedPoint, HaulString, LoaderAssumptions, LoaderModel, Material, Scenario, TruckModel,
} from '@/core/types';
import { emptyScenario } from '@/state/store';
import oem from '../../../docs/spec/fixtures/oem-curves.json';
import tables from '../../../docs/spec/fixtures/spreadsheet-tables.json';
import raw from '../../../docs/spec/fixtures/raw-data-strings.json';

type OemTruck = (typeof oem.trucks)[number];

const MAKE: Record<string, string> = { Caterpillar: 'CAT', Komatsu: 'KOM' };

function mergeCurves(curves: { points: number[][] }[]): CurvePoint[] {
  const pts = curves.flatMap(c => c.points.map(p => [p[0], p[1]] as CurvePoint)).sort((a, b) => a[0] - b[0]);
  const out: CurvePoint[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9) last[1] = Math.max(last[1], p[1]);
    else out.push([p[0], p[1]]);
  }
  return out;
}

function speedTable(kind: 'loaded' | 'unloaded'): GradeSpeedPoint[] {
  const t = (tables.speed_tables as unknown as Record<string, { rows: { grade: number; max_speed_kmh: number }[] }>)[kind];
  return t.rows.map(r => [r.grade, r.max_speed_kmh] as GradeSpeedPoint);
}

function truckFrom(t: OemTruck): TruckModel {
  const load: Record<string, number> = t.model.startsWith('789') ? { OB: 104, CL: 100 } : t.model.startsWith('HD1500') ? { OB: 89, CL: 100 } : {
    OB: +(t.mass.nominal_payload_t / 1.75).toFixed(0), CL: +(t.mass.nominal_payload_t / 1.27).toFixed(0),
  };
  const est = Object.entries(t.estimated as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k);
  return {
    id: t.id,
    name: `${MAKE[t.make] ?? t.make} ${t.model}`,
    make: t.make,
    model: t.model,
    drive: t.drive as TruckModel['drive'],
    emptyMassT: t.mass.empty_t,
    payloadT: t.mass.nominal_payload_t,
    gvwT: t.mass.gvw_max_t,
    enginePowerKW: (t.engine as { net_kW: number | null }).net_kW ?? t.engine.gross_kW,
    topSpeedKmh: t.transmission.top_speed_kmh,
    gears: (t.transmission.gears as { gear: number; max_kmh: number }[]).map(g => ({ gear: g.gear, maxKmh: g.max_kmh })),
    rimpull: (t.rimpull.envelope as number[][]).map(p => [p[0], p[1]] as CurvePoint),
    retarder: mergeCurves(t.retarder.curves as { points: number[][] }[]),
    bodyHeapedM3: (t.body as { default_heaped_m3?: number }).default_heaped_m3,
    loadBcmByMaterial: load,
    spreadsheetSpeeds: { loaded: speedTable('loaded'), empty: speedTable('unloaded') },
    dims: { length: 14.6, width: 7.7, height: 6.4, eyeHeight: 5.0, tyre: t.tyre },
    color: '#E8B620',
    sources: (t.sources as { field: string; url: string }[]).map(s => ({ title: s.field, url: s.url })),
    estimated: [...est, 'dims'],
  };
}

function stringFrom(id: string, name: string, color: string): HaulString {
  const r = (raw.strings as { id: string; points: number[][] }[]).find(s => s.id === id)!;
  return {
    id: `hs-${id}`, name, color, source: 'imported', visible: true, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
    points: r.points.map((p, i) => ({ id: `${id}-${i}`, e: p[0], n: p[1], z: p[2] })),
  };
}

const EX = (tables.excavator_assumptions as unknown as { excavators: Record<string, { model: string; dump_time_s: number; spot_time_s: number; loading_time_s: number; planned_rate_bcm_per_pt_hr: number }> }).excavators;

function params(unit: string, p: Partial<CircuitParams>): CircuitParams {
  const ex = EX[unit];
  return {
    haulEff: 0.85, stopSigns: 2, stopPenaltyS: 60, spotS: ex.spot_time_s, loadS: ex.loading_time_s, dumpS: ex.dump_time_s,
    truckLoadBcm: 104, plannedRateBcmPerPtHr: ex.planned_rate_bcm_per_pt_hr, truckPtHrsPerDay: 20,
    desiredDailyBcm: ex.planned_rate_bcm_per_pt_hr * 20, rrPct: 2.5, speedLimitKmh: 60, speedModel: 'spreadsheet', shiftsPerDay: 2, ...p,
  };
}

export function buildDevScenario(variant: 0 | 1 | 2 = 0): Scenario {
  const s = emptyScenario(['Week 45 – base plan', 'Week 45 – EX04 long haul', 'Week 45 – 789D swap'][variant]);
  s.id = `dev-scn-${variant}`;
  s.description = 'Analytics harness fixture built from the Haulage Calculator workbook strings.';
  s.site = { name: 'Bowen Basin strip pit (fixture)', origin: [236000, 7051000, 280], crs: 'GDA2020 / MGA zone 56' };
  const materials: Material[] = [
    { id: 'OB', name: 'Overburden', bankDensity: 1.75, swell: 1.2, color: 'var(--mat-ob)' },
    { id: 'CL', name: 'Coal', bankDensity: 1.27, swell: 1.2, color: 'var(--mat-coal)' },
  ];
  const trucks = oem.trucks.map(truckFrom);
  const loaders: LoaderModel[] = Object.entries(EX).map(([unit, e]) => ({
    id: `ldr-${unit}`, name: e.model.split(' (')[0], make: e.model.split(' ')[0], model: e.model.split(' ')[1] ?? '', type: unit === 'LDR' ? 'loader' : 'excavator',
    classLabel: /\(([^)]+)\)/.exec(e.model)?.[1], bucketM3: 30, cycleS: 30, sources: [{ title: 'Haulage Calculator ActiveRoute!H2:J34' }], estimated: ['bucketM3', 'cycleS'],
  }));
  const loaderAssumptions: LoaderAssumptions[] = Object.entries(EX).map(([unit, e]) => ({
    unitId: unit, dumpS: e.dump_time_s, spotS: e.spot_time_s, loadS: e.loading_time_s, plannedRateBcmPerPtHr: e.planned_rate_bcm_per_pt_hr, ptHrsPerDay: unit === 'LDR' ? 18 : 20,
  }));
  const strings = [
    stringFrom('ex09-b7-9-to-rl282', 'EX09 B7-9 → RL282', '#0A6FE6'),
    stringFrom(variant === 1 ? 'ex04-b07-b10-ob-to-rl325-dump-hauling-west-to-western-rl325-dump' : 'ex04-b10-b07-ob-to-rl325-dump-2', variant === 1 ? 'EX04 B07-B10 → RL325 West' : 'EX04 B10-B07 → RL325', '#B8692E'),
    stringFrom('ldr-b6-7-ma-coal-to-rom', 'LDR B6-7 MA coal → ROM', '#3E8A5A'),
    stringFrom('ex07-s51-haul-east-from-mid-point-option-1-short-haul', 'EX07 S51 East short haul', '#7B5EA7'),
    stringFrom('ex07-s51-haul-east-from-mid-point-option-2-long-haul', 'EX07 S51 East long haul', '#7B5EA7'),
  ];
  const t789 = variant === 2 ? 'CAT_789D' : 'CAT_789C';
  const mk = (id: string, name: string, unit: string, truck: string, mat: string, hs: string, n: number, prio: number, color: string, p: Partial<CircuitParams>): Circuit => ({
    id, name, loaderUnitId: unit, loaderModelId: `ldr-${unit}`, truckModelId: truck, materialId: mat, haulStringId: hs, trucks: n, priority: prio, active: true,
    params: params(unit, p), color,
  });
  s.circuits = [
    mk('c-ex09', 'EX09 OB → RL282', 'EX09', 'CAT_789D', 'OB', strings[0].id, 3, 1, 'var(--c1)', { desiredDailyBcm: 36000 }),
    mk('c-ex04', variant === 1 ? 'EX04 OB → RL325 West' : 'EX04 OB → RL325', 'EX04', 'KOM_HD1500_7', 'OB', strings[1].id, variant === 1 ? 5 : 3, 2, 'var(--c2)', { truckLoadBcm: 89, desiredDailyBcm: 26000 }),
    mk('c-ldr', 'LDR coal → ROM', 'LDR', t789, 'CL', strings[2].id, 3, 3, 'var(--c3)', { truckLoadBcm: 100, desiredDailyBcm: 11700, truckPtHrsPerDay: 18, stopSigns: 3 }),
    mk('c-ex07', 'EX07 OB → S51 East', 'EX07', t789, 'OB', strings[3].id, 4, 4, 'var(--c4)', { desiredDailyBcm: 36000, speedModel: 'rimpull' }),
  ];
  s.circuits[3].altHaulStringIds = [strings[4].id];
  s.strings = strings;
  s.materials = materials;
  s.fleet = {
    trucks, loaders,
    units: [
      ...Object.keys(EX).map(u => ({ id: u, modelId: `ldr-${u}`, kind: (u === 'LDR' ? 'loader' : 'loader') as 'loader', ownership: 'own' as const, availability: 0.9 })),
      ...Array.from({ length: 14 }, (_, i) => ({ id: `DT${120 + i}`, modelId: i < 8 ? 'CAT_789D' : i < 11 ? 'CAT_789C' : 'KOM_HD1500_7', kind: 'truck' as const, ownership: (i < 8 ? 'own' : 'hire') as 'own' | 'hire', availability: 0.85 })),
    ],
    loaderAssumptions,
    trucksAvailable: 12,
  };
  s.shift = {
    name: 'Day shift', startHour: 6, lengthH: 12,
    events: [
      { id: 'ev-pre', label: 'Shift change & prestart', kind: 'prestart', startMin: 0, durMin: 30, fleetStopFraction: 1 },
      { id: 'ev-crib1', label: 'Crib (staggered)', kind: 'crib', startMin: 330, durMin: 30, fleetStopFraction: 0.5 },
      { id: 'ev-fuel', label: 'Fuelling (rolling)', kind: 'fuel', startMin: 240, durMin: 60, fleetStopFraction: 0.15 },
      { id: 'ev-blast', label: 'Blast clearance', kind: 'blast', startMin: 390, durMin: 45, fleetStopFraction: 0.6 },
      { id: 'ev-end', label: 'End-of-shift park-up', kind: 'changeover', startMin: 690, durMin: 30, fleetStopFraction: 0.7 },
    ],
  };
  return s;
}
