/**
 * Dev harness site: a TypeScript port of the synthetic QLD strip pit used for the .00t fixtures
 * (scratchpad tools/mkpit.py): 2.4 × 1.7 km natural surface on a 5 m grid (≈ 330 k triangles), a benched strip pit
 * with ramps, a spoil dump, an overburden dig block (EX09) and a dump lift (S51). Only used by `?scene` when the
 * real demo ('@/demo/demoSite') is not available yet.
 */
import type { MeshAsset, MeshData, MeshStats, SiteInfo, Vec3 } from '@/core/types';

const E0 = 236000, N0 = 7051000, DX = 5, NX = 481, NY = 341;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSurfaceGrid(): Float64Array {
  const r = rng(7);
  const oct: { f: number; a: number; ph0: number; ph1: number; c: number; s: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const ang = r() * 3.14;
    oct.push({ f: 2 ** k / 1800, a: 6 / 1.9 ** k, ph0: r() * 6.28, ph1: r() * 6.28, c: Math.cos(ang), s: Math.sin(ang) });
  }
  const z = new Float64Array(NX * NY);
  const cy = 900, half = 170, xa = 350, xb = 2050, floor = 262;
  const bench = (d: number, top: number, bottom: number, bh: number, face: number, berm: number) => {
    const run = bh / Math.tan((face * Math.PI) / 180), per = run + berm;
    const k = Math.floor(d / per), rr = d - k * per;
    return Math.max(top - k * bh - Math.min(Math.max(rr / run, 0), 1) * bh, bottom);
  };
  const nat = (lx: number, ly: number) => {
    let n = 0;
    for (const o of oct) {
      const u = lx * o.c + ly * o.s, v = -lx * o.s + ly * o.c;
      n += o.a * Math.sin(u * o.f * 6.28 + o.ph0) * Math.cos(v * o.f * 6.28 * 0.7 + o.ph1);
    }
    return 318 + 0.006 * lx - 0.004 * ly + n;
  };
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const lx = i * DX, ly = j * DX;
      const zn = nat(lx, ly);
      let zz = zn;
      const dxp = Math.min(lx - xa, xb - lx), dHw = cy + half - ly, dLw = ly - (cy - half);
      if (dxp > 0 && dHw > 0 && dLw > 0) {
        const zHw = bench(Math.max(dHw, 0), zn, floor, 15, 70, 9);
        const zLw = Math.max(zn - Math.max(dLw, 0) * Math.tan((30 * Math.PI) / 180), floor);
        const zEnd = bench(Math.max(dxp, 0), zn, floor, 15, 65, 12);
        let pit = Math.min(zHw, zLw, zEnd);
        pit = Math.max(pit, floor + 0.004 * (lx - xa) + 1.5 * Math.sin(lx / 160));
        zz = Math.min(zn, pit);
      }
      z[j * NX + i] = zz;
    }
  }
  // ramps (9 %) at both ends
  const ramp = (x0: number, y0: number, dir: number, ztop: number, width: number) => {
    const length = (ztop - floor) / 0.09;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const lx = i * DX, ly = j * DX, along = (lx - x0) * dir;
      if (along >= 0 && along <= length && Math.abs(ly - y0) <= width / 2) z[j * NX + i] = ztop - along * 0.09;
    }
  };
  const at = (lx: number, ly: number) => z[Math.round(ly / DX) * NX + Math.round(lx / DX)];
  ramp(330, 760, +1, at(330, 760), 34);
  ramp(2070, 1040, -1, at(2070, 1040), 34);
  // spoil dump
  const sx0 = 520, sx1 = 1880, sy0 = 260, sy1 = 640, top = 352;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const lx = i * DX, ly = j * DX;
    const dd = Math.min(lx - sx0, sx1 - lx, ly - sy0, sy1 - ly);
    const o = j * NX + i;
    z[o] = Math.max(z[o], floor - 1);
    if (dd > 0) z[o] = Math.max(z[o], Math.min(top, nat(lx, ly) + dd * Math.tan((20 * Math.PI) / 180)));
  }
  return z;
}

function gridMesh(z: Float64Array): MeshData {
  const verts = new Float64Array(NX * NY * 3);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const o = (j * NX + i) * 3;
    verts[o] = E0 + i * DX; verts[o + 1] = N0 + j * DX; verts[o + 2] = z[j * NX + i];
  }
  const tris = new Uint32Array((NX - 1) * (NY - 1) * 6);
  let k = 0;
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX + 1, d = a + NX;
    tris[k++] = a; tris[k++] = b; tris[k++] = c;
    tris[k++] = a; tris[k++] = c; tris[k++] = d;
  }
  return { verts, tris };
}

function bilinear(z: Float64Array, e: number, n: number) {
  const fx = (e - E0) / DX, fy = (n - N0) / DX;
  const i = Math.max(0, Math.min(NX - 2, Math.floor(fx))), j = Math.max(0, Math.min(NY - 2, Math.floor(fy)));
  const tx = fx - i, ty = fy - j;
  return z[j * NX + i] * (1 - tx) * (1 - ty) + z[j * NX + i + 1] * tx * (1 - ty) + z[(j + 1) * NX + i] * (1 - tx) * ty + z[(j + 1) * NX + i + 1] * tx * ty;
}

/** Closed prism over a plan rectangle: top grid, bottom grid, side walls (outward winding). */
function prism(x0: number, y0: number, x1: number, y1: number, top: (e: number, n: number) => number, bot: (e: number, n: number) => number, dx: number): MeshData {
  const nx = Math.round((x1 - x0) / dx) + 1, ny = Math.round((y1 - y0) / dx) + 1, n = nx * ny;
  const verts = new Float64Array(n * 6);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const e = x0 + i * dx, nn = y0 + j * dx, zt = top(e, nn), zb = Math.min(bot(e, nn), zt - 0.01), o = j * nx + i;
    verts.set([e, nn, zt], o * 3); verts.set([e, nn, zb], (o + n) * 3);
  }
  const tris: number[] = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
    tris.push(a, b, c, a, c, d);
    tris.push(a + n, c + n, b + n, a + n, d + n, c + n);
  }
  const ring: number[] = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
  for (let j = ny - 2; j > 0; j--) ring.push(j * nx);
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k], q = ring[(k + 1) % ring.length];
    tris.push(p, p + n, q + n, p, q + n, q);
  }
  return { verts, tris: new Uint32Array(tris) };
}

export function quickStats(m: MeshData, closed: boolean): MeshStats {
  const v = m.verts, t = m.tris;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[i + a]); max[a] = Math.max(max[a], v[i + a]); }
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let v6 = 0, area = 0;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, d = t[k + 2] * 3;
    const ax = v[a] - c[0], ay = v[a + 1] - c[1], az = v[a + 2] - c[2];
    const bx = v[b] - c[0], by = v[b + 1] - c[1], bz = v[b + 2] - c[2];
    const dx = v[d] - c[0], dy = v[d + 1] - c[1], dz = v[d + 2] - c[2];
    v6 += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx);
    area += ((bx - ax) * (dy - ay) - (by - ay) * (dx - ax)) / 2;
  }
  return {
    vertexCount: v.length / 3, triangleCount: t.length / 3, bbox: { min, max }, planArea: Math.abs(closed ? area / 2 : area),
    closed, boundaryEdges: 0, volume: closed ? Math.abs(v6) / 6 : undefined, centroid: c,
  };
}

export function buildDevSite(): { site: SiteInfo; assets: MeshAsset[] } {
  const z = buildSurfaceGrid();
  const surf = gridMesh(z);
  const now = new Date().toISOString();
  const s = (e: number, n: number) => bilinear(z, e, n);
  const dig = prism(1150 + E0, 1030 + N0, 1400 + E0, 1125 + N0, s, () => 266, 5);
  const dump = prism(700 + E0, 330 + N0, 1100 + E0, 560 + N0, () => 367, s, 5);
  const asset = (id: string, name: string, kind: MeshAsset['kind'], role: MeshAsset['role'], mesh: MeshData, color: string, extra?: Partial<MeshAsset>): MeshAsset => ({
    id, name, kind, role, mesh, stats: quickStats(mesh, kind === 'solid'), color, visible: true, opacity: 1, source: 'generated', importedAt: now, ...extra,
  });
  return {
    site: { name: 'Synthetic strip pit (dev)', origin: [E0, N0, 0], crs: 'GDA2020 / MGA zone 56' },
    assets: [
      asset('dev-topo', 'Pit surface (week 45)', 'surface', 'topo', surf, '#C9BFAE'),
      asset('dev-dig', 'EX09 OB block', 'solid', 'dig', dig, '#C79A6B', { block: { materialId: 'OB', depletionMode: 'face-advance', advanceAzimuthDeg: 90 } }),
      asset('dev-dump', 'S51 West lift', 'solid', 'dump', dump, '#7FA58E', { block: { materialId: 'OB', depletionMode: 'bottom-up', advanceAzimuthDeg: 0 } }),
    ],
  };
}
