/**
 * Tiny mesh kit for the parametric machines (pattern of Haul Road Lab's `_kit5`): primitives are written in the
 * VEHICLE frame (x forward, y to the driver's left, z up, metres) and converted to Three.js local axes on build
 * (x forward, y up, z right). Every vertex carries an RGB colour and a paint weight: paint = 1 vertices are tinted by
 * the instance colour (truck body colour, material colour), paint = 0 vertices keep their own colour (tyres, glass…).
 * Winding always agrees with the normal, materials are double-sided, so lighting is right whichever way a face is seen.
 */
import * as THREE from 'three';

export type V3 = [number, number, number];
export type RGB = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const v3 = { sub, add, mul, dot, cross, unit };

export const shade = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

export class Kit {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  paint: number[] = [];

  count(): number { return this.pos.length / 3; }

  private vert(p: V3, n: V3, c: RGB, paint: number) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    this.paint.push(paint);
  }

  /** Triangle with a flat normal pointing along `out` (or its winding normal when omitted). */
  tri(a: V3, b: V3, c: V3, col: RGB, paint = 0, out?: V3) {
    let n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) return;
    n = unit(n);
    if (out && dot(n, out) < 0) { const t = b; b = c; c = t; n = mul(n, -1); }
    this.vert(a, n, col, paint); this.vert(b, n, col, paint); this.vert(c, n, col, paint);
  }

  /** Smooth triangle (per-vertex normals); winding follows the mean normal. */
  triN(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, col: RGB, paint = 0) {
    const w = cross(sub(b, a), sub(c, a));
    if (Math.hypot(w[0], w[1], w[2]) < 1e-12) return;
    const m = add(add(na, nb), nc);
    if (dot(w, m) < 0) { this.vert(a, na, col, paint); this.vert(c, nc, col, paint); this.vert(b, nb, col, paint); }
    else { this.vert(a, na, col, paint); this.vert(b, nb, col, paint); this.vert(c, nc, col, paint); }
  }

  /** Planar convex polygon; normal oriented away from `ref` (a point inside the solid) or along `n`. */
  face(P: V3[], col: RGB, paint = 0, ref?: V3 | null, n?: V3) {
    if (P.length < 3) return;
    let out = n;
    if (!out) {
      const c = centroid(P);
      let w: V3 = [0, 0, 0];
      for (let i = 0; i < P.length; i++) w = add(w, cross(P[i], P[(i + 1) % P.length]));
      out = unit(w);
      if (ref && dot(out, sub(c, ref)) < 0) out = mul(out, -1);
    }
    for (let i = 1; i < P.length - 1; i++) this.tri(P[0], P[i], P[i + 1], col, paint, out);
  }

  /** Hexahedron, corners indexed i = xBit + 2·yBit + 4·zBit (HRL order). */
  hexa(P: V3[], col: RGB, paint = 0) {
    const c = centroid(P);
    const F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
    for (const f of F) this.face(f.map(i => P[i]), col, paint, c);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB, paint = 0) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1), za = Math.min(z0, z1), zb = Math.max(z0, z1);
    this.hexa([[xa, ya, za], [xb, ya, za], [xa, yb, za], [xb, yb, za], [xa, ya, zb], [xb, ya, zb], [xa, yb, zb], [xb, yb, zb]], col, paint);
  }

  /** Oriented box: centre, unit axes, half sizes. */
  obox(c: V3, ax: V3, ay: V3, az: V3, hx: number, hy: number, hz: number, col: RGB, paint = 0) {
    const P: V3[] = [];
    for (let i = 0; i < 8; i++) {
      const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1;
      P.push(add(add(add(c, mul(ax, sx * hx)), mul(ay, sy * hy)), mul(az, sz * hz)));
    }
    this.hexa(P, col, paint);
  }

  /** Beam of rectangular section from a to b; `up` orients the section. */
  beam(a: V3, b: V3, w: number, h: number, col: RGB, paint = 0, up: V3 = [0, 0, 1]) {
    const ax = unit(sub(b, a));
    let ay = cross(up, ax);
    if (Math.hypot(ay[0], ay[1], ay[2]) < 1e-6) ay = cross([1, 0, 0], ax);
    ay = unit(ay);
    const az = unit(cross(ax, ay));
    const L = Math.hypot(...sub(b, a));
    this.obox(mul(add(a, b), 0.5), ax, ay, az, L / 2, w / 2, h / 2, col, paint);
  }

  /** Cylinder from a to b (smooth sides, flat caps). */
  tube(a: V3, b: V3, r: number, col: RGB, paint = 0, seg = 10, caps = true) {
    const ax = unit(sub(b, a));
    const ref: V3 = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = unit(cross(ax, ref)), v = cross(ax, u);
    const ring = (c: V3, i: number): [V3, V3] => {
      const t = (i / seg) * Math.PI * 2, n = add(mul(u, Math.cos(t)), mul(v, Math.sin(t)));
      return [add(c, mul(n, r)), n];
    };
    for (let i = 0; i < seg; i++) {
      const [a0, n0] = ring(a, i), [a1, n1] = ring(a, i + 1), [b0] = ring(b, i), [b1] = ring(b, i + 1);
      this.triN(a0, b0, b1, n0, n0, n1, col, paint);
      this.triN(a0, b1, a1, n0, n1, n1, col, paint);
      if (caps) {
        this.tri(a, a1, a0, col, paint, mul(ax, -1));
        this.tri(b, b0, b1, col, paint, ax);
      }
    }
  }

  /**
   * Surface of revolution about axis A through C; profile = [radius, axial offset] pairs (open polyline).
   * Smooth normals; `U`, `V` span the plane normal to A.
   */
  revolve(C: V3, A: V3, U: V3, V: V3, profile: [number, number][], col: RGB, paint = 0, seg = 32) {
    const m = profile.length;
    // 2D normals of the profile (radial, axial), oriented away from the profile centroid
    const cr = profile.reduce((s, p) => s + p[0], 0) / m, ca = profile.reduce((s, p) => s + p[1], 0) / m;
    const n2: [number, number][] = profile.map((p, j) => {
      const a = profile[Math.max(0, j - 1)], b = profile[Math.min(m - 1, j + 1)];
      let nr = b[1] - a[1], na = -(b[0] - a[0]);
      const l = Math.hypot(nr, na) || 1; nr /= l; na /= l;
      if (nr * (p[0] - cr) + na * (p[1] - ca) < 0) { nr = -nr; na = -na; }
      return [nr, na];
    });
    const at = (j: number, i: number): [V3, V3] => {
      const t = (i / seg) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
      const rad = add(mul(U, ct), mul(V, st));
      const p = add(add(C, mul(rad, profile[j][0])), mul(A, profile[j][1]));
      const n = unit(add(mul(rad, n2[j][0]), mul(A, n2[j][1])));
      return [p, n];
    };
    for (let j = 0; j < m - 1; j++) {
      for (let i = 0; i < seg; i++) {
        const [p00, n00] = at(j, i), [p01, n01] = at(j, i + 1), [p10, n10] = at(j + 1, i), [p11, n11] = at(j + 1, i + 1);
        this.triN(p00, p10, p11, n00, n10, n11, col, paint);
        this.triN(p00, p11, p01, n00, n11, n01, col, paint);
      }
    }
  }

  /** Loft through closed sections with equal point counts (flat-shaded quads, optional caps). */
  loft(S: V3[][], col: RGB, paint = 0, capStart = true, capEnd = true) {
    const k = S[0].length;
    for (let j = 0; j < S.length - 1; j++) {
      const A = S[j], B = S[j + 1];
      const c = centroid([...A, ...B]);
      for (let i = 0; i < k; i++) {
        const i1 = (i + 1) % k;
        this.face([A[i], A[i1], B[i1], B[i]], col, paint, c);
      }
    }
    if (capStart) this.face(S[0], col, paint, centroid(S[Math.min(1, S.length - 1)]));
    if (capEnd) this.face(S[S.length - 1], col, paint, centroid(S[Math.max(0, S.length - 2)]));
  }

  /** Curved band (fender) around a wheel at (x, z = r) between y0..y1, angles from the front (rad). */
  arcBand(xc: number, zc: number, r0: number, r1: number, y0: number, y1: number, a0: number, a1: number, n: number, col: RGB, paint = 0) {
    const S: V3[][] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, c = Math.cos(a), s = Math.sin(a);
      S.push([[xc + c * r0, y0, zc + s * r0], [xc + c * r1, y0, zc + s * r1], [xc + c * r1, y1, zc + s * r1], [xc + c * r0, y1, zc + s * r0]]);
    }
    this.loft(S, col, paint);
  }

  /** Merge another kit (optionally transformed by a vehicle-frame matrix function). */
  append(o: Kit, f?: (p: V3) => V3, fn?: (n: V3) => V3) {
    for (let i = 0; i < o.pos.length; i += 3) {
      const p: V3 = [o.pos[i], o.pos[i + 1], o.pos[i + 2]];
      const n: V3 = [o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]];
      const q = f ? f(p) : p, m = fn ? fn(n) : n;
      this.pos.push(q[0], q[1], q[2]); this.nrm.push(m[0], m[1], m[2]);
    }
    this.col.push(...o.col);
    this.paint.push(...o.paint);
  }

  /**
   * Build a BufferGeometry in Three.js local axes: (x, y, z)_vehicle → (x, z, −y)_three, shifted by `origin`
   * (a vehicle-frame point that becomes the local origin).
   */
  build(origin: V3 = [0, 0, 0]): THREE.BufferGeometry {
    const n = this.pos.length / 3;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = this.pos[3 * i] - origin[0], y = this.pos[3 * i + 1] - origin[1], z = this.pos[3 * i + 2] - origin[2];
      P[3 * i] = x; P[3 * i + 1] = z; P[3 * i + 2] = -y;
      N[3 * i] = this.nrm[3 * i]; N[3 * i + 1] = this.nrm[3 * i + 2]; N[3 * i + 2] = -this.nrm[3 * i + 1];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(this.paint), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function centroid(P: V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of P) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return mul(c, 1 / Math.max(1, P.length));
}

/**
 * The one material for every machine: MeshStandardMaterial with vertex colours, where the instance colour (or
 * `uTint`) only tints paint-weighted vertices.
 */
export function machineMaterial(opts: { roughness?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.62,
    metalness: opts.metalness ?? 0.08,
    side: THREE.DoubleSide,
    envMapIntensity: 0.7,
  });
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;')
      .replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
  vColor *= color;
#elif defined( USE_COLOR )
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aPaint );
#endif
`);
  };
  m.customProgramCacheKey = () => 'haiul-machine-v1';
  return m;
}
