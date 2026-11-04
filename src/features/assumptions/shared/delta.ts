/** Delta helpers for side-by-side comparisons (what-if, spreadsheet vs rimpull, scenario vs scenario). */
import { num } from '@/core/format';

export type Better = 'up' | 'down' | 'none';
export type DeltaTone = 'ok' | 'bad' | 'na';

export interface Delta { abs: number; rel: number | null }

/** b relative to a (a = baseline). rel is null when the baseline is ~0. */
export function delta(a: number, b: number): Delta {
  const abs = b - a;
  const rel = Math.abs(a) > 1e-12 ? abs / Math.abs(a) : null;
  return { abs, rel };
}

/** Tone of a change: 'ok' when it moves in the better direction, 'bad' when it moves the other way. */
export function deltaTone(d: number, better: Better, eps = 1e-9): DeltaTone {
  if (better === 'none' || !Number.isFinite(d) || Math.abs(d) <= eps) return 'na';
  return (d > 0) === (better === 'up') ? 'ok' : 'bad';
}

/** "+1.2", "−0.4", "0.0" with a true minus sign; optional unit appended with a thin space. */
export function fmtDelta(d: number, dp = 1, unit?: string): string {
  if (!Number.isFinite(d)) return '–';
  const r = Math.abs(d) < 0.5 * 10 ** -dp ? 0 : d;
  const s = (r > 0 ? '+' : r < 0 ? '−' : '±') + num(Math.abs(r), dp);
  return unit ? `${s} ${unit}` : s;
}

export function fmtPctDelta(rel: number | null, dp = 1): string {
  if (rel == null || !Number.isFinite(rel)) return '';
  return fmtDelta(rel * 100, dp) + '%';
}

/** Sensible decimals for a calculation result: more for small magnitudes, none for thousands. */
export function smartDp(v: number): number {
  const a = Math.abs(v);
  if (!Number.isFinite(a) || a === 0) return 0;
  if (a >= 1000) return 0;
  if (a >= 100) return 1;
  if (a >= 10) return 2;
  if (a >= 1) return 2;
  return 3;
}
export const smart = (v: number) => (Number.isFinite(v) ? num(v, smartDp(v)) : '–');
