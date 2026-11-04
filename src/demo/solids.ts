/**
 * Closed "prism" solids over a rectangle: a gridded top surface, a gridded bottom surface and vertical
 * walls round the boundary, wound outward (CCW seen from outside).
 */
import type { MeshData } from '@/core/types';

/**
 * @param x0,y0,x1,y1 footprint (world m), multiples of dx apart
 * @param top,bottom surface heights (m RL) at world (e, n); bottom is kept ≥ minThick below top
 */
export function prismSolid(
  x0: number, y0: number, x1: number, y1: number, dx: number,
  top: (e: number, n: number) => number, bottom: (e: number, n: number) => number, minThick = 0.02,
): MeshData {
  const nx = Math.round((x1 - x0) / dx) + 1, ny = Math.round((y1 - y0) / dx) + 1, n = nx * ny;
  const verts = new Float64Array(n * 6);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, e = x0 + i * dx, nn = y0 + j * dx;
    const zt = top(e, nn), zb = Math.min(bottom(e, nn), zt - minThick);
    verts[k * 3] = e; verts[k * 3 + 1] = nn; verts[k * 3 + 2] = zt;
    verts[(n + k) * 3] = e; verts[(n + k) * 3 + 1] = nn; verts[(n + k) * 3 + 2] = zb;
  }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
    tris.push(a, b, c, a, c, d);                     // top, normal up
    tris.push(a + n, c + n, b + n, a + n, d + n, c + n); // bottom, normal down
  }
  // boundary ring, CCW seen from above
  const ring: number[] = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
  for (let j = ny - 2; j >= 1; j--) ring.push(j * nx);
  for (let r = 0; r < ring.length; r++) {
    const p = ring[r], q = ring[(r + 1) % ring.length];
    tris.push(p, p + n, q + n, p, q + n, q);
  }
  return { verts, tris: Uint32Array.from(tris) };
}

/** Distance (m) from (e, n) inside the rectangle to its nearest side (0 on / outside the boundary). */
export function insideDistance(x0: number, y0: number, x1: number, y1: number, e: number, n: number): number {
  return Math.max(0, Math.min(e - x0, x1 - e, n - y0, y1 - n));
}
