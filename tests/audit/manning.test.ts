/**
 * Audit 6 — manning: the 14 workbook crew scenarios (Targets & Haulage Priorities, 2 crew blocks × 7 days) and
 * synthetic day plans (push-dozer rule above 12 trucks), re-derived from the workbook cells by xlcrew.py
 * (tests/audit/workbook-crew.json), against evaluateCrew / computeManning.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeAllCircuits, computeManning, evaluateCrew, type CrewCircuit } from '@/engine';
import { defaultCrewRules } from '@/data';
import { createDemoScenario } from '@/state/demo';

interface Sc { id: string; trucks: Record<string, number>; enabling: number; overrides: Record<string, number>; lines: Record<string, number> }
const W = JSON.parse(readFileSync(fileURLToPath(new URL('./workbook-crew.json', import.meta.url)), 'utf8')) as { scenarios: Sc[]; synthetic: Sc[] };

const KIND: Record<string, CrewCircuit['loaderType']> = { EX09: 'excavator', EX04: 'excavator', EX06: 'excavator', LDR1: 'loader', LDR2: 'loader' };

function engine(sc: Sc) {
  const circuits: CrewCircuit[] = Object.entries(sc.trucks).map(([u, n]) => ({ circuitId: `c-${u}`, loaderUnitId: u, loaderType: KIND[u], materialId: u.startsWith('LDR') ? 'CL' : 'OB', trucks: n }));
  const o = sc.overrides;
  const overrides: Record<string, number> = {};
  if (o.push != null) overrides.R7_BULK_PUSH = o.push;
  if (o.water != null) overrides.R10_WATER_CARTS = o.water;
  if (o.grader != null) overrides.R10_GRADERS = o.grader;
  if (o.sup_oce != null) { overrides.R10_SUPERVISORS = Math.max(0, o.sup_oce - 1); overrides.R10_OCE = Math.min(1, o.sup_oce); }
  if (sc.enabling !== 1) overrides.R9_ENABLING_DOZERS = sc.enabling;
  return evaluateCrew({ circuits, rules: defaultCrewRules(), trucksAvailable: 12, available: 28, overrides });
}

function compare(sc: Sc): string[] {
  const r = engine(sc);
  const L = sc.lines, c = r.ruleCounts;
  const want: Record<string, number> = {
    R1_TRUCK_OPERATORS: L.trucks, R2_EX_OPERATOR: L.EX09_op + L.EX04_op + L.EX06_op, R3_EX_DOZERS: L.EX09_dzr + L.EX04_dzr + L.EX06_dzr,
    R4_LOADER_OPERATOR: L.LDR1_op + L.LDR2_op, R5_COAL_DOZER: L.LDR1_coal + L.LDR2_coal, R6_SUPPORT_EX: L.support_ex,
    R7_BULK_PUSH: L.push, R8_PUSH_ASSIST: L.assist, R9_ENABLING_DOZERS: L.enabling, R10_WATER_CARTS: L.water, R10_GRADERS: L.grader,
  };
  const bad: string[] = [];
  for (const [k, w] of Object.entries(want)) if ((c[k] ?? 0) !== w) bad.push(`${sc.id} ${k}: engine ${c[k] ?? 0} vs workbook ${w}`);
  if ((c.R10_SUPERVISORS ?? 0) + (c.R10_OCE ?? 0) !== L.sup_oce) bad.push(`${sc.id} sup+OCE ${(c.R10_SUPERVISORS ?? 0) + (c.R10_OCE ?? 0)} vs ${L.sup_oce}`);
  if (r.total !== L.total) bad.push(`${sc.id} TOTAL engine ${r.total} vs workbook ${L.total}`);
  const sumRoles = Object.values(r.required).reduce((a, b) => a + b, 0);
  if (sumRoles !== r.total) bad.push(`${sc.id} Σ roles ${sumRoles} ≠ total ${r.total}`);
  const st = r.steps.find(s => s.id === 'manning.total');
  if (st?.value !== r.total) bad.push(`${sc.id} manning.total step ${st?.value} ≠ ${r.total}`);
  return bad;
}

describe('audit 6 · manning vs the workbook crew blocks', () => {
  it.each(W.scenarios.map(s => [s.id, s] as const))('workbook %s', (_id, s) => expect(compare(s)).toEqual([]));
  it.each(W.synthetic.map(s => [s.id, s] as const))('synthetic %s (workbook formulas)', (_id, s) => expect(compare(s)).toEqual([]));

  it('computeManning on the demo equals block 1 day 1 (36)', async () => {
    const s = await createDemoScenario();
    const m = computeManning(s, computeAllCircuits(s));
    expect(m.total).toBe(36);
    expect(m.required.truck).toBe(12);
    expect(m.surplus).toBe(30 - 36);
  });
});
