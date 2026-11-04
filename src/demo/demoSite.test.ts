import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoSite, DEMO_IDS, type DemoSite } from './demoSite';
import { stringMetrics } from '@/geom/strings';
import { depletionPlane, prepareSolid } from '@/geom/depletion';
import { autoRoute } from '@/geom/route';
import { buildHeightIndex, heightAt, rasterize } from '@/geom/heightIndex';
import { meshTopology } from '@/geom/mesh';

let site: DemoSite;
let buildMs = Infinity;

beforeAll(() => {
  for (let k = 0; k < 2; k++) {
    const t0 = performance.now();
    site = buildDemoSite();
    buildMs = Math.min(buildMs, performance.now() - t0);
  }
  console.info(`buildDemoSite: ${buildMs.toFixed(0)} ms`);
}, 60_000);

const byId = (id: string) => site.assets.find(a => a.id === id)!;

// Wall-clock budgets: strict values apply with PERF_STRICT=1 (quiet machine); the default allows ×5 headroom so a
// busy CI box does not flake, while still catching order-of-magnitude regressions.
const PERF = process.env.PERF_STRICT === '1' ? 1 : 5;

describe('demo site', () => {
  it('builds in under 2 s and is deterministic', () => {
    expect(buildMs).toBeLessThan(2000 * PERF);
    const again = buildDemoSite();
    expect(again.strings.map(s => s.points.map(p => [p.e, p.n, p.z]))).toEqual(site.strings.map(s => s.points.map(p => [p.e, p.n, p.z])));
    expect(again.assets[0].stats).toEqual(site.assets[0].stats);
    expect(again.strings.map(s => s.id)).toEqual(site.strings.map(s => s.id));
  }, 20_000); // builds the site a second time; allow headroom when the test machine is busy

  it('has a topo surface, three digs and three dumps with block properties', () => {
    expect(site.assets.length).toBe(7);
    const roles = site.assets.map(a => a.role);
    expect(roles.filter(r => r === 'topo').length).toBe(1);
    expect(roles.filter(r => r === 'dig').length).toBe(3);
    expect(roles.filter(r => r === 'dump').length).toBe(3);
    expect(site.assets.map(a => a.name)).toEqual(expect.arrayContaining(['EX09 OB block', 'EX04 OB block', 'LDR coal block', 'S51 West lift', 'S52 East lift', 'ROM coal stockpile']));
    expect(new Set(site.assets.map(a => a.color)).size).toBe(7);
    expect(new Set(site.assets.map(a => a.id)).size).toBe(7);
    for (const a of site.assets.filter(x => x.role !== 'topo')) {
      expect(a.block).toBeDefined();
      expect(['OB', 'CL']).toContain(a.block!.materialId);
      expect(a.source).toBe('demo');
    }
    expect(byId(DEMO_IDS.ldr).block!.materialId).toBe('CL');
    expect(byId(DEMO_IDS.rom).block!.materialId).toBe('CL');
    expect(site.site.origin).toEqual([236000, 7051000, 0]);
    expect(site.site.crs).toMatch(/MGA zone 56/);
  });

  it('topography: 5 m grid TIN within the site extents, ≤ 400 k triangles, RL ≈ 262 – 352', () => {
    const t = byId(DEMO_IDS.topo);
    expect(t.kind).toBe('surface');
    expect(t.stats.triangleCount).toBeLessThanOrEqual(400_000);
    expect(t.stats.triangleCount).toBeGreaterThan(300_000);
    expect(t.stats.bbox.min[0]).toBe(236000);
    expect(t.stats.bbox.max[0]).toBe(238400);
    expect(t.stats.bbox.min[1]).toBe(7051000);
    expect(t.stats.bbox.max[1]).toBe(7052700);
    expect(t.stats.bbox.min[2]).toBeGreaterThan(258);
    expect(t.stats.bbox.min[2]).toBeLessThan(266);
    expect(t.stats.bbox.max[2]).toBeCloseTo(352, 3);
  });

  it('solids are closed with positive volume, sitting on / in the topography', () => {
    const idx = buildHeightIndex(byId(DEMO_IDS.topo).mesh);
    for (const a of site.assets.filter(x => x.role !== 'topo')) {
      expect(a.kind).toBe('solid');
      expect(a.stats.closed).toBe(true);
      expect(meshTopology(a.mesh).inconsistentEdges).toBe(0);
      expect(a.stats.volume!).toBeGreaterThan(50_000);
      const [e, n] = a.stats.centroid;
      const zt = heightAt(idx, e, n)!;
      if (a.role === 'dig') expect(a.stats.bbox.max[2]).toBeLessThanOrEqual(zt + 15); // top is the topo
      else expect(a.stats.bbox.min[2]).toBeGreaterThanOrEqual(zt - 1); // dumps sit on it
    }
    // a dig depletes cleanly
    const ex09 = byId(DEMO_IDS.ex09);
    const p = depletionPlane(prepareSolid(ex09.mesh), ex09.block!.depletionMode, ex09.block!.advanceAzimuthDeg, 0.5);
    expect(Math.abs(p.volumeRemoved / ex09.stats.volume! - 0.5)).toBeLessThan(0.002);
  });

  it('haul strings: 3–5, ≤ 10 % grade, start at their dig and end at their dump', () => {
    expect(site.strings.length).toBeGreaterThanOrEqual(3);
    expect(site.strings.length).toBeLessThanOrEqual(5);
    for (const s of site.strings) {
      const m = stringMetrics(s.points);
      expect(m.maxAbsGrade, s.name).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(m.length).toBeGreaterThan(500);
      for (const seg of m.segments) expect(seg.distPlan).toBeLessThanOrEqual(25 + 1e-6);
      const dig = byId(s.digId!), dump = byId(s.dumpId!);
      const first = s.points[0], last = s.points[s.points.length - 1];
      const inBox = (a: typeof dig, e: number, n: number, m = 0) =>
        e >= a.stats.bbox.min[0] - m && e <= a.stats.bbox.max[0] + m && n >= a.stats.bbox.min[1] - m && n <= a.stats.bbox.max[1] + m;
      expect(inBox(dig, first.e, first.n), `${s.name} starts in its dig`).toBe(true);
      expect(Math.hypot(first.e - dig.stats.centroid[0], first.n - dig.stats.centroid[1])).toBeLessThan(10);
      expect(inBox(dump, last.e, last.n), `${s.name} ends at its dump`).toBe(true);
      expect(Math.hypot(last.e - dump.stats.centroid[0], last.n - dump.stats.centroid[1])).toBeLessThan(10);
      expect(s.points.every(p => p.snapped)).toBe(true);
      expect(new Set(s.points.map(p => p.id)).size).toBe(s.points.length);
      expect(s.source).toBe('demo');
    }
    const main = site.strings.find(s => s.id === 'demo_str_ex09_s51')!, long = site.strings.find(s => s.id === 'demo_str_ex09_s51_long')!;
    expect(stringMetrics(long.points).length).toBeGreaterThan(stringMetrics(main.points).length);
    // routes that leave the pit use a ramp
    expect(site.strings.every(s => s.points.some(p => p.seg?.zone === 'ramp'))).toBe(true);
  });

  it('auto-routes across the full 2.4 × 1.7 km site at 5 m in under 1.5 s', () => {
    const topo = byId(DEMO_IDS.topo);
    const grid = rasterize(topo.mesh, 5);
    const a = byId(DEMO_IDS.ldr).stats.centroid, b = byId(DEMO_IDS.s52).stats.centroid;
    let ms = Infinity, r = autoRoute(grid, [a[0], a[1]], [b[0], b[1]]);
    for (let k = 0; k < 2; k++) { const t0 = performance.now(); r = autoRoute(grid, [a[0], a[1]], [b[0], b[1]]); ms = Math.min(ms, performance.now() - t0); }
    console.info(`autoRoute (demo, LDR → S52): ${ms.toFixed(0)} ms, ${r.expanded} nodes, ${r.lengthM.toFixed(0)} m`);
    expect(ms).toBeLessThan(1500 * PERF);
    expect(r.maxGrade).toBeLessThanOrEqual(0.1);
  }, 20_000);
});
