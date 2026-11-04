import { describe, expect, it } from 'vitest';
import {
  classifyMesh, computeNormals, flipWinding, meshStats, meshTopology, mergeMeshes, signedVolume, toLocalFloat32, weldVertices,
} from './mesh';
import { box, cube, gridTin, icosphere, MGA, polyVolume, prism, tetra, translate } from './__tests__/shapes';
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
