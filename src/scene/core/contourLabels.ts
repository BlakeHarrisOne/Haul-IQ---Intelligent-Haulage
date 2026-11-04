/**
 * RL labels on index contours (screen space, sparse — neither HRL nor Rain Model label theirs).
 * Marching squares over the height grid once per terrain / interval change gives candidate points on every index
 * contour (thinned to one per ~70 m per level, with the contour's plan tangent and the local slope). Each frame the
 * candidates are visited in a fixed shuffled order (stable, no flicker) and accepted when they are inside the safe
 * rect, where index contours are far enough apart on screen for the text, away from other contour labels and
 * clear of every placed scene label (shared label service). Text runs along the contour, kept upright, haloed.
 * Allocation-free per frame (typed arrays, cached strings / widths).
 */
import * as THREE from 'three';
import type { LabelService, Insets } from './labels';

const BUCKET = 70;
const MAX_CAND = 6000;
const MAX_LABELS = 14;
const MIN_SEP = 170;
const FONT = '600 10.5px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

export class ContourLabels {
  /** x, y (local Z), z (scene z = −N), tx, tz (unit plan tangent, scene), level, slope */
  private cand = new Float32Array(MAX_CAND * 7);
  private perm = new Uint16Array(MAX_CAND);
  private n = 0;
  private lastGrid: object | null = null;
  private lastI = 0;
  private v = new THREE.Vector3();
  private acc = new Float32Array(MAX_LABELS * 2);
  private text = new Map<number, string>();
  private width = new Map<string, number>();

  /** (Re)build candidates when the grid or interval changed. */
  update(grid: { ox: number; oy: number; nx: number; ny: number; dx: number; h: Float32Array } | null, interval: number) {
    if (grid === this.lastGrid && interval === this.lastI) return;
    this.lastGrid = grid; this.lastI = interval;
    this.n = 0;
    if (!grid || !(interval > 0)) return;
    const { nx, ny, dx, h, ox, oy } = grid;
    const seen = new Set<number>();
    const cand = this.cand;
    let n = 0;
    const push = (x: number, y: number, z: number, tx: number, ty: number, level: number, slope: number, li: number) => {
      if (n >= MAX_CAND) return;
      const b = (Math.floor(x / BUCKET) + 4096) * 8192 * 64 + (Math.floor(y / BUCKET) + 4096) * 64 + (li & 63);
      if (seen.has(b)) return;
      seen.add(b);
      const tl = Math.hypot(tx, ty) || 1;
      const o = n * 7;
      cand[o] = x; cand[o + 1] = z; cand[o + 2] = -y; cand[o + 3] = tx / tl; cand[o + 4] = -ty / tl; cand[o + 5] = level; cand[o + 6] = slope;
      n++;
    };
    const ex: number[] = [0, 0, 0, 0], ey: number[] = [0, 0, 0, 0];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i + 1], d = h[(j + 1) * nx + i];
        if (a !== a || b !== b || c !== c || d !== d) continue;
        const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
        const k0 = Math.ceil(lo / interval), k1 = Math.floor(hi / interval);
        if (k1 < k0) continue;
        const x0 = ox + i * dx, y0 = oy + j * dx;
        const gx = (b - a + c - d) / (2 * dx), gy = (d - a + c - b) / (2 * dx);
        const slope = Math.hypot(gx, gy);
        for (let k = k0; k <= k1; k++) {
          const L = k * interval;
          let m = 0;
          // edges a→b (south), b→c (east), d→c (north), a→d (west)
          if ((a - L) * (b - L) < 0) { const t = (L - a) / (b - a); ex[m] = x0 + t * dx; ey[m] = y0; m++; }
          if ((b - L) * (c - L) < 0) { const t = (L - b) / (c - b); ex[m] = x0 + dx; ey[m] = y0 + t * dx; m++; }
          if ((d - L) * (c - L) < 0) { const t = (L - d) / (c - d); ex[m] = x0 + t * dx; ey[m] = y0 + dx; m++; }
          if ((a - L) * (d - L) < 0) { const t = (L - a) / (d - a); ex[m] = x0; ey[m] = y0 + t * dx; m++; }
          if (m < 2) continue;
          push((ex[0] + ex[1]) / 2, (ey[0] + ey[1]) / 2, L, ex[1] - ex[0], ey[1] - ey[0], L, slope, k);
        }
      }
    }
    this.n = n;
    // fixed shuffled visiting order (deterministic LCG)
    const perm = this.perm;
    for (let i = 0; i < n; i++) perm[i] = i;
    let s = 12345;
    for (let i = n - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const r = s % (i + 1); const t = perm[i]; perm[i] = perm[r]; perm[r] = t; }
  }

  private label(level: number, Z0: number): string {
    const rl = level + Z0;
    let t = this.text.get(rl);
    if (t === undefined) { t = Math.abs(rl - Math.round(rl)) < 1e-6 ? String(Math.round(rl)) : rl.toFixed(1); this.text.set(rl, t); }
    return t;
  }

  /**
   * Draw up to ~14 labels. `mpp(x, y, z)` = metres per CSS px at a scene point; `visible` = optional occlusion test
   * (scene point → true if the camera sees it).
   */
  draw(ctx: CanvasRenderingContext2D, camera: THREE.Camera, w: number, h: number, ve: number, Z0: number, interval: number,
    ins: Insets, labels: LabelService | null, ink: string, halo: string,
    mpp: (x: number, y: number, z: number) => number, visible: ((x: number, y: number, z: number) => boolean) | null) {
    if (!this.n) return 0;
    const cand = this.cand, perm = this.perm, v = this.v, acc = this.acc;
    let k = 0;
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let pi = 0; pi < this.n && k < MAX_LABELS; pi++) {
      const o = perm[pi] * 7;
      const x = cand[o], y = cand[o + 1] * ve, z = cand[o + 2], slope = cand[o + 6];
      if (slope < 0.006) continue;
      v.set(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      if (sx < ins.left + 30 || sx > w - ins.right - 30 || sy < ins.top + 20 || sy > h - ins.bottom - 20) continue;
      let near = false;
      for (let q = 0; q < k; q++) { const dxq = acc[q * 2] - sx, dyq = acc[q * 2 + 1] - sy; if (dxq * dxq + dyq * dyq < MIN_SEP * MIN_SEP) { near = true; break; } }
      if (near) continue;
      // index contours must be far enough apart on screen for the text to sit between them
      const m = mpp(x, y, z);
      if (!(m > 0) || interval / slope / m < 24) continue;
      // tangent on screen → angle (kept upright)
      v.set(x + cand[o + 3] * 12, y, z + cand[o + 4] * 12).project(camera);
      const tx = (v.x * 0.5 + 0.5) * w - sx, ty = (-v.y * 0.5 + 0.5) * h - sy;
      let ang = Math.atan2(ty, tx);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      const txt = this.label(cand[o + 5], Z0);
      let tw = this.width.get(txt);
      if (tw === undefined) { tw = ctx.measureText(txt).width; this.width.set(txt, tw); }
      const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
      const hw = (tw / 2 + 4) * ca + 7 * sa, hh = (tw / 2 + 4) * sa + 7 * ca;
      if (labels && labels.hits(sx - hw, sy - hh, sx + hw, sy + hh)) continue;
      if (visible && !visible(x, y, z)) continue;
      acc[k * 2] = sx; acc[k * 2 + 1] = sy; k++;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      ctx.lineWidth = 3.2; ctx.strokeStyle = halo; ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = ink; ctx.fillText(txt, 0, 0);
      ctx.restore();
      labels?.reserve(sx - hw, sy - hh, sx + hw, sy + hh);
    }
    ctx.restore();
    return k;
  }
}
