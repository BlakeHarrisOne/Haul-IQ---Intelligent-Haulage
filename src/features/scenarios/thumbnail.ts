/**
 * Scenario thumbnails. Prefers the 3D view (sceneApi.screenshot, when the scene module provides it); otherwise draws
 * a plan map straight from the scenario: hillshaded topo (rasterised triangles), tinted dig/dump solids and the haul
 * strings - so every saved scenario gets a recognisable picture even without WebGL.
 */
import type { MeshAsset, Scenario } from '@/core/types';
import { circuitHex } from '@/ui';

type SceneApiLike = { screenshot?: (opts?: { width?: number; height?: number }) => unknown };
const sceneMods = import.meta.glob<{ sceneApi?: SceneApiLike }>('/src/scene/api.ts', { eager: true });
const sceneApi = (): SceneApiLike | undefined => Object.values(sceneMods)[0]?.sceneApi;

const W = 480, H = 300;

export type ThumbTheme = 'light' | 'dark';
/** The UI theme in effect (the shell writes it to <html data-theme>). */
export const docTheme = (): ThumbTheme =>
  (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** Plan-map palette per theme, so a thumbnail sits on its card like the rest of the UI. */
const PALETTE: Record<ThumbTheme, { bg: [string, string]; base: [number, number, number]; lift: [number, number, number]; shade: [number, number]; halo: string }> = {
  light: { bg: ['#EEF1F5', '#E2E6EC'], base: [226, 224, 218], lift: [14, 10, 6], shade: [0.52, 0.62], halo: 'rgba(255,255,255,.9)' },
  dark: { bg: ['#1B2029', '#141820'], base: [112, 108, 100], lift: [30, 26, 20], shade: [0.42, 0.58], halo: 'rgba(10,14,20,.75)' },
};

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function toDataUrl(src: unknown): Promise<string | undefined> {
  const v = await Promise.resolve(src);
  if (typeof v === 'string' && v.startsWith('data:')) return v;
  if (typeof Blob !== 'undefined' && v instanceof Blob) {
    return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(undefined); r.readAsDataURL(v); });
  }
  if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return v.toDataURL('image/jpeg', 0.82);
  return undefined;
}

/** Fit any image data URL into W×H (cover) as a compact JPEG. */
async function shrink(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  const c = makeCanvas(W, H);
  if (!c || !img.naturalWidth) return url;
  const g = c.getContext('2d')!;
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  return c.toDataURL('image/jpeg', 0.82);
}

export async function makeThumbnail(s: Scenario, opts: { preferScene?: boolean } = {}): Promise<string | undefined> {
  if (opts.preferScene && s.assets.length) {
    try {
      const api = sceneApi();
      if (api?.screenshot) {
        // never let a slow GPU hold up a save: fall back to the plan drawing after 1.5 s
        const shot = Promise.race([toDataUrl(api.screenshot({ width: W * 2, height: H * 2 })), new Promise<undefined>(r => setTimeout(() => r(undefined), 1500))]);
        const url = await shot;
        if (url) return await shrink(url);
      }
    } catch (e) { console.warn('[scenarios] scene screenshot failed', e); }
  }
  try { return planThumbnail(s, W, H, docTheme()); } catch (e) { console.warn('[scenarios] plan thumbnail failed', e); return undefined; }
}

// ── plan renderer ────────────────────────────────────────────────────────────────────────────────
function hexRgb(css: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return [140, 148, 156];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rasterise a mesh into a top-down z buffer (keeps the highest z per cell) and an owner buffer. */
function rasterise(a: MeshAsset, owner: number, zb: Float32Array, ob: Int16Array, gw: number, gh: number, x0: number, y0: number, cell: number) {
  const { verts, tris } = a.mesh;
  const nT = tris.length / 3;
  for (let t = 0; t < nT; t++) {
    const i0 = tris[3 * t] * 3, i1 = tris[3 * t + 1] * 3, i2 = tris[3 * t + 2] * 3;
    const ax = (verts[i0] - x0) / cell, ay = (y0 - verts[i0 + 1]) / cell, az = verts[i0 + 2];
    const bx = (verts[i1] - x0) / cell, by = (y0 - verts[i1 + 1]) / cell, bz = verts[i1 + 2];
    const cx = (verts[i2] - x0) / cell, cy = (y0 - verts[i2 + 1]) / cell, cz = verts[i2 + 2];
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(gw - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(gh - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minX > maxX || minY > maxY) continue;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) {
      // sliver / sub-cell triangle: splat the centroid
      const px = Math.round((ax + bx + cx) / 3), py = Math.round((ay + by + cy) / 3);
      if (px >= 0 && py >= 0 && px < gw && py < gh) {
        const z = (az + bz + cz) / 3, k = py * gw + px;
        if (z > zb[k]) { zb[k] = z; ob[k] = owner; }
      }
      continue;
    }
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5, sy = py + 0.5;
        const w0 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / d;
        const w1 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const z = w0 * az + w1 * bz + w2 * cz, k = py * gw + px;
        if (z > zb[k]) { zb[k] = z; ob[k] = owner; }
      }
    }
  }
}

export function planThumbnail(s: Scenario, w = W, h = H, theme: ThumbTheme = docTheme()): string | undefined {
  const pal = PALETTE[theme];
  const c = makeCanvas(w, h);
  if (!c) return undefined;
  const g = c.getContext('2d')!;
  // extent: all assets + strings
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of s.assets) {
    x0 = Math.min(x0, a.stats.bbox.min[0]); y0 = Math.min(y0, a.stats.bbox.min[1]);
    x1 = Math.max(x1, a.stats.bbox.max[0]); y1 = Math.max(y1, a.stats.bbox.max[1]);
  }
  for (const hs of s.strings) for (const p of hs.points) { x0 = Math.min(x0, p.e); x1 = Math.max(x1, p.e); y0 = Math.min(y0, p.n); y1 = Math.max(y1, p.n); }
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, pal.bg[0]); bg.addColorStop(1, pal.bg[1]);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (!Number.isFinite(x0) || x1 - x0 < 1 || y1 - y0 < 1) return c.toDataURL('image/jpeg', 0.85);

  // raster grid (half resolution, upscaled with smoothing)
  const pad = 0.06;
  const spanX = (x1 - x0) * (1 + 2 * pad), spanY = (y1 - y0) * (1 + 2 * pad);
  const gw = Math.round(w / 2), gh = Math.round(h / 2);
  const cell = Math.max(spanX / gw, spanY / gh);
  const ox = (x0 + x1) / 2 - (gw * cell) / 2, oy = (y0 + y1) / 2 + (gh * cell) / 2;
  // topo and solids rasterise into separate buffers: a dig block sits below the topo, but its footprint should still read
  const zb = new Float32Array(gw * gh).fill(-Infinity);
  const ob = new Int16Array(gw * gh).fill(-1);
  const zs = new Float32Array(gw * gh).fill(-Infinity);
  const os = new Int16Array(gw * gh).fill(-1);
  s.assets.forEach((a, i) => {
    if (a.visible === false) return;
    if (a.role === 'topo' || a.role === 'design' || a.kind === 'surface') rasterise(a, i, zb, ob, gw, gh, ox, oy, cell);
    else rasterise(a, i, zs, os, gw, gh, ox, oy, cell);
  });
  for (let k = 0; k < zb.length; k++) if (!(zb[k] > -Infinity) && zs[k] > -Infinity) zb[k] = zs[k];

  // hillshade
  let zmin = Infinity, zmax = -Infinity;
  for (const z of zb) if (z > -Infinity) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  const img = g.createImageData(gw, gh);
  const L = [-0.5, 0.5, 0.707]; // from NW, 45°
  const ve = 2.2;
  const zAt = (x: number, y: number, fb: number) => {
    const xx = Math.min(gw - 1, Math.max(0, x)), yy = Math.min(gh - 1, Math.max(0, y));
    const z = zb[yy * gw + xx];
    return z > -Infinity ? z : fb;
  };
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = y * gw + x, z = zb[k];
      const o = 4 * k;
      if (!(z > -Infinity)) { img.data[o + 3] = 0; continue; }
      const dzdx = (zAt(x + 1, y, z) - zAt(x - 1, y, z)) / (2 * cell) * ve;
      const dzdy = (zAt(x, y - 1, z) - zAt(x, y + 1, z)) / (2 * cell) * ve;
      const nl = Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0, (-dzdx * L[0] - dzdy * L[1] + L[2]) / nl);
      const t = zmax > zmin ? (z - zmin) / (zmax - zmin) : 0.5;
      let r = pal.base[0] + pal.lift[0] * t, gg = pal.base[1] + pal.lift[1] * t, b = pal.base[2] + pal.lift[2] * t; // hypsometric tint
      const a = os[k] >= 0 ? s.assets[os[k]] : ob[k] >= 0 ? s.assets[ob[k]] : undefined;
      if (a && a.role !== 'topo') {
        const [cr, cg, cb] = hexRgb(a.color);
        const m = a.role === 'design' ? 0.35 : 0.6;
        r = r * (1 - m) + cr * m; gg = gg * (1 - m) + cg * m; b = b * (1 - m) + cb * m;
      }
      const sh = pal.shade[0] + pal.shade[1] * shade;
      img.data[o] = Math.min(255, r * sh);
      img.data[o + 1] = Math.min(255, gg * sh);
      img.data[o + 2] = Math.min(255, b * sh);
      img.data[o + 3] = 255;
    }
  }
  const tmp = makeCanvas(gw, gh)!;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(tmp, 0, 0, gw * 2, gh * 2);

  // haul strings
  const px = (e: number) => ((e - ox) / cell) * 2, py = (n: number) => ((oy - n) / cell) * 2;
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const hs of s.strings) {
    if (hs.visible === false || hs.points.length < 2) continue;
    g.beginPath();
    hs.points.forEach((p, i) => (i ? g.lineTo(px(p.e), py(p.n)) : g.moveTo(px(p.e), py(p.n))));
    g.strokeStyle = pal.halo; g.lineWidth = 5; g.stroke();
    g.strokeStyle = circuitHex(hs.color || '#2A78D6', theme === 'dark'); g.lineWidth = 2.5; g.stroke();
  }
  return c.toDataURL('image/jpeg', 0.85);
}
