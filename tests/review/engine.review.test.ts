/**
 * Independent review: src/engine/shift/** and src/engine/haul/**.
 */
import { describe, expect, it } from 'vitest';
import type { ShiftProfile } from '@/core/types';
import { productiveMinutes, productiveMinutesAt } from '@/engine/shift/profile';
import { computeCircuit } from '@/engine/haul/circuit';
import { circuitFor, scenarioWith, stringFrom } from '@/engine/testing';

describe('review: shift profile with overlapping events', () => {
  // a blast clearance (all trucks stop) called during crib — both stop the whole fleet over 12:00–12:30
  const prof: ShiftProfile = {
    name: 'Day', startHour: 6, lengthH: 12, events: [
      { id: 'crib', label: 'Crib', kind: 'crib', startMin: 360, durMin: 30, fleetStopFraction: 1 },
      { id: 'blast', label: 'Blast', kind: 'blast', startMin: 360, durMin: 45, fleetStopFraction: 1 },
    ],
  };

  it('R-SHIFT-1 productive minutes never go backwards as the clock advances', () => {
    expect(productiveMinutesAt(prof, 380)).toBeGreaterThanOrEqual(productiveMinutesAt(prof, 360));
  });

  it('R-SHIFT-2 fleet productive minutes count overlapping stops once (720 − 45 = 675)', () => {
    expect(productiveMinutes(prof)).toBe(675);   // actual 645: the 30 min overlap is subtracted twice
  });
});

describe('review: kinematic stop signs', () => {
  it('R-KIN-1 a stop sign on a repeated point (zero-length segment) is still a real stop in BOTH directions', () => {
    // 0 → 400 m flat, stop at 400 m, → 800 m; the stop point is digitised twice (double click)
    const pts = [[1000, 2000, 100], [1200, 2000, 100], [1400, 2000, 100], [1400, 2000, 100], [1600, 2000, 100], [1800, 2000, 100]];
    const dup = stringFrom('hd', 'dup', pts, [{}, {}, {}, { stop: true }, {}, {}]);
    const one = stringFrom('h1', 'single', [pts[0], pts[1], pts[2], pts[4], pts[5]], [{}, {}, { stop: true }, {}, {}]);
    const run = (hs: ReturnType<typeof stringFrom>) => {
      const c = circuitFor('c', 'EX09', 'CAT_789D', 'OB', hs.id, 5, { speedModel: 'rimpull', motion: 'kinematic', stopSigns: 2 });
      return computeCircuit(scenarioWith([hs], [c]), c);
    };
    const a = run(dup), b = run(one);
    expect(a.ok && b.ok).toBe(true);
    expect(a.stopsModelled).toBe(b.stopsModelled);
    // the duplicate point must not change the physics: same loaded travel time (stop modelled loaded)
    expect(a.travelLoadedS).toBeCloseTo(b.travelLoadedS, 3);
    expect(a.cycleS).toBeCloseTo(b.cycleS, 3);
  });
});
