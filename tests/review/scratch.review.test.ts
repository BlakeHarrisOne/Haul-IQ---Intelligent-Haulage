import { it } from 'vitest';
import { computeAllCircuits, computeManning } from '@/engine';
import { computePriority } from '@/engine/priority/plan';
import { circuitFor, scenarioWith, straightString } from '@/engine/testing';

it('scratch priority', () => {
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
  const res = computeAllCircuits(s);
  console.log('manning', computeManning(s, res).total, computeManning(s, res).ruleCounts);
  for (const crew of [30, 33, 35]) {
    const p = computePriority(s, res, { crewAvailable: crew });
    console.log(crew, p.crewUsed, p.allocations.map(a => `${a.circuitId}:${a.allocatedTrucks}/${a.requestedTrucks}`).join(' '),
      JSON.stringify(p.tasks), p.bcmDayAchieved);
    // recompute manning at the final allocation
  }
});
