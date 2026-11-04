/**
 * Independent review: src/geom/** (mesh stats / volumes, depletion handle).
 */
import { describe, expect, it } from 'vitest';
import { cube } from '@/geom/__tests__/shapes';
import { meshStats, meshTopology } from '@/geom/mesh';
import { prepareSolid } from '@/geom/depletion';
import { reversePoints } from '@/geom/strings';
import type { StringPoint } from '@/core/types';

/** 10 m cube (1000 m³) with the two top-face triangles wound inward: still closed, winding inconsistent. */
function cubeWithFlippedTop() {
  const c = cube(10);
  const t = c.tris.slice();
  for (const k of [2, 3]) { const b = t[k * 3 + 1]; t[k * 3 + 1] = t[k * 3 + 2]; t[k * 3 + 2] = b; }
  return { verts: c.verts, tris: t };
}

describe('review: reversePoints', () => {
  it('R-GEOM-2 reversing a string keeps a one-way stop on the same traffic stream (loaded ↔ empty swap)', () => {
    const pts: StringPoint[] = [
      { id: 'a', e: 0, n: 0, z: 0 }, { id: 'b', e: 100, n: 0, z: 5, stop: true, stopOneWay: 'loaded' }, { id: 'c', e: 200, n: 0, z: 10 },
    ];
    // trucks travelling a→c stop at b. After reversal the dig is at c, so a→c traffic is the EMPTY leg.
    const r = reversePoints(pts);
    expect(r[1].id).toBe('b');
    expect(r[1].stopOneWay).toBe('empty');                    // actual: still 'loaded' → the other stream stops
  });
});

describe('review: closed solids with inconsistent winding', () => {
  it('R-GEOM-1 meshStats must not report a wrong volume for a closed solid with mixed winding', () => {
    const m = cubeWithFlippedTop();
    const topo = meshTopology(m);
    expect(topo.closed).toBe(true);
    expect(topo.inconsistentEdges).toBeGreaterThan(0);
    const v = meshStats(m).volume;
    // either the true 1000 m³ (after re-orienting) or "unknown" — never a confident wrong number (666.7 m³)
    expect(v === undefined || Math.abs(v - 1000) < 1e-6).toBe(true);
  });

  it('R-GEOM-1b prepareSolid (depletion volumes) has the same defect', () => {
    const h = prepareSolid(cubeWithFlippedTop());
    expect(h.volume).toBeCloseTo(1000, 6);
  });
});
