/**
 * Spreadsheet parity: calc.xlsm 'Travel Time' + 'ActiveRoute' (fixture spreadsheet-active-route.json, verified
 * against Excel's cached values) and the 23 Raw Data strings (raw-data-strings.json).
 */
import { describe, expect, it } from 'vitest';
import { computeCircuit } from '../haul/circuit';
import type { CircuitResultExt } from '../types';
import { excelRound } from '../util/excel';
import { circuitFor, fixture, rel, scenarioWith, stringFrom } from '../testing';

interface Seg {
  travel_time_row: number; from_point_index: number; distance_m: number; grade: number; grade_rounded: number;
  loaded_speed_kmh: number | null; loaded_time_s: number | null; unloaded_grade_rounded: number; unloaded_speed_kmh: number | null; unloaded_time_s: number | null;
  excluded_from_time_totals?: boolean;
}
interface ActiveRoute {
  points: number[][];
  segments: Seg[];
  segments_excluded_from_time: number[];
  expected: Record<string, { value: number }>;
  macro_truck_buttons: { table: { button: number; C20: number; C17: number; C24: number; C26: number; C28: number; capped_at_C19: boolean }[] };
}

const AR = fixture<ActiveRoute>('spreadsheet-active-route.json');
const TOL = 1e-9;

function run(extra: Parameters<typeof computeCircuit>[2] = {}, trucks = 3) {
  const hs = stringFrom('hs-ex09-rl282', 'EX09 - B7-9 to RL282', AR.points);
  const c = circuitFor('c-ex09', 'EX09', 'CAT_789D', 'OB', hs.id, trucks);
  const s = scenarioWith([hs], [c]);
  return computeCircuit(s, c, extra) as CircuitResultExt;
}

const close = (got: number, exp: number, tol = TOL) => {
  if (exp === 0) expect(Math.abs(got)).toBeLessThanOrEqual(1e-12);
  else expect(rel(got, exp)).toBeLessThanOrEqual(tol);
};

describe('excelRound (Excel ROUND half away from zero on the 15-digit value)', () => {
  it('matches the spec examples', () => {
    expect(excelRound(0.015, 2)).toBe(0.02);
    expect(excelRound(-0.165, 2)).toBe(-0.17);
    expect(excelRound(-0.004, 2)).toBe(-0);
    expect(excelRound(0.0449999999999999, 2)).toBe(0.04);
    expect(excelRound(2.5, 0)).toBe(3);
    expect(excelRound(-2.5, 0)).toBe(-3);
    expect(excelRound(1234.5678, -2)).toBe(1200);
    expect(excelRound(0.07, 2)).toBe(0.07);
  });
  it('rounds every fixture grade like Excel', () => {
    for (const s of AR.segments) {
      expect(excelRound(s.grade, 2)).toBe(s.grade_rounded);
      expect(excelRound(-s.grade, 2)).toBe(s.unloaded_grade_rounded);
    }
  });
});

describe('spreadsheet mode reproduces Travel Time + ActiveRoute exactly', () => {
  const r = run();

  it('computes ok with every segment', () => {
    expect(r.ok).toBe(true);
    expect(r.speedModel).toBe('spreadsheet');
    expect(r.segments.length).toBe(AR.segments.length);
  });

  it('matches every Travel Time row (A, B, ROUND, C, D, K, L, M)', () => {
    AR.segments.forEach((e, k) => {
      const g = r.segments[k];
      expect(g.i).toBe(e.from_point_index);
      expect(g.sheetRow).toBe(e.travel_time_row);
      close(g.dist3dM, e.distance_m, 1e-12);
      close(g.grade, e.grade, 1e-12);
      expect(g.gradeRoundedLoaded).toBe(e.grade_rounded);
      expect(g.gradeRoundedEmpty).toBe(e.unloaded_grade_rounded);
      if (e.loaded_speed_kmh == null) {
        expect(g.droppedLoaded).toBe(true);
        expect(g.timeLoadedS).toBe(0);
        expect(g.limitLoaded).toBe('table-out-of-range');
      } else {
        expect(g.speedLoadedKmh).toBe(e.loaded_speed_kmh);
        close(g.timeLoadedS, e.loaded_time_s as number, 1e-12);
      }
      if (e.unloaded_speed_kmh == null) {
        expect(g.droppedEmpty).toBe(true);
        expect(g.timeEmptyS).toBe(0);
      } else {
        expect(g.speedEmptyKmh).toBe(e.unloaded_speed_kmh);
        close(g.timeEmptyS, e.unloaded_time_s as number, 1e-12);
      }
    });
  });

  it('drops exactly the segments Excel drops (rows 36, 39, 40, 46) with a loud warning and a CalcStep each', () => {
    expect(r.droppedSegments.map(i => i + 4)).toEqual(AR.segments_excluded_from_time);
    const dropWarn = r.warnings.filter(w => w.startsWith('DROPPED'));
    expect(dropWarn.length).toBe(4);
    for (const row of AR.segments_excluded_from_time) {
      const st = r.steps.find(s => s.sheetRef === `'Travel Time'!D${row}`);
      expect(st, `step for row ${row}`).toBeTruthy();
      expect(st!.value).toBe(0);
    }
  });

  it('matches ActiveRoute C4…C28', () => {
    const X = AR.expected;
    close(r.travelLoadedS, X.C4.value);
    close(r.travelEmptyS, X.C5.value);
    close(r.haulTimeS, X.C7.value);
    close(r.stopsS, X.C12.value);
    close(r.cycleS, X.C14.value);
    close(r.cycleMin, X.C15.value);
    close(r.truckProdBcmPerPtHr, X.C16.value);
    close(r.truckHoursReq, X.C17.value);
    close(r.idealDailyBcm, X.C19.value);
    close(r.desiredDailyBcm, X.C20.value);
    close(r.truckLoadBcm, X.C21.value);
    close(r.trucksExact, X.C24.value);
    close(r.loaderPtHrs, X.C26.value);
    const lost = r.steps.find(s => s.id === 'loader.lost')!;
    close(lost.value, X.C28.value);
    const step = (id: string) => r.steps.find(s => s.id === id)!;
    close(step('cycle.dump').value, X.C8.value);
    close(step('cycle.spot').value, X.C9.value);
    close(step('cycle.load').value, X.C10.value);
    expect(step('cycle.haul').sheetRef).toBe('ActiveRoute!C7');
    expect(step('prod.truck').sheetRef).toBe('ActiveRoute!C16');
  });

  it('every CalcStep carries a formula and the key ones a sheetRef + sourced inputs', () => {
    for (const s of r.steps) { expect(s.formula.length).toBeGreaterThan(0); expect(Number.isFinite(s.value)).toBe(true); }
    const load = r.steps.find(s => s.id === 'cycle.load')!;
    expect(load.inputs?.[0].source).toBe('Loader assumptions · EX09 (ActiveRoute!I31)');
    const tl = r.steps.find(s => s.id === 'prod.load')!;
    expect(tl.inputs?.[0].source).toContain('ActiveRoute!N14');
  });

  it('macro buttons 1–9: C20 = MIN(n × C22 × C16, C19) then C17, C24, C26, C28', () => {
    const rr = run({ maxTrucks: 9 });
    for (const row of AR.macro_truck_buttons.table) {
      const o = rr.options[row.button - 1];
      expect(o.trucks).toBe(row.button);
      expect(o.capped).toBe(row.capped_at_C19);
      close(o.bcmPerDay, row.C20);
      close(o.truckHoursReq, row.C17);
      close(o.trucksNeeded, row.C24);
      close(o.loaderPtHrsDay, row.C26);
      close(o.lostLoaderPtHrsShift, row.C28);
    }
  });

  it('"Fix" option times out-of-range segments at the steepest-row speeds (+1.43 s loaded, +1.22 s return)', () => {
    const fx = run({ outOfRange: 'clamp' });
    expect(fx.droppedSegments.length).toBe(0);
    expect(fx.travelLoadedS - r.travelLoadedS).toBeCloseTo(1.43, 2);
    expect(fx.travelEmptyS - r.travelEmptyS).toBeCloseTo(1.22, 2);
    expect(fx.warnings.some(w => w.includes('differs from Excel'))).toBe(true);
  });

  it('assigned trucks select the macro option and report hang / queue / match factor', () => {
    const r3 = run({}, 3);
    close(r3.lostPtHrsShift, AR.macro_truck_buttons.table[2].C28);
    expect(r3.assigned.status).toBe('under');
    const r4 = run({}, 4);
    expect(r4.assigned.status).toBe('balanced');
    expect(r4.assigned.truckQueueHrsShift).toBeGreaterThan(0);
    const r6 = run({}, 6);
    expect(r6.assigned.status).toBe('over');
    expect(r3.assigned.matchFactor).toBeCloseTo((3 * 140) / r3.cycleS, 12);
  });
});

describe('Raw Data strings (derived spreadsheet-mode travel times)', () => {
  const raw = fixture<{ strings: { id: string; title: string; points: number[][]; spreadsheet_mode_travel: { loaded_time_s: number; unloaded_time_s: number; segments_excluded_out_of_range: number } }[] }>('raw-data-strings.json');
  it.each(raw.strings.map(s => [s.title, s] as const))('%s', (_t, s) => {
    const hs = stringFrom(s.id, s.title, s.points);
    const c = circuitFor('c', 'EX09', 'CAT_789D', 'OB', hs.id, 3);
    const r = computeCircuit(scenarioWith([hs], [c]), c) as CircuitResultExt;
    expect(r.ok).toBe(true);
    close(r.travelLoadedS, s.spreadsheet_mode_travel.loaded_time_s);
    close(r.travelEmptyS, s.spreadsheet_mode_travel.unloaded_time_s);
    expect(r.droppedSegments.length).toBe(s.spreadsheet_mode_travel.segments_excluded_out_of_range);
  });
});
