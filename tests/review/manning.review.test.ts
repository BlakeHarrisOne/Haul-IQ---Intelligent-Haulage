/**
 * Independent review: src/engine/manning/** (expression evaluator + crew rules).
 */
import { describe, expect, it } from 'vitest';
import { evalExpr } from '@/engine/manning/expr';
import { evaluateCrew, type CrewCircuit } from '@/engine/manning/evaluate';
import type { CrewRule } from '@/core/types';

const env = (vars: Record<string, number> = {}) => ({ lookup: (n: string) => vars[n] });

describe('review: evalExpr', () => {
  it('R-EXPR-1 scientific notation with a signed exponent is one number (1e-3), not 1 − 3', () => {
    expect(evalExpr('1e-3', env()).value).toBeCloseTo(0.001, 12);
    expect(evalExpr('2.5E+1', env()).value).toBe(25);
  });

  it('R-EXPR-2 a malformed number ("1.2.3", ".") is rejected rather than silently read as 1.2 / NaN', () => {
    expect(() => evalExpr('1.2.3', env())).toThrow();
    expect(() => evalExpr('.', env())).toThrow();
  });
});

describe('review: evaluateCrew', () => {
  it('R-EXPR-3 a rule expression that divides by zero must not turn the crew total into NaN', () => {
    const rules: CrewRule[] = [
      { id: 'T', name: 'Truck ops', enabled: true, scope: 'per-truck', role: 'truck', count: 1 },
      // e.g. one utility person per 4 trucks per active loader
      { id: 'U', name: 'Utility', enabled: true, scope: 'site', role: 'utility', count: 0, expr: 'ceil(totals.trucks / totals.activeLoaders / 4)' } as CrewRule,
    ];
    // every loader parked this shift (0 trucks) → totals.activeLoaders = 0, totals.trucks = 0 → 0/0
    const circuits: CrewCircuit[] = [{ circuitId: 'c1', loaderUnitId: 'EX09', loaderType: 'excavator', materialId: 'OB', trucks: 0 }];
    const r = evaluateCrew({ circuits, rules, trucksAvailable: 12, available: 30 });
    expect(Number.isFinite(r.total)).toBe(true);
    expect(Number.isFinite(r.surplus)).toBe(true);
  });
});
