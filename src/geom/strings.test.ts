import { describe, expect, it } from 'vitest';
import type { StringPoint } from '@/core/types';
import {
  densify, fromVec3, gradeClass, insertPoint, movePoint, nearestOnString, removePoint, reversePoints, simplify3d,
  smoothGrades, snapPoints, stringMetrics, toVec3,
} from './strings';
import { buildHeightIndex } from './heightIndex';
import { gridTin, MGA } from './__tests__/shapes';
import { mulberry32 } from '@/demo/rng';

const plane = (x: number, y: number) => 300 + 0.05 * (x - MGA[0]);
const idx = buildHeightIndex(gridTin(MGA[0], MGA[1], 10, 100, 100, plane));

const pts = (xyz: number[][]): StringPoint[] => xyz.map((p, i) => ({ id: `p${i}`, e: p[0], n: p[1], z: p[2] }));

describe('snap / densify / simplify', () => {
  it('snapPoints takes the surface height and flags points off the surface', () => {
    const s = snapPoints(idx, pts([[MGA[0] + 100, MGA[1] + 10, 0], [MGA[0] - 50, MGA[1], 7]]));
    expect(s[0].z).toBeCloseTo(305, 9);
    expect(s[0].snapped).toBe(true);
    expect(s[1]).toMatchObject({ z: 7, snapped: false });
  });

  it('densify: no segment longer than the step, originals kept in order, inserted points snapped', () => {
    const src = pts([[MGA[0] + 10, MGA[1] + 10, 0], [MGA[0] + 300, MGA[1] + 90, 1], [MGA[0] + 320, MGA[1] + 95, 2], [MGA[0] + 800, MGA[1] + 700, 3]]);
    src[1].seg = { zone: 'ramp' };
    const d = densify(idx, src, 25);
    const m = stringMetrics(d);
    for (const s of m.segments) expect(s.distPlan).toBeLessThanOrEqual(25 + 1e-9);
    expect(d.filter(p => src.includes(p))).toEqual(src); // same objects, same order
    const inserted = d.filter(p => !src.includes(p));
    expect(inserted.length).toBeGreaterThan(30);
    for (const p of inserted) { expect(p.snapped).toBe(true); expect(p.z).toBeCloseTo(plane(p.e, p.n), 8); }
    // inserted points between src[1] and src[2] inherit the ramp zone
    const i1 = d.indexOf(src[1]), i2 = d.indexOf(src[2]);
    for (let i = i1 + 1; i < i2; i++) expect(d[i].seg?.zone).toBe('ramp');
    // without an index, heights interpolate
    const lin = densify(null, src.slice(0, 2), 50);
    expect(lin[1].snapped).toBe(false);
    expect(lin[1].z).toBeGreaterThan(0);
    expect(lin[1].z).toBeLessThan(1);
  });

  it('simplify3d keeps ends, returns a subset, and stays within tolerance', () => {
    const r = mulberry32(5);
    const raw = pts(Array.from({ length: 300 }, (_, i) => [i * 5, Math.sin(i / 20) * 40 + r() * 0.2, Math.cos(i / 35) * 10]));
    const tol = 0.5;
    const s = simplify3d(raw, tol);
    expect(s[0]).toBe(raw[0]);
    expect(s[s.length - 1]).toBe(raw[raw.length - 1]);
    expect(s.length).toBeLessThan(raw.length / 3);
    // every original point within tol of the simplified polyline
    for (const p of raw) {
      let best = Infinity;
      for (let i = 0; i + 1 < s.length; i++) best = Math.min(best, dist3(p, s[i], s[i + 1]));
      expect(best).toBeLessThanOrEqual(tol + 1e-9);
    }
    expect(simplify3d(raw, 0).length).toBeGreaterThan(290);
  });
});

function dist3(p: StringPoint, a: StringPoint, b: StringPoint): number {
  const dx = b.e - a.e, dy = b.n - a.n, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
  const t = Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy + (p.z - a.z) * dz) / L2));
  return Math.hypot(p.e - a.e - t * dx, p.n - a.n - t * dy, p.z - a.z - t * dz);
}

describe('stringMetrics', () => {
  it('computes 3D/plan lengths, grades (dZ/3D), chainage, rise/fall', () => {
    const s = pts([[0, 0, 0], [100, 0, 10], [100, 50, 10], [100, 150, 0]]);
    const m = stringMetrics(s);
    expect(m.segments[0].dist3d).toBeCloseTo(Math.hypot(100, 10), 12);
    expect(m.segments[0].grade).toBeCloseTo(10 / Math.hypot(100, 10), 12);
    expect(m.segments[1].grade).toBe(0);
    expect(m.segments[2].grade).toBeCloseTo(-10 / Math.hypot(100, 10), 12);
    expect(m.segments[2].chainage).toBeCloseTo(Math.hypot(100, 10) + 50, 9);
    expect(m.rise).toBe(10);
    expect(m.fall).toBe(10);
    expect(m.planLength).toBe(250);
    expect(m.maxGrade).toBeCloseTo(0.0995, 4);
    expect(m.minGrade).toBeCloseTo(-0.0995, 4);
    expect(m.maxAbsGrade).toBeCloseTo(0.0995, 4);
    expect(m.averageGrade).toBe(0);
    expect(m.meanAbsGrade).toBeCloseTo(20 / m.length, 12);
    expect(stringMetrics([]).length).toBe(0);
  });

  it('gradeClass thresholds: ≤4 % flat, ≤8 % moderate, ≤10 % steep, >10 % excessive', () => {
    expect(gradeClass(0)).toBe('flat');
    expect(gradeClass(-0.04)).toBe('flat');
    expect(gradeClass(0.0401)).toBe('moderate');
    expect(gradeClass(0.08)).toBe('moderate');
    expect(gradeClass(-0.095)).toBe('steep');
    expect(gradeClass(0.1)).toBe('steep');
    expect(gradeClass(0.1001)).toBe('excessive');
  });
});

describe('editing', () => {
  const base = () => {
    const s = pts([[0, 0, 0], [10, 0, 1], [20, 0, 2], [30, 0, 3]]);
    s[0].seg = { zone: 'pit' }; s[1].seg = { zone: 'ramp' }; s[2].seg = { zone: 'road' };
    return s;
  };

  it('reversePoints moves segment overrides with their segments', () => {
    const r = reversePoints(base());
    expect(r.map(p => p.id)).toEqual(['p3', 'p2', 'p1', 'p0']);
    expect(r.map(p => p.seg?.zone)).toEqual(['road', 'ramp', 'pit', undefined]);
    expect(reversePoints(reversePoints(base())).map(p => p.seg?.zone)).toEqual(['pit', 'ramp', 'road', undefined]);
  });

  it('insertPoint interpolates or snaps, inherits the split segment; remove / move', () => {
    const s = base();
    const a = insertPoint(s, 2, 15, 1);
    expect(a.length).toBe(5);
    expect(a[2]).toMatchObject({ e: 15, n: 1, snapped: false });
    expect(a[2].z).toBeCloseTo(1.5, 9);
    expect(a[2].seg?.zone).toBe('ramp');
    expect(s.length).toBe(4); // input untouched
    const b = insertPoint(s, 0, MGA[0] + 20, MGA[1] + 20, idx);
    expect(b[0]).toMatchObject({ snapped: true });
    expect(b[0].z).toBeCloseTo(301, 9);
    expect(removePoint(s, 1).map(p => p.id)).toEqual(['p0', 'p2', 'p3']);
    expect(removePoint(s, 9)).toEqual(s);
    const m = movePoint(s, 1, MGA[0] + 40, MGA[1] + 40, idx);
    expect(m[1]).toMatchObject({ id: 'p1', e: MGA[0] + 40, snapped: true });
    expect(m[1].z).toBeCloseTo(302, 9);
    expect(m[0]).toBe(s[0]);
    expect(movePoint(s, 1, -1e6, 0, idx)[1]).toMatchObject({ z: 1, snapped: false });
  });

  it('nearestOnString gives segment, t, plan distance and 3D chainage', () => {
    const s = pts([[0, 0, 0], [30, 40, 0], [30, 100, 60]]);
    const q = nearestOnString(s, 30, 70)!;
    expect(q.segment).toBe(1);
    expect(q.t).toBeCloseTo(0.5, 12);
    expect(q.distance).toBeCloseTo(0, 12);
    expect(q.chainage).toBeCloseTo(50 + Math.hypot(60, 60) / 2, 9);
    expect(q.point[2]).toBeCloseTo(30, 12);
    const off = nearestOnString(s, -3, -4)!;
    expect(off).toMatchObject({ segment: 0, t: 0 });
    expect(off.distance).toBeCloseTo(5, 12);
    expect(nearestOnString([], 0, 0)).toBeNull();
  });

  it('smoothGrades evens out a sawtooth and keeps the ends', () => {
    const s = pts(Array.from({ length: 41 }, (_, i) => [i * 10, 0, i * 0.5 + (i % 2 ? 0.8 : -0.8)]));
    const sm = smoothGrades(s, 60);
    expect(sm[0]).toBe(s[0]);
    expect(sm[40]).toBe(s[40]);
    // interior segments (the fixed end points keep their offsets)
    const inner = (q: StringPoint[]) => Math.max(...stringMetrics(q).segments.slice(1, -1).map(x => Math.abs(x.grade)));
    expect(inner(sm)).toBeLessThan(inner(s) / 2);
    expect(inner(sm)).toBeLessThan(0.08);
    expect(sm[20].snapped).toBe(false);
  });

  it('fromVec3 / toVec3 round-trip', () => {
    const v = [[1, 2, 3], [4, 5, 6]] as [number, number, number][];
    const p = fromVec3(v, { snapped: true });
    expect(p[0].id).not.toBe(p[1].id);
    expect(toVec3(p)).toEqual(v);
  });
});
