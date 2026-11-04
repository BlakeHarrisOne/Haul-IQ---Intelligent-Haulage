/**
 * Vertical sections through meshes and long-section profiles along strings.
 *
 * Section coordinates: s = plan distance from A along A→B (m), z = RL (m).
 */
import type { MeshData } from '@/core/types';
import type { Vec2, XYZ } from './types';
import { chainSegments } from './chain';
import { heightAt, type HeightIndex } from './heightIndex';

/** One cut line in section coordinates. */
export interface SectionPath {
  /** Closed polygon (a solid's cut) or open polyline (a surface's cut). */
  closed: boolean;
  /** [s, z] vertices (m). Open paths run with increasing s; closed polygons are counter-clockwise in (s, z). */
  points: Array<[number, number]>;
}

/** Result of `sectionCut`. */
export interface SectionCut {
  /** Plan length of A→B (m). */
  lengthM: number;
  paths: SectionPath[];
}

/**
 * Cuts the mesh with the vertical plane through plan points A and B and returns the intersection in section
 * coordinates, clipped to 0 ≤ s ≤ |AB|. Surfaces give open polylines (sorted by s); closed solids give
 * closed polygons (clipped polygons are closed along the s = 0 / s = L verticals).
 */
export function sectionCut(mesh: MeshData, a: Vec2, b: Vec2): SectionCut {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(L > 0)) return { lengthM: 0, paths: [] };
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const nx = -uy, ny = ux;
  const v = mesh.verts, t = mesh.tris, V = v.length / 3;
  const d = new Float64Array(V), s = new Float64Array(V);
  const eps = 1e-9 * Math.max(1, L);
  for (let i = 0; i < V; i++) {
    const px = v[i * 3] - a[0], py = v[i * 3 + 1] - a[1];
    let di = px * nx + py * ny;
    if (Math.abs(di) < eps) di = eps; // symbolic perturbation: on-plane vertices count as the + side
    d[i] = di; s[i] = px * ux + py * uy;
  }
  const keys: number[] = [], pts: number[] = [];
  const cross = (i: number, j: number) => {
    const f = d[i] / (d[i] - d[j]);
    pts.push(s[i] + (s[j] - s[i]) * f, v[i * 3 + 2] + (v[j * 3 + 2] - v[i * 3 + 2]) * f);
    keys.push(i < j ? i * V + j : j * V + i);
  };
  for (let k = 0; k < t.length; k += 3) {
    const i0 = t[k], i1 = t[k + 1], i2 = t[k + 2];
    const p0 = d[i0] > 0, p1 = d[i1] > 0, p2 = d[i2] > 0;
    if (p0 === p1 && p1 === p2) continue;
    // the lone vertex is the one whose side differs; the segment joins its two edges
    if (p0 !== p1 && p0 !== p2) { cross(i0, i1); cross(i2, i0); }
    else if (p1 !== p0 && p1 !== p2) { cross(i1, i2); cross(i0, i1); }
    else { cross(i2, i0); cross(i1, i2); }
  }
  const chains = chainSegments(keys, keys.length / 2);
  const paths: SectionPath[] = [];
  for (const c of chains) {
    const P: Array<[number, number]> = c.ends.map(e => [pts[e * 2], pts[e * 2 + 1]]);
    if (c.closed) {
      let poly = clipPolygonS(P, 0, 1);
      poly = clipPolygonS(poly, L, -1);
      if (poly.length >= 3) {
        if (polyArea(poly) < 0) poly.reverse();
        paths.push({ closed: true, points: poly });
      }
    } else {
      for (const part of clipPolylineS(P, L)) {
        if (part.length < 2) continue;
        if (part[0][0] > part[part.length - 1][0]) part.reverse();
        paths.push({ closed: false, points: part });
      }
    }
  }
  paths.sort((p, q) => minS(p) - minS(q));
  return { lengthM: L, paths };
}

const minS = (p: SectionPath) => p.points.reduce((m, q) => Math.min(m, q[0]), Infinity);

function polyArea(P: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1];
  return a / 2;
}

/** Sutherland–Hodgman against the half-plane sign·(s − s0) ≥ 0. */
function clipPolygonS(P: Array<[number, number]>, s0: number, sign: 1 | -1): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < P.length; i++) {
    const A = P[i], B = P[(i + 1) % P.length];
    const da = sign * (A[0] - s0), db = sign * (B[0] - s0);
    if (da >= 0) out.push(A);
    if ((da >= 0) !== (db >= 0)) {
      const f = da / (da - db);
      out.push([s0, A[1] + (B[1] - A[1]) * f]);
    }
  }
  return out;
}

/** Clips an open polyline to 0 ≤ s ≤ L (1D Liang–Barsky per segment), splitting it where it leaves the range. */
function clipPolylineS(P: Array<[number, number]>, L: number): Array<Array<[number, number]>> {
  const parts: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> | null = null;
  const at = (q: [number, number], p: [number, number], f: number): [number, number] =>
    [Math.min(L, Math.max(0, q[0] + (p[0] - q[0]) * f)), q[1] + (p[1] - q[1]) * f];
  for (let i = 1; i < P.length; i++) {
    const q = P[i - 1], p = P[i], ds = p[0] - q[0];
    let t0 = 0, t1 = 1;
    if (ds === 0) {
      if (q[0] < 0 || q[0] > L) { cur = null; continue; }
    } else {
      const ta = -q[0] / ds, tb = (L - q[0]) / ds;
      t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb));
      if (!(t0 < t1)) { cur = null; continue; }
    }
    if (!cur || t0 > 0) { cur = [t0 > 0 ? at(q, p, t0) : q]; parts.push(cur); }
    cur.push(t1 < 1 ? at(q, p, t1) : p);
    if (t1 < 1) cur = null;
  }
  return parts;
}

/** One sample of a long-section profile. */
export interface ProfileSample {
  /** 3D chainage along the string (m), as used by the engine. */
  chainage: number;
  /** Plan chainage along the string (m). */
  planChainage: number;
  e: number;
  n: number;
  /** String height (m RL), linear between string points. */
  zString: number;
  /** Surface height below (m RL) or null off the surface. */
  zSurface: number | null;
}

/**
 * Long-section samples along a string: every string point plus points every `stepM` metres (plan) between,
 * with the string's own height and the surface height at each.
 */
export function profileAlongString(index: HeightIndex | null, points: ReadonlyArray<XYZ>, stepM: number): ProfileSample[] {
  const out: ProfileSample[] = [];
  if (!points.length) return out;
  const surf = (e: number, n: number) => (index ? heightAt(index, e, n) : null);
  const p0 = points[0];
  out.push({ chainage: 0, planChainage: 0, e: p0.e, n: p0.n, zString: p0.z, zSurface: surf(p0.e, p0.n) });
  let ch = 0, pch = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const Lp = Math.hypot(b.e - a.e, b.n - a.n), L3 = Math.hypot(Lp, b.z - a.z);
    const k = stepM > 0 ? Math.max(1, Math.ceil(Lp / stepM - 1e-9)) : 1;
    for (let j = 1; j <= k; j++) {
      const f = j / k, e = a.e + (b.e - a.e) * f, n = a.n + (b.n - a.n) * f;
      out.push({ chainage: ch + L3 * f, planChainage: pch + Lp * f, e, n, zString: a.z + (b.z - a.z) * f, zSurface: surf(e, n) });
    }
    ch += L3; pch += Lp;
  }
  return out;
}
