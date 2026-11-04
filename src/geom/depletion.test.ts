import { describe, expect, it } from 'vitest';
import {
  capLoops, clipMesh, depletionNormal, depletionPlane, prepareSolid, toScenePlane, volumeBehindPlane, volumeBeyondPlane,
} from './depletion';
import { meshStats, meshTopology } from './mesh';
import { box, extrude, icosphere, MGA, translate } from './__tests__/shapes';
import type { Vec3 } from '@/core/types';

const B = { sx: 60, sy: 40, sz: 20 };
const solid = translate(box(B.sx, B.sy, B.sz, 6), MGA);
const total = B.sx * B.sy * B.sz;
const within = (v: number, want: number, rel: number) => expect(Math.abs(v - want)).toBeLessThanOrEqual(rel * Math.max(want, total * 1e-12) + 1e-9);

describe('depletionPlane', () => {
  it('bench-down: removed volumes at 0, 25, 50, 100 % within 0.2 % and plane height', () => {
    for (const f of [0, 0.25, 0.5, 1]) {
      const p = depletionPlane(solid, 'bench-down', 0, f);
      within(p.volumeRemoved, f * total, 0.002);
      expect(p.volumeTotal).toBeCloseTo(total, 6);
      expect(p.normal).toEqual([0, 0, -1]);
      // the plane z = top − f·H  (normal (0,0,−1): −z = constant)
      expect(-p.constant).toBeCloseTo(MGA[2] + B.sz * (1 - f), 3);
      expect(p.point[2]).toBeCloseTo(MGA[2] + B.sz * (1 - f), 3);
    }
  });

  it('face-advance east (azimuth 90°): the face moves along +E', () => {
    const p = depletionPlane(solid, 'face-advance', 90, 0.25);
    expect(p.normal[0]).toBeCloseTo(1, 12);
    expect(p.normal[1]).toBeCloseTo(0, 12);
    expect(p.constant).toBeCloseTo(MGA[0] + 0.25 * B.sx, 3);
    within(p.volumeRemoved, 0.25 * total, 0.002);
    const n = depletionPlane(solid, 'face-advance', 0, 0.5);
    expect(n.constant).toBeCloseTo(MGA[1] + 0.5 * B.sy, 3);
  });

  it('bottom-up fill and an oblique face on a sphere', () => {
    const p = depletionPlane(solid, 'bottom-up', 0, 0.25);
    expect(p.constant).toBeCloseTo(MGA[2] + 0.25 * B.sz, 3);
    const ball = translate(icosphere(30, 3), MGA);
    const V = meshStats(ball).volume!;
    for (const f of [0.1, 0.5, 0.9]) {
      const q = depletionPlane(ball, 'face-advance', 33, f);
      within(q.volumeRemoved, f * V, 0.002);
    }
    const half = depletionPlane(ball, 'face-advance', 33, 0.5);
    const c = half.normal[0] * MGA[0] + half.normal[1] * MGA[1];
    expect(half.constant - c).toBeCloseTo(0, 1); // through the centre
  });

  it('volumeBeyondPlane + volumeBehindPlane = total; the cached handle is reused', () => {
    const h = prepareSolid(solid);
    expect(prepareSolid(solid)).toBe(h);
    const plane = { normal: [0.3, -0.5, 0.2] as Vec3, constant: 0.3 * (MGA[0] + 25) - 0.5 * (MGA[1] + 20) + 0.2 * (MGA[2] + 9) };
    const a = volumeBeyondPlane(h, plane), b = volumeBehindPlane(solid, plane);
    expect(a + b).toBeCloseTo(total, 6);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // a non-unit normal is normalised
    const scaled = { normal: [3, -5, 2] as Vec3, constant: plane.constant * 10 };
    expect(volumeBeyondPlane(h, scaled)).toBeCloseTo(a, 6);
  });

  it('is fast enough to call every frame (well under 1 ms per call)', () => {
    const big = translate(box(300, 120, 15, 40), MGA);
    const h = prepareSolid(big);
    depletionPlane(h, 'face-advance', 90, 0.5); // builds the table
    const t0 = performance.now();
    let s = 0;
    for (let k = 0; k <= 500; k++) s += depletionPlane(h, 'face-advance', 90, k / 500).volumeRemoved;
    const per = (performance.now() - t0) / 501;
    console.info(`depletionPlane: ${(per * 1000).toFixed(0)} µs per call on ${big.tris.length / 3} triangles`);
    expect(s).toBeGreaterThan(0);
    expect(per).toBeLessThan(1);
  });

  it('depletionNormal follows the azimuth convention', () => {
    const n = depletionNormal('face-advance', 180);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(-1, 12);
  });
});

describe('capLoops / clipMesh', () => {
  it('cap of a box has the analytic cross-section area', () => {
    const p = depletionPlane(solid, 'bench-down', 0, 0.5);
    const cap = capLoops(solid, p);
    expect(cap.loops.length).toBe(1);
    expect(cap.area).toBeCloseTo(B.sx * B.sy, 6);
    expect(cap.openChains).toBe(0);
    expect(cap.normal).toEqual([0, 0, 1]); // faces the removed (upper) side
    for (const v of cap.loops[0]) expect(v[2]).toBeCloseTo(MGA[2] + 10, 6);
    const face = capLoops(solid, depletionPlane(solid, 'face-advance', 90, 0.3));
    expect(face.area).toBeCloseTo(B.sy * B.sz, 6);
    // cap triangles face the cap normal
    const m = cap.mesh, v = m.verts;
    for (let k = 0; k < m.tris.length; k += 3) {
      const a = m.tris[k] * 3, b = m.tris[k + 1] * 3, c = m.tris[k + 2] * 3;
      const nz = (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a]);
      expect(nz).toBeGreaterThanOrEqual(0);
    }
  });

  it('a ring-shaped solid gives an outer loop and a hole (area = outer − hole)', () => {
    const tube = translate(extrude([[0, 0, 10, 0, 10, 10, 0, 10], [3, 3, 7, 3, 7, 7, 3, 7]], 5), MGA);
    expect(meshTopology(tube).closed).toBe(true);
    const cap = capLoops(tube, { normal: [0, 0, 1], constant: MGA[2] + 2.5 });
    expect(cap.loops.length).toBe(2);
    expect(cap.area).toBeCloseTo(100 - 16, 6);
    const ball = translate(icosphere(20, 3), MGA);
    const s = capLoops(ball, { normal: [0, 0, 1], constant: MGA[2] + 0.37 });
    const r2 = 400 - 0.37 * 0.37;
    expect(Math.abs(s.area / (Math.PI * r2) - 1)).toBeLessThan(0.02);
  });

  it('clipMesh returns closed solids whose volumes match the depletion volumes', () => {
    const p = depletionPlane(solid, 'face-advance', 60, 0.4);
    const front = clipMesh(solid, p, 'front'), back = clipMesh(solid, p, 'back');
    const sf = meshStats(front), sb = meshStats(back);
    expect(sf.closed).toBe(true);
    expect(sb.closed).toBe(true);
    within(sb.volume!, p.volumeRemoved, 1e-6);
    within(sf.volume!, total - p.volumeRemoved, 1e-6);
    expect(meshTopology(front).inconsistentEdges).toBe(0);
    // a cut exactly through a vertex layer still closes
    const flush = clipMesh(solid, { normal: [0, 0, 1], constant: MGA[2] + 10 }, 'back');
    expect(meshStats(flush).closed).toBe(true);
    within(meshStats(flush).volume!, total / 2, 1e-6);
    const ring = translate(extrude([[0, 0, 10, 0, 10, 10, 0, 10], [3, 3, 7, 3, 7, 7, 3, 7]], 5), MGA);
    const rc = clipMesh(ring, { normal: [1, 0, 0], constant: MGA[0] + 5 }, 'front');
    expect(meshStats(rc).closed).toBe(true);
    within(meshStats(rc).volume!, (100 - 16) * 5 / 2, 1e-6);
  });

  it('toScenePlane keeps the requested side in the Three.js frame', () => {
    const origin: Vec3 = [MGA[0], MGA[1], 0];
    const p = depletionPlane(solid, 'face-advance', 90, 0.5); // E = MGA + 30, front = east
    const sp = toScenePlane(p, origin, 2, 'front');
    const scene = (e: number, n: number, z: number) => [e - origin[0], (z - origin[2]) * 2, -(n - origin[1])];
    const dot = (q: number[]) => sp.normal[0] * q[0] + sp.normal[1] * q[1] + sp.normal[2] * q[2] + sp.constant;
    expect(dot(scene(MGA[0] + 40, MGA[1] + 5, MGA[2] + 3))).toBeGreaterThan(0);
    expect(dot(scene(MGA[0] + 20, MGA[1] + 5, MGA[2] + 3))).toBeLessThan(0);
    expect(dot(scene(MGA[0] + 30, MGA[1] + 5, MGA[2] + 3))).toBeCloseTo(0, 6);
    const back = toScenePlane(p, origin, 2, 'back');
    expect(back.normal[0]).toBeCloseTo(-sp.normal[0], 12);
  });
});
