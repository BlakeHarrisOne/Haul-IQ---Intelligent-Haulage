/**
 * Truck–loader production models for one loader and N identical trucks (spec 04 §C.2–C.3).
 *   t_L = spot + load (service at the loader), c = queue-free cycle, t_A = c − t_L (time away from the loader).
 *   deterministic:  X = min(N / c, 1 / t_L)                                   (optimistic bound)
 *   M/M/1//N:       ρ = t_L / t_A,  P0 = [Σ_{k=0..N} N!/(N−k)! ρ^k]⁻¹,  U = 1 − P0,  X = U / t_L,
 *                   L = N − X·t_A,  Lq = L − U,  Wq = Lq / X                   (finite-source, pessimistic bound)
 *   binomial:       p = t_L / c,  U = 1 − (1 − p)^N,  X = U / t_L              (independent positions, lower bound)
 */
import type { QueueModel } from '../types';

export interface QueueEstimate {
  model: QueueModel;
  /** Loads per hour delivered to the loader. */
  loadsPerHr: number;
  /** Loader busy fraction (1 − hang fraction). */
  loaderBusy: number;
  /** Mean trucks waiting in the queue (M/M/1//N; deterministic steady state). */
  meanQueue: number;
  /** Mean queue wait per load, s. */
  waitS: number;
  /** Mean cycle including queueing, s. */
  cycleActualS: number;
}

/**
 * Production estimate.
 * @param model queue model
 * @param n trucks
 * @param tL loader service time (spot + load), s
 * @param c queue-free truck cycle, s
 */
export function queueEstimate(model: QueueModel, n: number, tL: number, c: number): QueueEstimate {
  if (n <= 0 || !(c > 0) || !(tL > 0)) return { model, loadsPerHr: 0, loaderBusy: 0, meanQueue: 0, waitS: 0, cycleActualS: c };
  const tA = Math.max(1e-9, c - tL);
  if (model === 'mm1n') {
    const rho = tL / tA;
    let term = 1, sum = 1;
    for (let k = 1; k <= n; k++) { term *= (n - k + 1) * rho; sum += term; }
    const p0 = 1 / sum;
    const U = 1 - p0;
    const X = U / tL;
    const L = n - X * tA;
    const Lq = Math.max(0, L - U);
    return { model, loadsPerHr: X * 3600, loaderBusy: U, meanQueue: Lq, waitS: X > 0 ? Lq / X : 0, cycleActualS: n / X };
  }
  if (model === 'binomial') {
    const p = Math.min(1, tL / c);
    const U = 1 - Math.pow(1 - p, n);
    const X = U / tL;
    const cA = n / X;
    return { model, loadsPerHr: X * 3600, loaderBusy: U, meanQueue: 0, waitS: Math.max(0, cA - c), cycleActualS: cA };
  }
  const X = Math.min(n / c, 1 / tL);
  const cA = n / X;
  const wait = Math.max(0, cA - c);
  return { model: 'deterministic', loadsPerHr: X * 3600, loaderBusy: X * tL, meanQueue: wait > 0 ? (wait * n) / cA : 0, waitS: wait, cycleActualS: cA };
}
