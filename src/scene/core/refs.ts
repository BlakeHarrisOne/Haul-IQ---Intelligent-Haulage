/**
 * Survey points of reference drawn on the overlay canvas (orbit view): easting / northing ticks along the model's
 * camera-facing edges (matching the terrain's site grid lines) and an RL ruler on the nearest skirt corner.
 */
import * as THREE from 'three';
import type { HeightGrid } from './heightGrid';

export interface RefsInput {
  ctx: CanvasRenderingContext2D;
  camera: THREE.Camera;
  w: number;
  h: number;
  grid: HeightGrid;
  origin: [number, number, number];
  ve: number;
  datumY: number;
  stepM: number;
  ink: string;
  halo: string;
  insets: { top: number; right: number; bottom: number; left: number };
  /** Dark UI theme (light ink, dark halo); light theme = dark ink with a light halo. */
  dark?: boolean;
}

const v = new THREE.Vector3();
const fmtCoord = (x: number) => Math.round(x).toLocaleString('en-AU').replace(/,/g, ' ');

function proj(cam: THREE.Camera, x: number, y: number, z: number, w: number, h: number): [number, number] | null {
  v.set(x, y, z).project(cam);
  if (v.z > 1 || v.z < -1) return null;
  return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, halo: string, align: CanvasTextAlign = 'center') {
  ctx.textAlign = align;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}

export function drawSiteRefs(p: RefsInput) {
  const { ctx, camera: cam, w, h, grid: g, origin, ve, stepM, insets } = p;
  // one ink for every reference label (easting ticks and the RL ruler): dark ink on a light halo in the light theme
  const ink = p.dark ? p.ink : '#2B3038';
  const halo = p.dark ? p.halo : 'rgba(255,255,255,0.92)';
  const x0 = g.ox, x1 = g.ox + (g.nx - 1) * g.dx, n0 = g.oy, n1 = g.oy + (g.ny - 1) * g.dx;
  const cp = cam.position;
  const edgeY = (x: number, n: number) => {
    const hh = g.at(Math.min(x1 - g.dx * 0.01, Math.max(x0 + g.dx * 0.01, x)), Math.min(n1 - g.dx * 0.01, Math.max(n0 + g.dx * 0.01, n)));
    return hh === hh ? hh * ve : NaN;
  };
  const inside = (q: [number, number]) => q[0] > insets.left + 10 && q[0] < w - insets.right - 10 && q[1] > insets.top + 10 && q[1] < h - insets.bottom - 10;
  ctx.save();
  ctx.font = '600 11px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'top';
  // edges: [fixed coordinate, axis, outward normal (scene x, z)]
  const edges: { n: [number, number]; along: 'E' | 'N'; at: number }[] = [
    { n: [0, 1], along: 'E', at: n0 },   // south edge (scene z = −n0, outward +z)
    { n: [0, -1], along: 'E', at: n1 },  // north edge
    { n: [-1, 0], along: 'N', at: x0 },  // west edge
    { n: [1, 0], along: 'N', at: x1 },   // east edge
  ];
  const step = stepM;
  let drawn = 0;
  let corner: { x: number; n: number; d: number } | null = null;
  for (const [x, n] of [[x0, n0], [x1, n0], [x0, n1], [x1, n1]]) {
    const d = Math.hypot(cp.x - x, cp.z + n);
    if (!corner || d < corner.d) corner = { x, n, d };
  }
  const cTop = corner ? proj(cam, corner.x, edgeY(corner.x, corner.n), -corner.n, w, h) : null;
  for (const e of edges) {
    const mid = e.along === 'E' ? [(x0 + x1) / 2, -e.at] : [e.at, -(n0 + n1) / 2];
    const facing = (cp.x - mid[0]) * e.n[0] + (cp.z - mid[1]) * e.n[1];
    if (facing <= 0) continue;
    const lo = e.along === 'E' ? x0 + origin[0] : n0 + origin[1];
    const hi = e.along === 'E' ? x1 + origin[0] : n1 + origin[1];
    const first = Math.ceil(lo / step) * step;
    let last: [number, number] | null = null;
    for (let c = first; c <= hi; c += step) {
      const lx = e.along === 'E' ? c - origin[0] : e.at, ln = e.along === 'E' ? e.at : c - origin[1];
      const y = edgeY(lx, ln);
      if (y !== y) continue;
      const top = proj(cam, lx, y, -ln, w, h);
      const bot = proj(cam, lx, p.datumY * ve, -ln, w, h);
      if (!top || !bot || !inside(bot)) continue;
      if (last && Math.hypot(bot[0] - last[0], bot[1] - last[1]) < 78) continue;
      if (cTop && Math.hypot(top[0] - cTop[0], top[1] - cTop[1]) < 90) continue;
      last = bot;
      // tick the full height of the skirt face, label on the backdrop just below the skirt (never on the dark strata)
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bot[0], bot[1] + 3); ctx.stroke();
      ctx.globalAlpha = 1;
      label(ctx, `${fmtCoord(c)} ${e.along}`, bot[0], bot[1] + 5, ink, halo);
      drawn++;
    }
  }
  // RL ruler on the camera-nearest corner
  const best = corner;
  if (best) {
    const topY = edgeY(best.x, best.n);
    if (topY === topY) {
      const zTop = topY / ve + origin[2], zBot = p.datumY + origin[2];
      const a = proj(cam, best.x, topY, -best.n, w, h), b = proj(cam, best.x, p.datumY * ve, -best.n, w, h);
      if (a && b && inside(b)) {
        const pxPerM = Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, zTop - zBot);
        const tick = [5, 10, 20, 25, 50, 100].find(t => t * pxPerM >= 16) ?? 100;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.textBaseline = 'middle';
        const side = b[0] < w / 2 ? -1 : 1;
        for (let z = Math.ceil(zBot / tick) * tick; z <= zTop; z += tick) {
          const q = proj(cam, best.x, (z - origin[2]) * ve, -best.n, w, h);
          if (!q) continue;
          ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] + side * 5, q[1]); ctx.stroke();
          label(ctx, `RL ${Math.round(z)}`, q[0] + side * 8, q[1], ink, halo, side < 0 ? 'right' : 'left');
        }
      }
    }
  }
  ctx.restore();
  return drawn;
}
