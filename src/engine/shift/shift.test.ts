import { describe, expect, it } from 'vitest';
import type { MeshAsset, Scenario } from '@/core/types';
import { computeAllCircuits } from '../index';
import { circuitFor, scenarioWith, straightString } from '../testing';
import { clockAt, productiveMinutes, productiveMinutesAt } from './profile';
import { simProductionAt, simulateShift, truckStatesAt } from './sim';
import { shiftStateAt } from './state';

function demoLike(model: 'spreadsheet' | 'rimpull') {
  const h1 = straightString('h1', [{ len: 300, grade: 0 }, { len: 700, grade: 0.08 }, { len: 900, grade: 0, stop: true }, { len: 300, grade: -0.03 }]);
  const h2 = straightString('h2', [{ len: 200, grade: 0 }, { len: 500, grade: 0.09 }, { len: 1200, grade: 0 }]);
  const h3 = straightString('h3', [{ len: 400, grade: 0 }, { len: 1100, grade: 0.08 }, { len: 1650, grade: 0, stop: true }]);
  const cs = [
    circuitFor('c-ex09', 'EX09', 'CAT_789D', 'OB', 'h1', 5, { speedModel: model }, { priority: 1, digId: 'dig1', dumpId: 'dump1' }),
    circuitFor('c-ex04', 'EX04', 'KOM_HD1500_7', 'OB', 'h2', 4, { speedModel: model }, { priority: 2 }),
    circuitFor('c-ldr1', 'LDR1', 'CAT_789C', 'CL', 'h3', 3, { speedModel: model }, { priority: 3 }),
  ];
  const s = scenarioWith([h1, h2, h3], cs);
  const block = (id: string, role: 'dig' | 'dump', vol: number, plannedBcm?: number): MeshAsset => ({
    id, name: id, kind: 'solid', role, mesh: { verts: new Float64Array(), tris: new Uint32Array() },
    stats: { vertexCount: 0, triangleCount: 0, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, planArea: 0, closed: true, boundaryEdges: 0, volume: vol, centroid: [0, 0, 0] },
    color: '#888', visible: true, opacity: 1, source: 'demo', importedAt: '', block: { materialId: 'OB', depletionMode: 'face-advance', advanceAzimuthDeg: 0, plannedBcm },
  });
  s.assets = [block('dig1', 'dig', 999999, 50000), block('dump1', 'dump', 120000)];
  return { s, res: computeAllCircuits(s) };
}

describe('shift profile', () => {
  const { s } = demoLike('spreadsheet');
  it('default profile: 600 productive minutes = 10 PT h per shift (20 h/day)', () => {
    expect(productiveMinutes(s.shift)).toBe(600);
    expect(productiveMinutesAt(s.shift, 720)).toBe(600);
    expect(productiveMinutesAt(s.shift, 30)).toBe(0);
    expect(clockAt(s.shift, 0)).toBe('06:00');
    expect(clockAt(s.shift, 210)).toBe('09:30');
    expect(clockAt(s.shift, 1080)).toBe('00:00');
  });
});

describe.each(['spreadsheet', 'rimpull'] as const)('shift simulation (%s)', model => {
  const { s, res } = demoLike(model);

  it('one truck at the loader at a time', () => {
    for (const c of s.circuits) {
      const sim = simulateShift(s, res, c.id);
      const busy = sim.timelines.flatMap(tl => {
        const out: [number, number][] = [];
        tl.records.forEach((r, k) => { if (r.phase === 'spot') out.push([r.t0, tl.records[k + 1].t1]); });
        return out;
      }).sort((a, b) => a[0] - b[0]);
      expect(busy.length).toBe(sim.loadEndsS.length);
      for (let k = 1; k < busy.length; k++) expect(busy[k][0]).toBeGreaterThanOrEqual(busy[k - 1][1] - 1e-6);
    }
  });

  it('loads × truck load = production, close to the calculation (±3 %)', () => {
    for (const c of s.circuits) {
      const sim = simulateShift(s, res, c.id);
      const end = simProductionAt(sim, 720);
      expect(end.bcm).toBeCloseTo(sim.bcm, 9);
      expect(sim.loads * c.params.truckLoadBcm).toBeLessThanOrEqual(sim.bcm + 1e-9);
      expect(sim.bcm - sim.loads * c.params.truckLoadBcm).toBeLessThan(c.params.truckLoadBcm);
      expect(end.dumpedBcm % c.params.truckLoadBcm).toBeCloseTo(0, 9);
      const analytic = res[c.id].assigned.bcmPerDay / c.params.shiftsPerDay;
      expect(Math.abs(sim.bcm - analytic) / analytic, `${c.id}: sim ${sim.bcm.toFixed(0)} vs ${analytic.toFixed(0)}`).toBeLessThan(0.03);
    }
  });

  it('free-flow cycle in the simulation equals the calculated cycle time', () => {
    const sim = simulateShift(s, res, 'c-ex09');
    const recs = sim.timelines[0].records;
    const spot = recs.findIndex(r => r.phase === 'spot');
    const ret = recs.findIndex((r, k) => k > spot && r.phase === 'return');
    expect(recs[ret].t1 - recs[spot].t0).toBeCloseTo(res['c-ex09'].cycleS, 6);
  });

  it('no truck moves during a whole-fleet crib (fleetStopFraction 1)', () => {
    const a = truckStatesAt(s, res, 'c-ex09', 181), b = truckStatesAt(s, res, 'c-ex09', 209);
    a.forEach((x, k) => {
      expect(x.paused).toBe(true);
      expect(x.speedKmh).toBe(0);
      expect(b[k].chainageM).toBeCloseTo(x.chainageM, 9);
      expect(b[k].pos).toEqual(x.pos);
    });
  });

  it('staggered fuel: on average 25 % of the fleet stopped across the window', () => {
    let stopped = 0, total = 0;
    for (let t = 270; t < 330; t += 0.5) {
      const st = truckStatesAt(s, res, 'c-ex09', t);
      stopped += st.filter(x => x.paused).length;
      total += st.length;
    }
    expect(stopped / total).toBeCloseTo(0.25, 1);
  });

  it('moving trucks travel smoothly at segment speeds', () => {
    const r = res['c-ex09'];
    const maxV = Math.max(...r.segments.map(g => Math.max(g.speedLoadedKmh, g.speedEmptyKmh)));
    let prev = truckStatesAt(s, res, 'c-ex09', 40);
    for (let t = 40 + 1 / 60; t < 100; t += 1 / 60) {
      const cur = truckStatesAt(s, res, 'c-ex09', t);
      cur.forEach((x, k) => {
        const p = prev[k];
        if ((x.phase === 'haul' || x.phase === 'return') && x.phase === p.phase) {
          expect(Math.abs(x.chainageM - p.chainageM)).toBeLessThanOrEqual(maxV / 3.6 + 1.5);
          expect(x.speedKmh).toBeLessThanOrEqual(maxV + 1e-6);
          expect(x.dir).toBe(x.speedKmh > 0.05 ? (x.phase === 'haul' ? 1 : -1) : 0);
        }
        expect(x.loaded).toBe(x.phase === 'haul' || (x.phase === 'dump' && x.fill > 0));
      });
      prev = cur;
    }
    if (model === 'spreadsheet') {
      // mid-haul speed = table speed × η
      const st = truckStatesAt(s, res, 'c-ex09', 95).find(x => x.phase === 'haul' && !x.paused && x.chainageM > 400 && x.chainageM < 900);
      if (st) expect(st.speedKmh).toBeCloseTo(12 * 0.85, 6);
    }
  });

  it('shiftStateAt reports production, dig and dump fractions', () => {
    const st0 = shiftStateAt(s, res, 0);
    expect(st0.clock).toBe('06:00');
    expect(st0.activeEvent?.kind).toBe('prestart');
    expect(st0.perCircuit.every(p => p.bcmSoFar === 0)).toBe(true);
    const mid = shiftStateAt(s, res, 360);
    const ex9 = mid.perCircuit.find(p => p.circuitId === 'c-ex09')!;
    expect(ex9.bcmSoFar).toBeGreaterThan(0);
    expect(ex9.digFraction).toBeCloseTo(ex9.bcmSoFar / 50000, 9);
    const end = shiftStateAt(s, res, 720);
    const e9 = end.perCircuit.find(p => p.circuitId === 'c-ex09')!;
    expect(e9.bcmSoFar).toBeCloseTo(e9.bcmShift, 9);
    expect(e9.dumpFraction).toBeGreaterThan(0);
    expect(e9.dumpFraction).toBeLessThanOrEqual(1);
    expect(end.productiveFraction).toBe(1);
    expect(mid.perCircuit.find(p => p.circuitId === 'c-ex04')!.digFraction).toBe(0); // no dig block linked
  });

  it('is cached per scenario + result and invalidated by a new scenario', () => {
    expect(simulateShift(s, res, 'c-ex09')).toBe(simulateShift(s, res, 'c-ex09'));
    const s2: Scenario = { ...s };
    expect(simulateShift(s2, res, 'c-ex09')).not.toBe(simulateShift(s, res, 'c-ex09'));
  });
});

describe('circuit standby (PT target below the profile)', () => {
  const { s, res } = demoLike('spreadsheet');
  it('LDR at 18 h/day stands by 60 min per shift and keeps to its PT', () => {
    const sim = simulateShift(s, res, 'c-ldr1');
    expect(sim.standby?.durMin).toBeCloseTo(60, 6);
    const inStandby = truckStatesAt(s, res, 'c-ldr1', sim.standby!.startMin + 10);
    expect(inStandby.every(x => x.paused)).toBe(true);
  });
  it('inactive circuits simulate no trucks', () => {
    const s2: Scenario = { ...s, circuits: s.circuits.map(c => (c.id === 'c-ex04' ? { ...c, active: false } : c)) };
    const r2 = computeAllCircuits(s2);
    expect(simulateShift(s2, r2, 'c-ex04').trucks).toBe(0);
    expect(truckStatesAt(s2, r2, 'c-ex04', 100)).toEqual([]);
  });
});
