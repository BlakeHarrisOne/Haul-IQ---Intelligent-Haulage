/**
 * Steady-state (balance) speed on a grade from rimpull and retarder curves (spec 04 §B.1–B.5).
 *
 *   F_res = m·g·(sin θ + cos θ · RR/100)                      kN (m in t, g = 9.81) — signed, + opposes motion
 *   uphill / level (F_res ≥ 0):  v* = sup { v : F_rim(v) ≥ F_res }          (rimpull envelope, power-space interp.)
 *   downhill (F_res < 0), F_req = −F_res:
 *       'continuous'    v* = sup { v : F_ret(v) ≥ F_req }   (Komatsu ARSC / electric: hold any speed ≤ P_ret/F)
 *       'discrete_gear' v* = max { v_max,g : F_ret,g(v_max,g) ≥ F_req }   (Cat ARC: highest gear the brakes sustain)
 *   v = min(v*, segment / global speed limit, truck top speed) → LimitReason.
 *
 * sin θ is the segment grade itself (grade = ΔZ / slope distance), so no small-angle approximation is made.
 */
import type { LimitReason } from '@/core/types';
import { curveForce, gearForce, maxSpeedForForce } from '../util/curve';
import { gearMaxKmh, rimpullGearAt, retarderGearAt, type TruckPhysics } from './truck';

/** Gravity, m/s². With mass in t, m·g is in kN. */
export const G = 9.81;
/** Speed used when a truck cannot hold the grade at all (stall / retarder exceeded), km/h. */
export const CRAWL_KMH = 2;

/**
 * Total resistance (grade + rolling) on a slope, kN. Positive opposes motion.
 * @param massT gross mass, t
 * @param sinTheta grade as ΔZ / slope distance (+ uphill in the direction of travel)
 * @param rrPct rolling resistance, %
 */
export function resistanceKN(massT: number, sinTheta: number, rrPct: number): number {
  const s = Math.max(-1, Math.min(1, sinTheta));
  const c = Math.sqrt(1 - s * s);
  return massT * G * (s + (c * rrPct) / 100);
}

export interface SteadySolve {
  /** Speed after limits, km/h. */
  kmh: number;
  limit: LimitReason;
  /** 'rimpull_g3', 'governor_g1', 'retarder_g3', 'retarder', 'speed-limit', 'top-speed', 'stall', 'retarder-exceeded'. */
  binding: string;
  gear?: number;
  mode: 'propel' | 'retard';
  /** Resistance at this speed, kN (negative = net downhill). */
  resistanceKN: number;
  /** Force available at kmh: rimpull (propel) or retarder (retard), kN. */
  forceAvailKN: number;
  /** Force-limited balance speed before the speed caps (∞ when the curve never binds), km/h. */
  forceLimitedKmh: number;
  /** Speed cap applied (min of limit and top speed), km/h, and its reason. */
  capKmh: number;
  capReason: LimitReason;
  warning?: string;
}

/**
 * Balance speed of a truck on a segment.
 * @param tp prepared truck physics
 * @param massT gross mass, t
 * @param sinTheta grade (ΔZ / slope distance) in the direction of travel
 * @param rrPct rolling resistance, %
 * @param limitKmh speed limit for this segment (global ∧ segment override), km/h
 */
export function steadySpeed(tp: TruckPhysics, massT: number, sinTheta: number, rrPct: number, limitKmh: number): SteadySolve {
  const fRes = resistanceKN(massT, sinTheta, rrPct);
  const top = tp.topKmh;
  const capKmh = Math.min(top, limitKmh > 0 ? limitKmh : Infinity);
  const capReason: LimitReason = limitKmh > 0 && limitKmh < top ? 'speed-limit' : 'top-speed';
  if (fRes >= 0) {
    if (!tp.rimpull.length) {
      return { kmh: capKmh, limit: capReason, binding: capReason, mode: 'propel', resistanceKN: fRes, forceAvailKN: NaN, forceLimitedKmh: Infinity, capKmh, capReason, warning: 'no rimpull curve' };
    }
    const r = propelLimit(tp, fRes);
    if (!r.ok) {
      return {
        kmh: CRAWL_KMH, limit: 'rimpull', binding: 'stall', mode: 'propel', resistanceKN: fRes, forceAvailKN: curveForce(tp.rimpull, 0),
        forceLimitedKmh: 0, capKmh, capReason, warning: `insufficient rimpull: needs ${fRes.toFixed(0)} kN, max ${curveForce(tp.rimpull, 0).toFixed(0)} kN`,
      };
    }
    if (r.kmh >= capKmh) {
      const g = rimpullGearAt(tp, capKmh);
      return { kmh: capKmh, limit: capReason, binding: capReason, gear: g, mode: 'propel', resistanceKN: fRes, forceAvailKN: curveForce(tp.rimpull, capKmh), forceLimitedKmh: r.kmh, capKmh, capReason };
    }
    const g = r.gear ?? rimpullGearAt(tp, r.kmh);
    const gMax = g != null ? gearMaxKmh(tp, g) : undefined;
    const governed = gMax != null && Math.abs(r.kmh - gMax) <= 0.012 * gMax;
    return {
      kmh: r.kmh, limit: 'rimpull', binding: g == null ? 'rimpull' : `${governed ? 'governor' : 'rimpull'}_g${g}`, gear: g, mode: 'propel',
      resistanceKN: fRes, forceAvailKN: curveForce(tp.rimpull, r.kmh), forceLimitedKmh: r.kmh, capKmh, capReason,
    };
  }
  // net downhill: retarder must absorb F_req
  const fReq = -fRes;
  if (!tp.retarder.length && !tp.retarderGears.length) {
    return { kmh: capKmh, limit: capReason, binding: capReason, mode: 'retard', resistanceKN: fRes, forceAvailKN: NaN, forceLimitedKmh: Infinity, capKmh, capReason, warning: 'no retarder curve: descent speed not limited by braking' };
  }
  let v = Infinity, gear: number | undefined, avail = NaN, warning: string | undefined, binding = 'retarder', exceeded = false;
  if (tp.descentRule === 'discrete_gear' && tp.retarderGears.length) {
    for (const g of tp.retarderGears) {
      const last = g.points[g.points.length - 1];
      if (last && last[1] >= fReq - 1e-9) { v = last[0]; gear = g.gear; avail = last[1]; }
    }
    if (!Number.isFinite(v)) {
      const g1 = tp.retarderGears[0];
      const r = maxSpeedForForce(g1.points, fReq);
      if (r.ok) { v = Math.min(r.kmh, g1.maxKmh); gear = g1.gear; avail = gearForce(g1.points, v) || curveForce(g1.points, v); }
      else exceeded = true;
    }
    if (gear != null) binding = `retarder_g${gear}`;
  } else {
    const r = maxSpeedForForce(tp.retarder, fReq);
    if (r.ok) { v = r.kmh; avail = Number.isFinite(v) ? curveForce(tp.retarder, v) : NaN; gear = Number.isFinite(v) ? retarderGearAt(tp, v) : undefined; }
    else exceeded = true;
  }
  if (exceeded) {
    const vMin = Math.max(CRAWL_KMH, (tp.retarderGears[0]?.points[0]?.[0] ?? tp.retarder[0]?.[0]) || CRAWL_KMH);
    const cap = curveForce(tp.retarder.length ? tp.retarder : tp.retarderGears[0].points, vMin);
    warning = `retarder capacity exceeded: needs ${fReq.toFixed(0)} kN, max ${cap.toFixed(0)} kN (service brakes / lower gear required)`;
    return { kmh: Math.min(vMin, capKmh), limit: 'retarder', binding: 'retarder-exceeded', mode: 'retard', resistanceKN: fRes, forceAvailKN: cap, forceLimitedKmh: vMin, capKmh, capReason, warning };
  }
  if (v >= capKmh) {
    return { kmh: capKmh, limit: capReason, binding: capReason, gear, mode: 'retard', resistanceKN: fRes,
      forceAvailKN: curveForce(tp.retarder.length ? tp.retarder : tp.retarderGears[tp.retarderGears.length - 1].points, capKmh), forceLimitedKmh: v, capKmh, capReason };
  }
  return { kmh: v, limit: 'retarder', binding, gear, mode: 'retard', resistanceKN: fRes, forceAvailKN: avail, forceLimitedKmh: v, capKmh, capReason, warning };
}

/**
 * Highest speed with rimpull ≥ fRes. Gear-aware when per-gear curves exist (exact at each gear's governor drop:
 * v* = max over gears of sup{v in band_g : F_g(v) ≥ fRes}); otherwise solved on the envelope.
 */
function propelLimit(tp: TruckPhysics, fRes: number): { kmh: number; ok: boolean; gear?: number } {
  if (!tp.rimpullGears.length) return maxSpeedForForce(tp.rimpull, fRes);
  let best: { kmh: number; ok: boolean; gear?: number } = { kmh: 0, ok: false };
  for (const g of tp.rimpullGears) {
    const r = maxSpeedForForce(g.points, fRes);
    if (r.ok && (!best.ok || r.kmh > best.kmh)) best = { kmh: Math.min(r.kmh, g.points[g.points.length - 1][0]), ok: true, gear: g.gear };
  }
  return best;
}

/** Payload checks against the nominal payload (Cat 10/10/20: no load above 120 %). */
export function payloadFor(truckLoadBcm: number, bankDensity: number | undefined, nominalPayloadT: number):
  { payloadT: number; rawT: number; ratio: number; capped: boolean; note: string } {
  if (!(bankDensity && bankDensity > 0)) {
    return { payloadT: nominalPayloadT, rawT: nominalPayloadT, ratio: 1, capped: false, note: 'material density unknown: nominal payload used' };
  }
  const rawT = truckLoadBcm * bankDensity;
  const ratio = nominalPayloadT > 0 ? rawT / nominalPayloadT : 1;
  if (ratio > 1.2) return { payloadT: 1.2 * nominalPayloadT, rawT, ratio, capped: true, note: `payload ${rawT.toFixed(1)} t is ${(ratio * 100).toFixed(0)} % of nominal; capped at 120 % (Cat 10/10/20 policy)` };
  if (ratio > 1.1) return { payloadT: rawT, rawT, ratio, capped: false, note: `payload ${(ratio * 100).toFixed(0)} % of nominal (> 110 %: overload under 10/10/20)` };
  if (ratio > 1.0) return { payloadT: rawT, rawT, ratio, capped: false, note: `payload ${(ratio * 100).toFixed(0)} % of nominal (within the 110 % band)` };
  return { payloadT: rawT, rawT, ratio, capped: false, note: `payload ${(ratio * 100).toFixed(0)} % of nominal` };
}
