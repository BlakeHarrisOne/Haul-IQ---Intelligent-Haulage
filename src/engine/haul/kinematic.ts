/**
 * Kinematic travel along one leg: forward–backward pass on distance (spec 04 §B.6).
 *
 *   1. Resample each segment into steps of ≤ ds (10 m). Step caps = retarder balance speed (downhill), speed limit,
 *      top speed. Node caps = min of the adjoining steps; 0 at the leg ends (loader / dump) and at stop signs.
 *   2. Backward pass (planning deceleration d):  v_b[j] = min(cap_j, √(v_b[j+1]² + 2·d·h))
 *   3. Forward pass (full throttle, RK2 on v²):  a(v) = min(a_max, (min(F_rim(v), μ·m·g·cosθ·w_drive) − F_res) / (m·(1+k_rot)))
 *      v[j+1] = min(√(v[j]² + 2·ā·h), step cap, v_b[j+1]); on climbs the speed converges to the rimpull balance speed.
 *   4. dt = 2h / (v[j] + v[j+1]) (exact for constant acceleration); stop signs add a dwell.
 * Every step is tagged with what limited it (accel, decel, rimpull, retarder, speed-limit, top-speed) for the
 * time-share transparency record.
 */
import type { TravelInterval } from '../types';
import { curveForce } from '../util/curve';
import { CRAWL_KMH, G, resistanceKN, type SteadySolve } from './physics';
import type { TruckPhysics } from './truck';

export interface LegSeg {
  /** Route segment index (for the profile). */
  segIndex: number;
  /** Slope length, m. */
  len: number;
  /** Grade in the direction of travel (sin θ). */
  sin: number;
  rrPct: number;
  steady: SteadySolve;
  /** A stop sign at the node where this segment ends (interior nodes only). */
  stopAtEnd: boolean;
}

export interface KinOpts {
  massT: number;
  /** Max operator acceleration, m/s². */
  accelMax: number;
  /** Planning deceleration, m/s². */
  decel: number;
  /** Rotating-mass factor (effective mass = m·(1 + kRot)). */
  kRot: number;
  /** Traction coefficient μ. */
  mu: number;
  /** Drive-axle weight share. */
  driveShare: number;
  /** Dwell at a stop sign, s. */
  dwellS: number;
  /** Max step length, m. */
  dsMax: number;
}

export interface LegSegStats {
  timeS: number;
  vEntryKmh: number;
  vExitKmh: number;
  vMaxKmh: number;
  shares: Record<string, number>;
}

export interface LegResult {
  intervals: TravelInterval[];
  timeS: number;
  perSeg: LegSegStats[];
  /** Time share by binding constraint over the leg, 0..1. */
  shares: Record<string, number>;
  warnings: string[];
}

/** Binding tags (fixed slots keep the hot loop allocation-free). */
const TAGS = ['accel', 'decel', 'rimpull', 'retarder', 'speed-limit', 'top-speed', 'coast', 'stop'] as const;
const TAG: Record<string, number> = Object.fromEntries(TAGS.map((t, i) => [t, i]));
const NT = TAGS.length;

/**
 * Integrate one leg (start and end at rest).
 * @param tp truck physics
 * @param segs segments in travel order
 * @param o options (mass t, accelerations m/s², …)
 */
export function kinematicLeg(tp: TruckPhysics, segs: LegSeg[], o: KinOpts): LegResult {
  const crawl = CRAWL_KMH / 3.6;
  const nSeg = segs.length;
  // per-segment constants
  const sCap = new Float64Array(nSeg), sBal = new Float64Array(nSeg), sCos = new Float64Array(nSeg), sRes = new Float64Array(nSeg), sH = new Float64Array(nSeg);
  const sN = new Int32Array(nSeg), sTag = new Int32Array(nSeg), sProp = new Uint8Array(nSeg);
  let N = 0;
  for (let k = 0; k < nSeg; k++) {
    const sg = segs[k];
    const n = Math.max(1, Math.ceil(sg.len / o.dsMax - 1e-9));
    sN[k] = n;
    sH[k] = sg.len / n;
    N += n;
    const st = sg.steady;
    const propel = st.mode === 'propel';
    const stall = st.binding === 'stall';
    sProp[k] = propel ? 1 : 0;
    if (stall) { sCap[k] = crawl; sTag[k] = TAG.rimpull; }
    else if (propel) { sCap[k] = st.capKmh / 3.6; sTag[k] = TAG[st.capReason] ?? TAG['speed-limit']; }
    else { sCap[k] = st.kmh / 3.6; sTag[k] = TAG[st.limit] ?? TAG.retarder; }
    sBal[k] = stall ? crawl : propel ? (Number.isFinite(st.forceLimitedKmh) ? st.forceLimitedKmh / 3.6 : Infinity) : Infinity;
    sCos[k] = Math.sqrt(Math.max(0, 1 - sg.sin * sg.sin));
    sRes[k] = resistanceKN(o.massT, sg.sin, sg.rrPct);
  }
  // step → segment map and node caps (0 at both ends and at stop signs)
  const stepSeg = new Int32Array(N);
  const nodeCap = new Float64Array(N + 1);
  const nodeStop = new Uint8Array(N + 1);
  let j = 0;
  for (let k = 0; k < nSeg; k++) {
    for (let q = 0; q < sN[k]; q++) {
      stepSeg[j] = k;
      if (q === sN[k] - 1 && segs[k].stopAtEnd && k < nSeg - 1) nodeStop[j + 1] = 1;
      j++;
    }
  }
  for (let i = 1; i < N; i++) nodeCap[i] = nodeStop[i] ? 0 : Math.min(sCap[stepSeg[i - 1]], sCap[stepSeg[i]]);
  // backward pass
  const vb = new Float64Array(N + 1);
  for (let i = N - 1; i >= 0; i--) {
    const h = sH[stepSeg[i]];
    vb[i] = Math.min(nodeCap[i], Math.sqrt(vb[i + 1] * vb[i + 1] + 2 * o.decel * h));
  }
  // forward pass
  const mEff = o.massT * (1 + o.kRot);
  const tracBase = o.mu * o.massT * G * o.driveShare;
  const rim = tp.rimpull;
  const accel = (k: number, v: number) => {
    const fRim = curveForce(rim, v * 3.6);
    const fTrac = tracBase * sCos[k];
    const a = ((fRim < fTrac ? fRim : fTrac) - sRes[k]) / mEff;
    return a < o.accelMax ? a : o.accelMax;
  };
  const v = new Float64Array(N + 1);
  const intervals: TravelInterval[] = [];
  const segTime = new Float64Array(nSeg);
  const segShare = new Float64Array(nSeg * NT);
  const legShare = new Float64Array(NT);
  const warnings: string[] = [];
  let t = 0, s = 0, stallWarned = false;
  for (let i = 0; i < N; i++) {
    const k = stepSeg[i];
    const h = sH[k];
    const v0 = v[i];
    const w0 = v0 * v0;
    const bal = sProp[k] && sBal[k] !== Infinity ? sBal[k] : Infinity;
    const k1 = 2 * accel(k, v0);
    const wp = w0 + k1 * h;
    const k2 = 2 * accel(k, Math.sqrt(wp > 0 ? wp : 0));
    let w1: number;
    if (k1 * k2 < 0 || v0 >= bal - 1e-9) {
      // the step crosses a force balance or a force discontinuity (gear change, governor droop, v = 0 for an electric
      // drive): the RK2 average of the two slopes is meaningless there and held trucks above the balance speed on long
      // climbs. Sub-step with explicit Euler, never crossing the balance speed in either direction.
      const n = 16, hq = h / n, b2 = bal * bal;
      w1 = w0;
      for (let q = 0; q < n; q++) {
        const before = w1;
        w1 += 2 * accel(k, Math.sqrt(w1 > 0 ? w1 : 0)) * hq;
        if (before <= b2 && w1 > b2) w1 = b2;
        else if (before >= b2 && w1 < b2) w1 = b2;
        if (w1 < 0) w1 = 0;
      }
    } else {
      w1 = w0 + 0.5 * (k1 + k2) * h;
    }
    let v1 = Math.sqrt(w1 > 0 ? w1 : 0);
    let tag = v1 > v0 + 1e-6 ? TAG.accel : sProp[k] ? TAG.rimpull : TAG.coast;
    if (bal !== Infinity) {
      // the force-balance (steady) speed of this grade is never exceeded: above it the truck can only slow down to it
      if (v0 <= bal + 1e-9 && v1 >= bal) { v1 = bal; tag = TAG.rimpull; }
      else if (v0 > bal + 1e-9) { v1 = Math.max(bal, Math.min(v1, v0)); tag = TAG.rimpull; }
    }
    if (v1 < crawl && k1 <= 0 && vb[i + 1] > 0) {
      v1 = Math.min(crawl, vb[i + 1]);
      if (!stallWarned) { warnings.push('truck cannot accelerate from rest on this grade (rimpull/traction): crawl speed assumed'); stallWarned = true; }
    }
    const capS = sCap[k];
    const cap = capS < vb[i + 1] ? capS : vb[i + 1];
    if (v1 > cap) { tag = vb[i + 1] < capS - 1e-9 ? TAG.decel : sTag[k]; v1 = cap; }
    v[i + 1] = v1;
    const dt = v0 + v1 > 1e-9 ? (2 * h) / (v0 + v1) : h / crawl;
    intervals.push({ s0: s, ds: h, t0: t, dt, v0, v1, seg: segs[k].segIndex });
    t += dt;
    s += h;
    segTime[k] += dt;
    segShare[k * NT + tag] += dt;
    legShare[tag] += dt;
    if (nodeStop[i + 1] && o.dwellS > 0) {
      intervals.push({ s0: s, ds: 0, t0: t, dt: o.dwellS, v0: 0, v1: 0, seg: segs[k].segIndex, dwell: true });
      t += o.dwellS;
      segTime[k] += o.dwellS;
      segShare[k * NT + TAG.stop] += o.dwellS;
      legShare[TAG.stop] += o.dwellS;
    }
  }
  // per-segment entry/exit/max speeds and shares
  const perSeg: LegSegStats[] = new Array(nSeg);
  j = 0;
  for (let k = 0; k < nSeg; k++) {
    const vEntry = v[j];
    let vmax = vEntry;
    for (let q = 0; q < sN[k]; q++) { j++; if (v[j] > vmax) vmax = v[j]; }
    perSeg[k] = { timeS: segTime[k], vEntryKmh: vEntry * 3.6, vExitKmh: v[j] * 3.6, vMaxKmh: vmax * 3.6, shares: shareRecord(segShare, k * NT, segTime[k]) };
  }
  return { intervals, timeS: t, perSeg, shares: shareRecord(legShare, 0, t), warnings };
}

function shareRecord(a: Float64Array, off: number, total: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (let i = 0; i < NT; i++) if (a[off + i] > 0) out[TAGS[i]] = a[off + i] / total;
  return out;
}
