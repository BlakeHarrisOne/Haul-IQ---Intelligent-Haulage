/**
 * Independent review: src/io/strings.ts DXF export.
 */
import { describe, expect, it } from 'vitest';
import { toDxf3dPolyline } from '@/io/strings';

/** Pairs (code, value) of an ASCII DXF. */
function pairs(dxf: string): [number, string][] {
  const l = dxf.split('\r\n');
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < l.length; i += 2) out.push([Number(l[i].trim()), l[i + 1]]);
  return out;
}

describe('review: toDxf3dPolyline', () => {
  it('R-IO-1 every string gets its own, unique layer (no duplicate LAYER table records)', () => {
    const pts = [[0, 0, 0], [10, 0, 1]];
    const dxf = toDxf3dPolyline([{ name: 'Haul', points: pts }, { name: 'Haul', points: pts }, { name: 'Haul 2', points: pts }]);
    const p = pairs(dxf);
    const layers: string[] = [];
    for (let i = 0; i + 1 < p.length; i++) if (p[i][0] === 0 && p[i][1] === 'LAYER') layers.push(p[i + 1][1]);
    expect(new Set(layers).size).toBe(layers.length);         // actual: HAUL_2 listed twice
    const polyLayers: string[] = [];
    for (let i = 0; i + 1 < p.length; i++) if (p[i][0] === 0 && p[i][1] === 'POLYLINE') polyLayers.push(p[i + 1][1]);
    expect(new Set(polyLayers).size).toBe(3);                 // actual: strings 2 and 3 share a layer
  });

  it('R-IO-2 a non-finite coordinate is not silently written as 0.0 (a phantom vertex at the grid origin)', () => {
    const dxf = (() => {
      try { return toDxf3dPolyline({ name: 'H', points: [[236000, 7051000, 100], [236010, 7051000, NaN], [236020, 7051000, 101]] }); }
      catch { return null; }
    })();
    // acceptable: throw, or drop/flag the bad vertex; not acceptable: "30\r\n0.0" for a real vertex
    if (dxf) expect(dxf).not.toMatch(/\r\n30\r\n0\.0\r\n70\r\n32/);
  });
});
