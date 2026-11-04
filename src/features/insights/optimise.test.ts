import { describe, expect, it } from 'vitest';
import { evaluate, optimiseFleet, solveAllocation, taskWeightsFor, weightsFor, type OptCircuit, type OptProblem } from './optimise';
import { syntheticScenario } from './synthetic';
import { computeAllCircuits, computeCircuit, computeManning } from '@/engine';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Concave-then-flat production curve like a truck/loader circuit: min(n · perTruck, loaderCap). */
function circuit(id: string, rank: number, perTruck: number, cap: number, support: number, maxTrucks: number, current = 0): OptCircuit {
  const bcm: number[] = [], crew: number[] = [];
  for (let n = 0; n <= maxTrucks; n++) {
    bcm.push(Math.min(n * perTruck, cap));
    crew.push(n === 0 ? 0 : n + 1 + support);
  }
  return { id, name: id, rank, current, maxTrucks, bcm, crew };
}

function brute(p: OptProblem) {
  const w = weightsFor(p);
  let best = -Infinity, bestAlloc: number[] = [];
  const cur = new Array(p.circuits.length).fill(0);
  const rec = (i: number) => {
    if (i === p.circuits.length) {
      const e = evaluate(p, cur, w);
      if (e.feasible && e.objective > best + 1e-9) { best = e.objective; bestAlloc = cur.slice(); }
      return;
    }
    const c = p.circuits[i];
    const ns = c.locked ? [c.current] : Array.from({ length: c.maxTrucks + 1 }, (_, n) => n);
    for (const n of ns) { cur[i] = n; rec(i + 1); }
  };
  rec(0);
  return { best, bestAlloc };
}

describe('fleet optimiser', () => {
  it('fills the loader-limited optimum when trucks are scarce (2 circuits)', () => {
    // A: 300 bcm/truck to 1500 cap (5 trucks); B: 250/truck to 1000 cap (4 trucks); 7 trucks, plenty of crew
    const p: OptProblem = {
      circuits: [circuit('A', 1, 300, 1500, 2, 8), circuit('B', 2, 250, 1000, 2, 8)],
      trucksAvailable: 7, crewAvailable: 99, siteCrew: new Array(8).fill(5), mode: 'volume',
    };
    const s = solveAllocation(p);
    expect(s.method).toBe('branch-and-bound');
    expect(s.feasible).toBe(true);
    // volume: 5 on A (1500) + 2 on B (500) = 2000 is optimal (4 on B → 1000 + 3 on A 900 = 1900)
    expect(s.alloc).toEqual([5, 2]);
    expect(s.bcm).toBe(2000);
  });

  it('respects the crew constraint: parks the circuit whose start-up crew does not pay', () => {
    // 10 trucks, crew 14 with 4 site crew → 10 for circuits. A needs n+3, B needs n+3.
    const p: OptProblem = {
      circuits: [circuit('A', 1, 300, 1800, 2, 10), circuit('B', 2, 280, 1400, 2, 10)],
      trucksAvailable: 10, crewAvailable: 14, siteCrew: new Array(11).fill(4), mode: 'weighted',
    };
    const s = solveAllocation(p);
    const e = evaluate(p, s.alloc);
    expect(e.crew).toBeLessThanOrEqual(14);
    expect(brute(p).best).toBeCloseTo(s.objective, 6);
    // A full (6 trucks → 1800) uses 9 of the 10 circuit crew; B needs 4 to start even 1 truck, so it is parked
    expect(s.alloc).toEqual([6, 0]);
  });

  it('matches brute force on 300 random small problems (≤ 4 circuits, weighted and volume)', () => {
    const r = rng(42);
    for (let k = 0; k < 300; k++) {
      const nC = 1 + Math.floor(r() * 4);
      const T = 2 + Math.floor(r() * 9);
      const circuits = Array.from({ length: nC }, (_, i) => {
        const c = circuit(`C${i}`, i + 1, 150 + r() * 300, 600 + r() * 2400, Math.floor(r() * 4), T);
        if (r() < 0.15) { c.locked = true; c.current = Math.floor(r() * (T / 2)); }
        return c;
      });
      const siteBase = Math.floor(r() * 6);
      const p: OptProblem = {
        circuits, trucksAvailable: T, crewAvailable: siteBase + Math.floor(r() * (T + 3 * nC + 4)),
        // push-dozer style substitution: one less site crew per truck above 8
        siteCrew: Array.from({ length: T + 1 }, (_, t) => Math.max(0, siteBase - Math.max(0, t - 8))),
        mode: r() < 0.5 ? 'weighted' : 'volume',
      };
      const s = solveAllocation(p);
      const b = brute(p);
      if (b.best === -Infinity) { expect(s.feasible).toBe(false); continue; }
      expect(s.feasible).toBe(true);
      expect(s.objective).toBeCloseTo(b.best, 6);
    }
  });

  it('sheds site tasks optimally: brute force over circuits AND task people (150 random problems)', () => {
    const r = rng(99);
    for (let k = 0; k < 150; k++) {
      const nC = 1 + Math.floor(r() * 3), nT = 1 + Math.floor(r() * 2);
      const T = 2 + Math.floor(r() * 7);
      const circuits = Array.from({ length: nC }, (_, i) => circuit(`C${i}`, i + 1, 150 + r() * 300, 600 + r() * 2400, Math.floor(r() * 3), T));
      const tasks = Array.from({ length: nT }, (_, i) => {
        const base = 1 + Math.floor(r() * 5);
        // push-dozer style: one person fewer per truck above 6
        return { id: `T${i}`, name: `T${i}`, rank: nC + i + 1, valuePerPerson: Math.round(r() * 600), req: Array.from({ length: T + 1 }, (_, t) => Math.max(0, base - Math.max(0, t - 6))) };
      });
      const p: OptProblem = { circuits, tasks, trucksAvailable: T, crewAvailable: 2 + Math.floor(r() * (T + 4 * nC + 6)), siteCrew: new Array(T + 1).fill(2), mode: r() < 0.5 ? 'weighted' : 'volume' };
      const w = weightsFor(p), wt = taskWeightsFor(p);
      // brute force
      let best = -Infinity;
      const cur = new Array(nC).fill(0);
      const recC = (i: number) => {
        if (i === nC) {
          let obj = 0, crew = 0, trucks = 0;
          circuits.forEach((c, j) => { obj += w[j] * c.bcm[cur[j]]; crew += c.crew[cur[j]]; trucks += cur[j]; });
          obj -= 0.01 * trucks;
          crew += p.siteCrew[trucks];
          if (trucks > T || crew > p.crewAvailable) return;
          const tp = new Array(nT).fill(0);
          const recT = (j: number, left: number, val: number) => {
            if (j === nT) { best = Math.max(best, val); return; }
            for (let n = 0; n <= Math.min(tasks[j].req[trucks], left); n++) recT(j + 1, left - n, val + wt[j] * tasks[j].valuePerPerson * n);
          };
          recT(0, p.crewAvailable - crew, obj);
          void tp;
          return;
        }
        for (let n = 0; n <= circuits[i].maxTrucks; n++) { cur[i] = n; recC(i + 1); }
      };
      recC(0);
      const s = solveAllocation(p);
      if (best === -Infinity) { expect(s.feasible).toBe(false); continue; }
      expect(s.feasible).toBe(true);
      expect(s.objective).toBeCloseTo(best, 6);
    }
  });

  it('handles 8 circuits exactly and > 8 with the greedy fallback', () => {
    const r = rng(7);
    const mk = (n: number) => Array.from({ length: n }, (_, i) => circuit(`C${i}`, i + 1, 200 + r() * 200, 800 + r() * 1600, 2, 14));
    const p8: OptProblem = { circuits: mk(8), trucksAvailable: 14, crewAvailable: 40, siteCrew: new Array(15).fill(6), mode: 'weighted' };
    const s8 = solveAllocation(p8);
    expect(s8.method).toBe('branch-and-bound');
    expect(s8.feasible).toBe(true);
    expect(s8.trucks).toBeLessThanOrEqual(14);
    const p10: OptProblem = { ...p8, circuits: mk(10) };
    const s10 = solveAllocation(p10);
    expect(s10.method).toBe('greedy');
    expect(s10.feasible).toBe(true);
    expect(s10.trucks).toBeLessThanOrEqual(14);
  });

  it('never assigns a truck that adds no production (ties break to fewer trucks)', () => {
    const p: OptProblem = { circuits: [circuit('A', 1, 500, 1000, 0, 6)], trucksAvailable: 6, crewAvailable: 99, siteCrew: new Array(7).fill(0), mode: 'volume' };
    expect(solveAllocation(p).alloc).toEqual([2]);
  });

  it('optimises the synthetic workbook plan with the engine rule evaluator', () => {
    const s = syntheticScenario();
    const res = computeAllCircuits(s);
    const o = optimiseFleet(s, res, {
      crewAvailable: 99, computeManning, evalCircuit: (c, opts) => computeCircuit(s, c, opts),
    });
    expect(o.rows.map(r => r.circuit.loaderUnitId)).toEqual(['EX09', 'EX04', 'LDR1']);
    expect(o.solution.trucks).toBeLessThanOrEqual(12);
    expect(o.solution.objective).toBeGreaterThanOrEqual(o.current.objective - 1e-6);
    expect(o.crewExact).toBeGreaterThan(0);
    // bulk push (R7, P4) is a sheddable task: at 34 crew the optimum keeps every circuit and sheds push dozers or trucks
    const o34 = optimiseFleet(s, res, { crewAvailable: 34, computeManning, evalCircuit: (c, opts) => computeCircuit(s, c, opts) });
    expect(o34.taskRows.map(t => t.rule.id)).toEqual(['R7_BULK_PUSH']);
    expect(o34.solution.feasible).toBe(true);
    expect(o34.crewExact).toBeLessThanOrEqual(34);
    expect(o34.solution.objective).toBeGreaterThanOrEqual(o34.current.objective - 1e-6);
  });
});
