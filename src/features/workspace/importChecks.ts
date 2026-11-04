/** Pure plausibility checks for imported triangulations (kept free of workers and stores so they unit-test). */
import type { MeshStats } from '@/core/types';

/** A closed solid thinner than this on average (volume ÷ plan area) is almost certainly a defect, not a block. */
export const MIN_MEAN_THICKNESS_M = 0.5;

/**
 * Flags an implausible solid: a closed triangulation whose volume ÷ plan area is under 0.5 m reads as a sheet (or a
 * mis-wound mesh whose volumes cancel), so its bcm cannot be trusted. Returns the warning, or null when it looks solid.
 */
export function sheetLikeSolid(st: Pick<MeshStats, 'closed' | 'volume' | 'planArea'>): string | null {
  if (!st.closed || st.volume == null || !(st.planArea > 0)) return null;
  const mean = Math.abs(st.volume) / st.planArea;
  if (mean >= MIN_MEAN_THICKNESS_M) return null;
  return `Encloses ${Math.round(Math.abs(st.volume)).toLocaleString('en-AU')} bcm over ${(st.planArea / 10_000).toLocaleString('en-AU', { maximumFractionDigits: 1 })} ha – an average of ${mean < 0.1 ? mean.toFixed(2) : mean.toFixed(1)} m thick. It looks like a sheet, check the solid.`;
}
