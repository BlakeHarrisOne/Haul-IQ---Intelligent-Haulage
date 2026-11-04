/**
 * Small polyline helpers on plain coordinate arrays (metres). Used by strings, route and section code.
 */
import type { Vec2 } from './types';

/** Plan length of a polyline (m). */
export function planLength(pts: ReadonlyArray<ArrayLike<number>>): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/**
 * Douglas–Peucker keep-mask: true for the points needed to stay within `tol` (m) of the polyline.
 * @param dist distance of point i from the chord a–b
 */
export function douglasPeuckerMask(n: number, tol: number, dist: (i: number, a: number, b: number) => number): Uint8Array {
  const keep = new Uint8Array(n);
  if (n === 0) return keep;
  keep[0] = 1; keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!;
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = dist(i, a, b); if (d > md) { md = d; m = i; } }
    if (m > 0) { keep[m] = 1; stack.push(a, m, m, b); }
  }
  return keep;
}

/** Distance (m) from point p to segment a–b in plan. */
export function pointSegDistPlan(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Douglas–Peucker simplification in plan (m). Keeps the first and last points. */
export function simplify2d<T extends ArrayLike<number>>(pts: readonly T[], tol: number): T[] {
  if (pts.length < 3) return pts.slice();
  const keep = douglasPeuckerMask(pts.length, tol, (i, a, b) =>
    pointSegDistPlan(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]));
  return pts.filter((_, i) => keep[i]);
}

/**
 * Subdivides every segment into equal parts no longer than `stepM` (plan), keeping all original vertices.
 * Returns plan points; the caller assigns heights.
 */
export function subdivide(pts: ReadonlyArray<ArrayLike<number>>, stepM: number): Vec2[] {
  const out: Vec2[] = [];
  if (!pts.length) return out;
  out.push([pts[0][0], pts[0][1]]);
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
    const L = Math.hypot(bx - ax, by - ay);
    const k = stepM > 0 ? Math.max(1, Math.ceil(L / stepM - 1e-9)) : 1;
    for (let j = 1; j <= k; j++) out.push([ax + (bx - ax) * (j / k), ay + (by - ay) * (j / k)]);
  }
  return out;
}

/**
 * Chaikin corner cutting (plan), `iterations` times, keeping both end points fixed.
 */
export function chaikin(pts: readonly Vec2[], iterations = 1): Vec2[] {
  let P = pts.map(p => [p[0], p[1]] as Vec2);
  for (let it = 0; it < iterations && P.length > 2; it++) {
    const Q: Vec2[] = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const q: Vec2 = [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]];
      const r: Vec2 = [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]];
      if (i > 0) Q.push(q);
      if (i < P.length - 2) Q.push(r);
    }
    Q.push(P[P.length - 1]);
    P = Q;
  }
  return P;
}

/** Signed area (m²) of a closed 2D ring given as flat [x0, y0, x1, y1, …]; positive when CCW. */
export function ringArea(flat: ArrayLike<number>): number {
  const n = flat.length >> 1;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) s += flat[j * 2] * flat[i * 2 + 1] - flat[i * 2] * flat[j * 2 + 1];
  return s / 2;
}

/** Even-odd point-in-ring test for a flat [x, y, …] ring. */
export function pointInRing(x: number, y: number, flat: ArrayLike<number>): boolean {
  const n = flat.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2], yi = flat[i * 2 + 1], xj = flat[j * 2], yj = flat[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
