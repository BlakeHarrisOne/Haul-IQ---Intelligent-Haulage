/**
 * DEV HARNESS ONLY - a scenario for exercising the haulage panels before the shell is wired.
 * Uses createDemoScenario() (demo site + data module when present) and fills any gaps (fleet, circuits) with a
 * small fleet built from the workbook tables, plus the workbook's real 117-point "EX09 - B7-9 to RL282" string
 * (it has 4 segments steeper than ±16 %, which exercises the spreadsheet-drop flags).
 */
import type { Circuit, HaulString, LoaderModel, Scenario, TruckModel, FleetUnit, LoaderAssumptions, StringPoint, GradeSpeedPoint } from '@/core/types';
import { createDemoScenario } from '@/state/demo';
import { buildCircuit } from '../model';

interface SpeedRow { grade: number; max_speed_kmh: number }

export async function buildHarnessScenario(): Promise<Scenario> {
  const s = await createDemoScenario();
  const [tables, route] = await Promise.all([
    fetch('/src/data/spreadsheet-tables.json').then(r => r.json()),
    fetch('/docs/spec/fixtures/spreadsheet-active-route.json').then(r => r.json()),
  ]);
  const tbl = (rows: SpeedRow[]): GradeSpeedPoint[] => rows.map(r => [r.grade, r.max_speed_kmh]);
  const speeds = { loaded: tbl(tables.speed_tables.loaded.rows), empty: tbl(tables.speed_tables.unloaded.rows) };

  if (!s.materials.length) {
    s.materials = [
      { id: 'OB', name: 'Overburden', bankDensity: 2.2, swell: 1.3, color: '#C79A6B' },
      { id: 'CL', name: 'Coal', bankDensity: 1.35, swell: 1.25, color: '#2E3238' },
    ];
  }
  if (!s.fleet.trucks.length) {
    const truck = (id: string, name: string, make: string, model: string, payload: number, empty: number, ob: number, cl: number, color: string): TruckModel => ({
      id, name, make, model, drive: 'mechanical', emptyMassT: empty, payloadT: payload, gvwT: empty + payload, enginePowerKW: 1400, topSpeedKmh: 55,
      rimpull: [[0, 1100], [10, 700], [20, 360], [40, 180], [55, 120]], retarder: [[10, 900], [30, 400], [55, 250]],
      loadBcmByMaterial: { OB: ob, CL: cl }, spreadsheetSpeeds: speeds,
      dims: { length: 12.2, width: 7.7, height: 6.2, eyeHeight: 4.5 }, color, sources: [], estimated: ['rimpull', 'retarder'],
    });
    s.fleet.trucks = [
      truck('CAT_789D', 'CAT 789D', 'Cat', '789D', 181, 136, 104, 100, '#F2B417'),
      truck('CAT_789C', 'CAT 789C', 'Cat', '789C', 177, 140, 104, 100, '#F2B417'),
      truck('KOM_HD1500_7', 'KOM HD1500-7', 'Komatsu', 'HD1500-7', 144, 112, 89, 100, '#E8E3D8'),
    ];
  }
  if (!s.fleet.loaders.length) {
    const ld = (id: string, name: string, type: LoaderModel['type'], bucket: number, cls: string): LoaderModel => ({ id, name, make: name.split(' ')[0], model: name.split(' ')[1] ?? name, type, classLabel: cls, bucketM3: bucket, cycleS: 32, sources: [], estimated: [] });
    s.fleet.loaders = [ld('EX5600', 'HIT EX5600', 'excavator', 34, '550-ton class'), ld('PC4000', 'KOM PC4000', 'excavator', 22, '400-ton class'), ld('WA900', 'KOM WA900', 'loader', 13, '100-ton class')];
  }
  if (!s.fleet.units.length) {
    const u = (id: string, modelId: string, kind: FleetUnit['kind'], ownership: FleetUnit['ownership'] = 'own'): FleetUnit => ({ id, modelId, kind, ownership, availability: 0.88 });
    s.fleet.units = [u('EX09', 'EX5600', 'loader'), u('EX04', 'PC4000', 'loader'), u('LDR1', 'WA900', 'loader'),
      ...Array.from({ length: 14 }, (_, i) => u(`DT${124 + i}`, i < 8 ? 'CAT_789D' : i < 11 ? 'CAT_789C' : 'KOM_HD1500_7', 'truck', i < 8 ? 'own' : 'hire'))];
  }
  if (!s.fleet.loaderAssumptions.length) {
    const ex = tables.excavator_assumptions.excavators;
    const la = (unitId: string, key: string, pt: number): LoaderAssumptions => ({ unitId, dumpS: ex[key].dump_time_s, spotS: ex[key].spot_time_s, loadS: ex[key].loading_time_s, plannedRateBcmPerPtHr: ex[key].planned_rate_bcm_per_pt_hr, ptHrsPerDay: pt });
    s.fleet.loaderAssumptions = [la('EX09', 'EX09', 20), la('EX04', 'EX04', 20), la('LDR1', 'LDR', 18)];
  }
  if (!s.fleet.trucksAvailable) s.fleet.trucksAvailable = 12;

  // the workbook's own Data Dump string, as an imported string
  const pts: StringPoint[] = (route.points as [number, number, number][]).map(([e, n, z], i) => ({ id: `wb_${i}`, e, n, z, snapped: false }));
  pts[40].stop = true;
  pts[88].stop = true;
  pts[20].seg = { speedLimitKmh: 40, zone: 'ramp' };
  const wb: HaulString = {
    id: 'wb_ex09_rl282', name: 'EX09 - B7-9 to RL282 (calc.xlsm)', color: '#7B5EA7', points: pts, source: 'imported', visible: true,
    notes: 'Data Dump!A2:C118', createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z',
  };
  if (!s.strings.some(x => x.id === wb.id)) s.strings = [...s.strings, wb];

  if (!s.circuits.length) {
    const byName = (frag: string) => s.strings.find(x => x.name.includes(frag));
    const mk = (inp: Parameters<typeof buildCircuit>[1], trucks: number, extra: Partial<Circuit> = {}) => {
      const c = buildCircuit(s, inp);
      c.trucks = trucks;
      Object.assign(c, extra);
      s.circuits = [...s.circuits, c];
      return c;
    };
    const w = byName('S51 West lift') , long = byName('long haul'), e4 = byName('S52'), ldr = byName('ROM');
    mk({ loaderUnitId: 'EX09', truckModelId: 'CAT_789D', materialId: 'OB', haulStringId: w?.id, digId: w?.digId, dumpId: w?.dumpId, name: 'EX09 OB → S51 West' }, 4, { altHaulStringIds: [long?.id, wb.id].filter(Boolean) as string[] });
    mk({ loaderUnitId: 'EX04', truckModelId: 'CAT_789C', materialId: 'OB', haulStringId: e4?.id, digId: e4?.digId, dumpId: e4?.dumpId, name: 'EX04 OB → S52 East' }, 2);
    mk({ loaderUnitId: 'LDR1', truckModelId: 'KOM_HD1500_7', materialId: 'CL', haulStringId: ldr?.id, digId: ldr?.digId, dumpId: ldr?.dumpId, name: 'LDR1 coal → ROM' }, 4);
    mk({ loaderUnitId: 'EX09', truckModelId: 'CAT_789D', materialId: 'OB', haulStringId: wb.id, name: 'EX09 → RL282 (workbook)' }, 3, { active: false });
    s.circuits[0].params = { ...s.circuits[0].params, haulEff: 0.83 };
  }
  return s;
}
