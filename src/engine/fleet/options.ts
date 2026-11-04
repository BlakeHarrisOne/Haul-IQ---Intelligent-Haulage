/**
 * Fleet options per number of trucks — the workbook's row-28 "# TRUCKS" macro buttons, generalised.
 *
 * Macro_n: GoalSeek C24 := n by changing C20, then cap at C19  ⇒  C20 = MIN(n × C22 × C16, C19)   (spec 01 §6.4)
 *   C17 = C20 / C16 (truck hours) · C24 = C17 / C22 (trucks needed) · C26 = C20 / rate (loader PT)
 *   C28 = C22/s − C26/s (loader PT lost per shift, s = shifts/day; the workbook hard-codes s = 2)
 * Queue models replace n × C22 × C16 by X(n) × payload × PT (finite-source / binomial bunching losses).
 */
import type { TruckingStatus } from '@/core/types';
import type { FleetOptionExt, QueueModel } from '../types';
import { queueEstimate } from './queue';

export interface FleetCtx {
  /** C16 truck productivity, bcm per truck PT hour. */
  prod: number;
  /** C22 truck PT h/day. */
  truckPt: number;
  /** Loader planned rate, bcm/PT h. */
  rate: number;
  /** C19 ideal daily volume, bcm/day. */
  idealBcm: number;
  /** Loader PT target h/day (C22 in the workbook). */
  loaderPtTarget: number;
  shifts: number;
  /** Queue-free cycle, s (C14). */
  cycleS: number;
  /** Loader service time spot + load, s. */
  serviceS: number;
  /** C21 truck load, bcm. */
  loadBcm: number;
  queueModel: QueueModel;
}

/** Relative shortfall below the ideal volume still counted as "balanced" (2 %). */
export const BALANCE_TOL = 0.02;

/** Truck capacity (before the C19 cap) at n trucks, bcm/day. */
export function truckCapacity(n: number, x: FleetCtx): number {
  if (n <= 0) return 0;
  if (x.queueModel === 'deterministic') return n * x.truckPt * x.prod;
  const q = queueEstimate(x.queueModel, n, x.serviceS, x.cycleS);
  return q.loadsPerHr * x.loadBcm * x.truckPt;
}

/**
 * One fleet option.
 * @param n number of trucks
 * @param x context from the circuit result
 */
export function fleetOption(n: number, x: FleetCtx): FleetOptionExt {
  const goal = truckCapacity(n, x);
  const capped = goal > x.idealBcm;
  const bcm = capped ? x.idealBcm : goal;
  const truckHrs = x.prod > 0 ? bcm / x.prod : 0;
  const trucksNeeded = x.truckPt > 0 ? truckHrs / x.truckPt : 0;
  const loaderPt = x.rate > 0 ? bcm / x.rate : 0;
  const s = x.shifts > 0 ? x.shifts : 2;
  const lost = Math.max(0, x.loaderPtTarget / s - loaderPt / s);
  const queueHrs = Math.max(0, (n * x.truckPt - truckHrs) / s);
  const mf = x.cycleS > 0 ? (n * x.serviceS) / x.cycleS : 0;
  const q = queueEstimate(x.queueModel, n, x.serviceS, x.cycleS);
  const tolBcm = x.idealBcm * (1 - BALANCE_TOL);
  let status: TruckingStatus;
  if (goal < tolBcm) status = 'under';
  else if (n > 1 && truckCapacity(n - 1, x) >= tolBcm) status = 'over';
  else status = 'balanced';
  return {
    trucks: n, truckCapacityBcmDay: goal, bcmPerDay: bcm, loaderPtHrsDay: loaderPt, lostLoaderPtHrsShift: lost,
    truckQueueHrsShift: queueHrs, matchFactor: mf, loaderUtil: x.loaderPtTarget > 0 ? loaderPt / x.loaderPtTarget : 0, status,
    goalSeekBcmDay: goal, capped, truckHoursReq: truckHrs, trucksNeeded, idealBcmDay: x.idealBcm, queueModel: x.queueModel,
    loaderBusy: x.queueModel === 'deterministic' ? Math.min(1, mf) : q.loaderBusy, queueWaitMinPerLoad: q.waitS / 60,
  };
}

/** Options for 1..maxN trucks. */
export function fleetOptions(maxN: number, x: FleetCtx): FleetOptionExt[] {
  const out: FleetOptionExt[] = [];
  for (let n = 1; n <= maxN; n++) out.push(fleetOption(n, x));
  return out;
}
