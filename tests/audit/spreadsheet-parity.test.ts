/**
 * Audit 1 — spreadsheet parity against values re-derived from calc.xlsm itself (tests/audit/workbook-derived.json,
 * written by an independent Python model of the 'Travel Time' + 'ActiveRoute' formulas that is first checked against
 * the workbook's cached cells). Not the engine's own fixtures.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeCircuit } from '@/engine';
import type { CircuitResultExt, SegmentResultExt } from '@/engine/types';
import { circuitFor, scenarioWith, stringFrom } from '@/engine/testing';

interface Row { row: number; i: number; A: number | null; B: number | null; R: number | null; C: number | null; D: number | null; RK: number | null; L: number | null; M: number | null }
interface Out { [k: string]: number }
interface Case {
  id: string; title: string; points: (number | null)[][];
  inputs: { B3: string; C3: string; C6: number; C11: number; C20: number; I34: number; unit: string; truckId: string; materialId: string };
  rows: Row[]; expected: Out; macro: (Out & { n: number; capped: boolean })[];
}
const W = JSON.parse(readFileSync(fileURLToPath(new URL('./workbook-derived.json', import.meta.url)), 'utf8')) as {
  cases: Case[]; allStrings: { n: number; title: string; points: number[][]; C4: number; C5: number; dropped: number }[];
};

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

function run(c: Case, trucks = 3): CircuitResultExt {
  const hs = stringFrom(`hs-${c.id}`, c.title, c.points as number[][]);
  const ci = circuitFor(`c-${c.id}`, c.inputs.unit, c.inputs.truckId, c.inputs.materialId, hs.id, trucks, {
    haulEff: c.inputs.C6, stopSigns: c.inputs.C11, desiredDailyBcm: c.inputs.C20, truckPtHrsPerDay: c.inputs.I34, speedModel: 'spreadsheet',
  });
  return computeCircuit(scenarioWith([hs], [ci]), ci, { maxTrucks: 12 }) as CircuitResultExt;
}

/** Compare one case; returns human-readable mismatches. */
function compare(c: Case): string[] {
  const bad: string[] = [];
  const r = run(c);
  if (!r.ok) return [`${c.id}: engine error ${r.error}`];
  const chk = (what: string, got: number | undefined, exp: number, tol = 1e-12) => {
    if (got == null || !Number.isFinite(got) || (exp === 0 ? Math.abs(got) > 1e-12 : rel(got, exp) > tol)) bad.push(`${c.id} ${what}: engine ${got} vs workbook ${exp}`);
  };
  const segs = new Map((r.segments as SegmentResultExt[]).map(s => [s.i, s]));
  let timed = 0;
  for (const w of c.rows) {
    const g = segs.get(w.i);
    if (w.A == null || w.B == null) { // blank / zero-length row: no time
      if (g && (g.timeLoadedS !== 0 || g.timeEmptyS !== 0)) bad.push(`${c.id} row ${w.row}: Excel blank but engine timed ${g.timeLoadedS}/${g.timeEmptyS}`);
      continue;
    }
    if (!g) { bad.push(`${c.id} row ${w.row}: missing engine segment i=${w.i}`); continue; }
    timed++;
    if (g.sheetRow !== w.row) bad.push(`${c.id} row ${w.row}: sheetRow ${g.sheetRow}`);
    chk(`row ${w.row} A`, g.dist3dM, w.A);
    chk(`row ${w.row} B`, g.grade, w.B);
    if (g.gradeRoundedLoaded !== w.R) bad.push(`${c.id} row ${w.row} ROUND(B): engine ${g.gradeRoundedLoaded} vs ${w.R} (B=${w.B})`);
    if ((g.gradeRoundedEmpty ?? NaN) + 0 !== (w.RK as number) + 0) bad.push(`${c.id} row ${w.row} ROUND(K): engine ${g.gradeRoundedEmpty} vs ${w.RK}`);
    if (w.C == null) { if (g.timeLoadedS !== 0 || !g.droppedLoaded) bad.push(`${c.id} row ${w.row}: Excel drops loaded, engine ${g.speedLoadedKmh} km/h ${g.timeLoadedS} s`); }
    else { if (g.speedLoadedKmh !== w.C) bad.push(`${c.id} row ${w.row} C: ${g.speedLoadedKmh} vs ${w.C}`); chk(`row ${w.row} D`, g.timeLoadedS, w.D as number); }
    if (w.L == null) { if (g.timeEmptyS !== 0 || !g.droppedEmpty) bad.push(`${c.id} row ${w.row}: Excel drops return, engine ${g.speedEmptyKmh} km/h ${g.timeEmptyS} s`); }
    else { if (g.speedEmptyKmh !== w.L) bad.push(`${c.id} row ${w.row} L: ${g.speedEmptyKmh} vs ${w.L}`); chk(`row ${w.row} M`, g.timeEmptyS, w.M as number); }
  }
  if (timed !== r.segments.filter(s => s.dist3dM > 0).length) bad.push(`${c.id}: engine has ${r.segments.length} segments, workbook ${timed} non-blank rows`);
  const X = c.expected;
  const step = (id: string) => r.steps.find(s => s.id === id)?.value;
  chk('C4', r.travelLoadedS, X.C4, 1e-12);
  chk('C5', r.travelEmptyS, X.C5, 1e-12);
  chk('C7', r.haulTimeS, X.C7);
  chk('C8', step('cycle.dump'), X.C8);
  chk('C9', step('cycle.spot'), X.C9);
  chk('C10', step('cycle.load'), X.C10);
  chk('C12', r.stopsS, X.C12);
  chk('C14', r.cycleS, X.C14);
  chk('C15', r.cycleMin, X.C15);
  chk('C16', r.truckProdBcmPerPtHr, X.C16);
  chk('C17', r.truckHoursReq, X.C17);
  chk('C19', r.idealDailyBcm, X.C19);
  chk('C20', r.desiredDailyBcm, X.C20);
  chk('C21', r.truckLoadBcm, X.C21);
  chk('C22', step('fleet.trucks') != null ? r.truckHoursReq / r.trucksExact : NaN, X.C22);
  chk('C24', r.trucksExact, X.C24);
  chk('C26', r.loaderPtHrs, X.C26);
  chk('C28', step('loader.lost'), X.C28);
  for (const m of c.macro) {
    const o = r.options[m.n - 1];
    if (!o) { bad.push(`${c.id} button ${m.n}: no option`); continue; }
    if (o.capped !== m.capped) bad.push(`${c.id} button ${m.n}: capped ${o.capped} vs ${m.capped}`);
    chk(`button ${m.n} C20`, o.bcmPerDay, m.C20);
    chk(`button ${m.n} C17`, o.truckHoursReq, m.C17);
    chk(`button ${m.n} C24`, o.trucksNeeded, m.C24);
    chk(`button ${m.n} C26`, o.loaderPtHrsDay, m.C26);
    chk(`button ${m.n} C28`, o.lostLoaderPtHrsShift, m.C28);
  }
  return bad;
}

describe('audit 1 · spreadsheet parity vs the workbook re-derived independently', () => {
  it.each(W.cases.map(c => [c.id, c] as const))('%s', (_id, c) => {
    const bad = compare(c);
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
  });

  it('all 23 Raw Data strings: C4 / C5 / dropped count', () => {
    const bad: string[] = [];
    for (const s of W.allStrings) {
      const c = { id: `raw${s.n}`, title: s.title, points: s.points, inputs: { unit: 'EX09', truckId: 'CAT_789D', materialId: 'OB', C6: 0.85, C11: 2, C20: 36000, I34: 20 } } as unknown as Case;
      const r = run(c);
      if (!r.ok) { bad.push(`${s.n}: ${r.error}`); continue; }
      if (rel(r.travelLoadedS, s.C4) > 1e-12) bad.push(`${s.n} C4 ${r.travelLoadedS} vs ${s.C4}`);
      if (rel(r.travelEmptyS, s.C5) > 1e-12) bad.push(`${s.n} C5 ${r.travelEmptyS} vs ${s.C5}`);
      if (r.droppedSegments.length !== s.dropped) bad.push(`${s.n} dropped ${r.droppedSegments.length} vs ${s.dropped}`);
    }
    expect(bad).toEqual([]);
  });

  it('negative control: perturbed workbook values are caught', () => {
    const c = structuredClone(W.cases[0]);
    c.expected.C16 *= 1 + 1e-9;
    c.rows[5].C = 20;
    c.macro[2].C28 += 0.01;
    expect(compare(c).length).toBe(3);
  });

  it('a blank interior Data Dump row is refused (workbook would add ~846 000 s phantom time)', () => {
    const c = W.cases[0];
    const pts = [...c.points.slice(0, 10), [0, 0, 0], ...c.points.slice(10, 20)] as number[][];
    const r = run({ ...c, id: 'blank', points: pts });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/grid origin|phantom/);
  });
});
