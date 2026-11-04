/**
 * World (site grid E, N, Z) ↔ Three.js scene coordinates.
 * Scene is Y-up and right-handed: x = E − E0, y = Z (× vertical exaggeration), z = −(N − N0).
 * MGA coordinates (~236 000 / 7 051 000) lose precision in float32 GPU buffers, so everything
 * rendered is shifted by the site origin first.
 */
import type { Vec3 } from './types';

export interface Frame { origin: Vec3; vx: number }

export function makeFrame(origin: Vec3, verticalExaggeration = 1): Frame {
  return { origin, vx: verticalExaggeration };
}

export function worldToScene(f: Frame, e: number, n: number, z: number): [number, number, number] {
  return [e - f.origin[0], (z - f.origin[2]) * f.vx, -(n - f.origin[1])];
}

export function sceneToWorld(f: Frame, x: number, y: number, z: number): Vec3 {
  return [x + f.origin[0], -z + f.origin[1], y / f.vx + f.origin[2]];
}

/** A tidy origin for a bounding box: rounded down to 100 m in plan, 0 in Z. */
export function originFor(min: Vec3): Vec3 {
  return [Math.floor(min[0] / 100) * 100, Math.floor(min[1] / 100) * 100, 0];
}
