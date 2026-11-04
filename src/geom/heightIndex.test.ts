import { describe, expect, it } from 'vitest';
import { buildHeightIndex, gridHeightAt, gridToMesh, heightAt, heightsAlong, rasterize } from './heightIndex';
import { gridTin, MGA, translate } from './__tests__/shapes';
import { mergeMeshes } from './mesh';
import { mulberry32 } from '@/demo/rng';
import type { MeshData } from '@/core/types';
// Wall-clock budgets: strict with PERF_STRICT=1; ×5 headroom by default so busy CI machines don't flake.
const PERF = process.env.PERF_STRICT === '1' ? 1 : 5;


const plane = (x: number, y: number) => 300 + 0.03 * (x - MGA[0]) - 0.07 * (y - MGA[1]);

/** Irregular planar TIN: jittered grid points, all heights on the plane. */
function jitteredPlane(n: number): MeshData {
  const r = mulberry32(3);
  const m = gridTin(MGA[0], MGA[1], 10, n, n, plane);
  const v = m.verts;
  for (let i = 0; i < v.length; i += 3) {
    const ix = Math.round((v[i] - MGA[0]) / 10), iy = Math.round((v[i + 1] - MGA[1]) / 10);
    if (ix > 0 && iy > 0 && ix < n && iy < n) { v[i] += (r() - 0.5) * 6; v[i + 1] += (r() - 0.5) * 6; }
    v[i + 2] = plane(v[i], v[i + 1]);
  }
  return m;
}

describe('heightAt', () => {
  it('is exact on a planar irregular TIN at MGA coordinates', () => {
    const m = jitteredPlane(30);
    const idx = buildHeightIndex(m);
    const r = mulberry32(9);
    for (let k = 0; k < 2000; k++) {
      const e = MGA[0] + r() * 300, n = MGA[1] + r() * 300;
      const z = heightAt(idx, e, n);
      expect(z).not.toBeNull();
      expect(Math.abs(z! - plane(e, n))).toBeLessThan(1e-8);
    }
    // vertices and edges
    expect(heightAt(idx, MGA[0], MGA[1])).toBeCloseTo(plane(MGA[0], MGA[1]), 9);
    expect(heightAt(idx, MGA[0] + 300, MGA[1] + 300)).toBeCloseTo(plane(MGA[0] + 300, MGA[1] + 300), 9);
  });

  it('returns null off the surface and the highest of overlapping layers', () => {
    const lo = gridTin(0, 0, 10, 4, 4, () => 10);
    const hi = gridTin(15, 15, 10, 2, 2, () => 25);
    const idx = buildHeightIndex(mergeMeshes([lo, hi]));
    expect(heightAt(idx, -1, 5)).toBeNull();
    expect(heightAt(idx, 41, 5)).toBeNull();
    expect(heightAt(idx, 5, 5)).toBe(10);
    expect(heightAt(idx, 20, 20)).toBe(25);
  });

  it('heightsAlong samples every step and every vertex', () => {
    const idx = buildHeightIndex(jitteredPlane(10));
    const pts = [[MGA[0] + 5, MGA[1] + 5], [MGA[0] + 55, MGA[1] + 5], [MGA[0] + 55, MGA[1] + 35]];
    const s = heightsAlong(idx, pts, 10);
    expect(s.length).toBe(1 + 5 + 3);
    expect(s[5].s).toBeCloseTo(50, 9);
    expect(s[8].s).toBeCloseTo(80, 9);
    for (const q of s) expect(q.z!).toBeCloseTo(plane(q.e, q.n), 8);
  });

  it('builds fast for ~326 k triangles and answers in under 5 µs', () => {
    const f = (x: number, y: number) => 300 + 10 * Math.sin((x - MGA[0]) / 97) * Math.cos((y - MGA[1]) / 61);
    const m = gridTin(MGA[0], MGA[1], 5, 480, 340, f);
    expect(m.tris.length / 3).toBe(326400);
    let buildMs = Infinity, idx = buildHeightIndex(m);
    for (let k = 0; k < 2; k++) { const t0 = performance.now(); idx = buildHeightIndex(m); buildMs = Math.min(buildMs, performance.now() - t0); }
    const r = mulberry32(1);
    const N = 200_000, E = new Float64Array(N), Nn = new Float64Array(N);
    for (let k = 0; k < N; k++) { E[k] = MGA[0] + r() * 2400; Nn[k] = MGA[1] + r() * 1700; }
    let sum = 0;
    const t1 = performance.now();
    for (let k = 0; k < N; k++) sum += heightAt(idx, E[k], Nn[k]) ?? 0;
    const perQueryUs = ((performance.now() - t1) * 1000) / N;
    expect(sum).toBeGreaterThan(0);
    console.info(`heightIndex: build ${buildMs.toFixed(0)} ms for 326 400 triangles; query ${perQueryUs.toFixed(2)} µs`);
    expect(buildMs).toBeLessThan(1500 * PERF);
    expect(perQueryUs).toBeLessThan(5 * PERF);
  });
});

describe('rasterize / grids', () => {
  it('reproduces a grid TIN at its own spacing and leaves NaN off the surface', () => {
    const m = gridTin(MGA[0], MGA[1], 5, 8, 6, (x, y) => 100 + (x - MGA[0]) * 0.1 + (y - MGA[1]) * 0.2);
    const g = rasterize(m, 5);
    expect(g.nx).toBe(9);
    expect(g.ny).toBe(7);
    expect(g.z[0]).toBeCloseTo(100, 4);
    expect(g.z[8 + 6 * 9]).toBeCloseTo(100 + 4 + 6, 4);
    const big = rasterize(m, 5, { x0: MGA[0] - 10, y0: MGA[1], nx: 3, ny: 1 });
    expect(Number.isNaN(big.z[0])).toBe(true);
    expect(big.z[2]).toBeCloseTo(100, 4);
    expect(() => rasterize(m, 0)).toThrow(/above 0/);
  });

  it('gridHeightAt is bilinear-exact on a plane and gridToMesh round-trips', () => {
    const m = gridTin(0, 0, 2, 10, 10, (x, y) => 5 + 0.5 * x - 0.25 * y);
    const g = rasterize(m, 2);
    expect(gridHeightAt(g, 3.3, 7.1)!).toBeCloseTo(5 + 1.65 - 1.775, 5);
    expect(gridHeightAt(g, -1, 0)).toBeNull();
    g.z[0] = NaN;
    expect(gridHeightAt(g, 0.2, 0.2)).not.toBeNull();
    const back = gridToMesh(rasterize(m, 2));
    expect(back.tris.length).toBe(m.tris.length);
    const holes = gridToMesh(g);
    expect(holes.tris.length / 3).toBe(200 - 2);
    expect(holes.verts.length / 3).toBe(120);
  });

  it('translate helper keeps rasterize origin at floor(min)', () => {
    const g = rasterize(translate(gridTin(0.4, 0.6, 1, 2, 2, () => 0), [10, 20, 0]), 1);
    expect(g.x0).toBe(10);
    expect(g.y0).toBe(20);
  });
});
