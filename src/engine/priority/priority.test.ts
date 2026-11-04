import { describe, expect, it } from 'vitest';
import { computeAllCircuits, computeManning } from '../index';
import { crewCircuits, evaluateCrew } from '../manning/evaluate';
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

  describe('rule-driven site tasks are live (bulk push = 7 − enabling − max(0, trucks − 12))', () => {
    /** 15 trucks requested (6 + 5 + 4), LDR coal at P5 below bulk push P4. */
    function site15() {
      const { s } = plan();
      const t: Record<string, number> = { 'c-ex09': 6, 'c-ex04': 5, 'c-ldr1': 4 };
      const s2 = { ...s, fleet: { ...s.fleet, trucksAvailable: 15 }, circuits: s.circuits.map(c => ({ ...c, trucks: t[c.id], priority: c.id === 'c-ldr1' ? 5 : c.priority })) };
      return { s: s2, res: computeAllCircuits(s2) };
    }

    it('the reported plan is exactly what the rules man; with no task reduced, applying the trucks gives crewUsed', () => {
      const { s, res } = site15();
      for (let crew = 40; crew >= 20; crew--) {
        const p = computePriority(s, res, { crewAvailable: crew });
        const alloc = new Map(p.allocations.map(a => [a.circuitId, a.allocatedTrucks]));
        const ov: Record<string, number> = {};
        for (const t of p.tasks) if (t.allocated < t.requested) ov[t.ruleId] = t.allocated;
        const ev = evaluateCrew({ circuits: crewCircuits(s, id => alloc.get(id)), rules: s.crew.rules, trucksAvailable: 15, available: crew, overrides: ov });
        expect(ev.total, `crew ${crew}`).toBe(p.crewUsed);
        expect(p.crewUsed, `crew ${crew}`).toBeLessThanOrEqual(crew);
        for (const t of p.tasks) {
          expect(ev.ruleCounts[t.ruleId] ?? 0, `crew ${crew} ${t.ruleId}`).toBe(t.allocated);
          // requested = the rule at the planned trucks (what Manning shows after "Apply allocation")
          const natural = evaluateCrew({ circuits: crewCircuits(s, id => alloc.get(id)), rules: s.crew.rules, trucksAvailable: 15, available: crew });
          expect(natural.ruleCounts[t.ruleId] ?? 0, `crew ${crew} ${t.ruleId}`).toBe(t.requested);
        }
        if (p.tasks.every(t => t.allocated >= t.requested)) {
          const applied = { ...s, circuits: s.circuits.map(c => ({ ...c, trucks: alloc.get(c.id) ?? c.trucks })) };
          expect(computeManning(applied, computeAllCircuits(applied)).total, `crew ${crew}`).toBe(p.crewUsed);
        }
      }
    });

    it('crew 35: LDR (P5) parked, push follows the rule to 6 at 11 trucks (baseline 3 at 15) and its production counts', () => {
      const { s, res } = site15();
      const p = computePriority(s, res, { crewAvailable: 35 });
      const push = p.tasks.find(t => t.ruleId === 'R7_BULK_PUSH')!;
      expect(p.allocations.find(a => a.circuitId === 'c-ldr1')!.allocatedTrucks).toBe(0);
      expect(push).toMatchObject({ baseline: 3, requested: 6, allocated: 6, bcmDayLost: 0 });
      expect(p.crewUsed).toBe(32);
      const circuitsAchieved = p.allocations.reduce((a, x) => a + x.bcmDayAchieved, 0);
      expect(p.bcmDayAchieved - circuitsAchieved).toBe(6 * 18 * 320);
      expect(p.narrative.some(l => /Bulk push dozers \(P4\): the rule mans 6 at the planned 11 trucks \(3 at the requested 15\)/.test(l))).toBe(true);
    });

    it('crew 30: higher-priority EX04 stays full; push (P4) is held at 4 of the 6 the rule gives at 11 trucks, and says so', () => {
      const { s, res } = site15();
      const p = computePriority(s, res, { crewAvailable: 30 });
      expect(p.allocations.map(a => a.allocatedTrucks)).toEqual([6, 5, 0]);
      const push = p.tasks.find(t => t.ruleId === 'R7_BULK_PUSH')!;
      expect(push).toMatchObject({ requested: 6, allocated: 4, bcmDayLost: 2 * 18 * 320 });
      expect(p.crewUsed).toBe(30);
      expect(p.narrative.some(l => /Bulk push dozers \(P4\) reduced 6 → 4 .*stand 2 down in Manning/.test(l))).toBe(true);
      // applying the trucks alone gives the rule's 6 push dozers: 2 more than the plan, exactly the 2 reported as stood down
      const applied = { ...s, circuits: s.circuits.map(c => ({ ...c, trucks: p.allocations.find(a => a.circuitId === c.id)!.allocatedTrucks })) };
      expect(computeManning(applied, computeAllCircuits(applied)).total).toBe(p.crewUsed + push.requested - push.allocated);
    });
  });
});
