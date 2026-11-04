import { describe, expect, it } from 'vitest';
import { TRUCK_MODELS, WORKBOOK_SPEEDS } from '@/data';
import { computeCircuit } from '../haul/circuit';
import { circuitFor, scenarioWith, straightString } from '../testing';
import { derivedSpeedTable, operatingPoints, resistanceForce, speedOnGrade, truckEnvelope } from './index';

const t789c = TRUCK_MODELS.find(t => t.id === 'CAT_789C')!;

describe('Truck Curves API', () => {
  it('truckEnvelope exposes envelope, per-gear rimpull/retarder curves and estimated flags', () => {
    const e = truckEnvelope(t789c);
    expect(e.gears.length).toBe(6);
    expect(e.gears[0].rimpull.length).toBeGreaterThan(3);
    expect(e.gears[0].retarder?.length).toBeGreaterThan(3);
    expect(e.rimpull[0][1]).toBeCloseTo(785, 0);
    expect(e.descentRule).toBe('discrete_gear');
    expect(e.estimated).toEqual(expect.arrayContaining(['rimpull', 'retarder', 'retarderPowerKW']));
    expect(e.estimated).not.toContain('rimpull.stall'); // 789C stall rimpull is OEM
    const el = truckEnvelope(TRUCK_MODELS.find(t => t.id === 'KOM_830E_5')!);
    expect(el.gears.length).toBe(0);
    expect(el.descentRule).toBe('continuous');
  });

  it('resistanceForce = m·g·G_eff (chart form)', () => {
    expect(resistanceForce(317.5, 0.10)).toBeCloseTo(311.4675, 4);
    expect(resistanceForce(100, -0.05)).toBeCloseTo(-49.05, 6);
  });

  it('derivedSpeedTable mirrors the workbook rows and slows with grade', () => {
    const rows = derivedSpeedTable(t789c, true, 2, 'OB');
    expect(rows.length).toBe(33);
    rows.forEach((r, k) => expect(r.spreadsheetKmh).toBe(WORKBOOK_SPEEDS.loaded[k][1]));
    const up = rows.filter(r => r.grade >= 0);
    for (let k = 1; k < up.length; k++) expect(up[k].kmh).toBeLessThanOrEqual(up[k - 1].kmh + 1e-9);
    const at8 = rows.find(r => Math.abs(r.grade - 0.08) < 1e-9)!;
    expect(at8.effGrade).toBeCloseTo(0.10, 12);
    expect(at8.kmh).toBeGreaterThan(10);
    expect(at8.kmh).toBeLessThan(13);
  });

  it('speedOnGrade works for both models', () => {
    expect(speedOnGrade(t789c, 0.07, true)).toEqual({ kmh: 20, limit: 'table' });
    expect(speedOnGrade(t789c, 0.2, true).limit).toBe('table-out-of-range');
    expect(speedOnGrade(t789c, 0.2, false).kmh).toBe(14);
    const r = speedOnGrade(t789c, 0.08, true, 'rimpull', 2);
    expect(r.kmh).toBeGreaterThan(11);
    expect(r.kmh).toBeLessThan(13);
    expect(speedOnGrade(undefined, 0, true).kmh).toBe(30);
  });

  it('operatingPoints plot each segment for spreadsheet and rimpull results', () => {
    const h = straightString('h', [{ len: 200, grade: 0 }, { len: 400, grade: 0.08 }, { len: 300, grade: -0.05 }]);
    for (const speedModel of ['spreadsheet', 'rimpull'] as const) {
      const c = circuitFor('c', 'EX09', 'CAT_789C', 'OB', h.id, 3, { speedModel });
      const r = computeCircuit(scenarioWith([h], [c]), c);
      const op = operatingPoints(r);
      expect(op.length).toBe(r.segments.length);
      const climb = op.find(p => p.loaded.effGrade > 0.09)!;
      expect(climb.loaded.mode).toBe('propel');
      expect(climb.loaded.forceKN).toBeGreaterThan(200);
      if (speedModel === 'rimpull') expect(climb.loaded.availKN).toBeGreaterThanOrEqual(climb.loaded.forceKN - 1);
      const down = op.find(p => p.loaded.effGrade < -0.02)!;
      expect(down.loaded.mode).toBe('retard');
    }
  });
});
