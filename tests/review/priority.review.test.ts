/**
 * Independent review: src/engine/priority/plan.ts with the default crew rules (R7 bulk push is a prioritised site
 * task whose count depends on totals.trucks: 7 − enabling − max(0, trucks − 12)).
 */
import { describe, expect, it } from 'vitest';
import { computeAllCircuits, computeManning } from '@/engine';
import { computePriority } from '@/engine/priority/plan';
import { crewCircuits, evaluateCrew } from '@/engine/manning/evaluate';
import { circuitFor, scenarioWith, straightString } from '@/engine/testing';

/** 15 trucks requested (6 + 5 + 4): above the workbook's 12, so R7 bulk push = 6 − 3 = 3. LDR coal is P5 (< push P4). */
function site() {
  const h1 = straightString('h1', [{ len: 300, grade: 0 }, { len: 700, grade: 0.08 }, { len: 900, grade: 0 }]);
  const h2 = straightString('h2', [{ len: 200, grade: 0 }, { len: 500, grade: 0.09 }, { len: 1000, grade: 0 }]);
  const h3 = straightString('h3', [{ len: 400, grade: 0 }, { len: 1100, grade: 0.08 }, { len: 1650, grade: 0 }]);
  const cs = [
    circuitFor('c-ex09', 'EX09', 'CAT_789D', 'OB', 'h1', 6, {}, { priority: 1, name: 'EX09 OB' }),
    circuitFor('c-ex04', 'EX04', 'KOM_HD1500_7', 'OB', 'h2', 5, {}, { priority: 2, name: 'EX04 OB' }),
    circuitFor('c-ldr1', 'LDR1', 'CAT_789C', 'CL', 'h3', 4, {}, { priority: 5, name: 'LDR coal' }),
  ];
  const s = scenarioWith([h1, h2, h3], cs);
  s.fleet.trucksAvailable = 15;
  return { s, res: computeAllCircuits(s) };
}

describe('review: priority planner site-task accounting', () => {
  it('R-PRIO-1 the reported bulk-push allocation equals the push dozers the plan actually mans', () => {
    const { s, res } = site();
    expect(computeManning(s, res).total).toBe(36);
    const p = computePriority(s, res, { crewAvailable: 35 });
    const alloc = new Map(p.allocations.map(a => [a.circuitId, a.allocatedTrucks]));
    // people on R7 in the plan's own final crew evaluation (no task override was needed at 35 crew)
    const ev = evaluateCrew({
      circuits: crewCircuits(s, id => alloc.get(id) ?? 0), rules: s.crew.rules, trucksAvailable: 15, available: 35,
      shift: s.crew.shifts[0],
    });
    expect(ev.total).toBe(p.crewUsed);                       // 32: the plan does man 6 push dozers …
    const push = p.tasks.find(t => t.ruleId === 'R7_BULK_PUSH')!;
    expect(push.allocated).toBe(ev.ruleCounts.R7_BULK_PUSH); // … but reports 3 (frozen at the 15-truck value)
  });

  // Integrator revision: the original line `expect(push.allocated).toBe(push.requested)` asserted the planner's old
  // (buggy) report that push was NOT reduced. Keeping priority order at crew 30 requires standing 2 push dozers down
  // (P4) rather than cutting EX04 (P2) to 3 trucks, so the planner now reports push 6 → 4. The defect this test guards
  // - "the applied plan mans more crew than the planner reported" - is checked here end-to-end and more strictly:
  // Apply writes allocated trucks AND task caps (PriorityView), and computeManning must then equal crewUsed.
  it('R-PRIO-2 applying the plan (allocated trucks + task caps) mans exactly the crew it reported, within the crew available', () => {
    const { s, res } = site();
    const p = computePriority(s, res, { crewAvailable: 30 });
    expect(p.crewUsed).toBeLessThanOrEqual(30);
    const taskCaps: Record<string, number> = {};
    for (const t of p.tasks ?? []) if (t.allocated < t.requested) taskCaps[t.ruleId] = t.allocated;
    const applied = {
      ...s,
      circuits: s.circuits.map(c => ({ ...c, trucks: p.allocations.find(a => a.circuitId === c.id)!.allocatedTrucks })),
      crew: { ...s.crew, taskCaps },
    };
    const m = computeManning(applied, computeAllCircuits(applied));
    expect(m.total).toBeLessThanOrEqual(30);
    expect(m.total).toBe(p.crewUsed);
  });
});
