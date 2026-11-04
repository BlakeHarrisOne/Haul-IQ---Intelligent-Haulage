/**
 * Demo site: a procedurally generated Queensland open-cut strip coal mine ("Brigalow Creek", fictional),
 * E 236 000 – 238 400, N 7 051 000 – 7 052 700 (GDA2020 / MGA zone 56), RL ≈ 262 – 352.
 *
 * Contents: 5 m grid topography (≈ 326 k triangles) with a benched strip pit, in-pit ramps at 9 % on both
 * ends, a benched spoil dump with an access ramp, ROM pad and a graded ring road; dig solids (EX09 OB
 * pre-strip on the highwall side, EX04 OB parting on the floor, LDR coal on the floor) and dump solids
 * (S51 West lift and S52 East lift on the spoil, ROM coal stockpile); haul strings auto-routed from each
 * dig centroid to its dump centroid over the topography (≤ 10 % grade, ≈ 25 m spacing), plus a long-haul
 * alternative for EX09. Deterministic: ids, timestamps and geometry are identical on every call.
 */
import type { BlockProps, HaulString, MeshAsset, MeshData, SegmentZone, SiteInfo, StringPoint, Vec3 } from '@/core/types';
import { originFor } from '@/core/frame';
import { classifyMesh, meshStats } from '@/geom/mesh';
import { buildHeightIndex, gridToMesh, heightAt, rasterize } from '@/geom/heightIndex';
import { autoRoute } from '@/geom/route';
import type { Vec2 } from '@/geom/types';
import { mulberry32 } from './rng';
import {
  BLOCKS, DUMP_TOE, DX, E0, EX09_FLOOR_RL, N0, NX, NY, PIT_FLOOR, ROM_PAD_RL, SEAM_THICK, buildTerrain, seamRoof,
  type Rect, type Road,
} from './terrain';
import { insideDistance, prismSolid } from './solids';

/** What `buildDemoSite` returns. */
export interface DemoSite { site: SiteInfo; assets: MeshAsset[]; strings: HaulString[] }

const STAMP = '2026-11-04T00:00:00.000Z';
const SEED = 20261104;

/** Demo asset ids (stable, for tests and for the scenario builder to reference). */
export const DEMO_IDS = {
  topo: 'demo_topo',
  ex09: 'demo_dig_ex09',
  ex04: 'demo_dig_ex04',
  ldr: 'demo_dig_ldr',
  s51: 'demo_dump_s51',
  s52: 'demo_dump_s52',
  rom: 'demo_dump_rom',
} as const;

/** Builds the demo site (≈ 0.5 – 1 s). */
export function buildDemoSite(): DemoSite {
  const terrain = buildTerrain(mulberry32(SEED));
  const topoMesh = gridToMesh({ x0: E0, y0: N0, dx: DX, nx: NX, ny: NY, z: terrain.z });
  const nodeZ = (e: number, n: number) => terrain.z[Math.round((n - N0) / DX) * NX + Math.round((e - E0) / DX)];
  const W = (r: Rect) => [E0 + r.x0, N0 + r.y0, E0 + r.x1, N0 + r.y1] as const;
  const roof = (e: number, n: number) => seamRoof(e - E0, n - N0);

  const lift = (r: Rect, height: number, base: (e: number, n: number) => number, dx: number) => {
    const [x0, y0, x1, y1] = W(r);
    return prismSolid(x0, y0, x1, y1, dx,
      (e, n) => base(e, n) + Math.min(height, 0.02 + 0.75 * insideDistance(x0, y0, x1, y1, e, n)), base);
  };
  const block = (r: Rect, top: (e: number, n: number) => number, bottom: (e: number, n: number) => number) => {
    const [x0, y0, x1, y1] = W(r);
    return prismSolid(x0, y0, x1, y1, DX, top, bottom, 0.5);
  };

  const assets: MeshAsset[] = [
    asset(DEMO_IDS.topo, 'Topography (demo)', 'topo', topoMesh, '#a89f8a', 1),
    asset(DEMO_IDS.ex09, 'EX09 OB block', 'dig', block(BLOCKS.ex09, nodeZ, () => EX09_FLOOR_RL), '#d9912b', 0.85,
      { materialId: 'OB', depletionMode: 'face-advance', advanceAzimuthDeg: 90, loaderUnitId: 'EX09' }),
    asset(DEMO_IDS.ex04, 'EX04 OB block', 'dig', block(BLOCKS.ex04, nodeZ, roof), '#b4532a', 0.85,
      { materialId: 'OB', depletionMode: 'bench-down', advanceAzimuthDeg: 0, loaderUnitId: 'EX04' }),
    asset(DEMO_IDS.ldr, 'LDR coal block', 'dig', block(BLOCKS.ldr, nodeZ, (e, n) => roof(e, n) - SEAM_THICK), '#3b3d42', 0.9,
      { materialId: 'CL', depletionMode: 'face-advance', advanceAzimuthDeg: 270, loaderUnitId: 'LDR' }),
    asset(DEMO_IDS.s51, 'S51 West lift', 'dump', lift(BLOCKS.s51, 12, nodeZ, DX), '#8fb08a', 0.75,
      { materialId: 'OB', depletionMode: 'bottom-up', advanceAzimuthDeg: 0 }),
    asset(DEMO_IDS.s52, 'S52 East lift', 'dump', lift(BLOCKS.s52, 12, nodeZ, DX), '#4e9c94', 0.75,
      { materialId: 'OB', depletionMode: 'face-advance', advanceAzimuthDeg: 90 }),
    asset(DEMO_IDS.rom, 'ROM coal stockpile', 'dump', lift(BLOCKS.rom, 14, () => ROM_PAD_RL, DX / 2), '#55585e', 0.9,
      { materialId: 'CL', depletionMode: 'bottom-up', advanceAzimuthDeg: 0 }),
  ];
  const byId = (id: string) => assets.find(a => a.id === id)!;

  // haul strings over the topography
  const grid = rasterize(topoMesh, DX);
  const index = buildHeightIndex(topoMesh);
  const plan = (id: string): Vec2 => [byId(id).stats.centroid[0], byId(id).stats.centroid[1]];
  const zoneAt = zoneClassifier(terrain.roads);
  const makeString = (id: string, name: string, digId: string, dumpId: string, color: string, via?: Vec2[], notes?: string): HaulString => {
    const r = autoRoute(grid, plan(digId), plan(dumpId), { via, stepM: 25 });
    const points: StringPoint[] = r.points.map(([e, n, z], i) => {
      const zs = heightAt(index, e, n);
      const p: StringPoint = { id: `${id}_p${String(i).padStart(3, '0')}`, e, n, z: zs ?? z, snapped: zs != null };
      if (i < r.points.length - 1) {
        const q = r.points[i + 1];
        p.seg = { zone: zoneAt((e + q[0]) / 2 - E0, (n + q[1]) / 2 - N0) };
      }
      return p;
    });
    points[0].label = byId(digId).name;
    points[points.length - 1].label = byId(dumpId).name;
    return {
      id, name, color, points, digId, dumpId, source: 'demo', visible: true,
      notes: notes ?? 'Auto-routed over the demo topography (≤ 10 % grade, 25 m spacing).',
      createdAt: STAMP, updatedAt: STAMP,
    };
  };
  // EX09 has two options round either end of the pit: the shorter is the main route, the other the long haul
  const west = makeString('demo_str_ex09_s51', 'EX09 OB → S51 West lift', DEMO_IDS.ex09, DEMO_IDS.s51, '#2A78D6', [[E0 + 330, N0 + 1000]]);
  const east = makeString('demo_str_ex09_s51', 'EX09 OB → S51 West lift', DEMO_IDS.ex09, DEMO_IDS.s51, '#2A78D6', [[E0 + 2090, N0 + 1000]]);
  const len = (s: HaulString) => s.points.reduce((acc, p, i) => (i ? acc + Math.hypot(p.e - s.points[i - 1].e, p.n - s.points[i - 1].n) : 0), 0);
  const [main, alt] = len(west) <= len(east) ? [west, east] : [east, west];
  const long: HaulString = {
    ...alt, id: 'demo_str_ex09_s51_long', name: 'EX09 OB → S51 West lift (long haul)', color: '#7FA6DD',
    points: alt.points.map((p, i) => ({ ...p, id: `demo_str_ex09_s51_long_p${String(i).padStart(3, '0')}` })),
    notes: 'Long-haul alternative round the other end of the pit (≤ 10 % grade).',
  };
  const strings: HaulString[] = [
    main,
    long,
    makeString('demo_str_ex04_s52', 'EX04 OB → S52 East lift', DEMO_IDS.ex04, DEMO_IDS.s52, '#EDA100'),
    makeString('demo_str_ldr_rom', 'LDR coal → ROM stockpile', DEMO_IDS.ldr, DEMO_IDS.rom, '#6250D6'),
  ];
  const site: SiteInfo = { name: 'Brigalow Creek (demo)', origin: originFor(byId(DEMO_IDS.topo).stats.bbox.min), crs: 'GDA2020 / MGA zone 56' };
  return { site, assets, strings };
}

function asset(id: string, name: string, role: MeshAsset['role'], mesh: MeshData, color: string, opacity: number, block?: BlockProps): MeshAsset {
  const stats = meshStats(mesh);
  return {
    id, name, kind: classifyMesh(mesh, stats), role, mesh, stats, color, visible: true, opacity, block,
    source: 'demo', importedAt: STAMP,
  };
}

/** Segment zone from the demo layout: ramps, pit floor, dump, else road. Local coordinates. */
function zoneClassifier(roads: Road[]): (x: number, y: number) => SegmentZone {
  const ramps = roads.filter(r => r.kind !== 'road');
  const near = (r: Road, x: number, y: number) => {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const p = r.pts[i], q = r.pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / L2)) : 0;
      if (Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy) <= r.hw + 2 && Math.abs(q[2] - p[2]) > 1) return true;
    }
    return false;
  };
  const inside = (r: Rect, x: number, y: number, m = 0) => x >= r.x0 - m && x <= r.x1 + m && y >= r.y0 - m && y <= r.y1 + m;
  return (x, y) => {
    if (ramps.some(r => near(r, x, y))) return 'ramp';
    if (inside(PIT_FLOOR, x, y, 5)) return 'pit';
    if (inside(DUMP_TOE, x, y)) return 'dump';
    return 'road';
  };
}

/** World [E, N, Z] of a local demo coordinate (helper for tests and tooling). */
export const demoWorld = (x: number, y: number, z = 0): Vec3 => [E0 + x, N0 + y, z];
