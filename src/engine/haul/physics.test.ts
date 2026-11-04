/**
 * Rimpull / retarder physics: spec 04 §G.3 sanity table, monotonicity, limits, kinematic pass, phantom guards.
 */
import { describe, expect, it } from 'vitest';
import { TRUCK_MODELS } from '@/data';
import type { TruckModelExt } from '../types';
import { computeCircuit } from './circuit';
import { steadySpeed } from './physics';
import { truckPhysics } from './truck';
import { circuitFor, fixture, scenarioWith, stringFrom, straightString } from '../testing';
import type { CircuitResultExt } from '../types';

const truck = (id: string) => TRUCK_MODELS.find(t => t.id === id) as TruckModelExt;
/** Steady speed at an effective grade (fraction), RR folded in, no speed limit. */
const at = (id: string, massT: number, eff: number, rr = 0) => steadySpeed(truckPhysics(truck(id)), massT, eff, rr, Infinity);

describe('steady speeds vs the spec 04 §G.3 sanity table (GVW loaded, empty mass empty, ±0.4 km/h)', () => {
  // [loaded up 6, 8, 10, 12 %, empty level (2 % RR), empty up 10 %, loaded down −8 %, loaded down −10 % (rule)]
  const table: Record<string, number[]> = {
    CAT_789C: [21.3, 16.2, 12.0, 9.8, 54.4, 29.8, 22.0, 22.0],
    CAT_789D: [23.1, 17.1, 12.6, 11.1, 57.2, 31.2, 23.1, 23.1],
    KOM_HD1500_7: [19.7, 14.7, 11.7, 10.9, 58.4, 29.9, 30.4, 24.4],
    KOM_HD785_7: [27.3, 19.7, 16.4, 12.2, 65.0, 36.4, 30.3, 24.3],
    CAT_793F: [23.8, 17.4, 12.9, 12.2, 60.0, 32.1, 32.1, 23.8],
    CAT_777G: [20.1, 14.8, 11.9, 10.9, 67.1, 31.5, 27.2, 20.1],
    KOM_830E_5: [22.8, 17.1, 13.7, 11.4, 64.5, 32.2, 38.3, 30.7],
    KOM_930E_5: [18.2, 13.6, 10.9, 9.1, 64.5, 24.7, 35.5, 28.5],
  };
  it.each(Object.entries(table))('%s', (id, exp) => {
    const t = truck(id);
    const L = t.gvwT, E = t.emptyMassT;
    const got = [at(id, L, 0.06), at(id, L, 0.08), at(id, L, 0.10), at(id, L, 0.12), steadySpeed(truckPhysics(t), E, 0, 2, Infinity), at(id, E, 0.10), at(id, L, -0.08), at(id, L, -0.10)];
    got.forEach((g, k) => expect(Math.abs(g.kmh - exp[k]), `${id} column ${k}: ${g.kmh.toFixed(2)} vs ${exp[k]}`).toBeLessThanOrEqual(0.4));
  });

  it('789C loaded at 10 % effective ≈ 12 km/h on the 1st-gear governor (11–13)', () => {
    const r = at('CAT_789C', truck('CAT_789C').gvwT, 0.10);
    expect(r.kmh).toBeGreaterThanOrEqual(11);
    expect(r.kmh).toBeLessThanOrEqual(13);
    expect(r.binding).toBe('governor_g1');
    expect(r.limit).toBe('rimpull');
    expect(r.forceAvailKN).toBeGreaterThanOrEqual(r.resistanceKN - 1e-6);
  });

  it('empty on the level runs near top speed', () => {
    for (const t of TRUCK_MODELS) {
      const r = steadySpeed(truckPhysics(t), t.emptyMassT, 0, 2, Infinity);
      expect(r.kmh).toBeGreaterThanOrEqual(0.95 * t.topSpeedKmh);
      expect(r.limit).toBe('top-speed');
    }
  });

  it('descents are retarder-limited: Cat discrete gear (789C −10 % → 3rd gear 22.0), Komatsu continuous (P/F)', () => {
    const c = at('CAT_789C', truck('CAT_789C').gvwT, -0.10);
    expect(c.limit).toBe('retarder');
    expect(c.mode).toBe('retard');
    expect(c.gear).toBe(3);
    expect(c.kmh).toBeCloseTo(22.0, 1);
    const k = truck('KOM_HD1500_7');
    const r = at('KOM_HD1500_7', k.gvwT, -0.10);
    expect(r.limit).toBe('retarder');
    const fReq = -r.resistanceKN;
    expect(r.kmh).toBeCloseTo(((k.retarderPowerKW as number) / fReq) * 3.6, 0);
  });
});

describe('monotonicity and limits', () => {
  it('more grade → slower (loaded and empty, uphill), steeper descent → slower', () => {
    for (const t of TRUCK_MODELS) {
      const tp = truckPhysics(t);
      for (const m of [t.emptyMassT, t.emptyMassT + t.payloadT]) {
        let prev = Infinity;
        for (let g = 0; g <= 0.2001; g += 0.005) {
          const v = steadySpeed(tp, m, g, 2, Infinity).kmh;
          expect(v, `${t.id} m=${m} g=${g.toFixed(3)}`).toBeLessThanOrEqual(prev + 1e-9);
          prev = v;
        }
        prev = Infinity;
        for (let g = -0.04; g >= -0.2001; g -= 0.005) {
          const v = steadySpeed(tp, m, g, 2, Infinity).kmh;
          expect(v, `${t.id} m=${m} descent g=${g.toFixed(3)}`).toBeLessThanOrEqual(prev + 1e-9);
          prev = v;
        }
      }
    }
  });

  it('a speed limit below the balance speed binds as speed-limit', () => {
    const t = truck('CAT_789D');
    const r = steadySpeed(truckPhysics(t), t.emptyMassT, 0, 2, 40);
    expect(r.kmh).toBe(40);
    expect(r.limit).toBe('speed-limit');
  });

  it('an impossible climb stalls loudly instead of producing an infinite time', () => {
    const t = truck('CAT_789C');
    const r = steadySpeed(truckPhysics(t), t.gvwT, 0.4, 2, Infinity);
    expect(r.binding).toBe('stall');
    expect(r.kmh).toBeGreaterThan(0);
    expect(r.warning).toMatch(/insufficient rimpull/);
  });

  it('rimpull envelopes respect the power limit F·v ≤ η·P (spec 04 §B.2)', () => {
    for (const t of TRUCK_MODELS) {
      const net = (t as TruckModelExt).netPowerKW;
      const cap = t.drive === 'electric' ? 0.77 * t.enginePowerKW : 0.85 * (net ?? t.enginePowerKW);
      const maxP = Math.max(...t.rimpull.map(([v, f]) => (v / 3.6) * f));
      expect(maxP, t.id).toBeLessThanOrEqual(cap * 1.02);
    }
  });
});

describe('rimpull circuits (steady and kinematic)', () => {
  const AR = fixture<{ points: number[][] }>('spreadsheet-active-route.json');
  const hs = stringFrom('hs', 'EX09 fixture', AR.points);
  const run = (motion: 'steady' | 'kinematic', truckId = 'CAT_789D', h = hs, patch = {}) => {
    const c = circuitFor('c', 'EX09', truckId, 'OB', h.id, 4, { speedModel: 'rimpull', motion, ...patch } as never);
    return computeCircuit(scenarioWith([h], [c]), c) as CircuitResultExt;
  };

  it('kinematic travel ≥ steady travel (acceleration and braking cost time) and records the transparency data', () => {
    const s = run('steady'), k = run('kinematic');
    expect(s.ok && k.ok).toBe(true);
    expect(k.travelLoadedS).toBeGreaterThan(s.travelLoadedS);
    expect(k.travelEmptyS).toBeGreaterThan(s.travelEmptyS);
    expect(k.massLoadedT).toBeCloseTo(truck('CAT_789D').emptyMassT + 104 * 1.728, 6);
    for (const g of k.segments) {
      expect(g.physLoaded?.binding).toBeTruthy();
      expect(g.physLoaded?.shares).toBeTruthy();
      expect(g.timeLoadedS).toBeGreaterThan(0);
      expect(g.speedLoadedKmh).toBeLessThanOrEqual(g.speedLimitKmh + 1e-6);
    }
    const share = Object.values(k.bindingShare!.loaded).reduce((a, b) => a + b, 0);
    expect(share).toBeCloseTo(1, 9);
    expect(k.steps.some(s2 => s2.id === 'phys.payload')).toBe(true);
    expect(k.steps.find(s2 => s2.id === 'travel.loaded')!.inputs!.some(i => String(i.source).includes('ESTIMATED'))).toBe(true);
  });

  it('kinematic profile starts and ends at rest, honours stops and caps, and sums to the travel time', () => {
    const ramp = straightString('ramp', [{ len: 300, grade: 0 }, { len: 900, grade: 0.09 }, { len: 600, grade: 0, stop: true }, { len: 400, grade: -0.07 }, { len: 300, grade: 0 }]);
    const k = run('kinematic', 'CAT_789C', ramp, { speedLimitKmh: 40, stopSigns: 2 });
    const iv = k.profiles.loaded.intervals;
    expect(iv[0].v0).toBe(0);
    expect(iv[iv.length - 1].v1).toBe(0);
    expect(iv.reduce((a, x) => a + x.dt, 0)).toBeCloseTo(k.travelLoadedS, 6);
    expect(iv.reduce((a, x) => a + x.ds, 0)).toBeCloseTo(k.lengthM, 6);
    for (const x of iv) { expect(x.v0 * 3.6).toBeLessThanOrEqual(40 + 1e-6); expect(x.v1 * 3.6).toBeLessThanOrEqual(40 + 1e-6); }
    const dwell = iv.filter(x => x.dwell);
    expect(dwell.length).toBe(1);
    expect(iv[iv.indexOf(dwell[0]) - 1].v1).toBe(0);
    expect(k.stopsModelled).toBe(2);
    expect(k.stopsS).toBe(0);
    // the long 9 % ramp converges to the steady (balance) speed
    const mid = k.segments.find(s => s.chainageM > 1000 && s.chainageM < 1100)!;
    expect(mid.physLoaded!.vMaxKmh!).toBeCloseTo(mid.physLoaded!.steadyKmh, 0);
  });
});

describe('phantom-segment guard', () => {
  const base = [[1000, 2000, 100], [1010, 2000, 100], [1020, 2000, 101], [1030, 2000, 101]];
  const run = (pts: number[][]) => {
    const h = stringFrom('h', 'guard', pts);
    const c = circuitFor('c', 'EX09', 'CAT_789D', 'OB', h.id, 4);
    return computeCircuit(scenarioWith([h], [c]), c) as CircuitResultExt;
  };
  it('rejects non-finite coordinates', () => {
    const r = run([...base.slice(0, 2), [NaN, 2000, 100], ...base.slice(2)]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-finite/);
  });
  it('rejects the workbook blank-row phantom (a point at 0,0,0) and any > 5 km segment', () => {
    const mga = base.map(p => [p[0] + 235000, p[1] + 7049000, p[2]]);
    const r = run([...mga.slice(0, 2), [0, 0, 0], ...mga.slice(2)]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/grid origin/);
    const r2 = run([...mga.slice(0, 2), [mga[1][0] + 7000, mga[1][1], 100], ...mga.slice(2)]);
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/Phantom segment/);
  });
  it('flags a suspiciously long segment and skips duplicate points', () => {
    const pts = [...base, [1630, 2000, 101], [1640, 2000, 101], [1640, 2000, 101], [1650, 2000, 101], [1660, 2000, 101]];
    const r = run(pts);
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => /check for a missing or misplaced point/.test(w))).toBe(true);
    expect(r.warnings.some(w => /zero-length segment skipped/.test(w))).toBe(true);
  });
  it('reports a missing string / truck as an error', () => {
    const h = stringFrom('h', 'x', base);
    const c = circuitFor('c', 'EX09', 'NOPE', 'OB', h.id, 4);
    expect(computeCircuit(scenarioWith([h], [c]), c).error).toMatch(/not found/);
    const c2 = circuitFor('c', 'EX09', 'CAT_789D', 'OB', 'missing', 4);
    expect(computeCircuit(scenarioWith([h], [c2]), c2).error).toMatch(/No haul string/);
  });
});
