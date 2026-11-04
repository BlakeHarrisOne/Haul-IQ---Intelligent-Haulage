/**
 * Priority planner: allocate trucks and crew to circuits in priority order (1 first).
 *
 *   1. Trucks: each active circuit (priority order) gets min(requested, trucks left).
 *   2. Crew: while the crew rules need more people than the shift has, shed from the LOWEST priority item:
 *      a prioritised site task (CrewRuleExt.priority, e.g. bulk push = Targets priority 4) loses one person, or a
 *      circuit loses one truck; a circuit at 0 trucks is parked (its loader operator and support roles go too).
 *   3. Back-fill: in priority order, re-add trucks / task people while the crew still fits (uses any slack a park freed).
 *   4. Report lost bcm/day and loader PT per circuit, and evaluate each circuit's altHaulStringIds
 *      (computeCircuit(…, { haulStringId })) for trucks needed and production deltas.
 */
import type { Circuit, CircuitResult, Id, PriorityAllocation, PriorityResult, Scenario } from '@/core/types';
import type { CircuitResultExt, CrewRuleExt } from '../types';
import { computeCircuit } from '../haul/circuit';
import { crewCircuits, evaluateCrew, type CrewEvalResult } from '../manning/evaluate';
import { fmt, fmtInt, StepLog } from '../util/steps';

export interface PriorityOptions {
  /** Crew available (default: the active shift crew). */
  crewAvailable?: number;
  /** Trucks available (default: scenario.fleet.trucksAvailable). */
  trucksAvailable?: number;
  shiftId?: Id;
  /** Shed prioritised site tasks (rules with a priority) like circuits (default true). */
  shedSiteTasks?: boolean;
}

export interface PriorityTask {
  ruleId: Id;
  name: string;
  priority: number;
  requested: number;
  allocated: number;
  bcmDayLost: number;
}

export interface PriorityResultExt extends PriorityResult {
  tasks: PriorityTask[];
  crewRequired: number;
  bcmDayPlanned: number;
  bcmDayAchieved: number;
  warnings: string[];
}

type Item = { kind: 'circuit'; c: Circuit; priority: number; order: number } | { kind: 'task'; rule: CrewRuleExt; priority: number; order: number };

/**
 * Plan allocations for the available crew and trucks.
 * @param scenario scenario
 * @param results circuit results (computeAllCircuits)
 * @param opts crew / trucks available overrides
 */
export function computePriority(scenario: Scenario, results: Record<Id, CircuitResult>, opts: PriorityOptions = {}): PriorityResultExt {
  const log = new StepLog();
  const narrative: string[] = [];
  const warnings: string[] = [];
  const shift = scenario.crew.shifts.find(s => s.id === (opts.shiftId ?? scenario.crew.activeShiftId));
  const trucksAvail = Math.max(0, opts.trucksAvailable ?? scenario.fleet.trucksAvailable);
  const circuits = scenario.circuits.map((c, order) => ({ c, order })).filter(x => x.c.active)
    .sort((a, b) => a.c.priority - b.c.priority || a.order - b.order).map(x => x.c);
  const rules = scenario.crew.rules;
  const requested = new Map(circuits.map(c => [c.id, Math.max(0, Math.round(c.trucks))]));
  const evalAt = (alloc: Map<Id, number>, overrides: Record<string, number>, available: number): CrewEvalResult =>
    evaluateCrew({ circuits: crewCircuits(scenario, id => alloc.get(id) ?? 0), rules, trucksAvailable: trucksAvail, available, shift, overrides });

  const planEval = evalAt(requested, {}, 0);
  const crewAvail = opts.crewAvailable ?? shift?.available ?? planEval.total;
  if (opts.crewAvailable == null && !shift) warnings.push('No active shift crew defined: crew is not limiting.');

  // 1. trucks in priority order
  const alloc = new Map<Id, number>();
  let left = trucksAvail;
  for (const c of circuits) {
    const n = Math.min(requested.get(c.id) ?? 0, left);
    alloc.set(c.id, n);
    left -= n;
  }
  const truckCut = circuits.filter(c => (alloc.get(c.id) ?? 0) < (requested.get(c.id) ?? 0));
  const reqTrucks = [...requested.values()].reduce((a, b) => a + b, 0);
  if (truckCut.length) {
    narrative.push(`Trucks ${reqTrucks} requested > ${trucksAvail} available: ${truckCut.map(c => `${c.name} ${requested.get(c.id)} → ${alloc.get(c.id)}`).join(', ')}.`);
  }
  log.add('priority', 'priority.trucks', 'Trucks allocated in priority order', 'n_i = min(requested_i, trucks left)', trucksAvail - left, 'trucks', {
    substituted: circuits.map(c => `P${c.priority} ${c.loaderUnitId} ${alloc.get(c.id)}/${requested.get(c.id)}`).join(' · '),
    inputs: [{ label: 'Trucks available', value: trucksAvail, source: opts.trucksAvailable != null ? 'Input' : 'Fleet · trucks available' }],
  });

  // prioritised site tasks
  const tasks = opts.shedSiteTasks === false ? [] : (rules as CrewRuleExt[]).filter(r => r.enabled && r.priority != null && r.scope === 'site');
  const overrides: Record<string, number> = {};
  let ev = evalAt(alloc, overrides, crewAvail);
  const taskFull: Record<string, number> = {};
  for (const t of tasks) { taskFull[t.id] = ev.ruleCounts[t.id] ?? 0; }

  const items: Item[] = [
    ...circuits.map((c, order) => ({ kind: 'circuit' as const, c, priority: c.priority, order })),
    ...tasks.map((rule, k) => ({ kind: 'task' as const, rule, priority: rule.priority as number, order: circuits.length + k })),
  ];
  const shedOrder = [...items].sort((a, b) => b.priority - a.priority || b.order - a.order);
  const fillOrder = [...items].sort((a, b) => a.priority - b.priority || a.order - b.order);
  const crewRequired = ev.total;
  if (ev.total > crewAvail) {
    narrative.unshift(`Crew ${crewAvail}${shift ? ` (${shift.name})` : ''} < ${ev.total} required: short by ${ev.total - crewAvail}.`);
  } else {
    narrative.unshift(`Crew ${crewAvail}${shift ? ` (${shift.name})` : ''} ≥ ${ev.total} required: every circuit can be fully manned.`);
  }
  log.add('priority', 'priority.required', 'Crew required for the truck allocation', 'Σ crew rules', ev.total, 'people', {
    substituted: `${crewAvail} available → ${ev.total > crewAvail ? `short ${ev.total - crewAvail}` : `spare ${crewAvail - ev.total}`}`,
    inputs: [{ label: 'Crew available', value: crewAvail, source: opts.crewAvailable != null ? 'Input' : shift ? `Shift crew · ${shift.name}` : 'Not limited' }],
  });

  // 2. shed lowest priority first
  const before = new Map(alloc);
  const taskCount = (t: CrewRuleExt) => overrides[t.id] ?? taskFull[t.id] ?? 0;
  let guard = 0;
  while (ev.total > crewAvail && guard++ < 1000) {
    const it = shedOrder.find(x => (x.kind === 'task' ? taskCount(x.rule) > 0 : (alloc.get(x.c.id) ?? 0) > 0));
    if (!it) break;
    if (it.kind === 'task') overrides[it.rule.id] = taskCount(it.rule) - 1;
    else alloc.set(it.c.id, (alloc.get(it.c.id) ?? 0) - 1);
    ev = evalAt(alloc, overrides, crewAvail);
  }
  if (ev.total > crewAvail) {
    warnings.push(`Fixed site roles alone need ${ev.total} people > ${crewAvail} available: no mining can be fully manned.`);
    narrative.push(`Fixed site roles alone need ${ev.total} > ${crewAvail}: check supervision / statutory roles.`);
  }
  // 3. back-fill with any slack, most important first
  for (const it of fillOrder) {
    let k = 0;
    while (k++ < 100) {
      if (it.kind === 'task') {
        const full = taskFull[it.rule.id] ?? 0;
        if (taskCount(it.rule) >= full) break;
        const trial = { ...overrides, [it.rule.id]: taskCount(it.rule) + 1 };
        const e2 = evalAt(alloc, trial, crewAvail);
        if (e2.total > crewAvail) break;
        Object.assign(overrides, trial);
        ev = e2;
      } else {
        const cur = alloc.get(it.c.id) ?? 0;
        const used = [...alloc.values()].reduce((a, b) => a + b, 0);
        if (cur >= (requested.get(it.c.id) ?? 0) || used >= trucksAvail) break;
        const trial = new Map(alloc).set(it.c.id, cur + 1);
        const e2 = evalAt(trial, overrides, crewAvail);
        if (e2.total > crewAvail) break;
        alloc.set(it.c.id, cur + 1);
        ev = e2;
      }
    }
  }
  for (const t of tasks) if (overrides[t.id] != null && overrides[t.id] >= (taskFull[t.id] ?? 0)) delete overrides[t.id];

  // 4. report
  const allocations: PriorityAllocation[] = [];
  let planned = 0, achieved = 0;
  const reqEval = evalAt(requested, {}, crewAvail);
  for (const c of circuits) {
    const r = results[c.id] as CircuitResultExt | undefined;
    const nReq = requested.get(c.id) ?? 0, nAl = alloc.get(c.id) ?? 0;
    const optReq = optionAt(scenario, c, r, nReq), optAl = optionAt(scenario, c, r, nAl);
    const status: PriorityAllocation['status'] = nAl >= nReq ? 'full' : nAl === 0 ? 'parked' : 'reduced';
    const alternatives: PriorityAllocation['alternatives'] = [];
    for (const altId of c.altHaulStringIds ?? []) {
      const hs = scenario.strings.find(s => s.id === altId);
      if (!hs) continue;
      const at = Math.max(1, nAl);
      const ar = computeCircuit(scenario, c, { haulStringId: altId, trucks: at });
      if (!ar.ok) continue;
      const baseBcm = nAl > 0 ? optAl.bcm : optionAt(scenario, c, r, 1).bcm;
      alternatives.push({ haulStringId: altId, name: hs.name, trucksNeeded: ar.trucksRecommended, bcmDay: ar.assigned.bcmPerDay, deltaBcmDay: ar.assigned.bcmPerDay - baseBcm });
    }
    planned += optReq.bcm;
    achieved += optAl.bcm;
    allocations.push({
      circuitId: c.id, priority: c.priority, requestedTrucks: nReq, allocatedTrucks: nAl, crewRequested: reqEval.byCircuit[c.id] ?? 0,
      crewAllocated: ev.byCircuit[c.id] ?? 0, status, bcmDayPlanned: optReq.bcm, bcmDayAchieved: optAl.bcm, bcmDayLost: optReq.bcm - optAl.bcm,
      lostPtHrsShift: optAl.lostPt, alternatives,
    });
    const b4 = before.get(c.id) ?? 0;
    if (status !== 'full') {
      const why = nAl < b4 || b4 === nReq ? 'crew' : 'trucks';
      const lostTxt = `−${fmtInt(optReq.bcm - optAl.bcm)} bcm/day${nAl > 0 ? `, loader hangs ${fmt(optAl.lostPt, 2)} h/shift` : ''}`;
      narrative.push(status === 'parked'
        ? `${c.name} (P${c.priority}) parked (${why} short): ${lostTxt}.`
        : `${c.name} (P${c.priority}) reduced from ${nReq} to ${nAl} truck${nAl === 1 ? '' : 's'} (${lostTxt}).`);
      log.add('priority', `priority.${c.id}`, `${c.name}: ${status}`, 'bcm lost = V(n_requested) − V(n_allocated)', optReq.bcm - optAl.bcm, 'bcm/day', {
        substituted: `${fmt(optReq.bcm, 0)} − ${fmt(optAl.bcm, 0)} (n ${nReq} → ${nAl})`,
        note: `Loader PT lost ${fmt(optAl.lostPt, 2)} h/shift at ${nAl} trucks. Crew ${reqEval.byCircuit[c.id] ?? 0} → ${ev.byCircuit[c.id] ?? 0}.`,
      });
      for (const a of alternatives) {
        narrative.push(`  ${a.name}: needs ${a.trucksNeeded} truck${a.trucksNeeded === 1 ? '' : 's'} (vs ${r?.trucksRecommended ?? '–'} on the current route); `
          + `${fmtInt(a.bcmDay)} bcm/day at ${Math.max(1, nAl)} truck${Math.max(1, nAl) === 1 ? '' : 's'} (${a.deltaBcmDay >= 0 ? '+' : '−'}${fmtInt(Math.abs(a.deltaBcmDay))}).`);
      }
    }
  }
  const taskOut: PriorityTask[] = tasks.map(t => {
    const full = taskFull[t.id] ?? 0, got = overrides[t.id] ?? full;
    const lost = (full - got) * (t.bcmPerUnitDay ?? 0);
    if (got < full) {
      narrative.push(`${t.name} (P${t.priority}) reduced ${full} → ${got}${t.bcmPerUnitDay ? ` (−${fmtInt(lost)} bcm/day)` : ''}.`);
      log.add('priority', `priority.task.${t.id}`, `${t.name}: reduced`, 'people = full − shed', got, 'people', {
        substituted: `${full} → ${got}`, sheetRef: t.sheetRef, note: t.bcmPerUnitDay ? `${fmtInt(t.bcmPerUnitDay)} bcm/day per person.` : undefined,
      });
    }
    planned += full * (t.bcmPerUnitDay ?? 0);
    achieved += got * (t.bcmPerUnitDay ?? 0);
    return { ruleId: t.id, name: t.name, priority: t.priority as number, requested: full, allocated: got, bcmDayLost: lost };
  });
  const trucksUsed = [...alloc.values()].reduce((a, b) => a + b, 0);
  narrative.push(`Crew used ${ev.total} of ${crewAvail}; trucks ${trucksUsed} of ${trucksAvail}; production ${fmtInt(planned)} → ${fmtInt(achieved)} bcm/day`
    + `${planned - achieved > 0.5 ? ` (−${fmtInt(planned - achieved)})` : ''}.`);
  log.add('priority', 'priority.result', 'Production achieved', 'Σ V(n_allocated) (+ site tasks)', achieved, 'bcm/day', {
    substituted: `planned ${fmt(planned, 0)} − lost ${fmt(planned - achieved, 0)}`,
  });
  return {
    crewAvailable: crewAvail, crewUsed: ev.total, trucksAvailable: trucksAvail, trucksUsed, allocations, narrative, steps: log.steps,
    tasks: taskOut, crewRequired, bcmDayPlanned: planned, bcmDayAchieved: achieved, warnings: [...warnings, ...ev.warnings],
  };
}

/** Production and loader PT lost at n trucks (from the result's options, recomputing beyond the table). */
function optionAt(scenario: Scenario, c: Circuit, r: CircuitResultExt | undefined, n: number): { bcm: number; lostPt: number } {
  if (!r?.ok) return { bcm: 0, lostPt: 0 };
  if (n <= 0) return { bcm: 0, lostPt: r.loaderPtTargetHrs / (c.params.shiftsPerDay || 2) };
  const o = n <= r.options.length ? r.options[n - 1] : computeCircuit(scenario, c, { trucks: n }).assigned;
  return { bcm: o.bcmPerDay, lostPt: o.lostLoaderPtHrsShift };
}
