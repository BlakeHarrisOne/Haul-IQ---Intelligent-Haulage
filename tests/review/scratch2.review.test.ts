import { it, expect } from 'vitest';
import { box, cube, extrude, gridTin, icosphere, MGA, translate } from '@/geom/__tests__/shapes';
import { meshStats, meshTopology, signedVolume } from '@/geom/mesh';
import { prepareSolid, depletionPlane, volumeBehindPlane, clipMesh, capLoops, volumeBeyondPlane } from '@/geom/depletion';
import { buildHeightIndex, heightAt, rasterize, gridHeightAt } from '@/geom/heightIndex';
import { sectionCut } from '@/geom/section';

it('scratch geom', () => {
  // U-shape (concave) extruded
  const U = [0, 0, 300, 0, 300, 200, 200, 200, 200, 50, 100, 50, 100, 200, 0, 200];
  const m = translate(extrude([U], 40), MGA);
  const st = meshStats(m);
  console.log('U volume', st.volume, 'expected', (300 * 200 - 100 * 150) * 40);
  const h = prepareSolid(m);
  for (const az of [0, 90, 45, 180, 270, 33]) {
    for (const f of [0.05, 0.2, 0.37, 0.5, 0.63, 0.9, 0.999]) {
      const dp = depletionPlane(h, 'face-advance', az, f);
      const vb = volumeBehindPlane(h, dp);
      const clip = clipMesh(h, dp, 'front');
      const cv = signedVolume(clip);
      const back = clipMesh(h, dp, 'back');
      const bv = signedVolume(back);
      if (Math.abs(dp.fraction - f) > 1e-4 || Math.abs(cv - (h.volume - vb)) > 1e-3 * h.volume || Math.abs(bv - vb) > 1e-3 * h.volume || !meshTopology(clip).closed)
        console.log('MISMATCH az', az, 'f', f, dp.fraction, 'clipFront', cv, 'expected', h.volume - vb, 'clipBack', bv, vb, meshTopology(clip));
    }
  }
  for (const mode of ['bench-down', 'bottom-up'] as const) for (const f of [0.1, 0.5, 0.9]) {
    const dp = depletionPlane(h, mode, 0, f);
    const cap = capLoops(h, dp, 'front');
    if (Math.abs(dp.fraction - f) > 1e-4 || Math.abs(cap.area - (300 * 200 - 100 * 150)) > 1) console.log('cap', mode, f, dp.fraction, cap.area, cap.openChains);
  }
  // sphere
  const s = translate(icosphere(50, 3), MGA);
  const hs = prepareSolid(s);
  for (const f of [0.01, 0.3, 0.5, 0.99]) {
    const dp = depletionPlane(hs, 'bench-down', 0, f);
    if (Math.abs(dp.fraction - f) > 1e-4) console.log('sphere', f, dp.fraction);
  }
  // height index edges
  const tin = translate(gridTin(0, 0, 10, 20, 20, (x, y) => 0.1 * x + 0.05 * y), MGA);
  const idx = buildHeightIndex(tin);
  const pts = [[200, 200], [200, 0], [0, 200], [0, 0], [199.9999999, 199.9999999], [100, 200], [200, 100]];
  for (const [x, y] of pts) {
    const z = heightAt(idx, x + MGA[0], y + MGA[1]);
    const ex = MGA[2] + 0.1 * x + 0.05 * y;
    if (z == null || Math.abs(z - ex) > 1e-6) console.log('heightAt', x, y, z, ex, idx.cell, idx.nx, idx.ny);
  }
  const g = rasterize(tin, 7);
  for (const [x, y] of pts) {
    const z = gridHeightAt(g, x + MGA[0], y + MGA[1]);
    const ex = MGA[2] + 0.1 * x + 0.05 * y;
    if (z == null || Math.abs(z - ex) > 1e-3) console.log('gridHeightAt', x, y, z, ex, g.x0, g.y0, g.nx, g.ny);
  }
  // section through U
  const sc = sectionCut(m, [MGA[0] - 10, MGA[1] + 100], [MGA[0] + 310, MGA[1] + 100]);
  console.log('section paths', sc.paths.length, sc.paths.map(p => p.points.length));
  // flipped cube
  const c = cube(10);
  const t = c.tris.slice();
  // flip top face (tris 2 and 3)
  for (const k of [2, 3]) { const b = t[k * 3 + 1]; t[k * 3 + 1] = t[k * 3 + 2]; t[k * 3 + 2] = b; }
  const fc = { verts: c.verts, tris: t };
  console.log('flipped cube', meshTopology(fc), meshStats(fc).volume, prepareSolid(fc).volume);
  expect(1).toBe(1);
});
