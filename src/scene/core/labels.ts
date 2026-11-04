/**
 * Screen-space label placement for floating scene labels (solid volumes today).
 * Greedy by priority (selected > hovered > dig > dump > size): each label tries a short list of offsets above /
 * beside its anchor and takes the first that hits no placed label and stays inside the safe rect (chrome bands and
 * the inspector are excluded). Labels that can't fit are hidden; displaced ones get a leader line to the anchor,
 * drawn on the overlay canvas. DOM writes only when something changes.
 */
import * as THREE from 'three';

export interface Insets { top: number; right: number; bottom: number; left: number }

export interface LabelItem {
  id: string;
  el: HTMLDivElement;
  /** Anchor in scene coordinates (VE applied). */
  anchor: THREE.Vector3;
  priority: number;
  /** 0..1 extra fade (e.g. distance). */
  alpha: number;
  enabled: boolean;
  /** Cached size; set w = 0 to re-measure. */
  w: number;
  h: number;
  // placement state
  x: number;
  y: number;
  ax: number;
  ay: number;
  shown: boolean;
  leader: boolean;
  lastTx: string;
  lastOp: string;
}

export function makeLabelItem(id: string, el: HTMLDivElement): LabelItem {
  return { id, el, anchor: new THREE.Vector3(), priority: 0, alpha: 1, enabled: true, w: 0, h: 0, x: 0, y: 0, ax: 0, ay: 0, shown: false, leader: false, lastTx: '', lastOp: '' };
}

const GAP = 6, STEM = 12;

export class LabelPlacer {
  private v = new THREE.Vector3();
  private rects: { x0: number; y0: number; x1: number; y1: number }[] = [];

  place(items: LabelItem[], camera: THREE.Camera, w: number, h: number, ins: Insets) {
    const sx0 = ins.left, sy0 = ins.top, sx1 = w - ins.right, sy1 = h - ins.bottom;
    // project anchors
    for (const it of items) {
      it.shown = false;
      if (!it.enabled || it.alpha <= 0.02) continue;
      const p = this.v.copy(it.anchor).project(camera);
      if (p.z > 1 || p.z < -1) continue;
      it.ax = (p.x * 0.5 + 0.5) * w; it.ay = (-p.y * 0.5 + 0.5) * h;
      if (it.ax < sx0 - 40 || it.ax > sx1 + 40 || it.ay < sy0 - 40 || it.ay > sy1 + 200) continue;
      if (!it.w) { it.w = it.el.offsetWidth || 120; it.h = it.el.offsetHeight || 24; }
      it.shown = true;
    }
    const order = items.filter(i => i.shown).sort((a, b) => b.priority - a.priority);
    this.rects.length = 0;
    // anchors themselves are small obstacles so labels don't cover other pins
    for (const it of order) this.rects.push({ x0: it.ax - 5, y0: it.ay - 5, x1: it.ax + 5, y1: it.ay + 5 });
    for (const it of order) {
      const cands: [number, number, boolean][] = [];
      const cx = it.ax - it.w / 2, top = it.ay - STEM - it.h;
      cands.push([cx, top, false]);
      for (let k = 1; k <= 3; k++) cands.push([cx, top - k * (it.h + GAP), true]);
      cands.push([it.ax + 18, it.ay - it.h / 2, true], [it.ax - 18 - it.w, it.ay - it.h / 2, true]);
      cands.push([cx + it.w * 0.6 + GAP, top - (it.h + GAP), true], [cx - it.w * 0.6 - GAP, top - (it.h + GAP), true]);
      cands.push([cx, it.ay + STEM + 4, true]);
      let ok = false;
      for (const [x, y, leader] of cands) {
        const r = { x0: x - 2, y0: y - 2, x1: x + it.w + 2, y1: y + it.h + 2 };
        if (r.x0 < sx0 || r.y0 < sy0 || r.x1 > sx1 || r.y1 > sy1) continue;
        let hit = false;
        for (const o of this.rects) {
          if (o.x1 <= r.x0 || o.x0 >= r.x1 || o.y1 <= r.y0 || o.y0 >= r.y1) continue;
          // its own anchor obstacle doesn't count
          if (Math.abs((o.x0 + o.x1) / 2 - it.ax) < 0.5 && Math.abs((o.y0 + o.y1) / 2 - it.ay) < 0.5) continue;
          hit = true; break;
        }
        if (hit) continue;
        it.x = x; it.y = y; it.leader = leader; ok = true;
        this.rects.push(r);
        break;
      }
      if (!ok) it.shown = false;
    }
    // DOM
    for (const it of items) {
      const op = it.shown ? Math.min(1, it.alpha).toFixed(2) : '0';
      if (op !== it.lastOp) { it.el.style.opacity = op; it.el.style.visibility = it.shown ? 'visible' : 'hidden'; it.lastOp = op; }
      if (!it.shown) continue;
      const tx = `translate3d(${Math.round(it.x)}px, ${Math.round(it.y)}px, 0)`;
      if (tx !== it.lastTx) { it.el.style.transform = tx; it.lastTx = tx; }
    }
  }

  /** Stems / leader lines + anchor pins (overlay canvas, CSS px). */
  drawLeaders(ctx: CanvasRenderingContext2D, items: LabelItem[], ink: string, halo: string, colorOf: (it: LabelItem) => string) {
    for (const it of items) {
      if (!it.shown) continue;
      const a = Math.min(1, it.alpha);
      const bx = Math.min(Math.max(it.ax, it.x + 10), it.x + it.w - 10);
      const by = it.y > it.ay ? it.y : it.y + it.h;
      ctx.globalAlpha = a;
      ctx.lineCap = 'round';
      ctx.strokeStyle = halo; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(it.ax, it.ay, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = colorOf(it);
      ctx.beginPath(); ctx.arc(it.ax, it.ay, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
