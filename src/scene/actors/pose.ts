/**
 * Vehicle pose on a haul string (pure). The front and rear axles both ride the path ("bicycle on the polyline"), so the
 * heading turns smoothly through bends and the pitch follows the grade without any extra filtering.
 */
import { sampleAt, type PathSample, type PathTable } from '../strings/path';

export interface Pose {
  /** Ground point midway between the axles (world). */
  e: number;
  n: number;
  z: number;
  /** Plan heading (rad, 0 = east, + towards north). */
  heading: number;
  /** Pitch (rad, nose up +), in scene space (includes vertical exaggeration). */
  pitch: number;
  /** Ground point under the front axle (world). */
  fe: number;
  fn: number;
  fz: number;
}

const A: PathSample = { e: 0, n: 0, z: 0, i: 0, t: 0, heading: 0, grade: 0 };
const B: PathSample = { e: 0, n: 0, z: 0, i: 0, t: 0, heading: 0, grade: 0 };

/**
 * @param s        chainage of the midpoint between the axles
 * @param rev      0 = facing the dump (forward), 1 = facing the dig (fractions turn through the left)
 * @param lateral  offset (m), + = right of the forward direction
 * @param wb       wheelbase (m)
 * @param vx       vertical exaggeration of the scene
 */
export function poseOnPath(path: PathTable, s: number, rev: number, lateral: number, wb: number, vx = 1, out?: Pose): Pose {
  const o = out ?? { e: 0, n: 0, z: 0, heading: 0, pitch: 0, fe: 0, fn: 0, fz: 0 };
  const h = Math.max(0.5, wb / 2);
  sampleAt(path, s + h, A);
  sampleAt(path, s - h, B);
  let de = A.e - B.e, dn = A.n - B.n;
  const dz = A.z - B.z;
  let d = Math.hypot(de, dn);
  if (d < 1e-6) { de = Math.cos(A.heading); dn = Math.sin(A.heading); d = 1; }
  const h0 = Math.atan2(dn, de);
  const p0 = Math.atan2(dz * vx, d);
  const heading = h0 + Math.PI * rev;
  const fx = de / d, fy = dn / d;          // forward unit (dig → dump)
  const rx = fy, ry = -fx;                 // right of forward
  o.e = (A.e + B.e) / 2 + rx * lateral;
  o.n = (A.n + B.n) / 2 + ry * lateral;
  o.z = (A.z + B.z) / 2;
  o.heading = wrapAngle(heading);
  o.pitch = p0 * Math.cos(Math.PI * rev);
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const cp = Math.cos(o.pitch);
  o.fe = o.e + ch * h * cp;
  o.fn = o.n + sh * h * cp;
  o.fz = o.z + (Math.sin(o.pitch) * h) / Math.max(1e-6, vx);
  return o;
}

export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  a = ((a % t) + t) % t;
  return a > Math.PI ? a - t : a;
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, u: number): number {
  return a + wrapAngle(b - a) * u;
}

/** Wheelbase and front overhang from the overall length (HRL vehicleGeom proportions: axles at −0.235 L and −0.705 L). */
export function truckProportions(length: number): { wheelbase: number; frontToFrontAxle: number; frontToMid: number } {
  return { wheelbase: 0.47 * length, frontToFrontAxle: 0.235 * length, frontToMid: 0.47 * length };
}
