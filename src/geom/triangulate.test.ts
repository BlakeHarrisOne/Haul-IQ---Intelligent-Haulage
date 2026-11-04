import { describe, expect, it } from 'vitest';
import { triangulatePolygon } from './triangulate';
import { ringArea } from './polyline';

function triArea(rings: number[][], tris: number[]): { total: number; minSigned: number } {
  const all = rings.flat();
  let total = 0, minSigned = Infinity;
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k] * 2, b = tris[k + 1] * 2, c = tris[k + 2] * 2;
    const s = ((all[b] - all[a]) * (all[c + 1] - all[a + 1]) - (all[b + 1] - all[a + 1]) * (all[c] - all[a])) / 2;
    total += s; minSigned = Math.min(minSigned, s);
  }
  return { total, minSigned };
}

describe('triangulatePolygon (ear clipping)', () => {
  it('square in either orientation gives 2 CCW triangles', () => {
    for (const r of [[0, 0, 1, 0, 1, 1, 0, 1], [0, 0, 0, 1, 1, 1, 1, 0]]) {
      const t = triangulatePolygon([r]);
      expect(t.length).toBe(6);
      const a = triArea([r], t);
      expect(a.total).toBeCloseTo(1, 12);
      expect(a.minSigned).toBeGreaterThan(0);
    }
  });

  it('concave L shape', () => {
    const r = [0, 0, 4, 0, 4, 1, 1, 1, 1, 3, 0, 3];
    const t = triangulatePolygon([r]);
    expect(t.length / 3).toBe(4);
    expect(triArea([r], t).total).toBeCloseTo(6, 12);
    expect(triArea([r], t).minSigned).toBeGreaterThan(0);
  });

  it('polygon with two holes: area = outer − holes, n + 2h − 2 … triangles', () => {
    const outer = [0, 0, 10, 0, 10, 10, 0, 10];
    const h1 = [2, 2, 4, 2, 4, 4, 2, 4];
    const h2 = [6, 5, 8, 5, 8, 8, 6, 8];
    const rings = [outer, h1, h2];
    const t = triangulatePolygon(rings);
    const a = triArea(rings, t);
    expect(a.total).toBeCloseTo(100 - 4 - 6, 9);
    expect(a.minSigned).toBeGreaterThan(-1e-12);
    expect(t.length / 3).toBe(12 + 2 * 2 - 2);
  });

  it('many-vertex ring (bucket grid path) with collinear points', () => {
    const r: number[] = [];
    const n = 400;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, rad = k % 2 ? 10 : 7; // star
      r.push(rad * Math.cos(a), rad * Math.sin(a));
    }
    r.push(10, 0); // duplicate-ish closing point collinear with the start
    const t = triangulatePolygon([r]);
    const a = triArea([r], t);
    expect(a.total).toBeCloseTo(ringArea(r), 6);
    expect(a.minSigned).toBeGreaterThan(-1e-9);
  });

  it('returns nothing for degenerate input', () => {
    expect(triangulatePolygon([])).toEqual([]);
    expect(triangulatePolygon([[0, 0, 1, 1]])).toEqual([]);
  });
});
