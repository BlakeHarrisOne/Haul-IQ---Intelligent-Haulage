import { describe, expect, it } from 'vitest';
import { buildPlan, cycleState, isParkUp, parkSlot, presentEngineState, queuePos, truckStateAt, LANE_M, QUEUE_FRONT_M, type EngineTruckState, type PlanInput } from './sim';
import { buildPath } from '../strings/path';
import { poseOnPath, truckProportions, wrapAngle, lerpAngle } from './pose';

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  trucks: 4, spotS: 40, loadS: 120, dumpS: 60, haulEff: 0.85, stopsS: 0,
  segments: [
    { len: 1000, loadedS: 120, emptyS: 80, speedLoadedKmh: 30, speedEmptyKmh: 45 },
    { len: 500, loadedS: 90, emptyS: 40, speedLoadedKmh: 20, speedEmptyKmh: 45 },
  ],
  stops: [], loaderCycleS: 30, events: [], ...over,
});

describe('buildPlan', () => {
  it('builds travel keyframes scaled by the haul efficiency', () => {
    const p = buildPlan(base());
    expect(p.lengthM).toBe(1500);
    expect(p.haul.dur).toBeCloseTo(210 / 0.85);
    expect(p.ret.dur).toBeCloseTo(120 / 0.85);
    expect(p.cycleS).toBeCloseTo(40 + 120 + 60 + 330 / 0.85);
    expect(p.passes).toBe(4);
  });

  it('is loader-bound when over-trucked: effective cycle N·(spot + load) and a queue wait', () => {
    const p = buildPlan(base({ trucks: 6 }));
    expect(p.effCycleS).toBeCloseTo(6 * 160);
    expect(p.queueS).toBeCloseTo(6 * 160 - p.cycleS);
    expect(p.headwayS).toBeCloseTo(160);
  });

  it('dwells at stop signs and spreads the stop time when the string has none', () => {
    const withStop = buildPlan(base({ stopsS: 120, stops: [{ s: 1000 }] }));
    expect(withStop.haul.dur).toBeCloseTo(210 / 0.85 + 60);
    expect(withStop.haul.v.includes(0)).toBe(true);
    const spread = buildPlan(base({ stopsS: 120 }));
    expect(spread.haul.dur + spread.ret.dur).toBeCloseTo(330 / 0.85 + 120);
  });
});

describe('cycleState', () => {
  const p = buildPlan(base());
  const tHaul0 = p.queueS + p.spotS + p.loadS;

  it('walks queue → spot → load → haul → dump → return', () => {
    expect(cycleState(p, p.queueS + 1).phase).toBe('spot');
    const load0 = cycleState(p, p.queueS + p.spotS + 5);
    expect(load0.phase).toBe('load');
    expect(load0.fill).toBe(0);                       // first bucket not in yet
    expect(cycleState(p, p.queueS + p.spotS + 25).fill).toBeCloseTo(0.25);
    expect(cycleState(p, tHaul0 - 0.01).fill).toBe(1);
    const haul = cycleState(p, tHaul0 + 50);
    expect(haul.phase).toBe('haul');
    expect(haul.loaded).toBe(true);
    expect(haul.dir).toBe(1);
    expect(haul.speedKmh).toBe(30);
    expect(haul.lateral).toBeCloseTo(-LANE_M);
    const dump = cycleState(p, tHaul0 + p.haul.dur + p.dumpS * 0.6);
    expect(dump.phase).toBe('dump');
    expect(dump.tray).toBeGreaterThan(0.9);
    const ret = cycleState(p, tHaul0 + p.haul.dur + p.dumpS + 10);
    expect(ret.phase).toBe('return');
    expect(ret.loaded).toBe(false);
    expect(ret.rev).toBe(1);
  });

  it('chainage is continuous across the travel legs', () => {
    let prev = 0;
    for (let t = 0; t <= p.haul.dur + 4.99; t += 5) {
      const s = cycleState(p, tHaul0 + Math.min(t, p.haul.dur - 1e-6)).s;
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(s - prev).toBeLessThan(60);
      prev = s;
    }
    expect(prev).toBeCloseTo(1500, 0);
  });

  it('ETA to the dump counts down and is 0 while dumping', () => {
    expect(cycleState(p, tHaul0 + 10).etaDumpS).toBeCloseTo(p.haul.dur - 10);
    expect(cycleState(p, tHaul0 + p.haul.dur + 1).etaDumpS).toBe(0);
  });
});

describe('queue and parking', () => {
  it('stages queued trucks front to back and moves them up', () => {
    const p = buildPlan(base({ trucks: 8 }));
    const back = queuePos(p, 0), front = queuePos(p, p.queueS - 1);
    expect(front.s).toBeCloseTo(QUEUE_FRONT_M);
    expect(back.s).toBeGreaterThan(front.s);
    expect(front.ahead).toBe(0);
  });

  it('parks the stopped fraction of the fleet during a shift event and stops their clock', () => {
    const p = buildPlan(base({ events: [{ startMin: 60, durMin: 30, fleetStopFraction: 0.5 }] }));
    const a = truckStateAt(p, 0, 75), b = truckStateAt(p, 3, 75);
    expect(a.phase).toBe('parked');
    expect(a.speedKmh).toBe(0);
    expect(b.phase).not.toBe('parked');
    // the parked truck resumes where it stopped
    const before = truckStateAt(p, 0, 59.999), after = truckStateAt(p, 0, 90.001);
    expect(Math.abs(after.s - before.s)).toBeLessThan(2);
  });

  it('staggers the trucks around the cycle at shift start', () => {
    const p = buildPlan(base());
    const phases = new Set([0, 1, 2, 3].map(k => truckStateAt(p, k, 0).phase));
    expect(phases.size).toBeGreaterThan(1);
  });
});

describe('poseOnPath', () => {
  const path = buildPath([{ e: 0, n: 0, z: 0 }, { e: 100, n: 0, z: 10 }, { e: 100, n: 100, z: 10 }]);

  it('rides both axles on the path: heading and pitch from the chord', () => {
    const p = poseOnPath(path, 50, 0, 0, 6);
    expect(p.heading).toBeCloseTo(0);
    expect(p.pitch).toBeCloseTo(Math.atan2(10, 100), 3);
    expect(p.fe).toBeGreaterThan(p.e);
  });

  it('reverses heading and pitch, offsets to the right', () => {
    const p = poseOnPath(path, 50, 1, 4, 6);
    expect(Math.abs(wrapAngle(p.heading - Math.PI))).toBeLessThan(1e-9);
    expect(p.pitch).toBeCloseTo(-Math.atan2(10, 100), 3);
    expect(p.n).toBeCloseTo(-4); // right of east = south
  });

  it('turns smoothly through a corner', () => {
    const s0 = 100 * Math.hypot(1, 0.1);
    const h = [s0 - 10, s0, s0 + 10].map(s => poseOnPath(path, s, 0, 0, 6).heading);
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
    expect(h[1]).toBeGreaterThan(0.1);
    expect(h[1]).toBeLessThan(Math.PI / 2 - 0.1);
  });

  it('angle helpers', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(truckProportions(12).wheelbase).toBeCloseTo(5.64);
  });
});

describe('presentEngineState', () => {
  const plan = buildPlan(base());
  const es = (over: Partial<EngineTruckState>): EngineTruckState => ({
    truckIndex: 0, phase: 'haul', paused: false, chainageM: 500, speedKmh: 30, loaded: true, dir: 1, fill: 1, phaseStartMin: 10, phaseEndMin: 14, ...over,
  });

  it('keeps the engine chainage (scaled), speed and load; keep-left lane', () => {
    const s = presentEngineState(es({}), 12, 1500, 1.0, plan);
    expect(s.s).toBeCloseTo(500);
    expect(s.lateral).toBeCloseTo(-LANE_M);
    expect(s.speedKmh).toBe(30);
    expect(s.phaseRemainS).toBeCloseTo(120);
    expect(s.etaDumpS).toBeCloseTo(120);
    expect(presentEngineState(es({}), 12, 1530, 1.02, plan).s).toBeCloseTo(510);
  });

  it('turns and tips during the dump, fills bucket by bucket while loading', () => {
    const d = presentEngineState(es({ phase: 'dump', phaseStartMin: 10, phaseEndMin: 11 }), 10.6, 1500, 1, plan);
    expect(d.tray).toBeGreaterThan(0.9);
    expect(d.rev).toBe(1);
    const l = presentEngineState(es({ phase: 'load', chainageM: 0, fill: 0.3, phaseStartMin: 10, phaseEndMin: 12 }), 10.5, 1500, 1, plan);
    expect(l.fill).toBeCloseTo(0.25);
    expect(l.s).toBe(0);
  });

  it('a paused truck shows as parked with zero speed, in place', () => {
    const p = presentEngineState(es({ paused: true, pauseLabel: 'Crib' }), 12, 1500, 1, plan);
    expect(p.phase).toBe('parked');
    expect(p.speedKmh).toBe(0);
    expect(p.s).toBeCloseTo(500);
  });

  it('a paused truck out on the road pulls over to the shoulder and back out before the event ends', () => {
    const wide = buildPlan(base({ laneM: 7.5, shoulderM: 10.5 }));
    const pause = { startMin: 11, endMin: 13, parkUp: false };
    const mid = presentEngineState(es({ paused: true, pauseLabel: 'Crib' }), 12, 1500, 1, wide, pause);
    expect(mid.lateral).toBeCloseTo(-10.5);
    expect(mid.s).toBeCloseTo(500);
    const atStart = presentEngineState(es({ paused: true }), 11, 1500, 1, wide, pause);
    expect(atStart.lateral).toBeCloseTo(-7.5);
    // at the loader it waits in place
    const ld = presentEngineState(es({ phase: 'load', chainageM: 0, paused: true }), 12, 1500, 1, wide, pause);
    expect(ld.lateral).toBe(0);
  });

  it('end-of-shift park-up: trucks drive to the park-up line near the loader instead of stopping on the road', () => {
    expect(isParkUp({ kind: 'changeover', label: 'End-of-shift park-up' })).toBe(true);
    expect(isParkUp({ kind: 'crib', label: 'Crib 1' })).toBe(false);
    const p = buildPlan(base({ laneM: 7.5, shoulderM: 10.5, parkGapM: 17 }));
    const pause = { startMin: 705, endMin: 720, parkUp: true };
    const slot = parkSlot(p, 2);
    expect(slot.s).toBeCloseTo(QUEUE_FRONT_M - 6 + 34);
    // a loaded truck 900 m out at the start of the event
    const t0 = presentEngineState(es({ truckIndex: 2, chainageM: 900, paused: true, pauseLabel: 'End-of-shift park-up' }), 705, 1500, 1, p, pause);
    expect(t0.s).toBeCloseTo(900);
    const tm = presentEngineState(es({ truckIndex: 2, chainageM: 900, paused: true }), 706, 1500, 1, p, pause);
    expect(tm.phase).toBe('return');
    expect(tm.s).toBeLessThan(900);
    expect(tm.s).toBeGreaterThan(slot.s);
    expect(tm.speedKmh).toBeGreaterThan(5);
    const end = presentEngineState(es({ truckIndex: 2, chainageM: 900, paused: true }), 719, 1500, 1, p, pause);
    expect(end.phase).toBe('parked');
    expect(end.s).toBeCloseTo(slot.s);
    expect(end.lateral).toBeCloseTo(slot.lateral);
    expect(end.rev).toBeCloseTo(1);
    expect(end.speedKmh).toBe(0);
    // chainage is continuous through the drive
    let prev = 900;
    for (let t = 705; t <= 720; t += 0.02) {
      const x = presentEngineState(es({ truckIndex: 2, chainageM: 900, paused: true }), t, 1500, 1, p, pause).s;
      expect(Math.abs(x - prev)).toBeLessThan(25);
      prev = x;
    }
  });
});
