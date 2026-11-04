import { describe, expect, it } from 'vitest';
import { computeCircuit } from '../haul/circuit';
import { circuitFor, fixture, scenarioWith, stringFrom } from '../testing';
import type { CircuitResultExt } from '../types';
import { queueEstimate } from './queue';

describe('queue models (spec 04 §C.4 worked example: t_L 2.75 min, t_A 22 min, 181 t)', () => {
  const tL = 2.75 * 60, c = (2.75 + 22) * 60;
  const tph = (m: 'deterministic' | 'mm1n' | 'binomial', n: number) => queueEstimate(m, n, tL, c).loadsPerHr * 181;
  const table: [number, number, number, number][] = [ // N, deterministic, binomial, M/M/1//N (t/h)
    [6, 2633, 2001, 2410], [7, 3072, 2218, 2732], [8, 3510, 2410, 3019], [9, 3949, 2581, 3265], [10, 3949, 2733, 3469], [11, 3949, 2868, 3628], [12, 3949, 2988, 3746],
  ];
  it.each(table)('N = %i', (n, det, bin, mm) => {
    expect(tph('deterministic', n)).toBeCloseTo(det, -1);
    expect(Math.abs(tph('binomial', n) - bin)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(tph('mm1n', n) - mm)).toBeLessThanOrEqual(1.5);
  });
  it('bounds: binomial ≤ M/M/1//N ≤ deterministic; loader busy → 1 as trucks grow', () => {
    for (let n = 1; n <= 20; n++) {
      const d = queueEstimate('deterministic', n, tL, c), m = queueEstimate('mm1n', n, tL, c), b = queueEstimate('binomial', n, tL, c);
      expect(b.loadsPerHr).toBeLessThanOrEqual(m.loadsPerHr + 1e-9);
      expect(m.loadsPerHr).toBeLessThanOrEqual(d.loadsPerHr + 1e-9);
    }
    expect(queueEstimate('mm1n', 40, tL, c).loaderBusy).toBeGreaterThan(0.999);
  });
});

describe('fleet options (macro buttons generalised)', () => {
  const AR = fixture<{ points: number[][] }>('spreadsheet-active-route.json');
  const hs = stringFrom('hs', 'EX09', AR.points);
  const run = (patch = {}, trucks = 4) => {
    const c = circuitFor('c', 'EX09', 'CAT_789D', 'OB', hs.id, trucks, patch);
    return computeCircuit(scenarioWith([hs], [c]), c, { maxTrucks: 12 }) as CircuitResultExt;
  };

  it('is internally consistent for every n', () => {
    const r = run();
    let prev = r.options[0];
    let balanced = 0;
    for (const o of r.options) {
      expect(o.bcmPerDay).toBeCloseTo(Math.min(o.truckCapacityBcmDay, r.idealDailyBcm), 9);
      expect(o.loaderPtHrsDay).toBeCloseTo(o.bcmPerDay / 1800, 12);
      expect(o.truckHoursReq).toBeCloseTo(o.bcmPerDay / r.truckProdBcmPerPtHr, 9);
      expect(o.lostLoaderPtHrsShift).toBeCloseTo((20 - o.loaderPtHrsDay) / 2, 9);
      expect(o.truckQueueHrsShift).toBeCloseTo((o.trucks * 20 - o.truckHoursReq) / 2, 9);
      expect(o.matchFactor).toBeCloseTo((o.trucks * 140) / r.cycleS, 12);
      expect(o.bcmPerDay).toBeGreaterThanOrEqual(prev.bcmPerDay - 1e-9);
      expect(o.lostLoaderPtHrsShift).toBeLessThanOrEqual(prev.lostLoaderPtHrsShift + 1e-9);
      expect(o.truckQueueHrsShift).toBeGreaterThanOrEqual(prev.truckQueueHrsShift - 1e-9);
      if (o.status === 'balanced') balanced++;
      prev = o;
    }
    expect(balanced).toBe(1);
    expect(r.options[r.trucksRecommended - 1].status).toBe('balanced');
  });

  it('queue models lower the truck capacity and are explained in CalcSteps', () => {
    const det = run({}, 4), mm = run({ queueModel: 'mm1n' } as never, 4);
    expect(mm.queueModel).toBe('mm1n');
    expect(mm.assigned.truckCapacityBcmDay).toBeLessThan(det.assigned.truckCapacityBcmDay);
    expect(mm.steps.find(s => s.id === 'queue.mm1n')!.label).toMatch(/\(used\)/);
    expect(mm.steps.find(s => s.id === 'queue.mm1n')!.note).toMatch(/pessimistic/);
    const n = mm.options.find(o => o.status === 'balanced')!.trucks;
    expect(n).toBeGreaterThanOrEqual(det.trucksRecommended);
  });

  it('assigned 0 trucks → no production, the whole loader target is lost', () => {
    const r = run({}, 0);
    expect(r.assigned.bcmPerDay).toBe(0);
    expect(r.lostPtHrsShift).toBeCloseTo(10, 12);
  });
});
