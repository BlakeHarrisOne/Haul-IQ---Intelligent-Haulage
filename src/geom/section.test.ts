import { describe, expect, it } from 'vitest';
import { profileAlongString, sectionCut } from './section';
import { buildHeightIndex } from './heightIndex';
import { box, gridTin, MGA, translate } from './__tests__/shapes';
import type { StringPoint } from '@/core/types';

const plane = (x: number, y: number) => 300 + 0.1 * (x - MGA[0]) + 0.02 * (y - MGA[1]);

describe('sectionCut', () => {
  it('cuts a planar surface into one polyline matching the plane, clipped to A–B', () => {
    const m = gridTin(MGA[0], MGA[1], 10, 20, 20, plane);
    const a: [number, number] = [MGA[0] - 50, MGA[1] + 37], b: [number, number] = [MGA[0] + 150, MGA[1] + 137];
    const s = sectionCut(m, a, b);
    expect(s.lengthM).toBeCloseTo(Math.hypot(200, 100), 9);
    expect(s.paths.length).toBe(1);
    const p = s.paths[0];
    expect(p.closed).toBe(false);
    const L = s.lengthM;
    for (const [sv, z] of p.points) {
      expect(sv).toBeGreaterThanOrEqual(0);
      expect(sv).toBeLessThanOrEqual(L + 1e-9);
      const x = a[0] + ((b[0] - a[0]) * sv) / L, y = a[1] + ((b[1] - a[1]) * sv) / L;
      expect(z).toBeCloseTo(plane(x, y), 8);
    }
    for (let i = 1; i < p.points.length; i++) expect(p.points[i][0]).toBeGreaterThanOrEqual(p.points[i - 1][0] - 1e-9);
    // surface starts at x = MGA[0] → s where the line enters the TIN (A is 50 m west of the surface)
    expect(p.points[0][0]).toBeCloseTo((50 / 200) * L, 6);
    expect(p.points[p.points.length - 1][0]).toBeCloseTo(L, 6);
  });

  it('cuts a box into a closed rectangle; A–B inside the box clips it', () => {
    const m = translate(box(40, 20, 10, 3), MGA);
    const full = sectionCut(m, [MGA[0] - 10, MGA[1] + 7], [MGA[0] + 60, MGA[1] + 7]);
    expect(full.paths.length).toBe(1);
    expect(full.paths[0].closed).toBe(true);
    expect(area(full.paths[0].points)).toBeCloseTo(40 * 10, 6);
    const xs = full.paths[0].points.map(p => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(10, 9);
    expect(Math.max(...xs)).toBeCloseTo(50, 9);
    const inside = sectionCut(m, [MGA[0] + 5, MGA[1] + 7], [MGA[0] + 30, MGA[1] + 7]);
    expect(inside.paths[0].closed).toBe(true);
    expect(area(inside.paths[0].points)).toBeCloseTo(25 * 10, 6);
    // a line through a vertex row (on-plane vertices) still closes
    const onGrid = sectionCut(m, [MGA[0] - 1, MGA[1] + 20 / 3], [MGA[0] + 41, MGA[1] + 20 / 3]);
    expect(onGrid.paths.length).toBe(1);
    expect(area(onGrid.paths[0].points)).toBeCloseTo(400, 6);
    expect(sectionCut(m, [MGA[0], MGA[1] + 100], [MGA[0] + 10, MGA[1] + 100]).paths).toEqual([]);
  });
});

function area(P: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) s += P[j][0] * P[i][1] - P[i][0] * P[j][1];
  return s / 2;
}

describe('profileAlongString', () => {
  it('samples string and surface heights with 3D and plan chainage', () => {
    const idx = buildHeightIndex(gridTin(MGA[0], MGA[1], 10, 20, 20, plane));
    const pts: StringPoint[] = [
      { id: 'a', e: MGA[0] + 10, n: MGA[1] + 10, z: 290 },
      { id: 'b', e: MGA[0] + 110, n: MGA[1] + 10, z: 300 },
    ];
    const p = profileAlongString(idx, pts, 10);
    expect(p.length).toBe(11);
    expect(p[10].planChainage).toBeCloseTo(100, 9);
    expect(p[10].chainage).toBeCloseTo(Math.hypot(100, 10), 9);
    expect(p[5].zString).toBeCloseTo(295, 9);
    expect(p[5].zSurface!).toBeCloseTo(plane(MGA[0] + 60, MGA[1] + 10), 8);
    expect(profileAlongString(null, pts, 50)[1].zSurface).toBeNull();
  });
});
