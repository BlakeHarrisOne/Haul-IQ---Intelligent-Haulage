/**
 * Loading and support machines as small articulated hierarchies (few of them on site, so plain meshes):
 *  - hydraulic excavator (backhoe): tracks, carbody, house + counterweight + cab (swings), boom → stick → bucket
 *  - wheel loader: front frame + lift arms + bucket, rear frame with cab and engine (rocks through a V-cycle)
 *  - track dozer: tracks, hood, cab, ripper, blade (pushes at the dump)
 * Built in the vehicle frame with the kit (x forward, y left, z up) and baked to vertex colours.
 */
import * as THREE from 'three';
import { Kit, shade, machineMaterial, type RGB, type V3 } from './kit';
import { C } from './vehicle';

export const MAKE_PAINT: Record<string, string> = {
  hitachi: '#E2731E', komatsu: '#E7AE1C', liebherr: '#E9C31B', caterpillar: '#E3A21B', cat: '#E3A21B', default: '#E3A21B',
};

function bake(k: Kit, paint: RGB): THREE.BufferGeometry {
  for (let i = 0; i < k.paint.length; i++) {
    if (k.paint[i] > 0) { k.col[3 * i] *= paint[0]; k.col[3 * i + 1] *= paint[1]; k.col[3 * i + 2] *= paint[2]; k.paint[i] = 0; }
  }
  return k.build();
}

const PP: RGB = [1, 1, 1], PDk: RGB = [0.72, 0.72, 0.72], PLt: RGB = [1.08, 1.08, 1.08];

/** Track frame + belt (stadium profile) with grousers and rollers, centred on y = yc. */
function track(K: Kit, len: number, wid: number, hgt: number, yc: number) {
  const r = hgt / 2, x0 = -len / 2 + r, x1 = len / 2 - r;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI; prof.push([x0 + r * Math.cos(a), r + r * Math.sin(a)]); }
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; prof.push([x1 + r * Math.cos(a), r + r * Math.sin(a)]); }
  const sec = (y: number): V3[] => prof.map(([x, z]) => [x, y, z] as V3);
  K.loft([sec(yc - wid / 2), sec(yc + wid / 2)], C.tread);
  // grousers on the top and bottom runs
  const n = Math.round((x1 - x0) / 0.42);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    K.box(x - 0.08, x + 0.08, yc - wid / 2 - 0.01, yc + wid / 2 + 0.01, hgt - 0.01, hgt + 0.07, C.rubber);
    K.box(x - 0.08, x + 0.08, yc - wid / 2 - 0.01, yc + wid / 2 + 0.01, -0.06, 0.01, C.rubber);
  }
  // side frame + rollers
  K.box(x0 - 0.2, x1 + 0.2, yc - wid * 0.38, yc + wid * 0.38, r * 0.5, hgt - 0.22, C.frame);
  for (const x of [x0, x1]) K.tube([x, yc - wid / 2 - 0.05, r], [x, yc + wid / 2 + 0.05, r], r * 0.62, C.under, 0, 14);
  const nr = 6;
  for (let i = 1; i < nr; i++) { const x = x0 + ((x1 - x0) * i) / nr; K.tube([x, yc - wid * 0.42, 0.42], [x, yc + wid * 0.42, 0.42], 0.3, C.steel, 0, 10); }
}

export interface ExcavatorRig {
  root: THREE.Group;
  house: THREE.Group;
  boom: THREE.Group;
  stick: THREE.Group;
  bucket: THREE.Group;
  scale: number;
  /** Reach geometry (m) for placing the machine beside the truck. */
  boomLen: number;
  stickLen: number;
  pivot: [number, number];
  dispose(): void;
}

export function buildExcavator(paintHex: string, operatingMassT = 550): ExcavatorRig {
  const s = Math.max(0.55, Math.min(1.25, Math.cbrt(operatingMassT / 550)));
  const paint = new THREE.Color(paintHex);
  const pc: RGB = [paint.r, paint.g, paint.b];
  const mat = machineMaterial();
  const mk = (k: Kit) => { const m = new THREE.Mesh(bake(k, pc), mat); m.castShadow = true; return m; };

  // undercarriage
  const U = new Kit();
  const tl = 9.6 * s, tw = 1.6 * s, th = 2.0 * s, gauge = 6.0 * s;
  track(U, tl, tw, th, gauge / 2);
  track(U, tl, tw, th, -gauge / 2);
  U.box(-1.6 * s, 1.6 * s, -gauge / 2 + tw * 0.4, gauge / 2 - tw * 0.4, th * 0.55, th * 0.95, C.frame);
  U.tube([0, 0, th * 0.9], [0, 0, th + 0.55 * s], 1.6 * s, C.under, 0, 20);
  U.box(-1.9 * s, 1.9 * s, -1.6 * s, 1.6 * s, th * 0.7, th + 0.2 * s, PDk, 1);

  // house (swing centre at the local origin, z = 0 at the swing ring top)
  const Hk = new Kit();
  const hz0 = 0, hz1 = 2.6 * s, hx0 = -4.3 * s, hx1 = 2.4 * s, hy = 3.3 * s;
  Hk.box(hx0, hx1, -hy, hy, hz0, hz1, PP, 1);
  Hk.box(hx0 + 0.2, hx1 - 0.2, -hy + 0.2, hy - 0.2, hz1, hz1 + 0.08, PDk, 1);
  // engine room louvres
  for (let i = 0; i < 6; i++) { const x = hx0 + 1.2 * s + i * 0.55 * s; Hk.box(x, x + 0.28 * s, -hy - 0.02, -hy + 0.05, 0.7 * s, 2.0 * s, C.grille); Hk.box(x, x + 0.28 * s, hy - 0.05, hy + 0.02, 0.7 * s, 2.0 * s, C.grille); }
  // counterweight (rounded rear)
  {
    const S: V3[][] = [];
    const prof = (x: number, k: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; out.push([x, Math.sin(a) * hy * k, 0.1 * s + 2.3 * s * (0.5 + 0.5 * Math.cos(a)) ** 0.2]); }
      out.push([x, hy * k, -0.05 * s]); out.push([x, -hy * k, -0.05 * s]);
      return out;
    };
    S.push(prof(hx0 + 0.05, 1.0), prof(hx0 - 0.9 * s, 0.97), prof(hx0 - 1.35 * s, 0.85));
    Hk.loft(S, PDk, 1);
  }
  // cab (front left) with glass
  {
    const cx0 = 0.4 * s, cx1 = 2.3 * s, cy0 = 1.3 * s, cy1 = 3.2 * s, cz0 = hz1 + 1.4 * s, cz1 = cz0 + 2.3 * s;
    Hk.box(cx0, cx1, cy0, cy1, hz1, cz0, PDk, 1);
    Hk.box(cx0, cx1, cy0, cy1, cz0, cz1, PLt, 1);
    Hk.box(cx0 - 0.05, cx1 + 0.08, cy0 - 0.05, cy1 + 0.05, cz1, cz1 + 0.12 * s, PP, 1);
    Hk.face([[cx1 + 0.02, cy0 + 0.12, cz0 + 0.25], [cx1 + 0.02, cy1 - 0.12, cz0 + 0.25], [cx1 + 0.02, cy1 - 0.12, cz1 - 0.15], [cx1 + 0.02, cy0 + 0.12, cz1 - 0.15]], C.glass, 0, null, [1, 0, 0]);
    Hk.face([[cx0 + 0.15, cy1 + 0.02, cz0 + 0.3], [cx1 - 0.15, cy1 + 0.02, cz0 + 0.3], [cx1 - 0.15, cy1 + 0.02, cz1 - 0.15], [cx0 + 0.15, cy1 + 0.02, cz1 - 0.15]], C.glass, 0, null, [0, 1, 0]);
    Hk.face([[cx0 + 0.15, cy0 - 0.02, cz0 + 0.3], [cx1 - 0.15, cy0 - 0.02, cz0 + 0.3], [cx1 - 0.15, cy0 - 0.02, cz1 - 0.15], [cx0 + 0.15, cy0 - 0.02, cz1 - 0.15]], C.glass, 0, null, [0, -1, 0]);
    // walkway + rails
    Hk.box(hx0 + 0.6, hx1, hy, hy + 0.7 * s, hz1 - 0.12, hz1, C.steel);
    for (let x = hx0 + 0.8; x < hx1; x += 1.4 * s) Hk.tube([x, hy + 0.65 * s, hz1], [x, hy + 0.65 * s, hz1 + 1.05], 0.035, C.amber, 0, 6);
    Hk.tube([hx0 + 0.8, hy + 0.65 * s, hz1 + 1.05], [hx1 - 0.1, hy + 0.65 * s, hz1 + 1.05], 0.04, C.amber, 0, 6);
  }
  // exhaust stacks + radiator top
  for (const y of [-1.2 * s, -1.8 * s]) Hk.tube([hx0 + 1.2 * s, y, hz1], [hx0 + 1.2 * s, y, hz1 + 1.0 * s], 0.16 * s, C.under, 0, 10);
  Hk.box(hx0 + 2.2 * s, hx0 + 4.2 * s, -hy + 0.4, 0.4, hz1, hz1 + 0.5 * s, PDk, 1);
  // boom foot housing
  Hk.box(hx1 - 0.6 * s, hx1 + 0.5 * s, -0.9 * s, 0.9 * s, 0.2 * s, 1.9 * s, PDk, 1);

  // boom (pivot at its local origin, arched, tip at (Lb, 0))
  const Lb = 9.4 * s, Ls = 4.9 * s, Lk = 2.6 * s;
  const Bk = new Kit();
  {
    const mid: V3 = [0.48 * Lb, 0, 0.16 * Lb], tip: V3 = [Lb, 0, 0];
    const sec = (p: V3, w: number, h: number, dir: V3): V3[] => {
      const n: V3 = [-dir[2], 0, dir[0]];
      return [[p[0] + n[0] * h, w, p[2] + n[2] * h], [p[0] + n[0] * h, -w, p[2] + n[2] * h], [p[0] - n[0] * h, -w, p[2] - n[2] * h], [p[0] - n[0] * h, w, p[2] - n[2] * h]];
    };
    const l1 = Math.hypot(mid[0], mid[2]);
    const d1: V3 = [mid[0] / l1, 0, mid[2] / l1];
    const d2v: V3 = [tip[0] - mid[0], 0, tip[2] - mid[2]], l2 = Math.hypot(d2v[0], d2v[2]);
    const d2: V3 = [d2v[0] / l2, 0, d2v[2] / l2];
    const dm: V3 = [(d1[0] + d2[0]) / 2, 0, (d1[2] + d2[2]) / 2];
    Bk.loft([sec([0, 0, 0], 0.75 * s, 0.6 * s, d1), sec(mid, 0.62 * s, 0.85 * s, dm), sec(tip, 0.45 * s, 0.45 * s, d2)], PP, 1);
    Bk.tube([0, -0.85 * s, 0], [0, 0.85 * s, 0], 0.35 * s, C.steel, 0, 12);
    Bk.tube([Lb, -0.6 * s, 0], [Lb, 0.6 * s, 0], 0.3 * s, C.steel, 0, 12);
    // boom cylinders (fixed relative to the boom - reads at site scale)
    for (const y of [0.85 * s, -0.85 * s]) {
      Bk.tube([0.6 * s, y, -1.9 * s], [0.42 * Lb, y, 0.05 * Lb], 0.26 * s, C.chrome, 0, 10);
      Bk.tube([0.6 * s, y, -1.9 * s], [0.25 * Lb, y, -0.02 * Lb], 0.34 * s, PDk, 1, 10);
    }
    Bk.tube([0.55 * Lb, 0, 0.2 * Lb + 0.4 * s], [0.95 * Lb, 0, 0.12 * Lb], 0.24 * s, C.chrome, 0, 10);
    Bk.tube([0.55 * Lb, 0, 0.2 * Lb + 0.4 * s], [0.78 * Lb, 0, 0.17 * Lb], 0.32 * s, PDk, 1, 10);
  }
  const Sk = new Kit();
  {
    Sk.loft([
      [[-0.6 * s, 0.42 * s, 0.6 * s], [-0.6 * s, -0.42 * s, 0.6 * s], [-0.6 * s, -0.42 * s, -0.45 * s], [-0.6 * s, 0.42 * s, -0.45 * s]],
      [[Ls, 0.36 * s, 0.32 * s], [Ls, -0.36 * s, 0.32 * s], [Ls, -0.36 * s, -0.3 * s], [Ls, 0.36 * s, -0.3 * s]],
    ] as V3[][], PP, 1);
    Sk.tube([0, 0, 0.75 * s], [0.8 * Ls, 0, 0.55 * s], 0.2 * s, C.chrome, 0, 10);
    Sk.tube([-0.5 * s, 0, 0.85 * s], [0.45 * Ls, 0, 0.65 * s], 0.28 * s, PDk, 1, 10);
    Sk.tube([Ls, -0.45 * s, 0], [Ls, 0.45 * s, 0], 0.24 * s, C.steel, 0, 10);
  }
  const Kb = new Kit();
  {
    // open bucket: back plate curve + floor + sides, teeth at the lip; opening faces local −z at rest
    const bw = 1.75 * s, hl = Lk;
    const curve: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 0.85; curve.push([0.15 * hl + Math.sin(a) * 0.75 * hl, 0.55 * hl - Math.cos(a) * 0.55 * hl - 0.55 * hl]); }
    const sec = (y: number) => curve.map(([x, z]) => [x, y, z] as V3);
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      Kb.face([[a[0], -bw, a[1]], [b[0], -bw, b[1]], [b[0], bw, b[1]], [a[0], bw, a[1]]], C.under, 0, [0.5 * hl, 0, -0.6 * hl]);
    }
    for (const y of [-bw, bw]) Kb.face(sec(y), PDk, 1, null, [0, Math.sign(y), 0]);
    const lip = curve[curve.length - 1];
    for (let i = 0; i < 6; i++) {
      const y = -bw + 0.25 * s + (i * (2 * bw - 0.5 * s)) / 5;
      Kb.obox([lip[0] - 0.1 * s, y, lip[1] - 0.3 * s], [0, 0, -1], [0, 1, 0], [1, 0, 0], 0.32 * s, 0.11 * s, 0.09 * s, C.steel);
    }
    Kb.tube([0, -0.5 * s, 0], [0, 0.5 * s, 0], 0.26 * s, C.steel, 0, 10);
    Kb.box(-0.1 * s, 0.5 * s, -0.45 * s, 0.45 * s, -0.1 * s, 0.5 * s, PDk, 1);
  }

  const root = new THREE.Group(); root.name = 'excavator';
  const house = new THREE.Group(); house.position.y = th + 0.55 * s;
  const boom = new THREE.Group(); boom.position.set(hx1, 1.4 * s, 0);
  const stick = new THREE.Group(); stick.position.set(Lb, 0, 0);
  const bucket = new THREE.Group(); bucket.position.set(Ls, 0, 0);
  root.add(mk(U)); root.add(house); house.add(mk(Hk)); house.add(boom); boom.add(mk(Bk)); boom.add(stick); stick.add(mk(Sk)); stick.add(bucket); bucket.add(mk(Kb));
  return {
    root, house, boom, stick, bucket, scale: s, boomLen: Lb, stickLen: Ls, pivot: [hx1, th + 0.55 * s + 1.4 * s],
    dispose() { root.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); mat.dispose(); },
  };
}

export interface ExcavatorPose { swing: number; boom: number; stick: number; bucket: number }

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const deg = Math.PI / 180;

/**
 * One loading pass, u ∈ [0, 1): dig (curl through the face) → raise + swing to the truck → dump → swing back + lower.
 * Angles are joint angles (rad): boom from horizontal, stick relative to the boom, bucket relative to the stick.
 */
export function excavatorPass(u: number, faceYaw: number, truckYaw: number): ExcavatorPose {
  const dig = { boom: 2 * deg, stick: -112 * deg, bucket: -35 * deg };
  const curl = { boom: 12 * deg, stick: -62 * deg, bucket: 70 * deg };
  const carry = { boom: 36 * deg, stick: -78 * deg, bucket: 62 * deg };
  const dump = { boom: 38 * deg, stick: -52 * deg, bucket: -55 * deg };
  const dyaw = ((truckYaw - faceYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (u < 0.3) {
    const e = ease(u / 0.3);
    return { swing: faceYaw, boom: lerp(dig.boom, curl.boom, e), stick: lerp(dig.stick, curl.stick, e), bucket: lerp(dig.bucket, curl.bucket, e) };
  }
  if (u < 0.52) {
    const e = ease((u - 0.3) / 0.22);
    return { swing: faceYaw + dyaw * e, boom: lerp(curl.boom, carry.boom, Math.min(1, e * 1.4)), stick: lerp(curl.stick, carry.stick, e), bucket: lerp(curl.bucket, carry.bucket, e) };
  }
  if (u < 0.64) {
    const e = ease((u - 0.52) / 0.12);
    return { swing: truckYaw, boom: lerp(carry.boom, dump.boom, e), stick: lerp(carry.stick, dump.stick, e), bucket: lerp(carry.bucket, dump.bucket, e) };
  }
  const e = ease((u - 0.64) / 0.36);
  return { swing: truckYaw - dyaw * e, boom: lerp(dump.boom, dig.boom, ease(Math.max(0, e * 1.2 - 0.2))), stick: lerp(dump.stick, dig.stick, e), bucket: lerp(dump.bucket, dig.bucket, e) };
}

export function idleExcavatorPose(faceYaw: number, t: number): ExcavatorPose {
  const w = Math.sin(t * 0.4) * 0.5 + 0.5;
  return { swing: faceYaw, boom: lerp(4, 9, w) * deg, stick: lerp(-104, -96, w) * deg, bucket: lerp(-20, 5, w) * deg };
}

export function applyExcavatorPose(rig: ExcavatorRig, p: ExcavatorPose, rootYaw: number) {
  rig.house.rotation.y = p.swing - rootYaw;
  rig.boom.rotation.z = p.boom;
  rig.stick.rotation.z = p.stick;
  rig.bucket.rotation.z = p.bucket;
}

// ── wheel loader ──────────────────────────────────────────────────────────────────────
export interface LoaderRig {
  root: THREE.Group;
  front: THREE.Group;
  arms: THREE.Group;
  bucket: THREE.Group;
  wheels: THREE.Object3D[];
  wheelR: number;
  dispose(): void;
}

export function buildWheelLoader(paintHex: string): LoaderRig {
  const paint = new THREE.Color(paintHex);
  const pc: RGB = [paint.r, paint.g, paint.b];
  const mat = machineMaterial();
  const mk = (k: Kit) => { const m = new THREE.Mesh(bake(k, pc), mat); m.castShadow = true; return m; };
  const r = 1.3, W = 4.6, hw = W / 2;
  // rear frame (engine, cab) - origin at the articulation
  const R = new Kit();
  R.box(-6.4, -0.2, -1.2, 1.2, 1.0, 2.2, PDk, 1);
  R.box(-6.6, -3.6, -1.6, 1.6, 2.0, 3.6, PP, 1);
  R.box(-6.9, -6.4, -1.7, 1.7, 1.0, 3.2, PDk, 1);
  for (let i = 0; i < 5; i++) R.box(-6.92, -6.88, -1.4, 1.4, 1.4 + i * 0.32, 1.55 + i * 0.32, C.grille);
  R.box(-3.6, -1.0, -1.5, 1.5, 2.2, 3.0, PP, 1);
  R.box(-3.3, -1.3, -1.25, 1.25, 3.0, 5.2, PLt, 1);
  R.box(-3.4, -1.2, -1.35, 1.35, 5.2, 5.38, PP, 1);
  R.face([[-1.28, -1.1, 3.4], [-1.28, 1.1, 3.4], [-1.28, 1.1, 5.0], [-1.28, -1.1, 5.0]], C.glass, 0, null, [1, 0, 0]);
  for (const sd of [1, -1]) R.face([[-3.1, sd * 1.27, 3.4], [-1.5, sd * 1.27, 3.4], [-1.5, sd * 1.27, 5.0], [-3.1, sd * 1.27, 5.0]], C.glass, 0, null, [0, sd, 0]);
  for (const sd of [1, -1]) R.arcBand(-4.6, r, r + 0.08, r + 0.2, sd * (hw - 0.85), sd * (hw + 0.05), 0.1, Math.PI - 0.1, 10, PP, 1);
  R.tube([-5.6, -0.8, 3.6], [-5.6, -0.8, 4.4], 0.12, C.under, 0, 8);
  // front frame
  const F = new Kit();
  F.box(0.2, 3.2, -1.0, 1.0, 1.0, 2.2, PDk, 1);
  for (const sd of [1, -1]) F.arcBand(1.6, r, r + 0.08, r + 0.2, sd * (hw - 0.85), sd * (hw + 0.05), 0.1, Math.PI - 0.1, 10, PP, 1);
  // arms (pivot at local origin of `arms`)
  const A = new Kit();
  for (const sd of [1, -1]) A.beam([0, sd * 0.9, 0], [3.4, sd * 0.9, -0.9], 0.3, 0.55, PP, 1);
  A.beam([1.6, -0.9, -0.5], [1.6, 0.9, -0.5], 0.3, 0.4, PP, 1);
  for (const sd of [1, -1]) A.tube([-0.4, sd * 1.05, -1.5], [1.7, sd * 1.05, -0.4], 0.14, C.chrome, 0, 8);
  const B = new Kit();
  {
    const bw = 2.5;
    const curve: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 0.8; curve.push([0.3 - Math.sin(a) * -1.2 + 0.0, 0.9 - Math.cos(a) * 1.0 - 0.9]); }
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      B.face([[a[0], -bw, a[1]], [b[0], -bw, b[1]], [b[0], bw, b[1]], [a[0], bw, a[1]]], C.under, 0, [0.6, 0, 0.2]);
    }
    for (const y of [-bw, bw]) B.face(curve.map(([x, z]) => [x, y, z] as V3), PDk, 1, null, [0, Math.sign(y), 0]);
    B.box(1.2, 1.6, -bw, bw, -1.0, -0.88, C.steel);
  }
  const wheelKit = new Kit();
  {
    const prof: [number, number][] = [[0.55 * r, -0.36], [0.95 * r, -0.4], [r, -0.3], [r, 0.3], [0.95 * r, 0.4], [0.55 * r, 0.36]];
    wheelKit.revolve([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], prof, C.rubber, 0, 22);
    wheelKit.revolve([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], [[0.55 * r, 0.3], [0, 0.3]], C.rim, 0, 16);
    for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; wheelKit.obox([Math.cos(t) * r * 0.99, 0, Math.sin(t) * r * 0.99], [-Math.sin(t), 0, Math.cos(t)], [0, 1, 0], [Math.cos(t), 0, Math.sin(t)], 0.12, 0.38, 0.06, C.tread); }
  }
  const wheelGeo = bake(wheelKit, pc);
  const root = new THREE.Group(); root.name = 'wheel-loader';
  const rear = mk(R);
  const front = new THREE.Group();
  front.add(mk(F));
  const arms = new THREE.Group(); arms.position.set(0.8, 3.6, 0);
  const bucket = new THREE.Group(); bucket.position.set(3.4, -0.9, 0);
  arms.add(mk(A)); arms.add(bucket); bucket.add(mk(B));
  front.add(arms);
  root.add(rear, front);
  const wheels: THREE.Object3D[] = [];
  for (const [x, parent] of [[1.6, front], [-4.6, root]] as [number, THREE.Object3D][]) for (const sd of [1, -1]) {
    const w = new THREE.Mesh(wheelGeo, mat); w.castShadow = true;
    w.position.set(x, r, -sd * (hw - 0.4));
    if (sd < 0) w.rotation.y = Math.PI;
    parent.add(w); wheels.push(w);
  }
  return { root, front, arms, bucket, wheels, wheelR: r, dispose() { root.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); mat.dispose(); } };
}

// ── track dozer ───────────────────────────────────────────────────────────────────────
export interface DozerRig { root: THREE.Group; blade: THREE.Group; dispose(): void }

export function buildDozer(paintHex: string): DozerRig {
  const paint = new THREE.Color(paintHex);
  const pc: RGB = [paint.r, paint.g, paint.b];
  const mat = machineMaterial();
  const K = new Kit();
  const tl = 4.6, tw = 0.9, th = 1.25, gauge = 2.9;
  track(K, tl, tw, th, gauge / 2);
  track(K, tl, tw, th, -gauge / 2);
  K.box(-2.4, 1.6, -1.15, 1.15, 0.7, 2.3, PDk, 1);
  K.box(-0.6, 2.4, -1.05, 1.05, 2.3, 3.0, PP, 1);
  for (let i = 0; i < 5; i++) K.box(2.4, 2.43, -0.9, 0.9, 1.4 + i * 0.28, 1.55 + i * 0.28, C.grille);
  K.box(-2.3, -0.4, -1.1, 1.1, 2.3, 4.1, PLt, 1);
  K.box(-2.4, -0.3, -1.2, 1.2, 4.1, 4.25, PP, 1);
  K.face([[-0.38, -0.95, 2.7], [-0.38, 0.95, 2.7], [-0.38, 0.95, 3.95], [-0.38, -0.95, 3.95]], C.glass, 0, null, [1, 0, 0]);
  for (const sd of [1, -1]) K.face([[-2.1, sd * 1.12, 2.7], [-0.6, sd * 1.12, 2.7], [-0.6, sd * 1.12, 3.95], [-2.1, sd * 1.12, 3.95]], C.glass, 0, null, [0, sd, 0]);
  K.tube([1.4, 0.5, 3.0], [1.4, 0.5, 3.9], 0.1, C.under, 0, 8);
  // ripper
  K.beam([-2.4, 0, 1.6], [-3.6, 0, 1.4], 0.4, 0.5, PP, 1);
  K.beam([-3.6, 0, 1.6], [-3.9, 0, -0.1], 0.25, 0.4, C.steel);
  // push arms
  for (const sd of [1, -1]) K.beam([-0.6, sd * 1.95, 0.7], [2.9, sd * 1.95, 0.8], 0.25, 0.35, PP, 1);
  const Bk = new Kit();
  {
    const bw = 2.6, curve: [number, number][] = [];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 0.5; curve.push([0.2 - Math.cos(a) * 0.35 + 0.35, Math.sin(a) * 1.7]); }
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      Bk.face([[a[0], -bw, a[1]], [b[0], -bw, b[1]], [b[0], bw, b[1]], [a[0], bw, a[1]]], PP, 1, [-1, 0, 0.8]);
      Bk.face([[a[0] - 0.12, -bw, a[1]], [b[0] - 0.12, -bw, b[1]], [b[0] - 0.12, bw, b[1]], [a[0] - 0.12, bw, a[1]]], PDk, 1, [1, 0, 0.8]);
    }
    Bk.box(0.15, 0.32, -bw, bw, -0.05, 0.1, C.steel);
    for (const y of [-bw, bw]) Bk.box(-0.1, 0.6, y - 0.06, y + 0.06, 0, 1.6, PDk, 1);
  }
  const root = new THREE.Group(); root.name = 'dozer';
  const body = new THREE.Mesh(bake(K, pc), mat); body.castShadow = true;
  const blade = new THREE.Group(); blade.position.set(3.0, 0, 0);
  const bm = new THREE.Mesh(bake(Bk, pc), mat); bm.castShadow = true;
  blade.add(bm);
  root.add(body, blade);
  return { root, blade, dispose() { root.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); mat.dispose(); } };
}

export function paintForMake(make: string | undefined): string {
  const k = (make ?? '').toLowerCase();
  for (const key of Object.keys(MAKE_PAINT)) if (k.includes(key)) return MAKE_PAINT[key];
  return MAKE_PAINT.default;
}

export { shade };
