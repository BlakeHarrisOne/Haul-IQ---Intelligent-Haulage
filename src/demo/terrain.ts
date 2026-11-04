/**
 * Procedural topography for the demo strip coal mine (deterministic).
 *
 * Local coordinates: x = E − 236 000, y = N − 7 051 000 (m). 5 m grid over 2.4 × 1.7 km.
 * Build order: natural ground (gentle regional fall + rotated sinusoid octaves + hummocky noise)
 *   → strip pit (seam-roof floor dipping 3.5 % north, benched highwall 15 m benches / 9 m berms at 70°,
 *     lowwall at the 37° spoil angle, benched endwalls) → spoil dump (10 m benches at 37°, 10 m berms,
 *     flat top RL 352) → ROM pad (RL 309, cut / fill batters) → EX04 parting remnant on the floor
 *   → graded roads blended into the ground with cut and fill batters: ring road round the pit, ROM spur,
 *     west and east in-pit ramps at 9 % (32 m wide), dump access ramp at 9 % (30 m), parting access at 8 %.
 */

import { valueNoise2D } from './rng';

/** Site grid origin easting (m, MGA zone 56). */
export const E0 = 236000;
/** Site grid origin northing (m). */
export const N0 = 7051000;
/** Topography grid spacing (m). */
export const DX = 5;
/** Grid nodes east (2.4 km at 5 m). */
export const NX = 481;
/** Grid nodes north (1.7 km at 5 m). */
export const NY = 341;

/** Axis-aligned rectangle in local metres. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Pit floor (toe) rectangle. */
export const PIT_FLOOR: Rect = { x0: 440, y0: 815, x1: 1960, y1: 1050 };
/** Spoil dump toe rectangle. */
export const DUMP_TOE: Rect = { x0: 560, y0: 220, x1: 1840, y1: 640 };
/** Spoil dump top (m RL). */
export const DUMP_TOP_RL = 352;
/** ROM pad rectangle. */
export const ROM_PAD: Rect = { x0: 40, y0: 860, x1: 260, y1: 1100 };
/** ROM pad level (m RL). */
export const ROM_PAD_RL = 309;
/** EX04 parting remnant on the floor. */
export const PARTING: Rect = { x0: 1300, y0: 880, x1: 1520, y1: 1010 };
/** Parting thickness above the seam roof (m). */
export const PARTING_THICK = 5;

/** Block footprints (local m). */
export const BLOCKS = {
  ex09: { x0: 1150, y0: 1120, x1: 1450, y1: 1240 } as Rect,
  ex04: PARTING,
  ldr: { x0: 900, y0: 860, x1: 1200, y1: 1000 } as Rect,
  s51: { x0: 720, y0: 340, x1: 1080, y1: 520 } as Rect,
  s52: { x0: 1320, y0: 340, x1: 1680, y1: 520 } as Rect,
  rom: { x0: 110, y0: 930, x1: 230, y1: 1030 } as Rect,
};
/** Pre-strip bench floor under the EX09 block (m RL). */
export const EX09_FLOOR_RL = 298;
/** Coal seam thickness under the LDR block (m). */
export const SEAM_THICK = 4.5;

/** A graded road: centreline vertices [x, y, z] (local plan, z RL), half width, fill / cut batter slopes. */
export interface Road {
  name: string;
  kind: 'road' | 'ramp' | 'dump';
  hw: number;
  kf: number;
  kc: number;
  pts: Array<[number, number, number]>;
  closed?: boolean;
}

/** The generated topography plus the layout used to make it. */
export interface Terrain {
  /** Heights (m RL), row-major: node (i, j) at (E0 + i·DX, N0 + j·DX). */
  z: Float64Array;
  roads: Road[];
  /** Seam roof (pit floor) RL at local (x, y). */
  roof: (x: number, y: number) => number;
}

/** Seam roof RL: 272 at the lowwall toe, dipping 3.5 % north, gentle along-strike rolls. */
export function seamRoof(x: number, y: number): number {
  return 272 - 0.035 * (y - PIT_FLOOR.y0) + 1.2 * Math.sin(x / 170 + 0.4) + 0.5 * Math.sin(x / 57 + 1.3);
}

/** Height of a benched wall d metres out from its toe (bench height h, face angle, berm width). */
function benchStack(d: number, h: number, faceDeg: number, berm: number): number {
  if (d <= 0) return 0;
  const run = h / Math.tan((faceDeg * Math.PI) / 180), per = run + berm;
  const k = Math.floor(d / per), r = d - k * per;
  return k * h + Math.min(r / run, 1) * h;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Distance from (x, y) to rectangle r (0 inside). */
const rectDist = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));

function roundedRing(r: Rect, radius: number, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const corners: Array<[number, number, number]> = [
    [r.x1 - radius, r.y0 + radius, -Math.PI / 2], [r.x1 - radius, r.y1 - radius, 0],
    [r.x0 + radius, r.y1 - radius, Math.PI / 2], [r.x0 + radius, r.y0 + radius, Math.PI],
  ];
  // CCW: bottom edge → right edge → top edge → left edge, arcs at the corners
  for (let c = 0; c < 4; c++) {
    const [cx, cy, a0] = corners[c];
    const prev = corners[(c + 3) % 4];
    // straight edge from the previous arc end to this arc start
    const sx = prev[0] + radius * Math.cos(prev[2] + Math.PI / 2), sy = prev[1] + radius * Math.sin(prev[2] + Math.PI / 2);
    const ex = cx + radius * Math.cos(a0), ey = cy + radius * Math.sin(a0);
    const L = Math.hypot(ex - sx, ey - sy), n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) out.push([sx + (ex - sx) * (k / n), sy + (ey - sy) * (k / n)]);
    const na = Math.max(2, Math.round((radius * Math.PI) / 2 / step));
    for (let k = 0; k < na; k++) { const a = a0 + (Math.PI / 2) * (k / na); out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]); }
  }
  return out;
}

/** Applies a road: inside the half width the surface is the road; beyond it, cut / fill batters meet the ground. */
function applyRoad(z: Float64Array, road: Road, reach: number): void {
  const n = NX * NY, margin = road.hw + reach;
  const bestD = new Float64Array(n).fill(Infinity), bestZ = new Float64Array(n);
  const P = road.pts, segs = road.closed ? P.length : P.length - 1;
  for (let s = 0; s < segs; s++) {
    const p = P[s], q = P[(s + 1) % P.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(p[0], q[0]) - margin) / DX)), i1 = Math.min(NX - 1, Math.ceil((Math.max(p[0], q[0]) + margin) / DX));
    const j0 = Math.max(0, Math.floor((Math.min(p[1], q[1]) - margin) / DX)), j1 = Math.min(NY - 1, Math.ceil((Math.max(p[1], q[1]) + margin) / DX));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * DX, y = j * DX;
      const t = L2 > 0 ? clamp(((x - p[0]) * dx + (y - p[1]) * dy) / L2, 0, 1) : 0;
      const d = Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy);
      const k = j * NX + i;
      if (d < bestD[k] && d <= margin) { bestD[k] = d; bestZ[k] = p[2] + (q[2] - p[2]) * t; }
    }
  }
  for (let k = 0; k < n; k++) {
    const d = bestD[k];
    if (d === Infinity) continue;
    const zr = bestZ[k];
    if (d <= road.hw) z[k] = zr;
    else { const e = d - road.hw; z[k] = clamp(z[k], zr - road.kf * e, zr + road.kc * e); }
  }
}

/** Builds the demo topography (deterministic for a given random source). */
export function buildTerrain(rand: () => number): Terrain {
  const hummocks = valueNoise2D(rand, NX * DX, NY * DX, 15);
  const grass = valueNoise2D(rand, NX * DX, NY * DX, 5);
  const oct = Array.from({ length: 6 }, (_, k) => ({
    f: (2 ** k / 1800) * 2 * Math.PI, a: 4 / 1.9 ** k, p0: rand() * 6.283, p1: rand() * 6.283, ang: rand() * 3.1416,
  }));
  const natural = (x: number, y: number) => {
    let z = 312 + 0.003 * x - 0.004 * y;
    for (const o of oct) {
      const c = Math.cos(o.ang), s = Math.sin(o.ang), u = x * c + y * s, v = -x * s + y * c;
      z += o.a * Math.sin(u * o.f + o.p0) * Math.cos(v * o.f * 0.7 + o.p1);
    }
    return z;
  };
  const z = new Float64Array(NX * NY);
  const F = PIT_FLOOR;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = i * DX, y = j * DX, k = j * NX + i;
    let h = natural(x, y) + 0.35 * hummocks(x, y) + 0.3 * grass(x, y);
    // strip pit: walls rise from the floor toe outwards; the excavation is the highest wall constraint
    const base = seamRoof(clamp(x, F.x0, F.x1), clamp(y, F.y0, F.y1));
    const wall = Math.max(
      benchStack(y - F.y1, 15, 70, 9),          // highwall (north)
      (F.y0 - y) * Math.tan((37 * Math.PI) / 180), // lowwall at spoil angle (south)
      benchStack(F.x0 - x, 15, 65, 12),          // west endwall
      benchStack(x - F.x1, 15, 65, 12),          // east endwall
    );
    h = Math.min(h, base + Math.max(0, wall));
    // spoil dump
    const D = DUMP_TOE;
    const dd = Math.min(x - D.x0, D.x1 - x, y - D.y0, D.y1 - y);
    if (dd > 0) h = Math.max(h, Math.min(DUMP_TOP_RL, 312 + benchStack(dd, 10, 37, 10)));
    // ROM pad (cut 1:1, fill 1:1.5)
    const dp = rectDist(ROM_PAD, x, y);
    h = dp === 0 ? ROM_PAD_RL : clamp(h, ROM_PAD_RL - 0.67 * dp, ROM_PAD_RL + 1.0 * dp);
    // EX04 parting remnant on the floor, 60° faces
    const dq = rectDist(PARTING, x, y);
    const top = seamRoof(clamp(x, PARTING.x0, PARTING.x1), clamp(y, PARTING.y0, PARTING.y1)) + PARTING_THICK;
    if (dq < 10) h = Math.max(h, dq === 0 ? seamRoof(x, y) + PARTING_THICK : top - 1.73 * dq);
    z[k] = h;
  }
  const roads = layoutRoads(natural);
  for (const r of roads) applyRoad(z, r, r.kind === 'road' ? 45 : 90);
  return { z, roads, roof: seamRoof };
}

function layoutRoads(natural: (x: number, y: number) => number): Road[] {
  // ring road: rounded rectangle round the pit, profile = smoothed natural ground
  const ringXY = roundedRing({ x0: 330, y0: 690, x1: 2090, y1: 1290 }, 80, 10);
  let rz = ringXY.map(([x, y]) => natural(x, y));
  for (let pass = 0; pass < 3; pass++) {
    const n = rz.length, w = 7;
    rz = rz.map((_, i) => { let s = 0; for (let k = -w; k <= w; k++) s += rz[(i + k + n) % n]; return s / (2 * w + 1); });
  }
  const ring: Road = { name: 'Ring road', kind: 'road', hw: 16, kf: 0.67, kc: 1.0, closed: true, pts: ringXY.map(([x, y], i) => [x, y, rz[i]]) };
  const ringZ = (x: number, y: number) => {
    let best = Infinity, zb = 0;
    for (const p of ring.pts) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < best) { best = d; zb = p[2]; } }
    return zb;
  };
  const G = 0.09;
  // west in-pit ramp: from the ring road east, down the lowwall toe at 9 %, onto the floor
  const zw = ringZ(330, 800);
  let xb = 346 + (zw - seamRoof(800, PIT_FLOOR.y0)) / G;
  for (let it = 0; it < 4; it++) xb = 346 + (zw - seamRoof(xb, PIT_FLOOR.y0)) / G;
  const west: Road = {
    name: 'West ramp', kind: 'ramp', hw: 16, kf: 0.75, kc: 1.2,
    pts: [[330, 800, zw], [346, 800, zw], [xb, 805, seamRoof(xb, PIT_FLOOR.y0)], [xb + 60, 830, seamRoof(xb + 60, 830)]],
  };
  // east in-pit ramp: from the ring road west, down at 9 %
  const ze = ringZ(2090, 800);
  let xe = 2074 - (ze - seamRoof(1600, PIT_FLOOR.y0)) / G;
  for (let it = 0; it < 4; it++) xe = 2074 - (ze - seamRoof(xe, PIT_FLOOR.y0)) / G;
  const east: Road = {
    name: 'East ramp', kind: 'ramp', hw: 16, kf: 0.75, kc: 1.2,
    pts: [[2090, 800, ze], [2074, 800, ze], [xe, 805, seamRoof(xe, PIT_FLOOR.y0)], [xe - 60, 830, seamRoof(xe - 60, 830)]],
  };
  // dump access ramp: off the ring road's south side, up the north batter at 9 % to the top
  const za = ringZ(1300, 690);
  const dirx = -430, diry = -141, dl = Math.hypot(dirx, diry);
  const Lr = (DUMP_TOP_RL - za) / G;
  const bx = 1300 + (dirx / dl) * Lr, by = 690 + (diry / dl) * Lr;
  const dump: Road = {
    name: 'Dump ramp', kind: 'dump', hw: 15, kf: 0.75, kc: 1.0,
    pts: [[1300, 690, za], [bx, by, DUMP_TOP_RL], [bx + (dirx / dl) * 50, by + (diry / dl) * 50, DUMP_TOP_RL]],
  };
  // ROM spur
  const zr = ringZ(330, 980);
  const spur: Road = { name: 'ROM spur', kind: 'road', hw: 15, kf: 0.67, kc: 1.0, pts: [[330, 980, zr], [250, 980, ROM_PAD_RL]] };
  // EX04 parting access: west off the plateau at 8 %
  const ym = (PARTING.y0 + PARTING.y1) / 2;
  const zt = seamRoof(PARTING.x0, ym) + PARTING_THICK;
  const xm = PARTING.x0 - PARTING_THICK / 0.08;
  const mini: Road = {
    name: 'Parting access', kind: 'ramp', hw: 12, kf: 1.0, kc: 1.73,
    pts: [[PARTING.x0 + 10, ym, zt], [PARTING.x0, ym, zt], [xm, ym, seamRoof(xm, ym)], [xm - 15, ym, seamRoof(xm - 15, ym)]],
  };
  return [ring, spur, west, east, dump, mini];
}
