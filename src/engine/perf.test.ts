/**
 * Performance budget: computeAllCircuits for 10 circuits × 300 segments < 20 ms.
 * Best of several rounds (robust to other processes on a shared machine).
 */
import { describe, expect, it } from 'vitest';
import { computeAllCircuits } from './index';
import { circuitFor, scenarioWith, straightString } from './testing';

function bench(model: 'spreadsheet' | 'rimpull', motion: 'kinematic' | 'steady' = 'kinematic'): number {
  const segs = Array.from({ length: 300 }, (_, k) => ({ len: 10, grade: 0.08 * Math.sin(k / 15) }));
  const h = straightString('big', segs, 10);
  const cs = Array.from({ length: 10 }, (_, k) => circuitFor(`c${k}`, 'EX09', k % 2 ? 'CAT_789C' : 'CAT_789D', 'OB', h.id, 4, { speedModel: model, motion }));
  const s = scenarioWith([h], cs);
  let best = Infinity;
  for (let r = 0; r < 25; r++) {
    const t0 = performance.now();
    const res = computeAllCircuits(s);
    best = Math.min(best, performance.now() - t0);
    expect(res.c0.segments.length).toBe(300);
  }
  return best;
}

describe('performance', () => {
  it('spreadsheet mode < 20 ms', () => { expect(bench('spreadsheet')).toBeLessThan(20); });
  it('rimpull steady < 20 ms', () => { expect(bench('rimpull', 'steady')).toBeLessThan(20); });
  it('rimpull kinematic < 20 ms', () => { expect(bench('rimpull', 'kinematic')).toBeLessThan(20); });
});
