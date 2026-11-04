import { describe, expect, it } from 'vitest';
import {
  classifyMesh, computeNormals, flipWinding, meshStats, meshTopology, mergeMeshes, orientMesh, signedVolume, toLocalFloat32,
  weldVertices,
} from './mesh';
import { box, cube, gridTin, icosphere, MGA, polyVolume, prism, tetra, translate } from './__tests__/shapes';
import { mulberry32 } from '@/demo/rng';
import type { MeshData } from '@/core/types';

const near = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe('meshStats on analytic solids (at MGA coordinates)', () => {
  it('cube: volume, centroid, closed, footprint', () => {
    const m = translate(cube(10), MGA);
    const s = meshStats(m);
    expect(s.closed).toBe(true);
    expect(s.boundaryEdges).toBe(0);
    near(s.volume!, 1000);
    near(s.centroid[0], MGA[0] + 5); near(s.centroid[1], MGA[1] + 5); near(s.centroid[2], MGA[2] + 5);
    near(s.planArea, 100);
    expect(s.vertexCount).toBe(8);
    expect(s.triangleCount).toBe(12);
    expect(s.bbox.min).toEqual(MGA);
    expect(classifyMesh(m, s)).toBe('solid');
  });

  it('tetrahedron: abc/6 and centroid at a quarter', () => {
    const s = meshStats(translate(tetra(3, 4, 6), MGA));
    near(s.volume!, 12);
    near(s.centroid[0], MGA[0] + 0.75); near(s.centroid[1], MGA[1] + 1); near(s.centroid[2], MGA[2] + 1.5);
  });

  it('triangular prism: abh/2, centroid (a/3, b/3, h/2)', () => {
    const s = meshStats(translate(prism(6, 9, 4), MGA));
    near(s.volume!, 108);
    near(s.centroid[0], MGA[0] + 2); near(s.centroid[1], MGA[1] + 3); near(s.centroid[2], MGA[2] + 2);
    expect(s.closed).toBe(true);
  });

  it('sphere-ish: matches the polyhedron exactly and the analytic sphere within 1 %', () => {
    const ico = icosphere(50, 4);
    const s = meshStats(translate(ico, MGA));
    near(s.volume!, polyVolume(ico), 1e-9);
    expect(Math.abs(s.volume! / ((4 / 3) * Math.PI * 50 ** 3) - 1)).toBeLessThan(0.01);
    for (let k = 0; k < 3; k++) expect(Math.abs(s.centroid[k] - MGA[k])).toBeLessThan(1e-6);
    near(s.planArea, polyPlanFootprint(ico), 1e-9);
  });

  it('inward-wound solid still reports a positive volume', () => {
    const s = meshStats(flipWinding(cube(2)));
    near(s.volume!, 8);
    expect(signedVolume(flipWinding(cube(2)))).toBeCloseTo(-8, 9);
  });
});

function polyPlanFootprint(m: MeshData): number {
  let s = 0;
  const v = m.verts, t = m.tris;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    s += Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a])) / 2;
  }
  return s / 2;
}

describe('closedness and topology', () => {
  it('detects a missing face as boundary edges and an open surface', () => {
    const c = cube(1);
    const open: MeshData = { verts: c.verts, tris: c.tris.slice(0, 30) }; // drop one face (2 triangles)
    const topo = meshTopology(open);
    expect(topo.boundaryEdges).toBe(4);
    expect(topo.closed).toBe(false);
    const s = meshStats(open);
    expect(s.closed).toBe(false);
    expect(s.volume).toBeUndefined();
    expect(classifyMesh(open)).toBe('surface');
  });

  it('flags inconsistent winding and non-manifold edges', () => {
    const c = cube(1);
    const t = c.tris.slice();
    [t[1], t[2]] = [t[2], t[1]]; // flip one triangle
    expect(meshTopology({ verts: c.verts, tris: t }).inconsistentEdges).toBe(3);
    const tripled: MeshData = { verts: c.verts, tris: Uint32Array.from([...c.tris, 0, 2, 1]) };
    expect(meshTopology(tripled).nonManifoldEdges).toBe(3);
    expect(meshTopology(tripled).closed).toBe(false);
  });

  it('counts degenerate triangles and ignores them for topology', () => {
    const c = cube(1);
    const topo = meshTopology({ verts: c.verts, tris: Uint32Array.from([...c.tris, 0, 0, 1]) });
    expect(topo.degenerateTriangles).toBe(1);
    expect(topo.closed).toBe(true);
  });

  it('open grid surface: area-weighted centroid and plan area', () => {
    const g = gridTin(MGA[0], MGA[1], 5, 20, 10, () => 300);
    const s = meshStats(g);
    expect(s.closed).toBe(false);
    near(s.planArea, 100 * 50);
    near(s.centroid[0], MGA[0] + 50); near(s.centroid[1], MGA[1] + 25); near(s.centroid[2], 300);
    expect(s.boundaryEdges).toBe(2 * (20 + 10));
  });
});

describe('weldVertices', () => {
  it('welds a face-soup box into 8 corners and closes it', () => {
    const soup = box(4, 4, 4, 1);
    expect(soup.verts.length / 3).toBe(8);
    expect(meshTopology(soup).closed).toBe(true);
    near(meshStats(soup).volume!, 64);
  });

  it('merges within tolerance only and drops collapsed triangles', () => {
    const m: MeshData = {
      verts: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.004, 0, 0, 1.2, 0, 0]),
      tris: Uint32Array.from([0, 1, 2, 0, 3, 2, 1, 4, 2]),
    };
    const w = weldVertices(m, 0.01);
    expect(w.verts.length / 3).toBe(4);
    expect(w.tris.length / 3).toBe(2); // 0-3-2 collapsed
  });

  it('handles two stacked copies of a cube joined at MGA coordinates', () => {
    const a = translate(cube(1), MGA), b = translate(cube(1), [MGA[0], MGA[1], MGA[2] + 1]);
    const merged = weldVertices(mergeMeshes([a, b]), 1e-6);
    expect(merged.verts.length / 3).toBe(12);
  });
});

describe('render buffers', () => {
  it('toLocalFloat32 maps E,N,Z to x, y·vx, −z about the origin', () => {
    const m: MeshData = { verts: Float64Array.from([236010, 7051020, 305, 236011, 7051020, 305, 236010, 7051021, 306]), tris: Uint32Array.from([0, 1, 2]) };
    const { positions, index } = toLocalFloat32(m, [236000, 7051000, 300], { verticalExaggeration: 2 });
    expect(Array.from(positions.slice(0, 3))).toEqual([10, 10, -20]);
    expect(positions[7]).toBeCloseTo(12, 6);
    expect(index).toBe(m.tris);
  });

  it('faceUp flips down-facing triangles; normals of an up-facing grid point +y in the scene', () => {
    const g = gridTin(0, 0, 1, 3, 3, () => 0);
    const down = flipWinding(g);
    const { positions, index } = toLocalFloat32(down, [0, 0, 0], { faceUp: true });
    const n = computeNormals(positions, index);
    for (let i = 0; i < n.length; i += 3) { expect(n[i + 1]).toBeCloseTo(1, 6); }
    expect(index).not.toBe(down.tris);
  });
});

/** Copy of `m` with the listed triangles' winding reversed. */
function flipTris(m: MeshData, which: Iterable<number>): MeshData {
  const t = m.tris.slice();
  for (const k of which) { const b = t[k * 3 + 1]; t[k * 3 + 1] = t[k * 3 + 2]; t[k * 3 + 2] = b; }
  return { verts: m.verts, tris: t };
}

describe('orientMesh: consistent winding for closed solids', () => {
  it('re-orients faces exported the wrong way round (cube, MGA coordinates) and reports them', () => {
    const good = translate(cube(10), MGA);
    const bad = flipTris(good, [2, 3]);
    const o = orientMesh(bad);
    expect(o.flippedTriangles).toBe(2);
    expect(o.shells).toBe(1);
    expect(o.topology).toEqual(meshTopology(bad));
    expect(meshTopology(o.mesh).inconsistentEdges).toBe(0);
    expect(Array.from(o.mesh.tris)).toEqual(Array.from(good.tris));
    expect(o.mesh.verts).toBe(bad.verts);
    expect(o.warnings).toHaveLength(1);
    expect(o.warnings[0]).toMatch(/2 triangles of 12 faced the wrong way/);
    const s = meshStats(bad);
    near(s.volume!, 1000);
    near(s.centroid[0], MGA[0] + 5); near(s.centroid[1], MGA[1] + 5); near(s.centroid[2], MGA[2] + 5);
    expect(orientMesh(bad)).toBe(o); // cached per mesh object
    expect(bad.tris[7]).not.toBe(good.tris[7]); // the input is not modified
  });

  it('random flips on a 5 120-triangle sphere: exact polyhedron volume, the minority of faces flipped back', () => {
    const ico = translate(icosphere(80, 4), MGA);
    const r = mulberry32(11), T = ico.tris.length / 3;
    const which = Array.from({ length: T }, (_, k) => k).filter(() => r() < 0.3);
    const bad = flipTris(ico, which);
    expect(meshTopology(bad).inconsistentEdges).toBeGreaterThan(0);
    const o = orientMesh(bad);
    expect(o.flippedTriangles).toBe(which.length);
    expect(Array.from(o.mesh.tris)).toEqual(Array.from(ico.tris));
    near(meshStats(bad).volume!, polyVolume(icosphere(80, 4)), 1e-9);
  });

  it('keeps the file majority winding: an inward-wound solid is left alone, a mostly flipped one ends up inward', () => {
    const inward = flipWinding(cube(2));
    const o = orientMesh(inward);
    expect(o.flippedTriangles).toBe(0);
    expect(o.warnings).toEqual([]);
    expect(o.mesh).toBe(inward);
    near(meshStats(inward).volume!, 8);
    const most = flipTris(cube(10), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // 10 of 12 inward
    const m = orientMesh(most);
    expect(m.flippedTriangles).toBe(2);
    expect(signedVolume(m.mesh)).toBeCloseTo(-1000, 9);
    near(meshStats(most).volume!, 1000);
  });

  it('flips a separate shell wound inside-out, but keeps a void (nested shell) wound opposite', () => {
    const a = translate(cube(10), MGA), b = translate(flipWinding(cube(4)), [MGA[0] + 30, MGA[1], MGA[2]]);
    const two = mergeMeshes([a, b]);
    const o = orientMesh(two);
    expect(o.shells).toBe(2);
    expect(o.invertedShells).toBe(1);
    expect(o.flippedTriangles).toBe(12);
    expect(o.warnings.join(' ')).toMatch(/1 separate shell was wound inside-out/);
    near(meshStats(two).volume!, 1000 + 64);
    // a 4 m void in the middle of a 10 m cube, wound inward as it should be: 1000 − 64
    const hole = translate(flipWinding(cube(4)), [MGA[0] + 3, MGA[1] + 3, MGA[2] + 3]);
    const hollow = mergeMeshes([a, hole]);
    const h = orientMesh(hollow);
    expect(h.invertedShells).toBe(0);
    expect(h.flippedTriangles).toBe(0);
    near(meshStats(hollow).volume!, 1000 - 64);
    // ... and with one face of the void exported the wrong way: still 936, one face fixed
    const hollowBad = mergeMeshes([a, flipTris(hole, [5])]);
    expect(orientMesh(hollowBad).flippedTriangles).toBe(1);
    near(meshStats(hollowBad).volume!, 1000 - 64);
  });

  it('high-valence fan vertices (a 4 000-sided cone: apex and base-centre fans) stay fast and exact', () => {
    const n = 4000, r = 20, h = 15, v: number[] = [0, 0, h, 0, 0, 0], t: number[] = [];
    for (let i = 0; i < n; i++) v.push(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), 0);
    for (let i = 0; i < n; i++) { const a = 2 + i, b = 2 + ((i + 1) % n); t.push(0, a, b, 1, b, a); }
    const cone = translate({ verts: Float64Array.from(v), tris: Uint32Array.from(t) }, MGA);
    const exact = signedVolume(cone);
    expect(exact).toBeGreaterThan(0);
    const bad = flipTris(cone, Array.from({ length: n }, (_, i) => i * 2 + (i % 3 === 0 ? 1 : 0)).filter((_, i) => i % 5 === 0));
    const t0 = performance.now();
    const o = orientMesh(bad);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(o.topology).toEqual(meshTopology(bad));
    expect(o.flippedTriangles).toBe(n / 5);
    near(meshStats(bad).volume!, exact, 1e-9);
  });

  it('non-orientable closed mesh (6-vertex projective plane): left as is, abs-volume fallback, with a warning', () => {
    const verts = Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10, 7, 7, 1, 3, 1, 8]);
    const f = [[1, 2, 3], [1, 3, 4], [1, 4, 5], [1, 5, 6], [1, 6, 2], [2, 3, 5], [3, 4, 6], [4, 5, 2], [5, 6, 3], [6, 2, 4]];
    const rp2: MeshData = { verts, tris: Uint32Array.from(f.flat().map(i => i - 1)) };
    expect(meshTopology(rp2).closed).toBe(true);
    const o = orientMesh(rp2);
    expect(o.nonOrientableShells).toBe(1);
    expect(o.flippedTriangles).toBe(0);
    expect(o.mesh).toBe(rp2);
    expect(o.warnings.join(' ')).toMatch(/cannot be wound consistently/);
    near(meshStats(rp2).volume!, Math.abs(signedVolume(rp2)));
  });

  it('non-manifold and open meshes are not re-oriented; non-manifold edges are flagged', () => {
    const c = cube(1);
    const tripled: MeshData = { verts: c.verts, tris: Uint32Array.from([...flipTris(c, [4]).tris, 0, 2, 1]) };
    const o = orientMesh(tripled);
    expect(o.mesh).toBe(tripled);
    expect(o.flippedTriangles).toBe(0);
    expect(o.topology).toEqual(meshTopology(tripled));
    expect(o.warnings.join(' ')).toMatch(/3 edges are shared by three or more triangles/);
    const g = gridTin(0, 0, 1, 6, 6, (x, y) => x * y * 0.1);
    const mixed = flipTris(g, [0, 3, 9]);
    const og = orientMesh(mixed);
    expect(og.mesh).toBe(mixed);
    expect(og.warnings).toEqual([]);
    expect(og.topology).toEqual(meshTopology(mixed));
    const degen: MeshData = { verts: c.verts, tris: Uint32Array.from([...c.tris, 0, 0, 1]) };
    expect(orientMesh(degen).topology).toEqual(meshTopology(degen));
    expect(orientMesh(flipTris(degen, [1])).flippedTriangles).toBe(1);
  });
});
