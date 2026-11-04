import { describe, expect, it } from 'vitest';
import type { CrewRule } from '@/core/types';
import { cleanCondition, describeRule, workbookRules } from './rules';
import { plural } from './roles';
import { syntheticScenario } from '@/features/insights/synthetic';
import { computeAllCircuits, computeManning } from '@/engine';

const ctx = { materials: [{ id: 'OB', name: 'Overburden' }, { id: 'CL', name: 'Coal' }] };
const rule = (r: Partial<CrewRule>): CrewRule => ({ id: 'x', name: 'x', enabled: true, scope: 'per-circuit', role: 'other', count: 1, ...r });

describe('rule sentences', () => {
  it('renders the workbook rules as readable sentences', () => {
    const t = Object.fromEntries(workbookRules().map(r => [r.id, describeRule(r, ctx).text]));
    expect(t.R1_TRUCK_OPERATORS).toBe('For every truck on an active circuit → +1 truck operator');
    expect(t.R2_EX_OPERATOR).toBe('For every active excavator or shovel circuit with ≥ 1 truck → +1 excavator operator');
    expect(t.R3_EX_DOZERS).toBe('For every active excavator or shovel circuit with ≥ 1 truck → +2 dozer operators (floor & dump)');
    expect(t.R5_COAL_DOZER).toBe('For every active loader circuit with ≥ 1 truck → +1 coal dozer operator');
    expect(t.R6_SUPPORT_EX).toBe('For every active circuit on LDR1 with ≥ 1 truck → +1 excavator operator');
    expect(t.R10_WATER_CARTS).toBe('Site-wide, every shift → +2 water cart operators');
    expect(t.R10_OCE).toBe('Site-wide, every shift → +1 open cut examiner (OCE)');
    expect(t.R7_BULK_PUSH).toBe('Site-wide, every shift → +(7 − 1 − max(0, trucks operating − 12)) push dozer operators');
    expect(t.R8_PUSH_ASSIST).toBe('Site-wide, when push dozers > 0 → +1 excavator operator');
  });

  it('the engine evaluates the workbook rules to 36 (linked plan) and swaps push dozers for trucks above 12', () => {
    const s = syntheticScenario();
    const r = computeAllCircuits(s);
    const m = computeManning(s, r);
    expect(m.total).toBe(36);
    expect(m.required.pushDozer).toBe(7); // 6 bulk push + 1 enabling
    // 13 trucks: one push-dozer operator re-deployed to drive (Targets!E47)
    const s13 = { ...s, circuits: s.circuits.map(c => (c.id === 'c_ex09' ? { ...c, trucks: 6 } : c)) };
    const m13 = computeManning(s13, computeAllCircuits(s13));
    expect(m13.required.truck).toBe(13);
    expect(m13.required.pushDozer).toBe(6);
    expect(m13.total).toBe(36);
  });

  it('renders materials, unit lists, tags and per-N truck rules', () => {
    expect(describeRule(rule({ when: { materialIds: ['CL'], loaderTypes: ['loader'], minTrucks: 2 }, role: 'coalDozer' }), ctx).text)
      .toBe('For every active coal loader circuit with ≥ 2 trucks → +1 coal dozer operator');
    expect(describeRule(rule({ when: { loaderUnitIds: ['EX09', 'EX04', 'EX06'] }, role: 'dumpDozer', count: 2 }), ctx).condition)
      .toBe('For every active circuit on EX09, EX04 or EX06');
    expect(describeRule(rule({ scope: 'per-truck', perUnits: 8, role: 'supervisor', when: { tags: ['prestrip'] } }), ctx).text)
      .toBe('For every 8 trucks (rounded up) on an active circuit tagged “prestrip” → +1 supervisor');
    expect(describeRule(rule({ scope: 'per-dump', role: 'dumpDozer', when: { materialIds: ['OB'] } }), ctx).condition)
      .toBe('For every active dump fed by an overburden circuit');
    expect(describeRule(rule({ scope: 'per-dump', role: 'dumpDozer', when: { materialIds: ['CL'] } }), ctx).condition)
      .toBe('For every active dump fed by a coal circuit');
    expect(describeRule(rule({ scope: 'site', role: 'grader', count: 2, when: { materialIds: ['CL'] } }), ctx).text)
      .toBe('Site-wide, while any coal circuit runs → +2 grader operators');
    expect(describeRule(rule({ scope: 'per-active-loader', role: 'dumpDozer', when: { loaderTypes: ['excavator'] } }), ctx).condition)
      .toBe('For every manned excavator unit');
    expect(describeRule(rule({ role: 'truck', count: -1 })).effect).toBe('−1 truck operator');
  });

  it('pluralises nouns with bracketed tails', () => {
    expect(plural(2, 'open cut examiner (OCE)')).toBe('open cut examiners (OCE)');
    expect(plural(1, 'supervisor')).toBe('supervisor');
    expect(plural(0, 'supervisor')).toBe('supervisors');
  });

  it('workbook rule set totals 36 for the linked plan (EX09 5, EX04 4, LDR1 3 trucks)', () => {
    // Evaluate the rules by hand for the plan (independent of the engine): per-circuit rules fire on trucked circuits.
    const plan = [{ unit: 'EX09', type: 'excavator', trucks: 5 }, { unit: 'EX04', type: 'excavator', trucks: 4 }, { unit: 'LDR1', type: 'loader', trucks: 3 }];
    let total = 0;
    for (const r of workbookRules().filter(x => x.enabled)) {
      if (r.scope === 'site') total += r.count;
      else if (r.scope === 'per-truck') total += plan.reduce((a, c) => a + Math.ceil(c.trucks / (r.perUnits ?? 1)) * r.count, 0);
      else total += plan.filter(c => (!r.when?.loaderTypes || r.when.loaderTypes.includes(c.type as 'excavator'))
        && (!r.when?.loaderUnitIds || r.when.loaderUnitIds.includes(c.unit)) && c.trucks >= (r.when?.minTrucks ?? 0)).length * r.count;
    }
    expect(total).toBe(36);
  });

  it('cleanCondition drops empty fields', () => {
    expect(cleanCondition({ materialIds: [], loaderTypes: ['loader'], tags: [] })).toEqual({ loaderTypes: ['loader'] });
    expect(cleanCondition({ materialIds: [] })).toBeUndefined();
  });
});
