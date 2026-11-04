import { test } from 'vitest';
import { syntheticScenario } from './synthetic';
import { computeAllCircuits, computeCircuit, computeManning, computePriority } from '@/engine';
import { optimiseFleet } from './optimise';
test('perf', () => {
  const s = syntheticScenario();
  let t = performance.now();
  const r = computeAllCircuits(s);
  console.log('circuits', (performance.now() - t).toFixed(1), 'ms');
  for (const crew of [34, 28, 20]) {
    t = performance.now();
    const p = computePriority(s, r, { crewAvailable: crew });
    console.log('priority', crew, (performance.now() - t).toFixed(1), 'ms', p.allocations.map(a => `${a.circuitId}:${a.allocatedTrucks}/${a.requestedTrucks}`).join(' '), p.tasks.map(x => `${x.ruleId}:${x.allocated}/${x.requested}`).join(' '));
  }
  t = performance.now();
  computeCircuit(s, s.circuits[0], { haulStringId: 'hs_ex09_long', trucks: 5 });
  console.log('computeCircuit', (performance.now() - t).toFixed(1), 'ms');
  t = performance.now();
  const o = optimiseFleet(s, r, { crewAvailable: 34, computeManning, evalCircuit: (c, op) => computeCircuit(s, c, op) });
  console.log('optimise', (performance.now() - t).toFixed(1), 'ms', o.solution.method, o.solution.nodes, o.rows.map(x => `${x.circuit.loaderUnitId} ${x.current}->${x.proposed}`).join(' '), o.taskRows.map(x => `${x.rule.id} ${x.current}->${x.proposed}`).join(' '), 'gain', (o.solution.bcm - o.current.bcm).toFixed(0), 'crew', o.crewExact);
});
