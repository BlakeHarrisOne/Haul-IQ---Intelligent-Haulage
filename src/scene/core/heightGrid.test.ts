import { describe, expect, it } from 'vitest';
import { HeightGrid } from './heightGrid';
import { boundaryEdges, smoothNormals } from './meshUtil';
import { bezier } from './camera';

/** A tilted plane z = 0.1·x over 0..200 × 0..100 m, as local scene buffers (y up, z = −north). */
function plane(nx = 21, ny = 11, dx = 10) {
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = (j * nx + i) * 3;
    pos[o] = i * dx; pos[o + 1] = 0.1 * i * dx; pos[o + 2] = -j * dx;
  }
  const idx: number[] = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
    idx.push(a, b, c, a, c, d);
  }
  const index = new Uint32Array(idx);
  return { positions: pos, index, min: [0, 0, -(ny - 1) * dx] as [number, number, number], max: [(nx - 1) * dx, 0.1 * (nx - 1) * dx, 0] as [number, number, number] };
}

describe('HeightGrid', () => {
  const m = plane();
  const g = HeightGrid.fromMeshes([m])!;
  it('rasterises and interpolates heights', () => {
    expect(g).not.toBeNull();
    expect(g.at(50, 50)).toBeCloseTo(5, 3);
    expect(g.at(123.4, 10)).toBeCloseTo(12.34, 2);
    expect(Number.isNaN(g.at(-5, 10))).toBe(true);
  });
  it('ray-marches to the surface', () => {
    // straight down onto (80, north 40)
    const t = g.raycast(80, 100, -40, 0, -1, 0, 1);
    expect(t).toBeGreaterThan(0);
    expect(100 - t).toBeCloseTo(8, 1);
    // oblique ray with vertical exaggeration 2
    const o = [0, 120, -50], d = [1, -1, 0];
    const t2 = g.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 2);
    const x = o[0] + d[0] * t2, y = o[1] + d[1] * t2;
    expect(y).toBeCloseTo(0.1 * x * 2, 1);
  });
  it('bakes AO in range and curvature near neutral on a plane', () => {
    const ao = g.bakeAO();
    expect(ao.data.length).toBe(ao.w * ao.h * 2);
    const mid = ((ao.h >> 1) * ao.w + (ao.w >> 1)) * 2;
    expect(ao.data[mid]).toBeGreaterThan(150);
    expect(Math.abs(ao.data[mid + 1] - 128)).toBeLessThan(12);
  });
});

describe('meshUtil', () => {
  const m = plane(5, 4, 10);
  it('finds the boundary with outward normals', () => {
    const e = boundaryEdges(m.positions, m.index);
    expect(e.length).toBe(2 * (4 + 3));
    for (const b of e) {
      const mx = (m.positions[b.a * 3] + m.positions[b.b * 3]) / 2, mz = (m.positions[b.a * 3 + 2] + m.positions[b.b * 3 + 2]) / 2;
      // outward = away from the centre (20, −15)
      expect(b.ox * (mx - 20) + b.oz * (mz + 15)).toBeGreaterThan(0);
    }
  });
  it('smooth normals point up', () => {
    const n = smoothNormals(m.positions, m.index, true);
    for (let i = 1; i < n.length; i += 3) expect(n[i]).toBeGreaterThan(0.9);
  });
});

describe('camera easing', () => {
  it('cubic-bezier(.23,1,.32,1) is monotone from 0 to 1', () => {
    const e = bezier(0.23, 1, 0.32, 1);
    let prev = 0;
    for (let x = 0; x <= 1.0001; x += 0.05) { const y = e(x); expect(y).toBeGreaterThanOrEqual(prev - 1e-9); prev = y; }
    expect(e(0)).toBe(0); expect(e(1)).toBe(1); expect(e(0.5)).toBeGreaterThan(0.85);
  });
});
