import { it } from 'vitest';
import { computeAllCircuits } from '@/engine';
import { crewCircuits, evaluateCrew } from '@/engine/manning/evaluate';
import { circuitFor, scenarioWith, straightString } from '@/engine/testing';
it('scan', () => {
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
  const out: string[] = [];
  for (const [a, b, c] of [[6,5,4],[6,5,0],[6,4,0],[6,3,0],[6,5,1],[6,2,0]]) {
    const al: Record<string, number> = { 'c-ex09': a, 'c-ex04': b, 'c-ldr1': c };
    const ev = evaluateCrew({ circuits: crewCircuits(s, id => al[id]), rules: s.crew.rules, trucksAvailable: 15, available: 30 });
    out.push(`${a},${b},${c}: total ${ev.total} R7 ${ev.ruleCounts.R7_BULK_PUSH}`);
  }
  for (const id of ['c-ex09','c-ex04','c-ldr1']) out.push(`${id} opts ${(res[id] as any).options.slice(0,8).map((o: any) => o.bcmPerDay.toFixed(0)).join(',')}`);
  process.stderr.write(out.join('\n') + '\n');
});
