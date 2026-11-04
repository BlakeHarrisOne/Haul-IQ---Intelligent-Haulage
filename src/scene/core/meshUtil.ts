/**
 * Scene-side mesh helpers (local, allocation-conscious). These mirror '@/geom' conventions so they can be swapped
 * for the geom implementations once its public entry exports them (toLocalFloat32 / computeNormals / capLoops ...).
 *
 * "Local" coordinates here are scene space at vertical exaggeration 1: x = E − E0, y = Z − Z0, z = −(N − N0).
 * Groups that hold these meshes are scaled by (1, VE, 1) so a VE change never rebuilds geometry.
 */
import type { MeshData, Vec3 } from '@/core/types';

export interface LocalMesh {
  positions: Float32Array;
  index: Uint32Array;
  /** Local-space bounds. */
  min: [number, number, number];
  max: [number, number, number];
}

export function toLocal(mesh: MeshData, origin: Vec3): LocalMesh {
  const v = mesh.verts, n = (v.length / 3) | 0;
  const p = new Float32Array(n * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const [e0, n0, z0] = origin;
  for (let i = 0; i < n; i++) {
    const x = v[i * 3] - e0, y = v[i * 3 + 2] - z0, z = -(v[i * 3 + 1] - n0);
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
  }
  return { positions: p, index: mesh.tris instanceof Uint32Array ? mesh.tris : new Uint32Array(mesh.tris), min, max };
}

/** Area-weighted smooth vertex normals. `flipUp` makes the average normal point +y (surfaces from any winding). */
export function smoothNormals(pos: Float32Array, idx: Uint32Array, flipUp = false): Float32Array {
  const nrm = new Float32Array(pos.length);
  let upSum = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    upSum += ny;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  const s = flipUp && upSum < 0 ? -1 : 1;
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] = (nrm[i] / l) * s; nrm[i + 1] = (nrm[i + 1] / l) * s; nrm[i + 2] = (nrm[i + 2] / l) * s;
  }
  return nrm;
}

/** True when triangle winding is mostly clockwise seen from +y (normals would point down). */
export function windsDown(pos: Float32Array, idx: Uint32Array): boolean {
  let s = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    s += (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
  }
  return s < 0;
}

export interface BoundaryEdge { a: number; b: number; ox: number; oz: number }

/**
 * Boundary edges of an open surface (edges used by exactly one triangle), each with its outward horizontal normal
 * (unit, scene xz) — outward = away from the owning triangle's third vertex.
 */
export function boundaryEdges(pos: Float32Array, idx: Uint32Array): BoundaryEdge[] {
  const nV = pos.length / 3;
  const map = new Map<number, number>(); // key → tri*3+edge  (or -1 when shared)
  for (let k = 0; k < idx.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[k + e], b = idx[k + ((e + 1) % 3)];
      const key = a < b ? a * nV + b : b * nV + a;
      const hit = map.get(key);
      if (hit === undefined) map.set(key, k + e);
      else if (hit >= 0) map.set(key, -1);
    }
  }
  const out: BoundaryEdge[] = [];
  for (const v of map.values()) {
    if (v < 0) continue;
    const k = v - (v % 3), e = v % 3;
    const a = idx[k + e], b = idx[k + ((e + 1) % 3)], c = idx[k + ((e + 2) % 3)];
    const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2];
    let ox = bz - az, oz = -(bx - ax);
    const l = Math.hypot(ox, oz) || 1;
    ox /= l; oz /= l;
    if (ox * (pos[c * 3] - ax) + oz * (pos[c * 3 + 2] - az) > 0) { ox = -ox; oz = -oz; }
    out.push({ a, b, ox, oz });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── plane slicing (caps + section cuts)

/** Plane in local space: points with n·p = d. */
export interface LPlane { nx: number; ny: number; nz: number; d: number }

/** Segments where the plane cuts the triangles: flat [x0,y0,z0, x1,y1,z1, ...]. */
export function sliceSegments(pos: Float32Array, idx: Uint32Array, pl: LPlane): Float32Array {
  const out: number[] = [];
  const { nx, ny, nz, d } = pl;
  const sd = (i: number) => pos[i * 3] * nx + pos[i * 3 + 1] * ny + pos[i * 3 + 2] * nz - d;
  const pts: number[] = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < idx.length; k += 3) {
    const ia = idx[k], ib = idx[k + 1], ic = idx[k + 2];
    const da = sd(ia), db = sd(ib), dc = sd(ic);
    if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
    let m = 0;
    const edge = (i: number, j: number, di: number, dj: number) => {
      if ((di > 0) === (dj > 0) || m >= 6) return;
      if (di === dj) return;
      const t = di / (di - dj);
      pts[m++] = pos[i * 3] + (pos[j * 3] - pos[i * 3]) * t;
      pts[m++] = pos[i * 3 + 1] + (pos[j * 3 + 1] - pos[i * 3 + 1]) * t;
      pts[m++] = pos[i * 3 + 2] + (pos[j * 3 + 2] - pos[i * 3 + 2]) * t;
    };
    edge(ia, ib, da, db); edge(ib, ic, db, dc); edge(ic, ia, dc, da);
    if (m === 6) out.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]);
  }
  return new Float32Array(out);
}

