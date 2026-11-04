/**
 * CalcStep builders and number formatting for transparent calculation traces.
 */
import type { CalcGroup, CalcStep } from '@/core/types';

/** Format a number for substituted formulas (trims trailing zeros; keeps sign). */
export function fmt(x: number, dp = 2): string {
  if (x === Infinity) return '∞';
  if (x === -Infinity) return '−∞';
  if (!Number.isFinite(x)) return String(x);
  const s = x.toFixed(dp);
  const t = dp > 0 ? s.replace(/\.?0+$/, '') : s;
  return t === '-0' ? '0' : t;
}

/** Thousands-separated integer-ish formatting for narrative text (e.g. 36,000). */
export function fmtInt(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return Math.round(x).toLocaleString('en-AU');
}

export type StepInput = NonNullable<CalcStep['inputs']>[number];

/** Collects CalcSteps with a fixed group prefix. */
export class StepLog {
  readonly steps: CalcStep[] = [];
  add(group: CalcGroup, id: string, label: string, formula: string, value: number, unit: string,
    extra: { substituted?: string; inputs?: StepInput[]; sheetRef?: string; note?: string } = {}): CalcStep {
    const s: CalcStep = { id, group, label, formula, value, unit, ...extra };
    if (!s.substituted) delete s.substituted;
    if (!s.inputs) delete s.inputs;
    if (!s.sheetRef) delete s.sheetRef;
    if (!s.note) delete s.note;
    this.steps.push(s);
    return s;
  }
}
