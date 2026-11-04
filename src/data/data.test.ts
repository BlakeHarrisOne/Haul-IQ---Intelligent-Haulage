import { describe, expect, it } from 'vitest';
import type { HaulString, MeshAsset, Scenario } from '@/core/types';
import { computeAllCircuits, computeManning, computePriority, productiveMinutes } from '@/engine';
import type { TruckModelExt } from '@/engine/types';
import { fixture, straightString } from '@/engine/testing';
import { defaultScenarioData, demoCircuits, LOADER_MODELS, TRUCK_MODELS, WORKBOOK_SPEEDS } from './index';

const tables = fixture<{ excavator_assumptions: { excavators: Record<string, { dump_time_s: number; spot_time_s: number; loading_time_s: number; planned_rate_bcm_per_pt_hr: number }> } }>('spreadsheet-tables.json');

describe('master data', () => {
  const d = defaultScenarioData();

  it('loader assumptions exactly from the workbook (ActiveRoute!H2:J34)', () => {
    const ex = tables.excavator_assumptions.excavators;
    for (const [unit, key] of [['EX04', 'EX04'], ['EX06', 'EX06'], ['EX07', 'EX07'], ['EX09', 'EX09'], ['LDR1', 'LDR'], ['LDR2', 'LDR']]) {
      const la = d.fleet.loaderAssumptions.find(l => l.unitId === unit)!;
      expect(la, unit).toBeTruthy();
      expect([la.dumpS, la.spotS, la.loadS, la.plannedRateBcmPerPtHr]).toEqual([ex[key].dump_time_s, ex[key].spot_time_s, ex[key].loading_time_s, ex[key].planned_rate_bcm_per_pt_hr]);
    }
    expect(d.fleet.loaderAssumptions.find(l => l.unitId === 'LDR1')!.ptHrsPerDay).toBe(18);
    expect(d.fleet.trucksAvailable).toBe(12);
  });

  it('truck library from oem-curves.json with workbook loads, one speed table, dims and estimated flags', () => {
    expect(TRUCK_MODELS.length).toBe(8);
    const c = TRUCK_MODELS.find(t => t.id === 'CAT_789C')! as TruckModelExt;
    expect(c.name).toBe('CAT 789C');
    expect(c.loadBcmByMaterial).toMatchObject({ OB: 104, CL: 100 });
    expect(TRUCK_MODELS.find(t => t.id === 'KOM_HD1500_7')!.loadBcmByMaterial!.OB).toBe(89);
    expect(TRUCK_MODELS.find(t => t.id === 'CAT_789D')!.loadBcmByMaterial!.OB).toBe(104);
    expect(c.spreadsheetSpeeds!.loaded).toEqual(WORKBOOK_SPEEDS.loaded);
    expect(c.dims).toMatchObject({ length: 12.177, width: 7.674, height: 6.15, eyeHeight: 4.52, eyeBack: 3.29, eyeRight: -2.79 });
    expect(TRUCK_MODELS.find(t => t.id === 'CAT_789D')!.dims).toMatchObject({ length: 12.697, eyeHeight: 4.8 });
    expect(TRUCK_MODELS.find(t => t.id === 'KOM_HD1500_7')!.dims).toMatchObject({ length: 11.37, eyeHeight: 4.435 });
    expect(c.estimated).toEqual(expect.arrayContaining(['rimpull', 'retarder', 'retarderPowerKW', 'loadBcmByMaterial.IB']));
    expect(c.rimpullGears!.length).toBe(6);
    expect(c.retarderGears!.length).toBe(6);
    expect(c.descentRule).toBe('discrete_gear');
    expect(c.color).toMatch(/^#E8B3/i);
    expect(TRUCK_MODELS.find(t => t.id === 'KOM_HD1500_7')!.color).toMatch(/^#F2C2/i);
    for (const t of TRUCK_MODELS) {
      expect(t.sources.length).toBeGreaterThan(1);
      expect(t.rimpull.length).toBeGreaterThan(5);
      expect(t.retarder.length).toBeGreaterThan(5);
      for (let k = 1; k < t.rimpull.length; k++) expect(t.rimpull[k][0]).toBeGreaterThan(t.rimpull[k - 1][0]);
    }
    expect(LOADER_MODELS.map(l => l.name)).toEqual(expect.arrayContaining(['KOM PC4000', 'LIEB R996B', 'HIT EX2600', 'HIT EX5600', 'KOM WA900']));
    expect(LOADER_MODELS.find(l => l.id === 'KOM_WA900_8')!.type).toBe('loader');
  });

  it('materials, units, crew, shift profile', () => {
    expect(d.materials.map(m => m.id)).toEqual(['OB', 'CL', 'IB', 'PT']);
    expect(d.materials.find(m => m.id === 'OB')!.bankDensity).toBe(1.728);
    expect(d.materials.every(m => m.swell === 1.2)).toBe(true);
    expect(d.fleet.units.filter(u => u.kind === 'truck').length).toBe(14);
    for (const u of d.fleet.units.filter(u => u.kind === 'truck')) expect(TRUCK_MODELS.some(t => t.id === u.modelId)).toBe(true);
    expect(d.crew.shifts.find(s => s.id === d.crew.activeShiftId)!.available).toBe(30);
    expect(productiveMinutes(d.shift)).toBe(600);
    expect(defaultScenarioData().fleet.trucks).not.toBe(d.fleet.trucks); // fresh copies
  });
});

describe('demoCircuits', () => {
  const d = defaultScenarioData();
  const asset = (id: string, name: string, role: 'dig' | 'dump'): MeshAsset => ({
    id, name, kind: 'solid', role, mesh: { verts: new Float64Array(), tris: new Uint32Array() },
    stats: { vertexCount: 0, triangleCount: 0, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, planArea: 0, closed: true, boundaryEdges: 0, volume: 1e5, centroid: [0, 0, 0] },
    color: '#888', visible: true, opacity: 1, source: 'demo', importedAt: '',
  });
  const assets = [asset('a1', 'EX09 OB block', 'dig'), asset('a2', 'EX04 OB block', 'dig'), asset('a3', 'LDR coal block', 'dig'),
    asset('a4', 'S51 West lift', 'dump'), asset('a5', 'S52 East lift', 'dump'), asset('a6', 'ROM coal stockpile', 'dump')];
  const named = (id: string, name: string): HaulString => ({ ...straightString(id, [{ len: 400, grade: 0 }, { len: 500, grade: 0.08 }, { len: 600, grade: 0 }]), name, source: 'demo' });
  const strings = [named('s1', 'EX09 → S51 West lift'), named('s2', 'EX09 → S51 West (long haul)'), named('s3', 'EX04 → S52 East lift'), named('s4', 'LDR → ROM coal stockpile')];

  it('creates the three Targets circuits linked by name', () => {
    const cs = demoCircuits(assets, strings, d);
    expect(cs.map(c => [c.loaderUnitId, c.truckModelId, c.trucks, c.priority, c.params.plannedRateBcmPerPtHr, c.params.truckPtHrsPerDay])).toEqual([
      ['EX09', 'CAT_789D', 5, 1, 1800, 20], ['EX04', 'KOM_HD1500_7', 4, 2, 1300, 20], ['LDR1', 'CAT_789C', 3, 3, 650, 18],
    ]);
    expect(cs[0]).toMatchObject({ haulStringId: 's1', altHaulStringIds: ['s2'], digId: 'a1', dumpId: 'a4', materialId: 'OB' });
    expect(cs[1]).toMatchObject({ haulStringId: 's3', digId: 'a2', dumpId: 'a5' });
    expect(cs[2]).toMatchObject({ haulStringId: 's4', digId: 'a3', dumpId: 'a6', materialId: 'CL' });
    expect(cs[2].params.truckLoadBcm).toBe(100);
    expect(cs[0].params.desiredDailyBcm).toBe(36000);
    expect(cs[2].params.desiredDailyBcm).toBe(11700);
  });

  it('a demo scenario computes end to end: 36 crew required, 30 available, planner explains the shortfall', () => {
    const s: Scenario = {
      schema: 'haiul-sim/scenario@1', id: 'demo', name: 'demo', createdAt: '', updatedAt: '', site: { name: 'demo', origin: [0, 0, 0] },
      assets, strings, circuits: [], ...d, settings: { verticalExaggeration: 1, contourIntervalM: 5, theme: 'light', showGradeColours: true },
    };
    s.circuits = demoCircuits(assets, strings, d);
    const res = computeAllCircuits(s);
    expect(Object.values(res).every(r => r.ok)).toBe(true);
    expect(computeManning(s, res).total).toBe(36);
    const p = computePriority(s, res);
    expect(p.crewUsed).toBeLessThanOrEqual(30);
    expect(p.narrative.length).toBeGreaterThan(1);
  });
});
