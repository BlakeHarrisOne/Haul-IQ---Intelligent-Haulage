import { describe, expect, it } from 'vitest';
import { autoRoute } from './route';
import type { Grid } from './types';
// Wall-clock budgets: strict with PERF_STRICT=1; ×5 headroom by default so busy CI machines don't flake.
const PERF = process.env.PERF_STRICT === '1' ? 1 : 5;


/**
 * Synthetic two-level terrain at 5 m: low plain (RL 100) in the south, plateau (RL 140) in the north,
 * separated by a 1:1 wall along y = 600; one 30 m wide ramp at 8 % climbs the wall near x = 1500
 * (running east), so the only drivable way up is the ramp.
 */
function rampTerrain(): Grid {
  const dx = 5, nx = 481, ny = 341, x0 = 236_000, y0 = 7_051_000;
  const z = new Float32Array(nx * ny);
  const rampX0 = 1000, rampLen = 40 / 0.08, rampY = 590, half = 15;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * dx, y = j * dx;
    let h = y < 580 ? 100 : y > 620 ? 140 : 100 + (y - 580); // 1:1 wall
    // the ramp: a 30 m causeway along y = 590 rising east from x = 1000 to 1500
    const along = x - rampX0;
    if (Math.abs(y - rampY) <= half && along >= -20 && along <= rampLen + 20) {
      const zr = 100 + Math.max(0, Math.min(rampLen, along)) * 0.08;
      h = zr;
    } else if (Math.abs(y - rampY) <= half + 40 && along >= 0 && along <= rampLen) {
      const zr = 100 + along * 0.08, e = Math.abs(y - rampY) - half;
      h = Math.max(Math.min(h, zr + e), zr - e); // 1:1 batters
    }
    // the ramp top joins the plateau
    if (x >= rampX0 + rampLen && x <= rampX0 + rampLen + 60 && y >= rampY - half && y <= 640) h = 140;
    z[j * nx + i] = h + 0.05 * Math.sin(x * 0.37) * Math.cos(y * 0.29); // a little texture
  }
  return { x0, y0, dx, nx, ny, z };
}

const g = rampTerrain();
const W = (x: number, y: number): [number, number] => [g.x0 + x, g.y0 + y];

function grades(points: number[][]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    out.push(Math.abs(points[i][2] - points[i - 1][2]) / d);
  }
  return out;
}

describe('autoRoute', () => {
  it('climbs by the ramp, obeys the 10 % limit and connects the clicked ends', () => {
    const from = W(400, 300), to = W(800, 1300);
    let ms = Infinity, r = autoRoute(g, from, to);
    for (let k = 0; k < 2; k++) { const t0 = performance.now(); r = autoRoute(g, from, to); ms = Math.min(ms, performance.now() - t0); }
    console.info(`autoRoute: ${ms.toFixed(0)} ms on a 2.4 × 1.7 km grid at 5 m (${r.expanded} nodes expanded, ${r.points.length} points)`);
    expect(ms).toBeLessThan(1500 * PERF);
    expect(r.points[0][0]).toBeCloseTo(from[0], 6);
    expect(r.points[0][1]).toBeCloseTo(from[1], 6);
    expect(r.points[r.points.length - 1][0]).toBeCloseTo(to[0], 6);
    expect(r.points[r.points.length - 1][1]).toBeCloseTo(to[1], 6);
    for (const gr of grades(r.points)) expect(gr).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(r.maxGrade).toBeLessThanOrEqual(0.1);
    // it must have used the ramp: some point lies on the ramp mid-way up
    expect(r.points.some(p => Math.abs(p[1] - g.y0 - 590) < 15 && p[2] > 110 && p[2] < 130)).toBe(true);
    // spacing ≤ 25 m in plan
    for (let i = 1; i < r.points.length; i++) expect(Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1])).toBeLessThanOrEqual(25 + 1e-6);
    expect(r.planLengthM).toBeGreaterThan(Math.hypot(400, 1000));
    expect(r.lengthM).toBeGreaterThan(r.planLengthM);
    expect(r.warnings).toEqual([]);
  });

  it('refuses when the only way exceeds a stricter grade limit', () => {
    // (at 5 % a 30 m wide 8 % ramp can still be climbed by switchbacks across it; at 2 % it cannot)
    expect(() => autoRoute(g, W(400, 300), W(800, 1300), { maxGrade: 0.02 })).toThrow(/No drivable route under 2 %/);
  });

  it('flat ground gives a straight line; via points are visited', () => {
    const a = W(100, 100), b = W(500, 400);
    const r = autoRoute(g, a, b);
    expect(r.points.length).toBe(Math.ceil(500 / 25) + 1);
    expect(r.planLengthM).toBeCloseTo(500, 0);
    const v = autoRoute(g, a, b, { via: [W(500, 100)] });
    expect(v.points.some(p => Math.hypot(p[0] - g.x0 - 500, p[1] - g.y0 - 100) < 6)).toBe(true);
    expect(v.planLengthM).toBeGreaterThan(690);
  });

  it('snaps ends on a wall to drivable ground and reports it; rejects ends off the grid', () => {
    const r = autoRoute(g, W(400, 600), W(400, 300));
    expect(r.warnings.some(w => /Start moved/.test(w))).toBe(true);
    expect(() => autoRoute(g, W(-5000, 0), W(400, 300))).toThrow();
  });
});
