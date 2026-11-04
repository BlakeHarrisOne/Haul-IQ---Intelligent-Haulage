/**
 * Spreadsheet-compatible speed lookup ('Travel Time' columns C / L):
 *   speed = VLOOKUP(ROUND(grade, 2), table, 2, FALSE) — exact match on the grade rounded half-away-from-zero;
 *   no match (|ROUND(grade,2)| > 0.16) → "" → the segment's time is dropped from SUM (counted as 0 s).
 */
import type { GradeSpeedPoint } from '@/core/types';
import { excelRound, gradeKey } from '../util/excel';

export interface TableLookup {
  /** km/h, or null when Excel would return "" (out of range, outOfRange = 'drop'). */
  kmh: number | null;
  /** ROUND(grade, 2). */
  rounded: number;
  /** True when ROUND(grade,2) is outside the table. */
  outOfRange: boolean;
}

interface Prepared { map: Map<number, number>; minKey: number; maxKey: number }
const cache = new WeakMap<GradeSpeedPoint[], Prepared>();

function prepare(tbl: GradeSpeedPoint[]): Prepared {
  const hit = cache.get(tbl);
  if (hit) return hit;
  const map = new Map<number, number>();
  let minKey = Infinity, maxKey = -Infinity;
  for (const [g, v] of tbl) {
    const k = gradeKey(excelRound(g, 2));
    if (!map.has(k)) map.set(k, v); // VLOOKUP returns the first exact match
    minKey = Math.min(minKey, k);
    maxKey = Math.max(maxKey, k);
  }
  const p = { map, minKey, maxKey };
  cache.set(tbl, p);
  return p;
}

/**
 * Look up the table speed for a grade.
 * @param tbl [grade fraction, km/h] rows
 * @param grade grade fraction in the direction of travel
 * @param clamp true = use the steepest row's speed when out of range (the "Fix" option); false = Excel ("")
 */
export function tableSpeed(tbl: GradeSpeedPoint[], grade: number, clamp = false): TableLookup {
  const rounded = excelRound(grade, 2);
  const p = prepare(tbl);
  const k = gradeKey(rounded);
  const v = p.map.get(k);
  if (v != null) return { kmh: v, rounded, outOfRange: false };
  if (!clamp || !p.map.size) return { kmh: null, rounded, outOfRange: true };
  const edge = k > p.maxKey ? p.maxKey : k < p.minKey ? p.minKey : undefined;
  const ev = edge != null ? p.map.get(edge) : undefined;
  return { kmh: ev ?? null, rounded, outOfRange: true };
}
