/**
 * Audit 7 — priority planner: never allocates more crew / trucks than available, its crew number is what the rules
 * need for its own allocation, lower priorities are shed first, and alternatives agree with computeCircuit.
 */
import { describe, expect, it } from 'vitest';
import type { Scenario } from '@/core/types';
import { computeAllCircuits, computeCircuit, computePriority, crewCircuits, evaluateCrew } from '@/engine';
import type { CrewRuleExt } from '@/engine/types';
import { createDemoScenario } from '@/state/demo';

/** Crew the rules need for an allocation (trucks per circuit + task people), evaluated independently of the planner. */
function crewFor(s: Scenario, trucks: Map<string, number>, tasks: Record<string, number>, available: number) {
  return evaluateCrew({ circuits: crewCircuits(s, id => trucks.get(id) ?? 0), rules: s.crew.rules, trucksAvailable: s.fleet.trucksAvailable, available, overrides: tasks });
}

function audit(s: Scenario, crewAvailable: number, trucksAvailable?: number): string[] {
  const R = computeAllCircuits(s);
  const pr = computePriority(s, R, { crewAvailable, trucksAvailable });
  const tag = `crew ${crewAvailable}${trucksAvailable != null ? ` trucks ${trucksAvailable}` : ''}`;
  const bad: string[] = [];
  const tAvail = trucksAvailable ?? s.fleet.trucksAvailable;
  const fixedOnly = pr.warnings.some(w => w.startsWith('Fixed site roles'));
  if (pr.trucksUsed > tAvail) bad.push(`${tag}: trucks used ${pr.trucksUsed} > ${tAvail}`);
  if (pr.crewUsed > crewAvailable && !fixedOnly) bad.push(`${tag}: crew used ${pr.crewUsed} > ${crewAvailable}`);
  for (const a of pr.allocations) if (a.allocatedTrucks > a.requestedTrucks || a.allocatedTrucks < 0) bad.push(`${tag}: ${a.circuitId} allocated ${a.allocatedTrucks} of ${a.requestedTrucks}`);
  // the plan as reported (trucks + task people) must need exactly crewUsed people under the rules
  const alloc = new Map(pr.allocations.map(a => [a.circuitId, a.allocatedTrucks]));
  const ov: Record<string, number> = {};
  for (const t of pr.tasks) if (t.allocated < t.requested) ov[t.ruleId] = t.allocated;
  const live = crewFor(s, alloc, ov, crewAvailable);
  if (live.total !== pr.crewUsed) bad.push(`${tag}: rules need ${live.total} for the reported plan, planner says crewUsed ${pr.crewUsed}`);
  if (live.total > crewAvailable && !fixedOnly) bad.push(`${tag}: reported plan needs ${live.total} > ${crewAvailable} available once applied`);
  for (const t of pr.tasks) {
    const got = live.ruleCounts[t.ruleId] ?? 0;
    if (got !== t.allocated) bad.push(`${tag}: task ${t.ruleId} reported ${t.allocated}/${t.requested} but the plan gives ${got}`);
  }
  // priority order: a reduced higher-priority circuit could not have got one more truck by shedding everything below it
  const tasksRules = (s.crew.rules as CrewRuleExt[]).filter(r => r.enabled && r.priority != null && r.scope === 'site');
  for (const a of pr.allocations) {
    if (a.allocatedTrucks >= a.requestedTrucks) continue;
    // only a truck that adds production counts (an over-trucked circuit's extra truck is released on purpose)
    const cc = s.circuits.find(x => x.id === a.circuitId)!;
    const gain = computeCircuit(s, cc, { trucks: a.allocatedTrucks + 1 }).assigned.bcmPerDay - computeCircuit(s, cc, { trucks: a.allocatedTrucks }).assigned.bcmPerDay;
    if (gain < 0.5) continue;
    const trial = new Map(alloc);
    trial.set(a.circuitId, a.allocatedTrucks + 1);
    const tov: Record<string, number> = { ...ov };
    for (const b of pr.allocations) if (b.priority > a.priority) trial.set(b.circuitId, 0);
    for (const r of tasksRules) if ((r.priority as number) > a.priority) tov[r.id] = 0;
    const used = [...trial.values()].reduce((x, y) => x + y, 0);
    const e = crewFor(s, trial, tov, crewAvailable);
    if (e.total <= crewAvailable && used <= tAvail) bad.push(`${tag}: ${a.circuitId} (P${a.priority}) left at ${a.allocatedTrucks}/${a.requestedTrucks} though shedding lower priorities would fit ${a.allocatedTrucks + 1} (needs ${e.total})`);
  }
  // production book-keeping
  const sumA = pr.allocations.reduce((x, a) => x + a.bcmDayAchieved, 0) + pr.tasks.reduce((x, t) => x + t.allocated * ((s.crew.rules.find(r => r.id === t.ruleId) as CrewRuleExt).bcmPerUnitDay ?? 0), 0);
  if (Math.abs(sumA - (pr.bcmDayAchieved ?? NaN)) > 1e-6) bad.push(`${tag}: Σ achieved ${sumA} ≠ ${pr.bcmDayAchieved}`);
  for (const a of pr.allocations) if (Math.abs(a.bcmDayLost - (a.bcmDayPlanned - a.bcmDayAchieved)) > 1e-9) bad.push(`${tag}: ${a.circuitId} lost ≠ planned − achieved`);
  // alternatives agree with computeCircuit on that string
  for (const a of pr.allocations) {
    const c = s.circuits.find(x => x.id === a.circuitId)!;
    for (const alt of a.alternatives) {
      const r = computeCircuit(s, c, { haulStringId: alt.haulStringId, trucks: Math.max(1, a.allocatedTrucks) });
      if (alt.trucksNeeded !== r.trucksRecommended) bad.push(`${tag}: ${a.circuitId} alt ${alt.haulStringId} trucksNeeded ${alt.trucksNeeded} ≠ computeCircuit ${r.trucksRecommended}`);
      if (Math.abs(alt.bcmDay - r.assigned.bcmPerDay) > 1e-6) bad.push(`${tag}: ${a.circuitId} alt bcm ${alt.bcmDay} ≠ ${r.assigned.bcmPerDay}`);
    }
  }
  return bad;
}

describe('audit 7 · priority planner', () => {
  it('demo, crew 40 → 0 (trucks 12): limits, live crew, priority order, alternatives', async () => {
    const s = await createDemoScenario();
    const bad: string[] = [];
    let lastP1 = Infinity;
    for (let crew = 40; crew >= 0; crew--) {
      bad.push(...audit(s, crew));
      const pr = computePriority(s, computeAllCircuits(s), { crewAvailable: crew });
      const p1 = pr.allocations.find(a => a.priority === 1)!.allocatedTrucks;
      if (p1 > lastP1) bad.push(`crew ${crew}: P1 trucks rise ${lastP1} → ${p1} as crew falls`);
      lastP1 = p1;
    }
    expect(bad.slice(0, 15), `${bad.length} issues\n${bad.slice(0, 15).join('\n')}`).toEqual([]);
  });

  it('demo with requests above trucks available (EX09 6, EX04 5, LDR1 4 = 15) at trucks 12 and 15', async () => {
    const s = await createDemoScenario();
    const t = { 'c-ex09': 6, 'c-ex04': 5, 'c-ldr1': 4 } as Record<string, number>;
    s.circuits = s.circuits.map(c => ({ ...c, trucks: t[c.id] ?? c.trucks }));
    const bad: string[] = [];
    const pr = computePriority(s, computeAllCircuits(s), { crewAvailable: 40 });
    const al = Object.fromEntries(pr.allocations.map(a => [a.circuitId, a.allocatedTrucks]));
    if (al['c-ex09'] !== 6 || al['c-ex04'] !== 5 || al['c-ldr1'] !== 1) bad.push(`trucks cut not in priority order: ${JSON.stringify(al)}`);
    for (const trucks of [12, 15]) for (const crew of [40, 36, 35, 32, 30, 28, 24]) bad.push(...audit(s, crew, trucks));
    expect(bad.slice(0, 15), `${bad.length} issues\n${bad.slice(0, 15).join('\n')}`).toEqual([]);
  });

  it('coal circuit below the push task (LDR1 P5, 15 trucks requested, trucks 15): crew 40 → 20', async () => {
    const s = await createDemoScenario();
    const t = { 'c-ex09': 6, 'c-ex04': 5, 'c-ldr1': 4 } as Record<string, number>;
    s.circuits = s.circuits.map(c => ({ ...c, trucks: t[c.id] ?? c.trucks, priority: c.id === 'c-ldr1' ? 5 : c.priority }));
    const bad: string[] = [];
    for (let crew = 40; crew >= 20; crew--) bad.push(...audit(s, crew, 15));
    expect(bad.slice(0, 15), `${bad.length} issues\n${bad.slice(0, 15).join('\n')}`).toEqual([]);
  });

  it('alternatives are evaluated for the long-haul option of EX09', async () => {
    const s = await createDemoScenario();
    const pr = computePriority(s, computeAllCircuits(s), { crewAvailable: 30 });
    const ex9 = pr.allocations.find(a => a.circuitId === 'c-ex09')!;
    expect(ex9.alternatives.length).toBe(1);
    const r = computeCircuit(s, s.circuits[0], { haulStringId: ex9.alternatives[0].haulStringId });
    expect(ex9.alternatives[0].trucksNeeded).toBe(r.trucksRecommended);
  });
});
