/**
 * Parametric low-poly rigid haul truck sized from TruckModel.dims (Haul Road Lab vehicleGeom v5 proportions:
 * axles at −0.235 L and −0.705 L, tyre OD from the tyre code, deck at eye − 1.2 m, cab on the eye side, canopy over it).
 * Parts are separate geometries so the actors module can instance them and animate: body (static), tray (tips about
 * the rear hinge), load heap (in the tray, scaled by fill), wheels (spin; single fronts, dual rears).
 * Main dimensions follow the OEM record; inner proportions are illustrative.
 */
import type * as THREE from 'three';
import type { TruckModel } from '@/core/types';
import { Kit, shade, type RGB, type V3 } from './kit';

export const C = {
  rubber: [0.075, 0.075, 0.08] as RGB, tread: [0.11, 0.11, 0.115] as RGB, under: [0.16, 0.16, 0.17] as RGB,
  frame: [0.2, 0.2, 0.22] as RGB, rail: [0.15, 0.15, 0.16] as RGB, glass: [0.13, 0.19, 0.25] as RGB, glassHi: [0.36, 0.44, 0.52] as RGB,
  seal: [0.05, 0.05, 0.06] as RGB, rim: [0.68, 0.69, 0.68] as RGB, hub: [0.26, 0.26, 0.28] as RGB, nut: [0.82, 0.82, 0.8] as RGB,
  steel: [0.46, 0.47, 0.49] as RGB, chrome: [0.8, 0.81, 0.82] as RGB, grille: [0.1, 0.1, 0.11] as RGB, grilleBar: [0.34, 0.35, 0.37] as RGB,
  lamp: [0.97, 0.97, 0.92] as RGB, lampRim: [0.09, 0.09, 0.1] as RGB, red: [0.8, 0.07, 0.05] as RGB, amber: [1.0, 0.55, 0.06] as RGB,
  black: [0.06, 0.06, 0.07] as RGB, white: [0.95, 0.95, 0.94] as RGB, liner: [0.3, 0.29, 0.27] as RGB,
};
/** Paint shades (multiplied by the instance colour). */
const P: RGB = [1, 1, 1], PD: RGB = [0.78, 0.78, 0.78], PL: RGB = [1.08, 1.08, 1.08];

export interface WheelSpot { x: number; y: number; z: number; r: number; side: 1 | -1 }

export interface TruckGeoms {
  body: THREE.BufferGeometry;
  /** Body without the cab exterior + the cab's interior shell: what the driver sees from the seat (POV). */
  bodyNoCab: THREE.BufferGeometry;
  cabInterior: THREE.BufferGeometry;
  tray: THREE.BufferGeometry;
  load: THREE.BufferGeometry;
  wheelHi: THREE.BufferGeometry;
  wheelLo: THREE.BufferGeometry;
  /** Wheel centres in Three.js local axes relative to the model origin (mid-axle ground point). */
  wheels: WheelSpot[];
  /** Tray hinge (local x, y). */
  hinge: [number, number];
  L: number; W: number; H: number; D: number;
  wheelbase: number;
  /** Local x of the front bumper / front axle (from the mid-axle origin). */
  frontX: number;
  frontAxleX: number;
  /** Driver eye in local axes (the seated eye the model and the POV use). */
  eye: [number, number, number];
  cabSide: 1 | -1;
  /**
   * Mirror glasses (local axes): centre, size (m) and the outward side as local z sign (−1 = vehicle left). The glass
   * faces back (−x); the POV shows a live view there.
   */
  mirrors: { pos: [number, number, number]; w: number; h: number; outward: 1 | -1 }[];
  /** Lamp centres (local axes): headlights on the deck pods, tail lights at the rear. */
  lamps: { head: [number, number, number][]; tail: [number, number, number][] };
}

export function tyreDiameter(code: string | undefined, H: number, L: number): { D: number; tw: number; rimR: number } {
  const s = String(code ?? '');
  const t = s.match(/(\d{2}(?:\.\d+)?)\s*-?\s*R?\s*(\d{2})\b/i);
  const t2 = s.match(/(\d{2})\/(\d{2})\s*R\s*(\d{2})/i);
  let D: number, tw: number, rim: number;
  if (t2) { const sec = +t2[1], ar = +t2[2] / 100, r = +t2[3]; D = (r + 2 * sec * ar) * 0.0254; tw = sec * 0.0254; rim = r * 0.0254; }
  else if (t) { const sec = +t[1], r = +t[2]; D = (r + 2 * 1.13 * sec) * 0.0254; tw = sec * 0.0254; rim = r * 0.0254; }
  else { D = Math.min(0.55 * H, 0.3 * L); tw = 0.27 * D; rim = 0.55 * D; }
  D = Math.min(D, 0.62 * H);
  return { D, tw, rimR: Math.min(rim / 2, 0.36 * D) };
}

function wheel(K: Kit, r: number, w: number, rb: number, detail: 'hi' | 'lo', rimC: RGB, hubC: RGB, outer: boolean) {
  const A: V3 = [0, 1, 0], U: V3 = [1, 0, 0], V: V3 = [0, 0, 1], O: V3 = [0, 0, 0];
  const lugH = 0.045 * r, Rc = r - lugH, k = Rc - rb;
  const sw = (f: number, a: number): [number, number] => [rb + f * k, a * w];
  const seg = detail === 'hi' ? 36 : 16;
  const prof: [number, number][] = detail === 'hi'
    ? [sw(0, -0.42), sw(0.18, -0.48), sw(0.5, -0.5), sw(0.8, -0.48), sw(0.94, -0.44), sw(0.99, -0.4), [Rc, -0.33 * w], [Rc, 0.33 * w], sw(0.99, 0.4), sw(0.94, 0.44), sw(0.8, 0.48), sw(0.5, 0.5), sw(0.18, 0.48), sw(0, 0.42)]
    : [sw(0, -0.42), sw(0.5, -0.5), sw(0.94, -0.44), [r, -0.36 * w], [r, 0.36 * w], sw(0.94, 0.44), sw(0.5, 0.5), sw(0, 0.42)];
  K.revolve(O, A, U, V, prof, C.rubber, 0, seg);
  if (detail === 'hi') {
    // staggered, angled tread lugs (directional, so rolling reads)
    const N = 22, chev = 0.3;
    for (const row of [-1, 1]) for (let i = 0; i < N; i++) {
      const t = ((i + (row > 0 ? 0.5 : 0)) / N) * 2 * Math.PI, ct = Math.cos(t), st = Math.sin(t);
      const dir: V3 = [ct, 0, st], T: V3 = [-st, 0, ct], ph = row * chev, cp = Math.cos(ph), sp = Math.sin(ph);
      const r0 = Rc - 0.05 * r, rad = (r0 + r) / 2, big = i % 2 === 0 ? 1.35 : 1;
      K.obox([ct * rad, row * 0.245 * w, st * rad], [T[0] * cp, sp, T[2] * cp], [-T[0] * sp, cp, -T[2] * sp], dir,
        (0.58 * Math.PI * Rc) / N, 0.215 * w * big, (r - r0) / 2, C.tread);
    }
  }
  // inboard cover
  K.revolve(O, A, U, V, [[0, -0.3 * w], [0.9 * rb, -0.3 * w], [rb, -0.42 * w]], C.hub, 0, detail === 'hi' ? 24 : 12);
  if (!outer) { K.revolve(O, A, U, V, [[rb, 0.42 * w], [0.9 * rb, 0.3 * w], [0, 0.3 * w]], C.hub, 0, detail === 'hi' ? 24 : 12); return; }
  const d = 0.12 * w, ha = 0.36 * w;
  K.revolve(O, A, U, V, [[rb + 0.05 * k, 0.415 * w], [rb + 0.025 * k, 0.455 * w], [rb - 0.015 * r, 0.455 * w], [rb - 0.04 * r, 0.41 * w], [0.93 * rb, d]], rimC, 0, detail === 'hi' ? 32 : 14);
  K.revolve(O, A, U, V, [[0.93 * rb, d], [0.62 * rb, d]], rimC, 0, detail === 'hi' ? 32 : 14);
  K.revolve(O, A, U, V, [[0.62 * rb, d], [0.57 * rb, d + 0.05 * w], [0.45 * rb, d + 0.05 * w], [0.42 * rb, ha], [0.36 * rb, ha + 0.03 * w], [0, ha + 0.03 * w]], hubC, 0, detail === 'hi' ? 24 : 12);
  if (detail === 'hi') {
    const nuts = 18;
    for (let i = 0; i < nuts; i++) {
      const t = ((i + 0.5) / nuts) * 2 * Math.PI, dir: V3 = [Math.cos(t), 0, Math.sin(t)], T: V3 = [-Math.sin(t), 0, Math.cos(t)];
      K.obox([dir[0] * 0.7 * rb, d + 0.03 * w, dir[2] * 0.7 * rb], T, A, dir, 0.028 * r, 0.03 * r, 0.028 * r, C.nut);
    }
    // valve marker - shows rotation
    K.obox([0, d + 0.01, 0.79 * rb], [1, 0, 0], A, [0, 0, 1], 0.05 * rb, 0.01, 0.05 * rb, C.red);
  }
}

const IN = {
  headliner: [0.83, 0.835, 0.82] as RGB, trim: [0.42, 0.45, 0.48] as RGB, pillar: [0.36, 0.385, 0.41] as RGB, wall: [0.62, 0.635, 0.645] as RGB,
  dash: [0.2, 0.215, 0.23] as RGB, dashTop: [0.27, 0.285, 0.3] as RGB, screen: [0.05, 0.07, 0.09] as RGB, wheel: [0.09, 0.095, 0.1] as RGB,
  seal: [0.04, 0.04, 0.045] as RGB,
};

/**
 * Operator cab interior seen from the seat: headliner, header beam, raked A-pillars, rear B-pillars, side belt rails,
 * windscreen sill, door cards, dash with the binnacle and instrument face, steering wheel and column. Windows are openings (no glass), as in Haul Road Lab's cab3d; the deck, rails, hood, canopy and mirrors
 * outside come from the truck body itself, so they match the model exactly.
 */
function cabInterior(K: Kit, c: { ex: number; eyR: number; ez: number; cs: 1 | -1; deck: number; cabF: number; cabR: number; rk: number; ct: number; yA: number; yB: number; zs: number; paint: RGB }) {
  const { ex, eyR, ez, deck, cabF, cabR, rk, ct, yA, yB, zs } = c;
  const hC = ct - deck, xAt = (z: number) => cabF - (rk * (z - deck)) / hC - 0.05;
  const ia = yA + 0.06, ib = yB - 0.06;                         // inner faces of the side walls
  const roofZ = ct - 0.06;
  // headliner + roof skin
  K.box(cabR + 0.02, xAt(roofZ), ia, ib, roofZ, roofZ + 0.05, IN.headliner);
  // header beam over the windscreen and a rear header
  K.box(xAt(roofZ) - 0.17, xAt(roofZ) + 0.02, ia, ib, roofZ - 0.13, roofZ, IN.trim);
  K.box(cabR + 0.02, cabR + 0.16, ia, ib, roofZ - 0.1, roofZ, IN.trim);
  // A-pillars along the rake, B-pillars at the rear corners, a mullion on the outer side glass
  for (const y of [ia + 0.035, ib - 0.035]) {
    K.beam([xAt(zs - 0.08), y, zs - 0.08], [xAt(roofZ) - 0.02, y, roofZ], 0.075, 0.1, IN.pillar, 0, [1, 0, 0]);
    K.box(cabR + 0.02, cabR + 0.14, y - 0.04, y + 0.04, deck, roofZ, IN.pillar);
  }
  const yOut = c.cs > 0 ? ib : ia, xm = cabR + (cabF - cabR) * 0.52;
  K.box(xm - 0.04, xm + 0.04, yOut - c.cs * 0.06, yOut, zs - 0.05, roofZ, IN.pillar);
  // side belt rails (window sills) and door cards below them
  for (const [y, inner] of [[ia, -1], [ib, 1]] as [number, number][]) {
    K.box(cabR + 0.1, xAt(zs) + 0.02, y - inner * 0.0, y + inner * -0.09, zs - 0.06, zs, IN.trim);
    K.box(cabR + 0.1, xAt(deck + 0.1), y, y - inner * 0.035, deck, zs - 0.06, IN.wall);
    // door handle / grab bar
    K.tube([cabR + 0.6, y - inner * 0.06, zs - 0.25], [cabR + 1.0, y - inner * 0.06, zs - 0.22], 0.016, IN.trim, 0, 6);
  }
  // windscreen sill (lower frame)
  K.box(xAt(zs) - 0.08, xAt(zs) + 0.03, ia, ib, zs - 0.09, zs - 0.01, IN.trim);
  // dash: top sloping down towards the driver, face down to the floor, binnacle hump in front of the eye
  const xd0 = xAt(zs) - 0.06, xd1 = ex + 0.42, zd0 = zs - 0.06, zd1 = zs - 0.17;
  const sec = (x: number, zt: number): V3[] => [[x, ia + 0.02, deck + 0.3], [x, ia + 0.02, zt], [x, ib - 0.02, zt], [x, ib - 0.02, deck + 0.3]];
  K.loft([sec(xd0, zd0), sec((xd0 + xd1) / 2, (zd0 + zd1) / 2 + 0.01), sec(xd1, zd1)], IN.dash);
  K.box(xd1 - 0.25, xd0 - 0.02, ia + 0.03, ib - 0.03, zd0 - 0.005, zd0 + 0.004, IN.dashTop);
  // binnacle + instrument face angled to the eye
  const by = eyR, bw = 0.27;
  K.hexa([[xd1 - 0.02, by - bw, zd1], [xd1 + 0.2, by - bw, zd1 + 0.02], [xd1 - 0.02, by + bw, zd1], [xd1 + 0.2, by + bw, zd1 + 0.02],
    [xd1 - 0.04, by - bw + 0.03, zd1 + 0.13], [xd1 + 0.16, by - bw + 0.03, zd1 + 0.1], [xd1 - 0.04, by + bw - 0.03, zd1 + 0.13], [xd1 + 0.16, by + bw - 0.03, zd1 + 0.1]], IN.dash);
  K.face([[xd1 - 0.015, by - bw + 0.05, zd1 + 0.015], [xd1 - 0.015, by + bw - 0.05, zd1 + 0.015], [xd1 - 0.035, by + bw - 0.06, zd1 + 0.115], [xd1 - 0.035, by - bw + 0.06, zd1 + 0.115]], IN.screen, 0, null, [-1, 0, 0.3]);
  // side display on the inner side of the dash
  const sy = eyR - c.cs * 0.62;
  K.face([[xd1 + 0.02, sy - 0.14, zd1 + 0.04], [xd1 + 0.02, sy + 0.14, zd1 + 0.04], [xd1 + 0.0, sy + 0.14, zd1 + 0.16], [xd1 + 0.0, sy - 0.14, zd1 + 0.16]], IN.screen, 0, null, [-1, 0, 0.2]);
  // steering column + wheel (rim tilted towards the driver), three spokes and a hub
  const wc: V3 = [ex + 0.46, eyR, ez - 0.52], tilt = 0.95;              // wheel plane ~55° from horizontal
  const nrm: V3 = [-Math.cos(tilt), 0, Math.sin(tilt)];               // faces the driver (back and up)
  const u: V3 = [0, 1, 0], v: V3 = [Math.sin(tilt), 0, Math.cos(tilt)];
  const R = 0.21, seg = 22;
  const rim = (i: number): V3 => { const t = (i / seg) * Math.PI * 2; return [wc[0] + (u[0] * Math.cos(t) + v[0] * Math.sin(t)) * R, wc[1] + (u[1] * Math.cos(t) + v[1] * Math.sin(t)) * R, wc[2] + (u[2] * Math.cos(t) + v[2] * Math.sin(t)) * R]; };
  for (let i = 0; i < seg; i++) K.tube(rim(i), rim(i + 1), 0.022, IN.wheel, 0, 8, false);
  for (const t of [Math.PI * 0.5 + 0.2, Math.PI * 1.5 - 0.2, Math.PI * 1.0]) {
    const p: V3 = [wc[0] + (u[0] * Math.cos(t) + v[0] * Math.sin(t)) * R, wc[1] + (u[1] * Math.cos(t) + v[1] * Math.sin(t)) * R, wc[2] + (u[2] * Math.cos(t) + v[2] * Math.sin(t)) * R];
    K.beam(wc, p, 0.05, 0.018, IN.wheel, 0, nrm);
  }
  K.tube([wc[0] - nrm[0] * 0.02, wc[1], wc[2] - nrm[2] * 0.02], [wc[0] + nrm[0] * 0.03, wc[1], wc[2] + nrm[2] * 0.03], 0.06, IN.dash, 0, 12);
  K.tube([wc[0] + 0.02, wc[1], wc[2] - 0.03], [xd1 + 0.12, wc[1], zd1 - 0.12], 0.045, IN.dash, 0, 10);
}

export function buildTruck(model: Pick<TruckModel, 'dims'> & { name?: string }): TruckGeoms {
  const dims = model.dims;
  const L = Math.max(4, dims.length), W = Math.max(2, dims.width), H = Math.max(2, dims.height), hw = W / 2;
  const { D, tw, rimR } = tyreDiameter(dims.tyre, H, L);
  const r = D / 2, lugH = 0.045 * r, rb = Math.min(rimR, 0.62 * (r - lugH));
  const xf = -0.235 * L, xr = xf - 0.47 * L, gap = 0.13 * tw;
  const yF = 0.84 * hw - tw / 2, yR1 = 0.86 * hw - tw / 2, yR2 = 0.86 * hw - 1.5 * tw - gap, yRinF = 0.86 * hw - 2 * tw - gap;
  const ex = dims.eyeBack != null ? -dims.eyeBack : -0.27 * L;
  const eyR = dims.eyeRight != null ? -dims.eyeRight : 0.3 * W;            // vehicle y (+ = left)
  const cs: 1 | -1 = eyR >= 0 ? 1 : -1;
  const ez = dims.eyeHeight || 0.75 * H;
  const deck = Math.max(ez - 1.2, D + 0.18), dT = 0.14;
  // seated eye used by the model and the POV: never less than 1.5 m above the deck the cab stands on (the deck), else the tyre-driven
  // deck height would put the windscreen sill at eye level (ASSUMED; the FLEET eye heights are estimates too)
  const ezR = Math.max(ez, deck + 1.5);
  const cabRoof = Math.max(Math.min(deck + 2.05, H - 0.38), ezR + 0.72), canBot = Math.max(cabRoof + 0.08, H - 0.42);
  const cabF = Math.min(ex + 1.1, -0.045 * L - 1.0), cabR = ex - 1.2, xBF = Math.min(-0.37 * L, cabR - 0.15);
  const yCo = cs * Math.min(Math.abs(eyR) + 0.95, hw - 0.3), yCi = yCo - cs * 1.95;
  const xCF = -0.03 * L, xDF = -0.045 * L;
  const bt = 0.47 * D, bb = 0.3 * D;

  const K = new Kit();
  const box = K.box.bind(K), tube = K.tube.bind(K);
  // ── frame and running gear
  for (const sd of [1, -1]) box(-0.95 * L, -0.05 * L, sd * 0.1 * W, sd * 0.16 * W, 0.42 * D, 0.72 * D, C.frame);
  box(-0.955 * L, -0.94 * L, -0.18 * W, 0.18 * W, 0.45 * D, 0.72 * D, C.frame);
  for (const sd of [1, -1]) {
    box(-0.958 * L, -0.955 * L, sd * 0.12 * W - 0.15, sd * 0.12 * W + 0.15, 0.6 * D, 0.67 * D, C.red);
    box(-0.958 * L, -0.955 * L, sd * 0.12 * W - 0.15, sd * 0.12 * W + 0.15, 0.53 * D, 0.585 * D, C.amber);
  }
  tube([xr, -yRinF + 0.05, r], [xr, yRinF - 0.05, r], 0.26 * r, C.under, 0, 14);
  K.obox([xr, 0, r], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.3 * r, 0.42 * r, 0.36 * r, C.under);
  for (const sd of [1, -1]) {
    const ys = sd * (yF - tw / 2 - 0.3);
    tube([xf, ys, r + 0.15], [xf, ys, deck - dT - 0.75], 0.09 * r, C.chrome, 0, 10);
    tube([xf, ys, deck - dT - 0.85], [xf, ys, deck - dT], 0.15 * r, PD, 1, 10);
    K.beam([xf, ys, r + 0.1], [xf, sd * (yF - 0.25 * tw), r], 0.3 * r, 0.3 * r, C.under, 0, [1, 0, 0]);
  }
  // side frame covers between the axles (octagonal tube, painted)
  {
    const tx0 = xf - r - 0.3, tx1 = xr + r + 0.55;
    if (tx0 - tx1 > 0.5) for (const sd of [1, -1]) {
      const ya = 0.17 * W, yb = 0.4 * W, za = 0.28 * D, zb = 0.7 * D, ch = 0.16;
      const oct = (x: number): V3[] => ([[ya + ch, za], [yb - ch, za], [yb, za + ch], [yb, zb - ch], [yb - ch, zb], [ya + ch, zb], [ya, zb - ch], [ya, za + ch]] as [number, number][]).map(([y, z]) => [x, sd * y, z] as V3);
      K.loft([oct(tx1), oct(tx0)], sd > 0 ? P : PD, 1);
      for (const f of [0.25, 0.75]) { const x = tx1 + (tx0 - tx1) * f; box(x - 0.05, x + 0.05, sd * (ya - 0.02), sd * (yb + 0.02), za - 0.02, zb + 0.02, C.under); }
    }
  }
  // ── front end: radiator housing, grille, bumper, lamps
  const xG = -0.075 * L, gy = 0.185 * W, gz0 = bt + 0.1, gz1 = deck - dT - 0.1;
  box(-0.27 * L, xG, -0.21 * W, 0.21 * W, bb, deck - dT, PD, 1);
  box(xG, xG + 0.03, -gy, gy, gz0, gz1, C.grille);
  { const nS = Math.max(6, Math.round((gz1 - gz0) / 0.2)); for (let i = 1; i < nS; i++) { const z = gz0 + ((gz1 - gz0) * i) / nS; box(xG + 0.03, xG + 0.065, -gy, gy, z - 0.035, z + 0.035, C.grilleBar); } }
  box(xG + 0.03, xG + 0.07, -0.035, 0.035, gz0, gz1, C.grilleBar);
  box(xG, xG + 0.1, -gy - 0.12, gy + 0.12, gz1, gz1 + 0.12, P, 1); box(xG, xG + 0.1, -gy - 0.12, gy + 0.12, gz0 - 0.12, gz0, P, 1);
  for (const sd of [1, -1]) box(xG, xG + 0.1, sd * gy, sd * (gy + 0.12), gz0, gz1, P, 1);
  box(-0.062 * L, -0.03, -0.3 * W, 0.3 * W, bb, bt, P, 1);
  box(-0.058 * L, -0.05, -0.29 * W, 0.29 * W, bt, bt + 0.02, C.steel);
  for (const sd of [1, -1]) {
    box(-0.03, -0.006, sd * (0.3 * W - 0.32), sd * (0.3 * W - 0.1), bt - 0.24, bt - 0.1, C.amber);
    const yc = sd * 0.15 * W;
    box(-0.03, -0.016, yc - 0.2, yc + 0.2, bb + 0.1, bb + 0.4, C.lampRim); box(-0.016, -0.004, yc - 0.16, yc + 0.16, bb + 0.14, bb + 0.36, C.lamp);
  }
  // ladder (front, opposite the stairs) and diagonal stairway up to the deck
  {
    const yL = -cs * 0.255 * W, xL = -0.035;
    for (const dy of [-0.26, 0.26]) tube([xL, yL + dy, 0.35], [xL, yL + dy, bt + 1.0], 0.03, C.rail, 0, 6);
    for (let z = 0.5; z < bb - 0.05; z += 0.3) tube([xL, yL - 0.26, z], [xL, yL + 0.26, z], 0.025, C.steel, 0, 5);
  }
  {
    const y0 = -cs * 0.235 * W, y1 = cs * 0.1 * W, z0s = bt + 0.02, sx0 = -0.046 * L, sx1 = -0.006 * L - 0.03;
    const nSt = Math.max(5, Math.round((deck - z0s) / 0.24)), dyS = (y1 - y0) / nSt;
    for (let i = 1; i < nSt; i++) { const yy = y0 + dyS * i, zz = z0s + ((deck - z0s) * i) / nSt; box(sx0, sx1, yy - dyS * 0.55, yy + dyS * 0.55, zz - 0.05, zz, C.steel); }
    for (const xs of [sx0 - 0.03, sx1 + 0.025]) K.beam([xs, y0 - 0.1 * cs, z0s - 0.12], [xs, y1, deck - 0.14], 0.05, 0.24, PD, 1);
    for (const xs of [sx0 - 0.04, sx1 + 0.035]) tube([xs, y0, z0s + 0.95], [xs, y1, deck + 0.95], 0.03, C.rail, 0, 6);
  }
  // ── upper deck, headlight pods, fenders, mud flaps
  box(xBF, xDF, -0.47 * W, 0.47 * W, deck - dT, deck, P, 1);
  box(xDF - 0.06, xDF + 0.01, -0.47 * W + 0.01, 0.47 * W - 0.01, deck - 0.3, deck - 0.005, P, 1);
  for (const sd of [1, -1]) {
    const yc = sd * 0.36 * W;
    box(xDF - 0.22, xDF + 0.02, yc - 0.45, yc + 0.45, deck - 0.72, deck - 0.3, PD, 1);
    for (const dy of [-0.2, 0.2]) { box(xDF + 0.02, xDF + 0.035, yc + dy - 0.17, yc + dy + 0.17, deck - 0.66, deck - 0.36, C.lampRim); box(xDF + 0.035, xDF + 0.05, yc + dy - 0.13, yc + dy + 0.13, deck - 0.62, deck - 0.4, C.lamp); }
    K.arcBand(xf, r, r + 0.07, r + 0.16, sd * (yF - tw / 2 - 0.06), sd * (yF + tw / 2 + 0.06), (8 * Math.PI) / 180, (95 * Math.PI) / 180, 10, P, 1);
    box(xf - r - 0.16, xf - r - 0.12, sd * (yF - tw / 2 - 0.04), sd * (yF + tw / 2 + 0.04), 0.8, deck - dT, C.rubber);
  }
  // fuel / hydraulic tanks between the axles
  for (const sd of [1, -1]) {
    const x0 = xr + r + 0.5, x1 = xf - r - 0.45, y0 = sd * 0.42 * W, y1 = sd * Math.min(0.47 * W, 0.42 * W + 0.85);
    if (x1 - x0 > 0.6) {
      box(x0, x1, y0, y1, 0.36 * D, 0.7 * D, sd > 0 ? P : C.steel, sd > 0 ? 1 : 0);
      for (const f of [0.25, 0.75]) { const x = x0 + (x1 - x0) * f; box(x - 0.06, x + 0.06, y0 - sd * 0.01, y1 + sd * 0.02, 0.35 * D, 0.71 * D, C.black); }
    }
  }
  // ── tread plate on the walkway in front of / beside the cab
  {
    const x0 = Math.max(xBF + 0.3, cabF + 0.1), x1 = xDF - 0.12, yy0 = -0.46 * W, yy1 = 0.46 * W, st = 0.22;
    for (let x = x0; x < x1 - 0.05; x += st) for (let y = yy0; y < yy1 - 0.05; y += st) {
      const alt = (Math.round((x - x0) / st) + Math.round((y - yy0) / st)) % 2 === 0;
      const cx = x + st / 2, cy = y + st / 2, a = alt ? 0.07 : 0.025, b = alt ? 0.025 : 0.07;
      K.face([[cx - a, cy - b, deck + 0.006], [cx + a, cy - b, deck + 0.006], [cx + a, cy + b, deck + 0.006], [cx - a, cy + b, deck + 0.006]], PD, 1, null, [0, 0, 1]);
    }
  }
  // ── handrails along the deck front
  const rails = (pts: [number, number][], z0: number, h: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.3));
      tube([a[0], a[1], z0 + h], [b[0], b[1], z0 + h], 0.035, PL, 1, 8);
      tube([a[0], a[1], z0 + h * 0.5], [b[0], b[1], z0 + h * 0.5], 0.028, PL, 1, 6);
      for (let j = 0; j <= n; j++) { const t = j / n; tube([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z0], [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z0 + h], 0.032, P, 1, 6); }
    }
  };
  const xRl = xDF - 0.08, yRl = 0.47 * W - 0.06;
  rails([[xRl, -cs * yRl], [xRl, cs * 0.1 * W - cs * 0.25]], deck, 1.05);
  rails([[xRl, cs * 0.1 * W + cs * 0.65], [xRl, cs * yRl], [cabF + 0.15, cs * yRl]], deck, 1.05);
  rails([[xRl, -cs * yRl], [xBF + 0.2, -cs * yRl]], deck, 1.05);
  // ── mirrors
  const mirrorHeads: V3[] = [];
  for (const [hp, base] of [[[-0.02 * L, cs * (hw - 0.14), deck + 1.55], [xRl, cs * yRl, deck + 1.05]], [[-0.03 * L, -cs * (hw - 0.14), deck + 1.3], [xRl, -cs * yRl, deck + 1.05]]] as [V3, V3][]) {
    K.beam(base, [hp[0], hp[1], hp[2] - 0.2], 0.04, 0.04, C.steel);
    K.obox(hp, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.05, 0.12, 0.3, C.black);
    const xg = hp[0] - 0.052;
    mirrorHeads.push([xg, hp[1], hp[2]]);
    K.face([[xg, hp[1] - 0.1, hp[2] - 0.26], [xg, hp[1] + 0.1, hp[2] - 0.26], [xg, hp[1] + 0.1, hp[2] + 0.26], [xg, hp[1] - 0.1, hp[2] + 0.26]], C.glassHi, 0, null, [-1, 0, 0]);
  }
  // ── engine hood, air cleaner, exhaust stacks (deck, beside the cab)
  {
    const xa = -0.11 * L, xb = xBF + 0.25, ya = -cs * 0.3 * W, yb = yCi - cs * 0.12, zt = deck + 0.85;
    K.hexa([[xb, ya, deck], [xa, ya, deck], [xb, yb, deck], [xa, yb, deck], [xb, ya, zt], [xa - 0.45, ya, zt], [xb, yb, zt], [xa - 0.45, yb, zt]], P, 1);
    for (const f of [0.2, 0.5, 0.8]) { const yv = ya + (yb - ya) * f; box(xb + 0.4, xa - 0.8, yv - 0.25, yv + 0.25, zt, zt + 0.012, C.grilleBar); }
    const yc = -cs * 0.37 * W, zc = deck + 0.38, x0 = -0.09 * L;
    tube([x0, yc, zc], [x0 - 1.2, yc, zc], 0.3, PD, 1, 14); tube([x0 + 0.02, yc, zc], [x0 - 0.02, yc, zc], 0.32, C.under, 0, 14);
    for (const yy of [-cs * 0.2 * W, -cs * 0.27 * W]) {
      const xs = xBF + 0.14;
      tube([xs, yy, deck - 0.05], [xs, yy, deck + 1.65], 0.13, C.under, 0, 10);
      tube([xs, yy, deck + 1.65], [xs + 0.25, yy, deck + 1.8], 0.13, C.under, 0, 10);
    }
  }
  const KC = new Kit(), KI = new Kit();
  // ── operator cab (raised on the eye side), framed windows
  {
    const ct = cabRoof - 0.1, rk = 0.2, hC = ct - deck, xFt = cabF - rk;
    const yA = Math.min(yCi, yCo), yB = Math.max(yCi, yCo);
    KC.hexa([[cabR, yA, deck], [cabF, yA, deck], [cabR, yB, deck], [cabF, yB, deck], [cabR, yA + 0.03, ct], [xFt, yA + 0.03, ct], [cabR, yB - 0.03, ct], [xFt, yB - 0.03, ct]], P, 1);
    KC.box(cabR - 0.05, xFt + 0.06, yA - 0.04, yB + 0.04, ct, cabRoof, PL, 1);
    const zs = deck + 0.78, zt2 = ct - 0.12, xAt = (z: number) => cabF - (rk * (z - deck)) / hC;
    const nF: V3 = [hC / Math.hypot(hC, rk), 0, rk / Math.hypot(hC, rk)];
    const fp = (y: number, z: number, o: number): V3 => [xAt(z) + nF[0] * o, y, z + nF[2] * o];
    KC.face([fp(yA + 0.1, zs - 0.05, 0.025), fp(yB - 0.1, zs - 0.05, 0.025), fp(yB - 0.1, zt2 + 0.05, 0.025), fp(yA + 0.1, zt2 + 0.05, 0.025)], C.seal, 0, null, nF);
    KC.face([fp(yA + 0.16, zs, 0.045), fp(yB - 0.16, zs, 0.045), fp(yB - 0.16, zt2, 0.045), fp(yA + 0.16, zt2, 0.045)], C.glass, 0, null, nF);
    const xm = cabR + (cabF - cabR) * 0.52;
    for (const outerSide of [1, -1]) {
      const yb = outerSide > 0 ? yB : yA, nn: V3 = [0, outerSide, 0];
      const sq = (pts: [number, number][], o: number, c: RGB) => KC.face(pts.map(([x, z]) => [x, yb + outerSide * o, z] as V3), c, 0, null, nn);
      sq([[cabR + 0.07, zs - 0.05], [xAt(zs - 0.05) - 0.07, zs - 0.05], [xAt(zt2 + 0.05) - 0.07, zt2 + 0.05], [cabR + 0.07, zt2 + 0.05]], 0.025, C.seal);
      sq([[cabR + 0.13, zs], [xm - 0.05, zs], [xm - 0.05, zt2], [cabR + 0.13, zt2]], 0.045, C.glass);
      sq([[xm + 0.07, zs], [xAt(zs) - 0.13, zs], [xAt(zt2) - 0.13, zt2], [xm + 0.07, zt2]], 0.045, C.glass);
    }
    KC.face([[cabR - 0.025, yA + 0.15, deck + 0.95], [cabR - 0.025, yB - 0.15, deck + 0.95], [cabR - 0.025, yB - 0.15, zt2 + 0.05], [cabR - 0.025, yA + 0.15, zt2 + 0.05]], C.seal, 0, null, [-1, 0, 0]);
    KC.face([[cabR - 0.045, yA + 0.22, deck + 1.0], [cabR - 0.045, yB - 0.22, deck + 1.0], [cabR - 0.045, yB - 0.22, zt2], [cabR - 0.045, yA + 0.22, zt2]], C.glass, 0, null, [-1, 0, 0]);
    // the cab seen from the driver's seat (POV): interior shell with openings for the glass
    cabInterior(KI, { ex, eyR, ez: ezR, cs, deck, cabF, cabR, rk, ct, yA, yB, zs, paint: P });
    // beacon on the cab roof
    KC.tube([cabR + 0.4, (yA + yB) / 2, cabRoof], [cabR + 0.4, (yA + yB) / 2, cabRoof + 0.22], 0.09, C.amber, 0, 8);
  }

  // ── dump body (separate part: tips about the rear hinge)
  const T = new Kit();
  const hwB = hw - 0.1, tW = 0.14, zsb = D + 0.22, zFl0 = 0.74 * D, yFl = Math.max(0.3, yRinF - 0.12), lb = xBF + L, tailLen = 0.22 * lb, xa = xBF - 0.2;
  const xs1 = xBF - 0.3 * lb, zMid = 0.8 * H, zTail = 0.75 * H;
  const sst = (t: number) => t * t * (3 - 2 * t);
  const zTop = (x: number) => (x >= xs1 ? zMid + (canBot - zMid) * sst(Math.min(1, (x - xs1) / (xa - xs1))) : zTail + ((zMid - zTail) * (x + L)) / (xs1 + L));
  const uT = (x: number) => Math.max(0, Math.min(1, (-L + tailLen - x) / tailLen));
  const zFl = (x: number) => zFl0 + uT(x) * (zsb - 0.3 - zFl0), zIn = (x: number) => zsb + 0.1 + uT(x) * 0.35;
  const xsB: number[] = [];
  for (let i = 0; i <= 6; i++) xsB.push(-L + (tailLen * i) / 6);
  for (let i = 1; i <= 6; i++) xsB.push(-L + tailLen + ((xs1 + L - tailLen) * i) / 6);
  for (let i = 1; i <= 10; i++) xsB.push(xs1 + ((xa - xs1) * i) / 10);
  const keel = (x: number, zt: number, zf: number): V3[] => [[x, hwB, zt], [x, hwB, zsb], [x, yFl + 0.07, zsb], [x, yFl, zf], [x, -yFl, zf], [x, -yFl - 0.07, zsb], [x, -hwB, zsb], [x, -hwB, zt]];
  T.loft(xsB.map(x => keel(x, zIn(x), zFl(x))), PD, 1);
  T.loft([keel(xa, canBot, zFl0), keel(xBF, canBot, zFl0)], P, 1);
  for (const yy of [-0.38 * W, -0.05 * W, 0.14 * W]) T.box(xBF, xBF + 0.09, yy - 0.08, yy + 0.08, zsb, canBot, PL, 1);
  // body liner (inside floor), darker so the heap reads
  T.loft(xsB.slice(0, -1).map(x => [[x, hwB - tW - 0.01, zIn(x) + 0.01], [x, yFl, zFl(x) + 0.02], [x, -yFl, zFl(x) + 0.02], [x, -hwB + tW + 0.01, zIn(x) + 0.01]] as V3[]), shade(C.liner, 1), 0, false, false);
  for (const sd of [1, -1]) {
    T.loft(xsB.map(x => [[x, sd * hwB, zIn(x)], [x, sd * hwB, zTop(x)], [x, sd * (hwB - tW), zTop(x)], [x, sd * (hwB - tW), zIn(x)]] as V3[]), P, 1);
    T.loft(xsB.map(x => [[x, sd * (hw - 0.03), zTop(x) - 0.2], [x, sd * (hw - 0.03), zTop(x) + 0.04], [x, sd * (hwB - tW - 0.04), zTop(x) + 0.04], [x, sd * (hwB - tW - 0.04), zTop(x) - 0.2]] as V3[]), PL, 1);
    T.loft(xsB.map(x => [[x, sd * (hw - 0.035), zsb - 0.1], [x, sd * (hw - 0.035), zsb + 0.1], [x, sd * (hwB - 0.02), zsb + 0.1], [x, sd * (hwB - 0.02), zsb - 0.1]] as V3[]), PD, 1);
    const xr0 = -L + 0.45, xr1 = xBF - 0.5, nR = Math.max(4, Math.round((xr1 - xr0) / 1.05));
    for (let i = 0; i <= nR; i++) {
      const x = xr0 + ((xr1 - xr0) * i) / nR, zt = zTop(x) - 0.15, zb = zsb + 0.1, yi = sd * (hwB - 0.01), yo = sd * (hw - 0.045);
      T.hexa([[x - 0.11, yi, zb], [x + 0.11, yi, zb], [x - 0.07, yo, zb], [x + 0.07, yo, zb], [x - 0.11, yi, zt], [x + 0.11, yi, zt], [x - 0.07, yo, zt], [x + 0.07, yo, zt]], PL, 1);
    }
    box(xr - r - 0.16, xr - r - 0.12, sd * (yRinF - 0.03), sd * (0.86 * hw + 0.03), 0.5 * D, zsb - 0.01, C.rubber);
    T.box(-L + tailLen * 0.6, xa, sd * 0.1 * W, sd * 0.16 * W, zFl0 - 0.09, zFl0 + 0.01, PD, 1);
  }
  {
    const yC = hw - 0.005;
    T.hexa([[xa, -yC, canBot], [xCF, -yC, canBot + 0.06], [xa, yC, canBot], [xCF, yC, canBot + 0.06], [xa, -yC, H - 0.06], [xCF, -yC, H], [xa, yC, H - 0.06], [xCF, yC, H]], P, 1);
    T.box(xCF - 0.18, xCF - 0.012, -yC + 0.01, yC - 0.01, canBot - 0.16, canBot + 0.1, PL, 1);
    for (const sd of [1, -1]) T.box(xa, xCF - 0.012, sd * (hw - 0.015), sd * (hw - 0.16), canBot - 0.14, canBot + 0.04, PL, 1);
    for (const sd of [1, -1]) T.box(xCF - 0.03, xCF - 0.005, sd * (yC - 0.35), sd * (yC - 0.12), canBot - 0.1, canBot + 0.02, C.amber);
  }

  // ── load heap (material colour, rides the tray)
  const Lh = new Kit();
  {
    const nx = 14, ny = 9;
    const x0 = -L + tailLen * 0.55, x1 = xa - 0.25;
    const peak = Math.min(zMid + 0.7, canBot - 0.1);
    const rnd = (i: number, j: number) => { const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453; return s - Math.floor(s); };
    const S: V3[][] = [];
    for (let i = 0; i <= nx; i++) {
      const u = i / nx, x = x0 + (x1 - x0) * u;
      const along = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.55;
      const sec: V3[] = [];
      const half = hwB - tW - 0.05;
      sec.push([x, half, zIn(x) + 0.05]);
      for (let j = 1; j < ny; j++) {
        const v = -1 + (2 * j) / ny, y = -v * half;
        const dome = Math.max(0, 1 - v * v) ** 0.7;
        const jit = (rnd(i, j) - 0.5) * 0.28 * dome * along;
        const zb = Math.max(zIn(x), zFl(x) + 0.2);
        sec.push([x, y, zb + (peak - zb) * dome * along + jit]);
      }
      sec.push([x, -half, zIn(x) + 0.05]);
      sec.push([x, -yFl, zFl(x) + 0.05]);
      sec.push([x, yFl, zFl(x) + 0.05]);
      S.push(sec);
    }
    Lh.loft(S, P, 1);
  }

  const origin: V3 = [-0.47 * L, 0, 0];
  const WH = new Kit(), WL = new Kit();
  wheel(WH, r, tw, rb, 'hi', C.rim, C.hub, true);
  wheel(WL, r, tw, rb, 'lo', C.rim, C.hub, true);
  const wheels: WheelSpot[] = [];
  const toLocal = (x: number, y: number, z: number): [number, number, number] => [x - origin[0], z, -y];
  for (const sd of [1, -1] as const) {
    const a = toLocal(xf, sd * yF, r), b = toLocal(xr, sd * yR1, r), c = toLocal(xr, sd * yR2, r);
    wheels.push({ x: a[0], y: a[1], z: a[2], r, side: sd }, { x: b[0], y: b[1], z: b[2], r, side: sd }, { x: c[0], y: c[1], z: c[2], r, side: sd });
  }
  const hingeV = toLocal(-0.92 * L, 0, zFl0 - 0.05);
  const eyeL = toLocal(ex, eyR, ezR);
  const mirrors = mirrorHeads.map(m => ({ pos: toLocal(m[0], m[1], m[2]), w: 0.2, h: 0.52, outward: (m[1] >= 0 ? -1 : 1) as 1 | -1 }));
  const lamps = {
    head: [1, -1].flatMap(sd => [-0.2, 0.2].map(dy => toLocal(xDF + 0.05, sd * 0.36 * W + dy, deck - 0.51))),
    tail: [1, -1].map(sd => toLocal(-0.96 * L, sd * 0.12 * W, 0.63 * D)),
  };
  const bodyNoCab = K.build(origin);
  K.append(KC);
  return {
    body: K.build(origin), bodyNoCab, cabInterior: KI.build(origin), tray: T.build(origin), load: Lh.build(origin), wheelHi: WH.build(), wheelLo: WL.build(),
    wheels, hinge: [hingeV[0], hingeV[1]], L, W, H, D, wheelbase: 0.47 * L, frontX: 0.47 * L, frontAxleX: 0.235 * L,
    eye: eyeL, cabSide: cs, mirrors, lamps,
  };
}
