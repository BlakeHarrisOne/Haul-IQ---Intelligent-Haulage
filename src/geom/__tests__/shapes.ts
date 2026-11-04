/**
 * TEST HELPER: analytic shapes as MeshData (outward winding), optionally offset to MGA-sized coordinates.
 */
import type { MeshData } from '@/core/types';
import { triangulatePolygon } from '../triangulate';
import { ringArea } from '../polyline';
import { weldVertices } from '../mesh';

export const MGA: [number, number, number] = [236_000, 7_051_000, 300];

export function translate(m: MeshData, d: readonly number[]): MeshData {
  const v = m.verts.slice();
  for (let i = 0; i < v.length; i += 3) { v[i] += d[0]; v[i + 1] += d[1]; v[i + 2] += d[2]; }
  return { verts: v, tris: m.tris };
}

/** Axis-aligned box [0,sx]×[0,sy]×[0,sz], each face split into n×n quads (2 triangles each), welded (closed). */
export function box(sx: number, sy: number, sz: number, n = 1): MeshData {
  const verts: number[] = [], tris: number[] = [];
  const face = (o: number[], u: number[], v: number[]) => {
    const base = verts.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++)
      verts.push(o[0] + (u[0] * i + v[0] * j) / n, o[1] + (u[1] * i + v[1] * j) / n, o[2] + (u[2] * i + v[2] * j) / n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 2, d = a + n + 1;
      tris.push(a, b, c, a, c, d);
    }
  };
  // u × v points outward for each face
  face([0, 0, 0], [0, sy, 0], [sx, 0, 0]);       // bottom (−z)
  face([0, 0, sz], [sx, 0, 0], [0, sy, 0]);      // top (+z)
  face([0, 0, 0], [sx, 0, 0], [0, 0, sz]);       // south (−y)
  face([0, sy, 0], [0, 0, sz], [sx, 0, 0]);      // north (+y)
  face([0, 0, 0], [0, 0, sz], [0, sy, 0]);       // west (−x)
  face([sx, 0, 0], [0, sy, 0], [0, 0, sz]);      // east (+x)
  return weldVertices({ verts: Float64Array.from(verts), tris: Uint32Array.from(tris) }, 1e-9 * Math.max(sx, sy, sz));
}

/** Box with shared vertices (8 corners, 12 triangles). */
export function cube(s = 1): MeshData {
  const v = [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s];
  const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { verts: Float64Array.from(v), tris: Uint32Array.from(t) };
}

/** Tetrahedron with vertices (0,0,0), (a,0,0), (0,b,0), (0,0,c). Volume abc/6, centroid (a,b,c)/4. */
export function tetra(a: number, b: number, c: number): MeshData {
  return { verts: Float64Array.from([0, 0, 0, a, 0, 0, 0, b, 0, 0, 0, c]), tris: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]) };
}

/** Triangular prism: right triangle legs a (x), b (y) extruded h in z. Volume abh/2, centroid (a/3, b/3, h/2). */
export function prism(a: number, b: number, h: number): MeshData {
  const v = [0, 0, 0, a, 0, 0, 0, b, 0, 0, 0, h, a, 0, h, 0, b, h];
  const t = [0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5];
  return { verts: Float64Array.from(v), tris: Uint32Array.from(t) };
}

/** Icosphere of radius r with `sub` subdivisions (shared vertices, closed). */
export function icosphere(r: number, sub: number): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;
  let V: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  V = V.map(norm);
  for (let s = 0; s < sub; s++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(k);
      if (i === undefined) { i = V.length; V.push(norm([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2])); mid.set(k, i); }
      return i;
    };
    F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  return { verts: Float64Array.from(V.flatMap(p => [p[0] * r, p[1] * r, p[2] * r])), tris: Uint32Array.from(F.flat()) };
}

/** Exact volume of a closed polyhedron (for comparing against the analytic sphere). */
export function polyVolume(m: MeshData): number {
  let s = 0;
  const v = m.verts, t = m.tris;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return s / 6;
}

/**
 * Extrusion of a polygon with holes from z = 0 to z = h (closed, outward). Rings are flat [x, y, …].
 * The outer ring is made CCW and holes CW before extrusion.
 */
export function extrude(rings: number[][], h: number): MeshData {
  const R = rings.map((r, i) => {
    const ccw = ringArea(r) > 0;
    if ((i === 0) === ccw) return r.slice();
    const out: number[] = [];
    for (let k = r.length / 2 - 1; k >= 0; k--) out.push(r[k * 2], r[k * 2 + 1]);
    return out;
  });
  const flat = R.flat(), n = flat.length / 2;
  const verts: number[] = [];
  for (let k = 0; k < n; k++) verts.push(flat[k * 2], flat[k * 2 + 1], 0);
  for (let k = 0; k < n; k++) verts.push(flat[k * 2], flat[k * 2 + 1], h);
  const tri = triangulatePolygon(R);
  const tris: number[] = [];
  for (let k = 0; k < tri.length; k += 3) {
    tris.push(tri[k] + n, tri[k + 1] + n, tri[k + 2] + n);   // top, CCW → up
    tris.push(tri[k], tri[k + 2], tri[k + 1]);               // bottom, reversed → down
  }
  let base = 0;
  for (const r of R) {
    const m = r.length / 2;
    for (let k = 0; k < m; k++) {
      const p = base + k, q = base + ((k + 1) % m);
      // ring traversed CCW (outer) / CW (hole) → wall normal points away from the solid
      tris.push(p, q, q + n, p, q + n, p + n);
    }
    base += m;
  }
  return { verts: Float64Array.from(verts), tris: Uint32Array.from(tris) };
}

/** Regular grid TIN over [x0, x0 + nx·d] × [y0, y0 + ny·d] with heights f(x, y). */
export function gridTin(x0: number, y0: number, d: number, nx: number, ny: number, f: (x: number, y: number) => number): MeshData {
  const verts: number[] = [], tris: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * d, y = y0 + j * d; verts.push(x, y, f(x, y)); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, e = a + nx + 1;
    tris.push(a, b, c, a, c, e);
  }
  return { verts: Float64Array.from(verts), tris: Uint32Array.from(tris) };
}
