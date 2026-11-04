/**
 * Fleet optimiser: allocate the available trucks across active circuits to maximise priority-weighted production,
 * subject to the trucks and crew available.
 *
 *   maximise   Σ_c w_c · bcm_c(n_c)  −  ε · Σ n_c            (ε breaks ties towards fewer trucks / crew)
 *   subject to Σ n_c ≤ trucksAvailable
 *              Σ crew_c(n_c) + siteCrew(Σ n_c) ≤ crewAvailable
 *              0 ≤ n_c ≤ maxTrucks_c   (n_c fixed when the circuit is locked, e.g. deliberately over-trucked)
 *
 * ≤ 8 circuits: exact depth-first branch-and-bound. The bound is a trucks-only knapsack DP (crew relaxed) over the
 * circuits not yet assigned - a valid upper bound, so the optimum is never pruned. More circuits (or a node budget
 * overrun): greedy by marginal weighted bcm per operator. Pure TS (optimise.test.ts).
 */
import type { Circuit, CircuitResult, Id, ManningResult, Scenario } from '@/core/types';
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

export interface OptProblem {
  circuits: OptCircuit[];
  trucksAvailable: number;
  crewAvailable: number;
  /** Site-level crew (fixed roles) at T total trucks, index 0..trucksAvailable (may depend on T, e.g. push-dozer substitution). */
  siteCrew: number[];
  mode: WeightMode;
  /** Geometric weight per rank for 'weighted' mode (P1 × 1, P2 × decay, P3 × decay² …). */
  decay?: number;
  maxNodes?: number;
}

export interface OptSolution {
  alloc: number[];
  objective: number;
  bcm: number;
  crew: number;
  trucks: number;
  feasible: boolean;
  method: 'branch-and-bound' | 'greedy';
  nodes: number;
  weights: number[];
}

const EPS_TRUCK = 0.01;

export function weightsFor(p: Pick<OptProblem, 'circuits' | 'mode' | 'decay'>): number[] {
  const d = p.decay ?? 0.85;
  return p.circuits.map(c => (p.mode === 'volume' ? 1 : d ** (c.rank - 1)));
}

/** Evaluate any allocation against the problem (objective, totals, feasibility). */
export function evaluate(p: OptProblem, alloc: number[], w = weightsFor(p)): Omit<OptSolution, 'method' | 'nodes' | 'weights'> {
  let obj = 0, bcm = 0, crew = 0, trucks = 0;
  p.circuits.forEach((c, i) => {
    const n = alloc[i];
    bcm += c.bcm[n] ?? 0;
    obj += w[i] * (c.bcm[n] ?? 0);
    crew += c.crew[n] ?? 0;
    trucks += n;
  });
  crew += p.siteCrew[Math.min(trucks, p.siteCrew.length - 1)] ?? 0;
  obj -= EPS_TRUCK * trucks;
  const feasible = trucks <= p.trucksAvailable && crew <= p.crewAvailable;
  return { alloc, objective: obj, bcm, crew, trucks, feasible };
}

export function solveAllocation(p: OptProblem): OptSolution {
  const w = weightsFor(p);
  if (p.circuits.length <= 8) {
    const r = branchAndBound(p, w);
    if (r) return r;
  }
  return greedy(p, w);
}

function range(c: OptCircuit, T: number): number[] {
  if (c.locked) return c.current <= T ? [c.current] : [];
  const hi = Math.min(c.maxTrucks, T, c.bcm.length - 1);
  const out: number[] = [];
  for (let n = hi; n >= 0; n--) out.push(n);
  return out;
}

function branchAndBound(p: OptProblem, w: number[]): OptSolution | null {
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
  // incumbent: greedy (gives an immediate strong bound)
  const g = greedy(p, w);
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
      const total = crew + (p.siteCrew[Math.min(used, p.siteCrew.length - 1)] ?? 0);
      if (total <= p.crewAvailable && val > bestObj + 1e-9) { bestObj = val; bestAlloc = cur.slice(); }
      return;
    }
    for (const n of range(cs[i], tLeft)) {
      const c = cs[i].crew[n] ?? 0;
      if (crew + c + siteMin > p.crewAvailable) continue;
      const v = val + ws[i] * cs[i].bcm[n] - EPS_TRUCK * n;
      if (v + ub[i + 1][tLeft - n] <= bestObj + 1e-9) continue;
      cur[i] = n;
      dfs(i + 1, tLeft - n, v, crew + c);
    }
    cur[i] = 0;
  };
  dfs(0, T, 0, 0);
  if (aborted) return null;
  if (!bestAlloc) return { ...evaluate(p, p.circuits.map(c => (c.locked ? c.current : 0)), w), method: 'branch-and-bound', nodes, weights: w };
  const ba: number[] = bestAlloc;
  const alloc = new Array(k).fill(0);
  order.forEach((orig, j) => { alloc[orig] = ba[j]; });
  return { ...evaluate(p, alloc, w), method: 'branch-and-bound', nodes, weights: w };
}

/** Greedy: repeatedly add the truck with the best weighted gain per extra operator (starting a loader costs its crew). */
function greedy(p: OptProblem, w: number[]): OptSolution {
  const k = p.circuits.length;
  const alloc = p.circuits.map(c => (c.locked ? c.current : 0));
  let nodes = 0;
  const totals = () => evaluate(p, alloc, w);
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
        const e = evaluate(p, trial, w);
        if (!e.feasible) break;
        const gain = e.objective - base.objective;
        if (gain <= 1e-6) continue;
        const dCrew = Math.max(1, e.crew - base.crew);
        const score = gain / dCrew;
        if (!best || score > best.score) best = { i, n: alloc[i] + step, score };
      }
    }
    if (!best) break;
    alloc[best.i] = best.n;
  }
  return { ...totals(), method: 'greedy', nodes, weights: w };
}

// ─────────────────────────────────────────────────────────────── scenario adapter

export interface FleetOptimisation {
  problem: OptProblem;
  solution: OptSolution;
  current: ReturnType<typeof evaluate>;
  rows: { circuit: Circuit; current: number; proposed: number; bcmNow: number; bcmNew: number; crewNow: number; crewNew: number; locked: boolean }[];
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
  computeManning: (s: Scenario, r: Record<Id, CircuitResult>) => ManningResult;
  evalCircuit?: (c: Circuit, opts: { trucks?: number }) => CircuitResult;
}

const withTrucks = (s: Scenario, f: (c: Circuit) => number): Scenario => ({ ...s, circuits: s.circuits.map(c => ({ ...c, trucks: f(c) })) });

/** Build the optimisation problem from a scenario (crew per circuit from the rule evaluator) and solve it. */
export function optimiseFleet(s: Scenario, results: Record<Id, CircuitResult>, b: BuildOptions): FleetOptimisation {
  const T = Math.max(0, Math.floor(b.trucksAvailable ?? s.fleet.trucksAvailable));
  const act = s.circuits.filter(c => c.active && results[c.id]?.ok).sort((x, y) => x.priority - y.priority);
  const ids = new Set(act.map(c => c.id));
  const zero = withTrucks(s, () => 0);
  // site-level lines (no circuitId) as a function of total trucks: place T trucks on the first circuit.
  const siteCrew: number[] = [];
  for (let t = 0; t <= T; t++) {
    const m = b.computeManning(act.length ? withTrucks(s, c => (c.id === act[0].id ? t : 0)) : zero, results);
    siteCrew.push(m.lines.filter(l => !l.circuitId || !ids.has(l.circuitId)).reduce((a, l) => a + l.count, 0));
  }
  const circuits: OptCircuit[] = act.map((c, i) => {
    const r = results[c.id];
    const maxT = Math.min(T, Math.max(r.options.length, c.trucks));
    const bcm: number[] = [], crew: number[] = [];
    for (let n = 0; n <= maxT; n++) {
      bcm.push(bcmAt(r, c, n, b.evalCircuit));
      const m = b.computeManning(withTrucks(s, x => (x.id === c.id ? n : 0)), results);
      crew.push(m.lines.filter(l => l.circuitId === c.id).reduce((a, l) => a + l.count, 0));
    }
    const locked = !!b.keepDeliberate && !!c.tags?.some(t => t === 'deliberate' || t.startsWith('deliberate:'));
    return { id: c.id, name: c.name, rank: i + 1, current: c.trucks, maxTrucks: maxT, bcm, crew, locked };
  });
  const problem: OptProblem = { circuits, trucksAvailable: T, crewAvailable: b.crewAvailable, siteCrew, mode: b.mode ?? 'weighted', decay: b.decay };
  const solution = solveAllocation(problem);
  const current = evaluate(problem, circuits.map(c => Math.min(c.current, c.bcm.length - 1)));
  const rows = act.map((c, i) => ({
    circuit: c, current: c.trucks, proposed: solution.alloc[i],
    bcmNow: circuits[i].bcm[Math.min(c.trucks, circuits[i].bcm.length - 1)] ?? 0, bcmNew: circuits[i].bcm[solution.alloc[i]] ?? 0,
    crewNow: circuits[i].crew[Math.min(c.trucks, circuits[i].crew.length - 1)] ?? 0, crewNew: circuits[i].crew[solution.alloc[i]] ?? 0,
    locked: !!circuits[i].locked,
  }));
  const proposedScenario = withTrucks(s, c => { const k = act.findIndex(x => x.id === c.id); return k >= 0 ? solution.alloc[k] : c.trucks; });
  const crewExact = b.computeManning(proposedScenario, results).total;
  return { problem, solution, current, rows, crewExact };
}

/** Scenario transform applying a proposed allocation. */
export const applyAllocation = (rows: FleetOptimisation['rows']) => (s: Scenario): Scenario => ({
  ...s,
  circuits: s.circuits.map(c => { const r = rows.find(x => x.circuit.id === c.id); return r ? { ...c, trucks: r.proposed } : c; }),
});
