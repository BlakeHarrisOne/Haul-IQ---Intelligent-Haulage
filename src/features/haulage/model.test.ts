import { describe, expect, it } from 'vitest';
import type { CircuitResult, FleetOption, StringPoint } from '@/core/types';
import {
  changedParams, chainagesOf, effectiveSeg, fleetRows, insertAfter, nearestVertex, profileScales,
  recommendedTrucks, removeAt, resultByPoint, sectionScales, segmentAt, segmentsOf, sheetDrops, stopsPerCycle, stringStats,
  truckingCall, truckStateAt, withSegOverride, withStop, withXYZ, GLOBAL_DEFAULTS,
} from './model';

const P = (e: number, n: number, z: number, extra: Partial<StringPoint> = {}): StringPoint => ({ id: `p${e}_${n}`, e, n, z, ...extra });

describe('drop detection (Q3: |ROUND(g,2)| > 16 % is silently dropped)', () => {
  it('flags only grades that round past 16 %', () => {
    expect(sheetDrops(0.16)).toBe(false);
    expect(sheetDrops(0.1649)).toBe(false);
    expect(sheetDrops(0.165)).toBe(true);
    expect(sheetDrops(-0.166)).toBe(true);
    expect(sheetDrops(0.178)).toBe(true);
    expect(sheetDrops(-0.312)).toBe(true);
  });
  it('flags the right segments of a string', () => {
    // 100 m flat, then 10 m plan with 2 m rise (≈19.6 %), then 10 m with 1 m fall (≈ −9.95 %)
    const pts = [P(0, 0, 100), P(100, 0, 100), P(110, 0, 102), P(120, 0, 101)];
    const segs = segmentsOf(pts);
    expect(segs.map(s => s.dropped)).toEqual([false, true, false]);
    const st = stringStats(pts);
    expect(st.droppedCount).toBe(1);
    expect(st.droppedM).toBeCloseTo(Math.hypot(10, 2), 9);
  });
});

describe('rows → segments', () => {
  const pts = [P(0, 0, 0), P(30, 40, 0), P(30, 40, 0), P(30, 40, 10)];
  it('builds N − 1 segments starting at each point, with 3D chainage', () => {
    const segs = segmentsOf(pts);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ i: 0, dist3d: 50, distPlan: 50, grade: 0, chainage: 0, zero: false });
    expect(segs[1].zero).toBe(true);
    expect(segs[2]).toMatchObject({ i: 2, chainage: 50, dz: 10 });
    expect(segs[2].grade).toBeCloseTo(1, 9); // vertical: dz / slope distance = 1
    expect(chainagesOf(pts)).toEqual([0, 50, 50, 60]);
  });
  it('maps engine results to their start point even when zero-length segments are skipped', () => {
    const fake = [{ i: 0 }, { i: 2 }] as unknown as Parameters<typeof resultByPoint>[1];
    const m = resultByPoint(4, fake);
    expect(m.map(x => (x ? x.i : null))).toEqual([0, null, 2, null]);
  });
  it('finds the nearest vertex and containing segment by chainage', () => {
    const ch = [0, 10, 25, 60];
    expect(nearestVertex(ch, 4)).toBe(0);
    expect(nearestVertex(ch, 6)).toBe(1);
    expect(nearestVertex(ch, 100)).toBe(3);
    expect(segmentAt(ch, 30)).toBe(2);
    expect(segmentAt(ch, 60)).toBe(2);
    expect(segmentAt(ch, -5)).toBe(0);
  });
  it('summarises rise, fall and steepest grades', () => {
    const st = stringStats([P(0, 0, 100), P(100, 0, 110), P(200, 0, 105)]);
    expect(st.riseM).toBeCloseTo(10);
    expect(st.fallM).toBeCloseTo(5);
    expect(st.maxUp).toBeCloseTo(10 / Math.hypot(100, 10));
    expect(st.maxDown).toBeCloseTo(-5 / Math.hypot(100, 5));
  });
});

describe('override application', () => {
  const pts = [P(0, 0, 0), P(10, 0, 0, { seg: { rrPct: 4 } }), P(20, 0, 0)];
  it('applies overrides over circuit defaults', () => {
    const d = { speedLimitKmh: 60, rrPct: 2 };
    expect(effectiveSeg(pts[0], d)).toMatchObject({ speedLimitKmh: 60, rrPct: 2, overridden: { speed: false, rr: false } });
    expect(effectiveSeg(pts[1], d)).toMatchObject({ speedLimitKmh: 60, rrPct: 4, overridden: { rr: true } });
  });
  it('merges, clears and removes empty seg objects without touching other points', () => {
    const a = withSegOverride(pts, 0, { speedLimitKmh: 25, zone: 'ramp' });
    expect(a[0].seg).toEqual({ speedLimitKmh: 25, zone: 'ramp' });
    expect(a[1]).toBe(pts[1]);
    const b = withSegOverride(a, 0, { speedLimitKmh: null, zone: undefined });
    expect(b[0].seg).toBeUndefined();
    const c = withSegOverride(pts, 1, { rrPct: null });
    expect('seg' in c[1]).toBe(false);
  });
  it('toggles stops and counts them both ways', () => {
    const s = withStop(pts, 1, true);
    expect(stopsPerCycle(s)).toBe(2);
    expect(stopsPerCycle(withStop(s, 1, false))).toBe(0);
    expect(stopsPerCycle([P(0, 0, 0, { stop: true, stopOneWay: 'loaded' })])).toBe(1);
  });
  it('clears snapped when RL is typed and inserts/removes rows', () => {
    const s = withXYZ([P(0, 0, 0, { snapped: true })], 0, { z: 5 });
    expect(s[0]).toMatchObject({ z: 5, snapped: false });
    const ins = insertAfter(pts, 0);
    expect(ins).toHaveLength(4);
    expect(ins[1]).toMatchObject({ e: 5, n: 0, z: 0 });
    expect(removeAt(ins, 1)).toHaveLength(3);
  });
});

const opt = (n: number, lost: number, queue: number, bcm: number, cap: number): FleetOption => ({
  trucks: n, truckCapacityBcmDay: cap, bcmPerDay: bcm, loaderPtHrsDay: bcm / 1800, lostLoaderPtHrsShift: lost,
  truckQueueHrsShift: queue, matchFactor: n / 3.44, loaderUtil: bcm / 36000, status: lost > 0.05 ? 'under' : queue > 0.05 ? 'over' : 'balanced',
});

describe('fleet chooser', () => {
  // spreadsheet test vector (§6.4): 1 → 7.09 h, 2 → 4.18 h, 3 → 1.27 h, 4+ → 0 h lost per shift
  const options = [opt(1, 7.09, 0, 10477, 10477), opt(2, 4.18, 0, 20954, 20954), opt(3, 1.27, 0, 31431, 31431),
    opt(4, 0, 0.56, 36000, 41908), opt(5, 0, 1.56, 36000, 52385), opt(6, 0, 2.56, 36000, 62862)];
  const r = { ok: true, options, trucksExact: 3.436, trucksRecommended: 4 } as unknown as CircuitResult;
  it('recommends the first n with 0 h lost (the "click until 0 h lost" rule)', () => {
    expect(recommendedTrucks(r)).toBe(4);
  });
  it('classifies rows and scales bars against target and capacity', () => {
    const rows = fleetRows(r, 3, 36000);
    expect(rows.map(x => x.kind)).toEqual(['under', 'under', 'under', 'recommended', 'over', 'over']);
    expect(rows.find(x => x.assigned)?.opt.trucks).toBe(3);
    expect(rows[3].achieved).toBeCloseTo(rows[3].target, 9);
    expect(rows[5].capacity).toBeLessThanOrEqual(1);
    expect(rows[0].achieved).toBeLessThan(rows[1].achieved);
  });
  it('labels deliberate under/over trucking', () => {
    expect(truckingCall(3, 4, options[2])).toMatchObject({ tone: 'bad', title: 'Deliberately under-trucked by 1' });
    expect(truckingCall(5, 4, options[4]).tone).toBe('warn');
    expect(truckingCall(4, 4, options[3]).title).toBe('Balanced');
  });
});

describe('changed vs default', () => {
  it('reports only differing numeric inputs', () => {
    const d = { ...GLOBAL_DEFAULTS, spotS: 30, loadS: 110, dumpS: 60, plannedRateBcmPerPtHr: 1800, desiredDailyBcm: 36000, truckLoadBcm: 104 };
    expect([...changedParams({ ...d }, d)]).toEqual([]);
    expect([...changedParams({ ...d, haulEff: 0.83, speedModel: 'rimpull' }, d)]).toEqual(['haulEff']);
  });
});

describe('chart scales', () => {
  const box = { left: 50, right: 1050, top: 10, bottom: 110 };
  it('profile: chainage spans the width and RL is drawn at the requested exaggeration', () => {
    const s = profileScales(0, 1000, 100, 104, box, 2); // 1 px/m horizontal → 2 px/m vertical
    expect(s.x(0)).toBe(50);
    expect(s.x(1000)).toBe(1050);
    expect(s.y(100) - s.y(101)).toBeCloseTo(2, 9);
    expect(s.capped).toBe(false);
    expect(s.y(102)).toBeCloseTo(60, 9); // centred
  });
  it('profile: a VE that would overflow is capped at the fit value', () => {
    const s = profileScales(0, 1000, 100, 160, box, 10);
    expect(s.capped).toBe(true);
    expect(s.veUsed).toBeCloseTo(s.veFit, 9);
    expect(s.y(100)).toBeLessThanOrEqual(110);
    expect(s.y(160)).toBeGreaterThanOrEqual(10);
    const f = profileScales(0, 1000, 100, 160, box, 'fit');
    expect(f.veUsed).toBeCloseTo(f.veFit, 9);
  });
  it('section: true scale keeps metres square and centres the plot', () => {
    const s = sectionScales(0, 400, 0, 200, box, true, 0);
    const kx = s.x(1) - s.x(0), ky = s.y(0) - s.y(1);
    expect(kx).toBeCloseTo(ky, 9);
    expect(s.x(200)).toBeCloseTo(550, 6);
    const e = sectionScales(0, 400, 0, 10, box, false, 0);
    expect(e.ve).toBeGreaterThan(1);
  });
});

describe('truck phase model', () => {
  const seg = (i: number, ch: number) => ({ i, chainageM: ch, dist3dM: 100, timeLoadedS: 12, timeEmptyS: 12, speedLoadedKmh: 30, speedEmptyKmh: 30 });
  const r = {
    ok: true, cycleS: 0, lengthM: 300, travelLoadedS: 36, travelEmptyS: 36, stopsS: 0, segments: [seg(0, 0), seg(1, 100), seg(2, 200)],
  } as unknown as CircuitResult;
  r.cycleS = 30 + 60 + 36 + 60 + 36;
  const p = { haulEff: 1, spotS: 30, loadS: 60, dumpS: 60 } as Parameters<typeof truckStateAt>[1];
  it('walks spot → load → haul → dump → return', () => {
    expect(truckStateAt(r, p, 1, 0, 10)?.phase).toBe('spot');
    expect(truckStateAt(r, p, 1, 0, 40)?.phase).toBe('load');
    const h = truckStateAt(r, p, 1, 0, 90 + 18)!;
    expect(h.phase).toBe('haul');
    expect(h.chainageM).toBeCloseTo(150, 6);
    expect(h.loaded).toBe(true);
    expect(truckStateAt(r, p, 1, 0, 130)?.phase).toBe('dump');
    const ret = truckStateAt(r, p, 1, 0, 186 + 6)!;
    expect(ret.phase).toBe('return');
    expect(ret.chainageM).toBeCloseTo(250, 6);
  });
  it('spaces trucks through the cycle', () => {
    const a = truckStateAt(r, p, 2, 0, 0)!, b = truckStateAt(r, p, 2, 1, 0)!;
    expect(b.cycleFrac - a.cycleFrac).toBeCloseTo(0.5, 9);
  });
});
