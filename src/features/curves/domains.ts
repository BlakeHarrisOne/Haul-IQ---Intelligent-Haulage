/** Chart domains for the truck-curve charts (pure). */
import { niceDomain } from '@/ui/chart';
import type { TruckModel } from '@/core/types';

/** Speed axis: 0 … highest top speed (+ a little air), nice-rounded. */
export function speedDomain(trucks: Pick<TruckModel, 'topSpeedKmh' | 'rimpull'>[]): [number, number] {
  const top = Math.max(10, ...trucks.map(t => Math.max(t.topSpeedKmh || 0, ...t.rimpull.filter(p => p[1] > 0).map(p => p[0]))));
  return niceDomain(0, top * 1.04, 6);
}

/** Force axis: 0 … max of every curve and extra reference forces (resistance lines), nice-rounded. */
export function forceDomain(trucks: Pick<TruckModel, 'rimpull' | 'retarder'>[], extra: number[] = []): [number, number] {
  const max = Math.max(100, ...trucks.flatMap(t => [...t.rimpull.map(p => p[1]), ...t.retarder.map(p => p[1])]), ...extra.filter(Number.isFinite));
  return niceDomain(0, max * 1.04, 6);
}

/** Speed-vs-grade y axis: 0 … max speed across series, rounded up to 10 km/h. */
export function speedAxisMax(values: number[]): number {
  const m = Math.max(10, ...values.filter(Number.isFinite));
  return Math.ceil(m / 10) * 10;
}

/** Clamp a pointer-x to the data domain. */
export const clampTo = (v: number, [a, b]: [number, number]) => Math.min(b, Math.max(a, v));
