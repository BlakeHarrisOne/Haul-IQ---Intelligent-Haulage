import { describe, expect, it } from 'vitest';
import { computeAllCircuits, computeManning } from '../index';
import { circuitFor, scenarioWith, straightString } from '../testing';
import { computePriority } from './plan';

function plan(extra: { alt?: boolean } = {}) {
  const h1 = straightString('h1', [{ len: 300, grade: 0 }, { len: 700, grade: 0.08 }, { len: 900, grade: 0 }]);
  const h2 = straightString('h2', [{ len: 200, grade: 0 }, { len: 500, grade: 0.09 }, { len: 1000, grade: 0 }]);
  const h3 = straightString('h3', [{ len: 400, grade: 0 }, { len: 1100, grade: 0.08 }, { len: 1650, grade: 0 }]);
  const h3s = straightString('h3-short', [{ len: 250, grade: 0 }, { len: 1100, grade: 0.08 }, { len: 600, grade: 0 }]);
  h3s.name = 'LDR1 B104 short haul';
  const cs = [
    circuitFor('c-ex09', 'EX09', 'CAT_789D', 'OB', 'h1', 5, {}, { priority: 1, name: 'EX09 OB' }),
    circuitFor('c-ex04', 'EX04', 'KOM_HD1500_7', 'OB', 'h2', 4, {}, { priority: 2, name: 'EX04 OB' }),
    circuitFor('c-ldr1', 'LDR1', 'CAT_789C', 'CL', 'h3', 3, {}, { priority: 3, name: 'LDR coal', altHaulStringIds: extra.alt ? ['h3-short'] : undefined }),
  ];
  const s = scenarioWith([h1, h2, h3, h3s], cs);
  return { s, res: computeAllCircuits(s) };
}

describe('priority planner', () => {
  it('the workbook plan needs 36 crew (Targets!D88)', () => {
    const { s, res } = plan();
    expect(computeManning(s, res).total).toBe(36);
  });

  it('full crew → everything full, no losses', () => {
    const { s, res } = plan();
    const p = computePriority(s, res, { crewAvailable: 36 });
    expect(p.allocations.every(a => a.status === 'full')).toBe(true);
    expect(p.crewUsed).toBe(36);
    expect(p.trucksUsed).toBe(12);
    expect(p.narrative[0]).toMatch(/≥ 36 required/);
    expect(p.tasks.find(t => t.ruleId === 'R7_BULK_PUSH')!.allocated).toBe(6);
  });

  it('crew 30: bulk push (Targets priority 4) is shed before any circuit', () => {
    const { s, res } = plan();
    const p = computePriority(s, res); // A Crew – Day = 30
    expect(p.crewAvailable).toBe(30);
    expect(p.allocations.every(a => a.status === 'full')).toBe(true);
    const push = p.tasks.find(t => t.ruleId === 'R7_BULK_PUSH')!;
    expect(push.allocated).toBe(0);
    expect(push.bcmDayLost).toBe(6 * 18 * 320);
    expect(p.crewUsed).toBeLessThanOrEqual(30);
    expect(p.narrative.join('\n')).toMatch(/Crew 30 .*< 36 required: short by 6/);
  });

  it('crew 30 with circuits only: LDR coal reduced 3 → 0 (parked), lost bcm and loader PT reported', () => {
    const { s, res } = plan();
    const p = computePriority(s, res, { shedSiteTasks: false });
    const ldr = p.allocations.find(a => a.circuitId === 'c-ldr1')!;
    expect(ldr.status).toBe('parked');
    expect(ldr.allocatedTrucks).toBe(0);
    expect(ldr.bcmDayLost).toBeCloseTo(ldr.bcmDayPlanned, 6);
    expect(ldr.lostPtHrsShift).toBeCloseTo(9, 6);
    expect(ldr.crewAllocated).toBe(0);
    expect(p.allocations.filter(a => a.circuitId !== 'c-ldr1').every(a => a.status === 'full')).toBe(true);
    expect(p.crewUsed).toBe(30);
    expect(p.narrative.some(l => /LDR coal \(P3\) parked/.test(l))).toBe(true);
  });

  it('crew 28: push shed, then the lowest-priority circuit loses trucks first', () => {
    const { s, res } = plan({ alt: true });
    const p = computePriority(s, res, { crewAvailable: 28 });
    const ldr = p.allocations.find(a => a.circuitId === 'c-ldr1')!;
    expect(ldr.status).toBe('reduced');
    expect(ldr.allocatedTrucks).toBe(2);
    expect(ldr.bcmDayLost).toBeGreaterThan(0);
    expect(p.narrative.some(l => /LDR coal \(P3\) reduced from 3 to 2 trucks/.test(l))).toBe(true);
    // the short-haul alternative is evaluated with computeCircuit(…, { haulStringId })
    expect(ldr.alternatives.length).toBe(1);
    const alt = ldr.alternatives[0];
    expect(alt.trucksNeeded).toBeLessThanOrEqual(res['c-ldr1'].trucksRecommended);
    expect(alt.deltaBcmDay).toBeGreaterThan(0);
    expect(p.narrative.some(l => /short haul: needs \d truck/.test(l))).toBe(true);
    expect(p.crewUsed).toBeLessThanOrEqual(28);
  });

  it('surplus trucks that only queue are released first, at no production loss', () => {
    const { s } = plan();
    const short = straightString('h-ldr-short', [{ len: 300, grade: 0 }, { len: 300, grade: 0.05 }]);
    const s2 = { ...s, strings: [...s.strings, short], circuits: s.circuits.map(c => (c.id === 'c-ldr1' ? { ...c, haulStringId: short.id } : c)) };
    const res2 = computeAllCircuits(s2);
    expect(res2['c-ldr1'].trucksRecommended).toBeLessThan(3);
    const p = computePriority(s2, res2, { crewAvailable: 35 });
    const ldr = p.allocations.find(a => a.circuitId === 'c-ldr1')!;
    expect(ldr.allocatedTrucks).toBe(2);
    expect(ldr.bcmDayLost).toBeCloseTo(0, 6);
    expect(p.tasks.find(t => t.ruleId === 'R7_BULK_PUSH')!.allocated).toBe(6);
    expect(p.narrative.some(l => /trimmed 3 → 2 trucks: the extra truck only queued/.test(l))).toBe(true);
  });

  it('trucks are allocated in priority order', () => {
    const { s, res } = plan();
    const p = computePriority(s, res, { crewAvailable: 99, trucksAvailable: 10 });
    expect(p.allocations.map(a => a.allocatedTrucks)).toEqual([5, 4, 1]);
    expect(p.allocations[2].status).toBe('reduced');
    expect(p.narrative.some(l => /Trucks 12 requested > 10 available/.test(l))).toBe(true);
  });

  it('never cuts a higher-priority circuit while a lower one still has trucks', () => {
    const { s, res } = plan();
    for (let crew = 10; crew <= 36; crew++) {
      const p = computePriority(s, res, { crewAvailable: crew, shedSiteTasks: false });
      // site roles alone (push 6 + assist + enabling + water 2 + grader 2 + supervision 3) = 15 when tasks are not shed
      if (crew >= 15) expect(p.crewUsed).toBeLessThanOrEqual(crew);
      else expect(p.warnings.some(w => /Fixed site roles/.test(w))).toBe(true);
      const a = p.allocations;
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
        if (a[i].allocatedTrucks < a[i].requestedTrucks) expect(a[j].allocatedTrucks, `crew ${crew}`).toBe(0);
      }
      expect(p.steps.length).toBeGreaterThan(0);
    }
  });
});
