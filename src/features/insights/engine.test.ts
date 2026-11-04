import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitResult, FleetOption, ManningResult, PriorityResult, Scenario, SegmentResult, ShiftState } from '@/core/types';
import { excelRound2, generateInsights, applyHaulOption } from './engine';
import { syntheticScenario } from './synthetic';

/** A synthetic circuit result: per-truck capacity `perTruck` bcm/day up to loader cap `cap`, loader PT target `pt`. */
function result(c: Circuit, perTruck: number, cap: number, pt = 20, segs: Partial<SegmentResult>[] = []): CircuitResult {
  const rate = cap / pt;
  const opt = (n: number): FleetOption => {
    const truckCap = n * perTruck;
    const bcm = Math.min(truckCap, cap);
    const lpt = bcm / rate;
    const lost = Math.max(0, (pt - lpt) / 2);
    const queue = Math.max(0, (truckCap - bcm) / (perTruck / 20) / 2);
    return { trucks: n, truckCapacityBcmDay: truckCap, bcmPerDay: bcm, loaderPtHrsDay: lpt, lostLoaderPtHrsShift: lost, truckQueueHrsShift: queue,
      matchFactor: truckCap / cap, loaderUtil: lpt / pt, status: lost > 0.05 ? 'under' : queue > 0.05 ? 'over' : 'balanced' };
  };
  const options = Array.from({ length: 12 }, (_, i) => opt(i + 1));
  const exact = cap / perTruck;
  const segments = segs.map((g, i) => ({
    i, from: [0, 0, 0], to: [0, 0, 0], chainageM: i * 25, dist3dM: 25, distPlanM: 25, grade: 0, rrPct: 2, effGradeLoaded: 0, effGradeEmpty: 0,
    speedLoadedKmh: 30, speedEmptyKmh: 30, timeLoadedS: 3, timeEmptyS: 3, limitLoaded: 'table', limitEmpty: 'table', speedLimitKmh: 60, ...g,
  })) as SegmentResult[];
  return {
    circuitId: c.id, ok: true, speedModel: 'spreadsheet', segments, lengthM: 2000, riseM: 50, fallM: 0, travelLoadedS: 400, travelEmptyS: 380,
    haulTimeS: 900, stopsS: 120, cycleS: 1200, cycleMin: 20, truckProdBcmPerPtHr: perTruck / 20, truckHoursReq: exact * 20, trucksExact: exact,
    trucksRecommended: Math.ceil(exact - 1e-9), loaderPtHrs: pt, lostPtHrsShift: opt(c.trucks).lostLoaderPtHrsShift, assigned: opt(c.trucks), options, steps: [], warnings: [],
  };
}

function setup(mut?: (s: Scenario) => void) {
  const s = syntheticScenario();
  mut?.(s);
  const byId = (id: string) => s.circuits.find(c => c.id === id)!;
  const results: Record<string, CircuitResult> = {
    c_ex09: result(byId('c_ex09'), 6000, 36000),   // needs 6, has 5 → under
    c_ex04: result(byId('c_ex04'), 6500, 26000),   // needs 4, has 4 → balanced
    c_ldr1: result(byId('c_ldr1'), 4000, 11700, 18), // needs 2.9, has 3 → slightly over
  };
  return { s, results };
}

describe('insight engine', () => {
  it('flags an under-trucked circuit with lost PT and bcm, and ranks it above opportunities', () => {
    const { s, results } = setup();
    const ins = generateInsights({ scenario: s, results });
    const u = ins.find(i => i.id === 'under-c_ex09')!;
    expect(u).toBeTruthy();
    expect(u.kind).toBe('under-trucked');
    expect(u.impactBcmDay).toBeCloseTo(6000, 6);
    expect(u.headline).toMatch(/EX09 under-trucked/);
    expect(u.headline).toMatch(/1\.67 h\/shift/); // (20 − 30000/1800) / 2
    expect(u.explain.length).toBeGreaterThan(2);
    // severity ordering: critical/warning before opportunity
    const order = ins.map(i => i.severity);
    const rank = { critical: 0, warning: 1, opportunity: 2, info: 3 } as const;
    expect([...order].sort((a, b) => rank[a] - rank[b])).toEqual(order);
  });

  it('suggests a net-positive truck transfer when no trucks are idle', () => {
    const { s, results } = setup();
    const ins = generateInsights({ scenario: s, results });
    // LDR1 (3 → 2 loses 11700 − 8000 = 3700) to EX09 (5 → 6 gains 6000): +2300 net
    const t = ins.find(i => i.kind === 'transfer')!;
    expect(t).toBeTruthy();
    expect(t.id).toBe('transfer-c_ldr1-c_ex09');
    expect(t.impactBcmDay).toBeCloseTo(2300, 6);
    const apply = t.actions.find(a => a.kind === 'apply');
    expect(apply && apply.kind === 'apply').toBe(true);
    if (apply?.kind === 'apply') {
      const next = apply.apply(s);
      expect(next.circuits.find(c => c.id === 'c_ex09')!.trucks).toBe(6);
      expect(next.circuits.find(c => c.id === 'c_ldr1')!.trucks).toBe(2);
    }
  });

  it('reports over-limit fleets as critical and idle trucks as an assignment opportunity', () => {
    const over = setup(s => { s.fleet.trucksAvailable = 11; });
    expect(generateInsights({ scenario: over.s, results: over.results })[0].kind).toBe('fleet-over-limit');
    const idle = setup(s => { s.fleet.trucksAvailable = 13; });
    const sp = generateInsights({ scenario: idle.s, results: idle.results }).find(i => i.kind === 'spare-trucks')!;
    expect(sp.headline).toMatch(/EX09 \+1/);
    expect(sp.impactBcmDay).toBeCloseTo(6000, 6);
  });

  it('downgrades deliberate over/under-trucking to an annotated info card', () => {
    const { s, results } = setup(sc => { sc.circuits.find(c => c.id === 'c_ex09')!.tags = ['deliberate:dig block running out'] });
    const u = generateInsights({ scenario: s, results }).find(i => i.circuitId === 'c_ex09' && i.kind === 'deliberate')!;
    expect(u.severity).toBe('info');
    expect(u.headline).toBe('EX09 deliberately under-trucked −1: dig block running out');
  });

  it('detects crew shortfall and names the cut circuit from the priority plan', () => {
    const { s, results } = setup();
    const manning = { required: {}, total: 36, available: 34, surplus: -2, lines: [], steps: [] } as unknown as ManningResult;
    const priority: PriorityResult = {
      crewAvailable: 34, crewUsed: 34, trucksAvailable: 12, trucksUsed: 10, narrative: ['LDR1 reduced to 1 truck: crew exhausted'], steps: [],
      allocations: [
        { circuitId: 'c_ex09', priority: 1, requestedTrucks: 5, allocatedTrucks: 5, crewRequested: 8, crewAllocated: 8, status: 'full', bcmDayPlanned: 30000, bcmDayAchieved: 30000, bcmDayLost: 0, lostPtHrsShift: 1.7, alternatives: [] },
        { circuitId: 'c_ldr1', priority: 3, requestedTrucks: 3, allocatedTrucks: 1, crewRequested: 6, crewAllocated: 4, status: 'reduced', bcmDayPlanned: 11700, bcmDayAchieved: 4000, bcmDayLost: 7700, lostPtHrsShift: 5, alternatives: [] },
      ],
    };
    const c = generateInsights({ scenario: s, results, manning, priority }).find(i => i.kind === 'crew-shortfall')!;
    expect(c.severity).toBe('critical');
    expect(c.headline).toBe('Crew short by 2 on A Crew – Day: LDR1 (P3) cut to 1 truck');
    expect(c.impactBcmDay).toBe(7700);
    expect(c.actions.some(a => a.kind === 'apply')).toBe(true);
  });

  it('finds segments the spreadsheet would drop (> ±16 %) and grades above 10 %', () => {
    const { s, results } = setup();
    results.c_ex04 = result(s.circuits[1], 6500, 26000, 20, [{ grade: 0.05 }, { grade: 0.115 }, { grade: -0.165 }, { grade: 0.164 }]);
    const ins = generateInsights({ scenario: s, results });
    const drop = ins.find(i => i.id === 'drop-c_ex04')!;
    expect(drop.headline).toMatch(/drop 1 segment \(25\.0 m\)/); // −0.165 → ROUND = −0.17; 0.164 → 0.16 stays
    const steep = ins.find(i => i.id === 'steep-c_ex04')!;
    expect(steep.headline).toMatch(/50 m .* steeper than 10%/);
    expect(steep.actions[0]).toMatchObject({ kind: 'show', target: { kind: 'string', id: 'hs_ex04' } });
  });

  it('flags loader PT below the 18 h minimum', () => {
    const { s, results } = setup();
    const ins = generateInsights({ scenario: s, results });
    const pt = ins.find(i => i.id === 'pt-c_ex09')!;
    expect(pt.headline).toMatch(/16\.7 h\/day – below the 18 h minimum/);
    expect(ins.find(i => i.id === 'pt-c_ex04')).toBeUndefined();
  });

  it('times dig-block exhaustion within the shift from the shift state', () => {
    const { s, results } = setup();
    s.assets = [{ id: 'dig_b79', name: 'B7-9 dig' } as Scenario['assets'][number]];
    const at = (tMin: number): ShiftState => ({
      tMin, clock: '', productiveFraction: tMin / 720,
      perCircuit: [{ circuitId: 'c_ex09', bcmSoFar: 0, bcmShift: 15000, digFraction: tMin / 540, dumpFraction: 0.3, loads: 0 }],
    });
    const ins = generateInsights({ scenario: s, results, shiftEnd: at(720), shiftAt: at });
    const d = ins.find(i => i.kind === 'dig-exhausted')!;
    expect(d.headline).toBe('EX09: B7-9 dig dig block exhausted at 15:00');
    expect(ins.find(i => i.kind === 'dump-full')).toBeUndefined();
  });

  it('evaluates long/short haul options and swaps the route on apply', () => {
    const { s, results } = setup();
    const ins = generateInsights({
      scenario: s, results,
      evalCircuit: (c, o) => (o.haulStringId === 'hs_ex09_short' ? result({ ...c, trucks: o.trucks ?? c.trucks }, 9000, 36000) : result({ ...c, trucks: o.trucks ?? c.trucks }, 5000, 36000)),
    });
    const opt = ins.find(i => i.id === 'option-c_ex09')!;
    expect(opt.headline).toMatch(/B8-10 OB → T-Bridge RL295/);
    expect(opt.impactBcmDay).toBeCloseTo(6000, 6);
    const next = applyHaulOption('c_ex09', 'hs_ex09_short')(s).circuits[0];
    expect(next.haulStringId).toBe('hs_ex09_short');
    expect(next.altHaulStringIds).toEqual(['hs_ex09', 'hs_ex09_long']);
  });

  it('excelRound2 rounds half away from zero on the 15-digit value', () => {
    expect(excelRound2(0.015)).toBe(0.02);
    expect(excelRound2(-0.165)).toBe(-0.17);
    expect(excelRound2(0.164999)).toBe(0.16);
    expect(Object.is(excelRound2(-0.004), -0) || excelRound2(-0.004) === 0).toBe(true);
  });
});
