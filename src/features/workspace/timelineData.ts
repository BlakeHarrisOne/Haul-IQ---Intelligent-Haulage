/** Pure helpers for the shift time bar: production per bucket, compact numbers, chip fitting and label choice. */
import type { CircuitResult, Id, Scenario } from '@/core/types';
import { simProductionAt, simulateShift } from '@/engine';
import { num } from '@/core/format';

/** Production bars in the track are 15-minute buckets (spec 03 §11.4, RM time-bar grammar). */
export const BUCKET_MIN = 15;

const cache = new WeakMap<Scenario, { results: Record<Id, CircuitResult>; bucket: number; lengthMin: number; bars: number[] }>();

/** bcm dug in each `bucket`-minute slice of the shift, summed over the active circuits (simulated shift). */
export function productionBuckets(scenario: Scenario, results: Record<Id, CircuitResult>, lengthMin: number, bucket = BUCKET_MIN): number[] {
  const hit = cache.get(scenario);
  if (hit && hit.results === results && hit.bucket === bucket && hit.lengthMin === lengthMin) return hit.bars;
  const n = Math.max(1, Math.ceil(lengthMin / bucket));
  const bars = new Array<number>(n).fill(0);
  for (const c of scenario.circuits) {
    if (!c.active) continue;
    try {
      const sim = simulateShift(scenario, results, c.id);
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const v = simProductionAt(sim, Math.min(lengthMin, (i + 1) * bucket)).bcm;
        bars[i] += Math.max(0, v - prev);
        prev = v;
      }
    } catch { /* a circuit the engine cannot simulate adds nothing */ }
  }
  cache.set(scenario, { results, bucket, lengthMin, bars });
  return bars;
}

/** bcm dug by all active circuits by tMin. */
export function bcmAt(scenario: Scenario, results: Record<Id, CircuitResult>, tMin: number): number {
  let sum = 0;
  for (const c of scenario.circuits) {
    if (!c.active) continue;
    try { sum += simProductionAt(simulateShift(scenario, results, c.id), tMin).bcm; } catch { /* skip */ }
  }
  return sum;
}

/** Compact bcm for chips: 650 · 7.1k · 15.7k · 124k. */
export function kbcm(v: number): string {
  const a = Math.abs(v);
  if (a < 999.5) return num(v);
  if (a < 99_950) return `${num(v / 1000, 1)}k`;
  return `${num(v / 1000)}k`;
}

/**
 * Circuit chips step down until they fit: full ("EX09 7.1k / 15.7k bcm") → compact ("EX09 7.1k") → name only ("EX09",
 * progress underline kept) → colour dots (+N behind a menu). The numbers stay in every chip's tooltip.
 */
export type ChipMode = 'full' | 'compact' | 'ids' | 'dots';
export const CHIP_MODES: ChipMode[] = ['full', 'compact', 'ids', 'dots'];
export const DOT_W = 26, DOT_GAP = 4, MORE_W = 40;

/** In dots mode: how many dots fit in `width` px, and how many go behind a "+N" button. */
export function dotsFit(n: number, width: number): { visible: number; hidden: number } {
  if (n * (DOT_W + DOT_GAP) - DOT_GAP <= width) return { visible: n, hidden: 0 };
  const visible = Math.max(0, Math.floor((width - MORE_W) / (DOT_W + DOT_GAP)));
  return { visible, hidden: n - visible };
}

/**
 * The text for an event block `px` wide: the full label when it fits, else the kind's short label, else nothing
 * (icon only, or not even that below 20 px). Every block keeps the full label in its tooltip.
 */
export function eventLabelFor(px: number, label: string, short: string, charPx = 6.1, iconPx = 24): string {
  const fits = (s: string) => iconPx + s.length * charPx + 8 <= px;
  if (fits(label)) return label;
  if (short && short !== label && fits(short)) return short;
  return '';
}
