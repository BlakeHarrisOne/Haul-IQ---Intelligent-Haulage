/**
 * Manning: the workbook's 14 crew test scenarios (spreadsheet-targets-crew.json) + every crew-block cell, generic
 * scopes, and the derived-rule expression language.
 */
import { describe, expect, it } from 'vitest';
import type { CrewRule } from '@/core/types';
import { defaultCrewRules } from '@/data';
import type { CrewRuleExt } from '../types';
import { fixture } from '../testing';
import { evaluateCrew, type CrewCircuit } from './evaluate';
import { evalExpr } from './expr';

interface Scenario14 {
  id: string;
  inputs: { circuits: { id: string; kind: 'excavator' | 'loader'; trucks: number }[]; enabling_dozers: number };
  overrides: { circuit_trucks?: Record<string, number>; roles?: Record<string, number> };
  expected: { total_crew: number; total_trucks?: number; dozer_bulk_push_E47?: number };
}
interface Line { row: number; trucks: (number | null)[]; equip_op: (number | null)[]; maps_to: { trucks?: [string, string | null]; equip_op?: [string, string | null] } }
const TC = fixture<{ rule_set: { test_scenarios: Scenario14[] }; crew_blocks: { rows: string; lines: Line[] }[] }>('spreadsheet-targets-crew.json');

const unitOf = (id: string) => id.replace(/\s+/g, '');
const ROLE_RULE: Record<string, string[]> = {
  truck_operator: ['R1_TRUCK_OPERATORS'], excavator_operator: ['R2_EX_OPERATOR'], dozer_floor_dump: ['R3_EX_DOZERS'], loader_operator: ['R4_LOADER_OPERATOR'],
  dozer_coal: ['R5_COAL_DOZER'], support_excavator_operator: ['R6_SUPPORT_EX'], dozer_bulk_push: ['R7_BULK_PUSH'], dozer_push_assist: ['R8_PUSH_ASSIST'],
  dozer_enabling: ['R9_ENABLING_DOZERS'], water_cart: ['R10_WATER_CARTS'], grader: ['R10_GRADERS'], supervisor_oce: ['R10_SUPERVISORS', 'R10_OCE'],
};

function evalScenario(sc: Scenario14, rules: CrewRule[] = defaultCrewRules()) {
  const circuits: CrewCircuit[] = sc.inputs.circuits.map(c => ({
    circuitId: c.id, loaderUnitId: unitOf(c.id), loaderType: c.kind, materialId: c.kind === 'loader' ? 'CL' : 'OB',
    trucks: sc.overrides.circuit_trucks?.[c.id] ?? c.trucks,
  }));
  const ov: Record<string, number> = {};
  for (const [role, v] of Object.entries(sc.overrides.roles ?? {})) {
    const ids = ROLE_RULE[role];
    ids.forEach((id, k) => { ov[id] = k === 0 ? v : 0; });
  }
  const R = rules.map(r => (r.id === 'R9_ENABLING_DOZERS' ? { ...r, count: sc.inputs.enabling_dozers } : r));
  return evaluateCrew({ circuits, rules: R, trucksAvailable: 12, available: 28, overrides: ov });
}

describe('workbook crew scenarios (Targets rows 47, 65–116)', () => {
  it.each(TC.rule_set.test_scenarios.map(s => [s.id, s] as const))('%s', (_id, sc) => {
    const r = evalScenario(sc);
    expect(r.total).toBe(sc.expected.total_crew);
    if (sc.expected.total_trucks != null) expect(r.totalTrucks).toBe(sc.expected.total_trucks);
    if (sc.expected.dozer_bulk_push_E47 != null) expect(r.ruleCounts.R7_BULK_PUSH).toBe(sc.expected.dozer_bulk_push_E47);
    expect(r.steps.find(s => s.id === 'manning.total')!.value).toBe(sc.expected.total_crew);
  });

  it('reproduces every crew-block cell (both blocks, 7 days)', () => {
    TC.crew_blocks.forEach((block, b) => {
      for (let day = 0; day < 7; day++) {
        const sc = TC.rule_set.test_scenarios.find(s => s.id === `${b === 0 ? 'linked_plan' : 'manual_scenario'}_day${day + 1}`)!;
        const r = evalScenario(sc);
        for (const line of block.lines) {
          for (const col of ['trucks', 'equip_op'] as const) {
            const exp = line[col][day];
            const map = line.maps_to[col];
            if (exp == null || !map) continue;
            const [role, circuit] = map;
            const ids = ROLE_RULE[role];
            const got = r.lines.filter(l => ids.includes(l.ruleId) && (circuit == null || l.circuitId === circuit)).reduce((a, l) => a + l.count, 0);
            expect(got, `${block.rows} row ${line.row} ${col} day ${day + 1}`).toBe(exp);
          }
        }
      }
    });
  });

  it('R7: every truck above 12 takes a push-dozer operator; R8 drops when push hits 0', () => {
    const sc = TC.rule_set.test_scenarios[0];
    const more = { ...sc, overrides: { circuit_trucks: { EX09: 6 } } };
    const r = evalScenario(more);
    expect(r.totalTrucks).toBe(13);
    expect(r.ruleCounts.R7_BULK_PUSH).toBe(5);
    expect(r.total).toBe(36); // the substitution keeps the crew constant
    const r0 = evaluateCrew({ circuits: [], rules: defaultCrewRules().map(x => (x.id === 'R7_BULK_PUSH' ? { ...x, expr: '0' } as CrewRuleExt : x)), trucksAvailable: 12, available: 30 });
    expect(r0.ruleCounts.R8_PUSH_ASSIST ?? 0).toBe(0);
  });

  it('a plain-count rendering of R7 (fixed 6, no expr / whenExpr) gives the same linked-plan total', () => {
    const plain = defaultCrewRules().map(r => { const { expr, whenExpr, params, ...rest } = r as CrewRuleExt; void expr; void whenExpr; void params; return rest as CrewRule; });
    const r = evalScenario(TC.rule_set.test_scenarios[0], plain);
    expect(r.total).toBe(36);
  });
});

describe('generic scopes', () => {
  const C = (id: string, unit: string, type: CrewCircuit['loaderType'], mat: string, trucks: number, dumpId?: string): CrewCircuit =>
    ({ circuitId: id, loaderUnitId: unit, loaderType: type, materialId: mat, trucks, dumpId });
  const circuits = [C('a', 'EX09', 'excavator', 'OB', 5, 'D1'), C('b', 'EX09', 'excavator', 'OB', 2, 'D2'), C('c', 'LDR1', 'loader', 'CL', 3, 'ROM'), C('d', 'EX04', 'excavator', 'IB', 0, 'D1')];
  const rule = (p: Partial<CrewRule>): CrewRule => ({ id: 'X', name: 'X', enabled: true, scope: 'site', role: 'other', count: 1, ...p });
  const run = (p: Partial<CrewRule>) => evaluateCrew({ circuits, rules: [rule(p)], trucksAvailable: 12, available: 40 }).ruleCounts.X ?? 0;
  it('per-circuit / per-active-loader / per-material / per-dump / per-truck', () => {
    expect(run({ scope: 'per-circuit' })).toBe(4);
    expect(run({ scope: 'per-circuit', when: { minTrucks: 1 } })).toBe(3);
    expect(run({ scope: 'per-active-loader' })).toBe(2);
    expect(run({ scope: 'per-material' })).toBe(2);
    expect(run({ scope: 'per-dump' })).toBe(3);
    expect(run({ scope: 'per-truck', perUnits: 4 })).toBe(2 + 1 + 1);
    expect(run({ scope: 'per-truck', when: { materialIds: ['CL'] } })).toBe(3);
    expect(run({ scope: 'site', when: { loaderTypes: ['loader'] } })).toBe(1);
    expect(run({ scope: 'site', when: { minTrucks: 11 } })).toBe(0);
    expect(run({ scope: 'per-circuit', when: { tags: ['coal'] } })).toBe(0);
    expect(run({ scope: 'site', enabled: false })).toBe(0);
  });
  it('byRole caps and truck limits raise checks', () => {
    const r = evaluateCrew({ circuits, rules: defaultCrewRules(), trucksAvailable: 8, available: 40, shift: { id: 's', name: 'A', available: 40, byRole: { truck: 6 } } });
    expect(r.warnings.some(w => /trucks assigned > 8/.test(w))).toBe(true);
    expect(r.warnings.some(w => /truck: 10 required > 6/.test(w))).toBe(true);
  });
});

describe('expression language', () => {
  const env = { lookup: (n: string) => ({ 'a.b': 3, x: 2 } as Record<string, number>)[n] };
  it('evaluates arithmetic, functions, comparisons and logic', () => {
    expect(evalExpr('7 - 1 - max(0, 13 - 12)', env).value).toBe(5);
    expect(evalExpr('a.b * (x + 1) / 3', env).value).toBe(3);
    expect(evalExpr('if(a.b > 2 && !(x == 3), 10, 20)', env).value).toBe(10);
    expect(evalExpr('min(4, ceil(2.1), floor(9.9))', env).value).toBe(3);
    expect(evalExpr('-x + abs(-5)', env).value).toBe(3);
    const r = evalExpr('nope + 1', env);
    expect(r.value).toBe(1);
    expect(r.unknown).toEqual(['nope']);
    expect(() => evalExpr('1 +', env)).toThrow();
    expect(() => evalExpr('process.exit()', env)).toThrow();
  });
});
