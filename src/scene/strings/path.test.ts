import { describe, expect, it } from 'vitest';
import { buildPath, densifyPoints, gradeClassOf, gradeRuns, legAt, legGrade, nearestOnPath, polylineStats, sampleAt } from './path';

const L = (pts: [number, number, number][]) => pts.map(([e, n, z]) => ({ e, n, z }));

describe('buildPath / sampleAt', () => {
  const p = buildPath(L([[0, 0, 0], [100, 0, 0], [100, 0, 0], [100, 100, 10]]));

  it('drops zero-length legs and accumulates 3D chainage', () => {
    expect(p.n).toBe(3);
    expect(Array.from(p.src)).toEqual([0, 1, 3]);
    expect(p.s[1]).toBeCloseTo(100);
    expect(p.length).toBeCloseTo(100 + Math.hypot(100, 10));
    expect(p.planLength).toBeCloseTo(200);
  });

  it('samples by chainage with heading and grade', () => {
    const a = sampleAt(p, 50);
    expect([a.e, a.n, a.z]).toEqual([50, 0, 0]);
    expect(a.heading).toBeCloseTo(0);
    const b = sampleAt(p, 100 + Math.hypot(100, 10) / 2);
    expect(b.e).toBeCloseTo(100);
    expect(b.n).toBeCloseTo(50);
    expect(b.z).toBeCloseTo(5);
    expect(b.heading).toBeCloseTo(Math.PI / 2);
    expect(b.grade).toBeCloseTo(10 / Math.hypot(100, 10));
  });

  it('extrapolates past both ends along the end legs', () => {
    expect(sampleAt(p, -20).e).toBeCloseTo(-20);
    const end = sampleAt(p, p.length + Math.hypot(100, 10));
    expect(end.n).toBeCloseTo(200);
    expect(end.z).toBeCloseTo(20);
  });

  it('finds legs by binary search', () => {
    expect(legAt(p, 0)).toBe(0);
    expect(legAt(p, 99.9)).toBe(0);
    expect(legAt(p, 150)).toBe(1);
    expect(legAt(p, 1e9)).toBe(1);
  });

  it('nearestOnPath projects in plan', () => {
    const r = nearestOnPath(p, 40, 7);
    expect(r.chainage).toBeCloseTo(40);
    expect(r.dist).toBeCloseTo(7);
  });
});

describe('grades', () => {
  it('classifies at the 4 / 8 / 10 % limits', () => {
    expect(gradeClassOf(0.04)).toBe('flat');
    expect(gradeClassOf(-0.0401)).toBe('mod');
    expect(gradeClassOf(0.08)).toBe('mod');
    expect(gradeClassOf(0.1)).toBe('steep');
    expect(gradeClassOf(-0.12)).toBe('max');
  });

  it('merges consecutive legs of one class and direction into runs', () => {
    const p = buildPath(L([[0, 0, 0], [100, 0, 9], [200, 0, 18], [300, 0, 18], [400, 0, 9]]));
    const runs = gradeRuns(p);
    expect(runs.map(r => r.cls)).toEqual(['steep', 'flat', 'steep']);
    expect(runs[0].i1).toBe(1);
    expect(Math.sign(runs[2].grade)).toBe(-1);
    expect(legGrade(p, 0)).toBeCloseTo(9 / Math.hypot(100, 9));
  });
});

describe('densify / stats', () => {
  it('inserts surface points every ≤ step m and keeps the originals', () => {
    const pts = L([[0, 0, 0], [100, 0, 10]]);
    const out = densifyPoints(pts, 25, (e) => e / 5, (e, n, z, snapped) => ({ e, n, z, snapped }));
    expect(out.length).toBe(5);
    expect(out[0]).toBe(pts[0]);
    expect(out[4]).toBe(pts[1]);
    expect(out[2].z).toBeCloseTo(10); // from the surface (50 / 5), not the chord (5)
  });

  it('measures 3D / plan length, rise / fall and average grade', () => {
    const s = polylineStats(L([[0, 0, 100], [30, 40, 110], [30, 140, 105]]));
    expect(s.lengthPlan).toBeCloseTo(150);
    expect(s.length3d).toBeCloseTo(Math.hypot(50, 10) + Math.hypot(100, 5));
    expect(s.rise).toBeCloseTo(10);
    expect(s.fall).toBeCloseTo(5);
    expect(s.avgGrade).toBeCloseTo(5 / 150);
    expect(s.legs).toHaveLength(2);
  });
});
