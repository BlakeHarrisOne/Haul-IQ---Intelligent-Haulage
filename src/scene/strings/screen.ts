/**
 * Fast scene → canvas-pixel projection for screen-space picking and overlay drawing (no allocation per point).
 * Uses the camera's matrices as of the last render.
 */
import * as THREE from 'three';
import type { SceneContext } from '../context';
import { worldToScene } from '@/core/frame';

export interface Projector {
  /** Canvas CSS size. */
  w: number;
  h: number;
  /** Projects scene (x, y, z) into `out` ([x px, y px, depth w]); returns false when behind the camera / outside depth. */
  project(x: number, y: number, z: number, out: Float64Array | number[]): boolean;
  /** World [E, N, Z] → canvas px. */
  projectWorld(e: number, n: number, z: number, out: Float64Array | number[]): boolean;
  /** Metres per CSS pixel at a view depth w (perspective) or constant (orthographic). */
  mppAt(w: number): number;
}

const M = new THREE.Matrix4();

export function makeProjector(ctx: SceneContext): Projector {
  const cam = ctx.camera() as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  cam.updateMatrixWorld();
  M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const e = M.elements.slice();
  const w = ctx.canvas.clientWidth || ctx.canvas.width || 1;
  const h = ctx.canvas.clientHeight || ctx.canvas.height || 1;
  const p11 = Math.abs(cam.projectionMatrix.elements[5]) || 1;
  const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera === true;
  const f = ctx.frame();
  const project = (x: number, y: number, z: number, out: Float64Array | number[]) => {
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (cw <= 1e-6) { out[0] = out[1] = NaN; out[2] = cw; return false; }
    const nx = cx / cw, ny = cy / cw, nz = cz / cw;
    out[0] = (nx * 0.5 + 0.5) * w;
    out[1] = (-ny * 0.5 + 0.5) * h;
    out[2] = cw;
    return nz >= -1.0001 && nz <= 1.0001;
  };
  return {
    w, h, project,
    projectWorld(E, N, Z, out) {
      const s = worldToScene(f, E, N, Z);
      return project(s[0], s[1], s[2], out);
    },
    mppAt(cw: number) { return ortho ? 2 / (p11 * h) : (2 * cw) / (p11 * h); },
  };
}

/** Squared distance from point P to segment AB in 2D, and the parameter t. */
export function distToSeg2(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return [qx * qx + qy * qy, t];
}
