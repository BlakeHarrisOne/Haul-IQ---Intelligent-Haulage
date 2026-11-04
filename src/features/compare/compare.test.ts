import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitResult, FleetOption, Scenario } from '@/core/types';
import { emptyScenario } from '@/state/store';
import { alignCircuits, circuitRows, matchCircuit, totals, MIN_PT_HRS_DAY } from './compareData';

const opt = (o: Partial<FleetOption>): FleetOption => ({ trucks: 3, truckCapacityBcmDay: 0, bcmPerDay: 0, loaderPtHrsDay: 20, lostLoaderPtHrsShift: 0, truckQueueHrsShift: 0, matchFactor: 1, loaderUtil: 1, status: 'balanced', ...o });
const circ = (id: string, loader: string, mat: string, trucks: number, active = true): Circuit => ({
  id, name: `${loader} ${mat}`, loaderUnitId: loader, loaderModelId: 'x', truckModelId: 't', materialId: mat, trucks, priority: 1, active, color: 'var(--c1)',
  params: { haulEff: 0.85, stopSigns: 2, stopPenaltyS: 60, spotS: 30, loadS: 110, dumpS: 60, truckLoadBcm: 104, plannedRateBcmPerPtHr: 1800, truckPtHrsPerDay: 20, desiredDailyBcm: 36000, rrPct: 2, speedLimitKmh: 60, speedModel: 'spreadsheet', shiftsPerDay: 2 },
});
const res = (id: string, o: Partial<FleetOption>, cycleMin = 12, exact = 3.4): CircuitResult => ({
  circuitId: id, ok: true, speedModel: 'spreadsheet', segments: [], lengthM: 2000, riseM: 10, fallM: 20, travelLoadedS: 0, travelEmptyS: 0, haulTimeS: 0, stopsS: 0,
  cycleS: cycleMin * 60, cycleMin, truckProdBcmPerPtHr: 500, truckHoursReq: 0, trucksExact: exact, trucksRecommended: Math.ceil(exact), loaderPtHrs: 20, lostPtHrsShift: 0,
  assigned: opt(o), options: [], steps: [], warnings: [],
});

function scn(): Scenario {
  const s = emptyScenario('t');
  s.circuits = [circ('a', 'EX09', 'OB', 3), circ('b', 'EX04', 'OB', 4), circ('c', 'LDR', 'CL', 2, false)];
  return s;
}

describe('circuit rows and totals', () => {
  const s = scn();
  const r = {
    a: res('a', { trucks: 3, bcmPerDay: 31000, loaderPtHrsDay: 17.2, lostLoaderPtHrsShift: 1.4, status: 'under' }),
    b: res('b', { trucks: 4, bcmPerDay: 26000, loaderPtHrsDay: 20, truckQueueHrsShift: 0.6, status: 'over' }, 10, 3.1),
    c: res('c', { trucks: 2, bcmPerDay: 9000, loaderPtHrsDay: 14 }),
  };
  const rows = circuitRows(s, r);
  it('maps results onto rows', () => {
    expect(rows[0].haulKm).toBe(2);
    expect(rows[0].lostPtShift).toBe(1.4);
    expect(rows[1].status).toBe('over');
  });
  it('totals only active circuits and counts PT rule breaches', () => {
    const t = totals(rows, 12);
    expect(t.trucksAssigned).toBe(7);
    expect(t.bcmDay).toBe(57000);
    expect(t.lostPtShift).toBeCloseTo(1.4);
    expect(t.queueHrsShift).toBeCloseTo(0.6);
    expect(t.belowMinPt).toBe(1);
    expect(t.activeCircuits).toBe(2);
    expect(t.trucksRecommended).toBe(8);
    expect(t.avgCycleMin).toBeCloseTo((12 * 3 + 10 * 4) / 7);
    expect(MIN_PT_HRS_DAY).toBe(18);
  });
  it('marks failed circuits', () => {
    const rr = circuitRows(s, { a: { ...r.a, ok: false, error: 'No haul string' } });
    expect(rr[0].status).toBe('error');
    expect(rr[1].status).toBe('error');
    expect(totals(rr, 12).bcmDay).toBe(0);
  });
});

describe('cross-scenario matching', () => {
  it('matches by id, then loader + material, then name', () => {
    const a = scn(), b = scn();
    b.circuits = [circ('zz', 'EX09', 'OB', 5), circ('b', 'EX04', 'OB', 3)];
    expect(matchCircuit(b, a.circuits[0])?.id).toBe('zz');
    expect(matchCircuit(b, a.circuits[1])?.id).toBe('b');
    expect(matchCircuit(b, a.circuits[2])).toBeUndefined();
  });
  it('aligns the union of circuits', () => {
    const a = scn(), b = scn();
    b.circuits = [circ('zz', 'EX09', 'OB', 5), circ('n', 'EX07', 'OB', 4)];
    const rows = alignCircuits([a, b]);
    expect(rows.length).toBe(4);
    expect(rows[0].per.map(c => c?.id)).toEqual(['a', 'zz']);
    expect(rows.find(r => r.per[1]?.id === 'n')?.per[0]).toBeUndefined();
  });
});
