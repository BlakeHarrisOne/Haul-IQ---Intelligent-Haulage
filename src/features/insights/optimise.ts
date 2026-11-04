/**
 * Fleet optimiser: allocate the available trucks across active circuits to maximise priority-weighted production,
 * subject to the trucks and crew available.
 *
 *   maximise   Σ_c w_c · bcm_c(n_c)  −  ε · Σ n_c            (ε breaks ties towards fewer trucks / crew)
 *   subject to Σ n_c ≤ trucksAvailable
 *              Σ crew_c(n_c) + siteCrew(Σ n_c) ≤ crewAvailable
 *              0 ≤ n_c ≤ maxTrucks_c   (n_c fixed when the circuit is locked, e.g. deliberately over-trucked)
 *
 * Prioritised site tasks (e.g. bulk push dozers, CrewRuleExt.priority) are sheddable: they take the crew left after
 * fixed roles and circuits, filled by weighted bcm per person (tasks are linear in people, so this fill is optimal).
 *
 * ≤ 8 circuits: exact depth-first branch-and-bound. The bound is a trucks-only knapsack DP (crew relaxed) over the
 * circuits not yet assigned plus every task fully crewed - a valid upper bound, so the optimum is never pruned.
 * More circuits (or a node budget overrun): greedy by marginal weighted bcm per operator. Pure TS (optimise.test.ts).
 */
import type { Circuit, CircuitResult, Id, ManningResult, Scenario } from '@/core/types';
import type { CrewRuleExt } from '@/engine';
import { bcmAt } from './engine';

export type WeightMode = 'weighted' | 'volume';

export interface OptCircuit {
  id: Id;
  name: string;
  /** 1-based rank among the circuits being optimised (1 = highest priority). */
  rank: number;
  current: number;
  maxTrucks: number;
  /** bcm/day at n trucks, index 0..maxTrucks. */
  bcm: number[];
  /** Operators the circuit needs at n trucks (trucks + loader + support), index 0..maxTrucks. */
  crew: number[];
  locked?: boolean;
}

/** A sheddable site task: people 0..req[T], each worth valuePerPerson bcm/day. Uses crew, not trucks. */
export interface OptTask {
  id: Id;
  name: string;
  rank: number;
  valuePerPerson: number;
  /** People the task wants at T total trucks, index 0..trucksAvailable (e.g. push dozers fall as trucks rise above 12). */
  req: number[];
}

export interface OptProblem {
  circuits: OptCircuit[];
  tasks?: OptTask[];
  trucksAvailable: number;
  crewAvailable: number;
  /** Fixed site crew (non-task site roles) at T total trucks, index 0..trucksAvailable. */
  siteCrew: number[];
  mode: WeightMode;
  /** Geometric weight per rank for 'weighted' mode (P1 × 1, P2 × decay, P3 × decay² …). */
  decay?: number;
  maxNodes?: number;
}

export interface OptSolution {
  alloc: number[];
  /** People per task (same order as problem.tasks). */
  taskAlloc: number[];
  /** Crew for fixed roles + circuits (tasks excluded). */
  crewCore: number;
  objective: number;
  bcm: number;
  crew: number;
  trucks: number;
  feasible: boolean;
  method: 'branch-and-bound' | 'greedy';
  nodes: number;
  weights: number[];
  taskWeights: number[];
}

const EPS_TRUCK = 0.01;

export function weightsFor(p: Pick<OptProblem, 'circuits' | 'mode' | 'decay'>): number[] {
  const d = p.decay ?? 0.85;
  return p.circuits.map(c => (p.mode === 'volume' ? 1 : d ** (c.rank - 1)));
}
export function taskWeightsFor(p: Pick<OptProblem, 'tasks' | 'mode' | 'decay'>): number[] {
  const d = p.decay ?? 0.85;
  return (p.tasks ?? []).map(t => (p.mode === 'volume' ? 1 : d ** (t.rank - 1)));
}

const at = (arr: number[], i: number) => arr[Math.min(Math.max(0, i), arr.length - 1)] ?? 0;

/** Fill sheddable tasks with the crew left, best weighted bcm per person first (optimal for linear tasks). */
function fillTasks(p: OptProblem, T: number, left: number, wt: number[]) {
  const tasks = p.tasks ?? [];
  const alloc = new Array(tasks.length).fill(0);
  let value = 0, bcm = 0, people = 0;
  const order = tasks.map((_, i) => i).sort((a, b) => wt[b] * tasks[b].valuePerPerson - wt[a] * tasks[a].valuePerPerson || tasks[a].rank - tasks[b].rank);
  for (const i of order) {
    const n = Math.max(0, Math.min(at(tasks[i].req, T), left));
    alloc[i] = n; left -= n; people += n;
    value += wt[i] * tasks[i].valuePerPerson * n;
    bcm += tasks[i].valuePerPerson * n;
  }
  return { alloc, value, bcm, people };
}

/** Evaluate any allocation against the problem (objective, totals, feasibility). */
export function evaluate(p: OptProblem, alloc: number[], w = weightsFor(p), wt = taskWeightsFor(p)): Omit<OptSolution, 'method' | 'nodes' | 'weights' | 'taskWeights'> {
  let obj = 0, bcm = 0, crew = 0, trucks = 0;
  p.circuits.forEach((c, i) => {
    const n = alloc[i];
    bcm += c.bcm[n] ?? 0;
    obj += w[i] * (c.bcm[n] ?? 0);
    crew += c.crew[n] ?? 0;
    trucks += n;
  });
  crew += at(p.siteCrew, trucks);
  obj -= EPS_TRUCK * trucks;
  const feasible = trucks <= p.trucksAvailable && crew <= p.crewAvailable;
  const f = fillTasks(p, trucks, Math.max(0, p.crewAvailable - crew), wt);
  return { alloc, taskAlloc: f.alloc, objective: obj + f.value, bcm: bcm + f.bcm, crew: crew + f.people, crewCore: crew, trucks, feasible };
}

export function solveAllocation(p: OptProblem): OptSolution {
  const w = weightsFor(p), wt = taskWeightsFor(p);
  if (p.circuits.length <= 8) {
    const r = branchAndBound(p, w, wt);
    if (r) return r;
  }
  return greedy(p, w, wt);
}

function range(c: OptCircuit, T: number): number[] {
  if (c.locked) return c.current <= T ? [c.current] : [];
  const hi = Math.min(c.maxTrucks, T, c.bcm.length - 1);
  const out: number[] = [];
  for (let n = hi; n >= 0; n--) out.push(n);
  return out;
}

function branchAndBound(p: OptProblem, w: number[], wt: number[]): OptSolution | null {
  const k = p.circuits.length, T = p.trucksAvailable;
  const maxNodes = p.maxNodes ?? 2_000_000;
  // Explore circuits in descending weight order (strong incumbents early); map back at the end.
  const order = p.circuits.map((_, i) => i).sort((a, b) => w[b] - w[a] || a - b);
  const cs = order.map(i => p.circuits[i]);
  const ws = order.map(i => w[i]);
  const siteSlice = p.siteCrew.slice(0, T + 1);
  const siteMin = siteSlice.length ? Math.min(...siteSlice) : 0;
  // ub[i][t]: best weighted value of circuits i..k-1 using ≤ t trucks (crew relaxed). Knapsack DP.
  const ub: number[][] = Array.from({ length: k + 1 }, () => new Array(T + 1).fill(0));
  for (let i = k - 1; i >= 0; i--) {
    for (let t = 0; t <= T; t++) {
      let best = -Infinity;
      for (const n of range(cs[i], t)) best = Math.max(best, ws[i] * cs[i].bcm[n] - EPS_TRUCK * n + ub[i + 1][t - n]);
      ub[i][t] = best;
    }
  }
  // every task fully crewed at its largest request - added to the bound
  const taskUB = (p.tasks ?? []).reduce((a, t, i) => a + wt[i] * t.valuePerPerson * Math.max(0, ...t.req), 0);
  // incumbent: greedy (gives an immediate strong bound)
  const g = greedy(p, w, wt);
  let bestObj = g.feasible ? g.objective : -Infinity;
  let bestAlloc: number[] | null = g.feasible ? order.map(i => g.alloc[i]) : null;
  const cur = new Array(k).fill(0);
  let nodes = 0;
  let aborted = false;

  const dfs = (i: number, tLeft: number, val: number, crew: number) => {
    if (aborted) return;
    if (++nodes > maxNodes) { aborted = true; return; }
    if (i === k) {
      const used = T - tLeft;
      const total = crew + at(p.siteCrew, used);
      if (total > p.crewAvailable) return;
      const v = val + fillTasks(p, used, p.crewAvailable - total, wt).value;
      if (v > bestObj + 1e-9) { bestObj = v; bestAlloc = cur.slice(); }
      return;
    }
    for (const n of range(cs[i], tLeft)) {
      const c = cs[i].crew[n] ?? 0;
      if (crew + c + siteMin > p.crewAvailable) continue;
      const v = val + ws[i] * cs[i].bcm[n] - EPS_TRUCK * n;
      if (v + ub[i + 1][tLeft - n] + taskUB <= bestObj + 1e-9) continue;
      cur[i] = n;
      dfs(i + 1, tLeft - n, v, crew + c);
    }
    cur[i] = 0;
  };
  dfs(0, T, 0, 0);
  if (aborted) return null;
  if (!bestAlloc) return { ...evaluate(p, p.circuits.map(c => (c.locked ? c.current : 0)), w, wt), method: 'branch-and-bound', nodes, weights: w, taskWeights: wt };
  const ba: number[] = bestAlloc;
  const alloc = new Array(k).fill(0);
  order.forEach((orig, j) => { alloc[orig] = ba[j]; });
  return { ...evaluate(p, alloc, w, wt), method: 'branch-and-bound', nodes, weights: w, taskWeights: wt };
}

/** Greedy: repeatedly add the truck with the best weighted gain per extra operator (starting a loader costs its crew). */
function greedy(p: OptProblem, w: number[], wt: number[]): OptSolution {
  const k = p.circuits.length;
  const alloc = p.circuits.map(c => (c.locked ? c.current : 0));
  let nodes = 0;
  const totals = () => evaluate(p, alloc, w, wt);
  for (;;) {
    const base = totals();
    let best: { i: number; n: number; score: number } | null = null;
    for (let i = 0; i < k; i++) {
      const c = p.circuits[i];
      if (c.locked) continue;
      // consider stepping 1 truck, or jumping to several at once (so a loader with a high start-up crew can start)
      for (let step = 1; alloc[i] + step <= Math.min(c.maxTrucks, c.bcm.length - 1); step++) {
        nodes++;
        const trial = alloc.slice(); trial[i] += step;
        const e = evaluate(p, trial, w, wt);
        if (!e.feasible) break;
        const gain = e.objective - base.objective;
        if (gain <= 1e-6) continue;
        const dCrew = Math.max(1, e.crewCore - base.crewCore);
        const score = gain / dCrew;
        if (!best || score > best.score) best = { i, n: alloc[i] + step, score };
      }
    }
    if (!best) break;
    alloc[best.i] = best.n;
  }
  return { ...totals(), method: 'greedy', nodes, weights: w, taskWeights: wt };
}

// ─────────────────────────────────────────────────────────────── scenario adapter

export interface FleetOptimisation {
  problem: OptProblem;
  solution: OptSolution;
  current: ReturnType<typeof evaluate>;
  rows: { circuit: Circuit; current: number; proposed: number; bcmNow: number; bcmNew: number; crewNow: number; crewNew: number; locked: boolean }[];
  taskRows: { rule: CrewRuleExt; current: number; proposed: number; bcmNow: number; bcmNew: number }[];
  /** Crew from the full rule evaluator at the proposed allocation (checks the separable model). */
  crewExact?: number;
}

export interface BuildOptions {
  crewAvailable: number;
  trucksAvailable?: number;
  mode?: WeightMode;
  decay?: number;
  /** Keep circuits tagged 'deliberate' at their current truck count. */
  keepDeliberate?: boolean;
  /** Circuits pinned at their current truck count. */
  lockedIds?: Id[];
  computeManning: (s: Scenario, r: Record<Id, CircuitResult>) => ManningResult;
  evalCircuit?: (c: Circuit, opts: { trucks?: number }) => CircuitResult;
}

const withTrucks = (s: Scenario, f: (c: Circuit) => number): Scenario => ({ ...s, circuits: s.circuits.map(c => ({ ...c, trucks: f(c) })) });

/** Build the optimisation problem from a scenario (crew per circuit from the rule evaluator) and solve it. */
export function optimiseFleet(s: Scenario, results: Record<Id, CircuitResult>, b: BuildOptions): FleetOptimisation {
  const T = Math.max(0, Math.floor(b.trucksAvailable ?? s.fleet.trucksAvailable));
  const act = s.circuits.filter(c => c.active && results[c.id]?.ok).sort((x, y) => x.priority - y.priority);
  const ids = new Set(act.map(c => c.id));
  const taskRules = (s.crew.rules as CrewRuleExt[]).filter(r => r.enabled && r.scope === 'site' && r.priority != null);
  const taskIds = new Set(taskRules.map(r => r.id));
  // combined priority ranks (circuits and site tasks)
  const ranked = [...act.map(c => ({ id: c.id, p: c.priority, k: 0 })), ...taskRules.map(r => ({ id: r.id, p: r.priority as number, k: 1 }))]
    .sort((x, y) => x.p - y.p || x.k - y.k);
  const rankOf = (id: Id) => ranked.findIndex(x => x.id === id) + 1;
  const zero = withTrucks(s, () => 0);
  // fixed site lines and task requests as functions of total trucks: place T trucks on the first circuit.
  const siteCrew: number[] = [];
  const taskReq: number[][] = taskRules.map(() => []);
  for (let t = 0; t <= T; t++) {
    const m = b.computeManning(act.length ? withTrucks(s, c => (c.id === act[0].id ? t : 0)) : zero, results);
    const site = m.lines.filter(l => !l.circuitId || !ids.has(l.circuitId));
    siteCrew.push(site.filter(l => !taskIds.has(l.ruleId)).reduce((a, l) => a + l.count, 0));
    taskRules.forEach((r, i) => taskReq[i].push(Math.max(0, site.filter(l => l.ruleId === r.id).reduce((a, l) => a + l.count, 0))));
  }
  const circuits: OptCircuit[] = act.map(c => {
    const r = results[c.id];
    const maxT = Math.min(T, Math.max(r.options.length, c.trucks));
    const bcm: number[] = [], crew: number[] = [];
    for (let n = 0; n <= maxT; n++) {
      bcm.push(bcmAt(r, c, n, b.evalCircuit));
      const m = b.computeManning(withTrucks(s, x => (x.id === c.id ? n : 0)), results);
      crew.push(m.lines.filter(l => l.circuitId === c.id).reduce((a, l) => a + l.count, 0));
    }
    const locked = (!!b.keepDeliberate && !!c.tags?.some(t => t === 'deliberate' || t.startsWith('deliberate:'))) || !!b.lockedIds?.includes(c.id);
    return { id: c.id, name: c.name, rank: rankOf(c.id), current: c.trucks, maxTrucks: maxT, bcm, crew, locked };
  });
  const tasks: OptTask[] = taskRules.map((r, i) => ({ id: r.id, name: r.name, rank: rankOf(r.id), valuePerPerson: r.bcmPerUnitDay ?? 0, req: taskReq[i] }));
  const problem: OptProblem = { circuits, tasks, trucksAvailable: T, crewAvailable: b.crewAvailable, siteCrew, mode: b.mode ?? 'weighted', decay: b.decay };
  const solution = solveAllocation(problem);
  const current = evaluate(problem, circuits.map(c => Math.min(c.current, c.bcm.length - 1)));
  const rows = act.map((c, i) => ({
    circuit: c, current: c.trucks, proposed: solution.alloc[i],
    bcmNow: circuits[i].bcm[Math.min(c.trucks, circuits[i].bcm.length - 1)] ?? 0, bcmNew: circuits[i].bcm[solution.alloc[i]] ?? 0,
    crewNow: circuits[i].crew[Math.min(c.trucks, circuits[i].crew.length - 1)] ?? 0, crewNew: circuits[i].crew[solution.alloc[i]] ?? 0,
    locked: !!circuits[i].locked,
  }));
  const taskRows = taskRules.map((rule, i) => ({
    rule, current: current.taskAlloc[i], proposed: solution.taskAlloc[i],
    bcmNow: current.taskAlloc[i] * tasks[i].valuePerPerson, bcmNew: solution.taskAlloc[i] * tasks[i].valuePerPerson,
  }));
  const proposedScenario = withTrucks(s, c => { const k = act.findIndex(x => x.id === c.id); return k >= 0 ? solution.alloc[k] : c.trucks; });
  const ex = b.computeManning(proposedScenario, results);
  // exact crew = rule evaluator at the proposed trucks, with the tasks at their proposed people
  const crewExact = ex.total - taskRules.reduce((a, r, i) => a + ex.lines.filter(l => l.ruleId === r.id).reduce((x, l) => x + l.count, 0) - solution.taskAlloc[i], 0);
  return { problem, solution, current, rows, taskRows, crewExact };
}

/** Scenario transform applying a proposed truck allocation. */
export const applyAllocation = (rows: FleetOptimisation['rows']) => (s: Scenario): Scenario => ({
  ...s,
  circuits: s.circuits.map(c => { const r = rows.find(x => x.circuit.id === c.id); return r ? { ...c, trucks: r.proposed } : c; }),
});
