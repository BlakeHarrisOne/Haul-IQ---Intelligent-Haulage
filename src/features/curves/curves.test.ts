import { describe, expect, it } from 'vitest';
import type { TruckModel } from '@/core/types';
import { balanceForForce, balanceOnGrade, curveForce, effGradeForce, gradeability, resistanceKN, supSpeed, gearAt, tableSpeed, range, type TruckX } from './physics';
import { forceDomain, speedDomain, speedAxisMax } from './domains';

const env: [number, number][] = [[0, 800], [5, 600], [10, 400], [20, 200], [40, 100], [40.2, 0]];
const truck: TruckX = {
  id: 't', name: 'T', make: 'Caterpillar', model: 'X', drive: 'mechanical', emptyMassT: 100, payloadT: 150, gvwT: 250, enginePowerKW: 1000, topSpeedKmh: 40,
  rimpull: env, retarder: [[5, 900], [10, 700], [20, 350], [40, 175]], dims: { length: 1, width: 1, height: 1, eyeHeight: 1 }, color: '#000', sources: [], estimated: [],
};

describe('curve interpolation', () => {
  it('returns the points exactly and interpolates in power space between them', () => {
    expect(curveForce(env, 10)).toBeCloseTo(400, 9);
    expect(curveForce(env, 20)).toBeCloseTo(200, 9);
    // P linear between (10, 4000) and (20, 4000) → constant power → F = 4000 / 15
    expect(curveForce(env, 15)).toBeCloseTo(4000 / 15, 9);
    // from rest the piece is linear in F
    expect(curveForce(env, 2.5)).toBeCloseTo(700, 9);
    expect(curveForce(env, 50)).toBe(0);
  });
  it('finds the highest speed that still delivers a force', () => {
    expect(supSpeed(env, 400)).toBeCloseTo(10, 1);
    expect(supSpeed(env, 900)).toBeUndefined();
    expect(supSpeed(env, 50)).toBeCloseTo(40.2 - 0.2 * (50 / 100), 0);
  });
});

describe('resistance and balance speed', () => {
  it('computes m·g·(sinθ + cosθ·RR)', () => {
    expect(resistanceKN(100, 0, 2)).toBeCloseTo(100 * 9.81 * 0.02, 9);
    expect(resistanceKN(100, 0.1, 0)).toBeCloseTo(98.1, 9);
    expect(effGradeForce(250, 10)).toBeCloseTo(245.25, 6);
    expect(gradeability(245.25, 250)).toBeCloseTo(10, 9);
  });
  it('is monotone: steeper uphill is never faster', () => {
    let last = Infinity;
    for (const g of range(0, 0.16, 0.01)) {
      const b = balanceOnGrade(truck, 250, g, 2);
      expect(b.kmh).toBeLessThanOrEqual(last + 1e-9);
      last = b.kmh;
    }
  });
  it('caps at top speed / speed limit and reports the binding constraint', () => {
    expect(balanceForForce(truck, 1).limit).toBe('top-speed');
    expect(balanceForForce(truck, 1, 30).limit).toBe('speed-limit');
    expect(balanceForForce(truck, 1, 30).kmh).toBe(30);
    expect(balanceForForce(truck, 400).limit).toBe('rimpull');
    expect(balanceForForce(truck, 2000).limit).toBe('stall');
  });
  it('limits descents by the retarder (continuous rule without gear curves)', () => {
    const b = balanceForForce(truck, -350);
    expect(b.mode).toBe('retard');
    expect(b.limit).toBe('retarder');
    expect(b.kmh).toBeCloseTo(20, 0);
  });
  it('uses the highest sustainable gear for the discrete (Cat ARC) rule', () => {
    const t: TruckX = { ...truck, descentRule: 'discrete_gear', retarderGears: [
      { gear: 1, maxKmh: 10, points: [[5, 900], [10, 700]] },
      { gear: 2, maxKmh: 20, points: [[10, 700], [20, 350]] },
      { gear: 3, maxKmh: 40, points: [[20, 350], [40, 175]] },
    ] };
    const b = balanceForForce(t, -500);
    expect(b.gear).toBe(1);
    expect(b.kmh).toBe(10);
    expect(balanceForForce(t, -300).kmh).toBe(20);
  });
  it('picks the gear with most force at a speed', () => {
    const gears = [{ gear: 1, maxKmh: 12, points: [[0, 800], [12, 400]] as [number, number][] }, { gear: 2, maxKmh: 20, points: [[10, 300], [20, 200]] as [number, number][] }];
    expect(gearAt(gears, 11)).toBe(1);
    expect(gearAt(gears, 15)).toBe(2);
    expect(gearAt(gears, 25)).toBeUndefined();
  });
  it('looks up the workbook table by rounded grade and returns undefined outside it', () => {
    const tbl: [number, number][] = [[0, 30], [0.08, 12]];
    expect(tableSpeed(tbl, 0.08)).toBe(12);
    expect(tableSpeed(tbl, 0.17)).toBeUndefined();
  });
});

describe('chart domains', () => {
  const t = truck as TruckModel;
  it('speed domain covers top speed with nice ticks', () => {
    const [a, b] = speedDomain([t]);
    expect(a).toBe(0);
    expect(b).toBeGreaterThanOrEqual(40);
    expect(b % 5).toBe(0);
  });
  it('force domain covers curves and extra lines', () => {
    expect(forceDomain([t])[1]).toBeGreaterThanOrEqual(900);
    expect(forceDomain([t], [1500])[1]).toBeGreaterThanOrEqual(1500);
  });
  it('speed axis rounds up to 10', () => {
    expect(speedAxisMax([54.4, 12])).toBe(60);
    expect(speedAxisMax([])).toBe(10);
  });
});

import { verdictRanges } from './SpeedGradeChart';
describe('verdict ranges', () => {
  it('groups contiguous optimistic / pessimistic grades', () => {
    const rows = [
      { g: -2, sheet: 30, phys: 30 }, { g: -1, sheet: 30, phys: 40 }, { g: 0, sheet: 30, phys: 45 },
      { g: 4, sheet: 30, phys: 20 }, { g: 5, sheet: 30, phys: 18 }, { g: 6, sheet: 20, phys: 20.2 }, { g: 17, sheet: undefined, phys: 5 },
    ];
    expect(verdictRanges(rows)).toEqual({ optimistic: [[4, 5]], pessimistic: [[-1, 0]] });
  });
});
