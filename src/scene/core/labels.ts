/**
 * The scene's ONE screen-space label placer (SceneContext.labels): core block labels and every label a module
 * registers (string pins, grade chips, truck tags …) are placed together once per rendered frame.
 *
 *  - Greedy by priority (selected 100 > hovered 90 > dig/dump block 50 > string pin 40 > grade chip 20); ties keep
 *    registration order. Each label tries a short list of offsets and takes the first that hits no placed label
 *    or anchor dot and stays inside the safe rect (chrome bands / inspector excluded). No room = hidden, never
 *    overlapping. Last frame's slot is tried first so labels do not hop while the camera moves.
 *  - Two styles: "callout" (priority ≥ 30 by default: box above the anchor on a stem, anchor dot) and "tag"
 *    (priority < 30, or `el.dataset.place = 'center'`: centred on the anchor, e.g. a grade chip on its line).
 *    `el.dataset.place = 'above'` forces a callout. Displaced labels get a leader to the anchor (unless
 *    `leader: false`), drawn on the overlay canvas; `el.dataset.color` colours a module label's anchor dot,
 *    `el.dataset.dot = '0'` drops the dot.
 *  - The placer owns `transform`, `visibility` and `opacity` of each element (top-left corner at the slot) and
 *    appends module elements to the label layer if they are not in it. Sizes come from a ResizeObserver (no layout
 *    reads per frame). No per-frame allocations: items live in a persistent array sorted in place, rects in a
 *    typed array, DOM writes only when a value changes.
 */
import * as THREE from 'three';
import type { Frame } from '@/core/frame';
import type { LabelService as LabelServiceApi, PlacedLabel } from '../context';

export interface Insets { top: number; right: number; bottom: number; left: number }

export interface LabelItem {
  id: string;
  el: HTMLElement;
  /** Anchor in scene coordinates (VE applied). Module labels: recomputed from `wx/wy/wz` every frame. */
  anchor: THREE.Vector3;
  priority: number;
  /** 0..1 extra fade (e.g. distance). */
  alpha: number;
  enabled: boolean;
  /** Cached border-box size (ResizeObserver); 0 = measure on next place. */
  w: number;
  h: number;
  /** Leader line allowed when displaced. */
  leaderOk: boolean;
  /** Anchor dot colour ('' = none). */
  color: string;
  /** World anchor for module labels (E, N, Z). */
  world: boolean;
  wx: number; wy: number; wz: number;
  // placement state
  x: number;
  y: number;
  ax: number;
  ay: number;
  shown: boolean;
  /** Displaced from its natural slot (draw a leader). */
  leader: boolean;
  tag: boolean;
  slot: number;
  lastX: number;
  lastY: number;
  lastOp: number;
  seq: number;
}

export function makeLabelItem(id: string, el: HTMLElement): LabelItem {
  return {
    id, el, anchor: new THREE.Vector3(), priority: 50, alpha: 1, enabled: true, w: 0, h: 0, leaderOk: true, color: '',
    world: false, wx: 0, wy: 0, wz: 0, x: 0, y: 0, ax: 0, ay: 0, shown: false, leader: false, tag: false, slot: -1,
    lastX: NaN, lastY: NaN, lastOp: -1, seq: 0,
  };
}

const GAP = 6, STEM = 12, DOT = 5;
const CALLOUT_SLOTS = 9, TAG_SLOTS = 5;

export class LabelService implements LabelServiceApi {
  private layer: HTMLElement;
  private byId = new Map<string, LabelItem>();
  private byEl = new WeakMap<Element, LabelItem>();
  /** Persistent placement order (insertion-sorted by priority each frame). */
  private order: LabelItem[] = [];
  private rects = new Float32Array(4 * 128);
  private nRects = 0;
  private v = new THREE.Vector3();
  private ro: ResizeObserver | null = null;
  private seq = 0;
  private onChange: () => void;
  /** Safe rect of the last pass (for overlay text that must avoid labels). */
  private sx0 = 0; private sy0 = 0; private sx1 = 0; private sy1 = 0;

  constructor(layer: HTMLElement, onChange: () => void) {
    this.layer = layer;
    this.onChange = onChange;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(entries => {
        let any = false;
        for (const e of entries) {
          const it = this.byEl.get(e.target);
          if (!it) continue;
          const b = e.borderBoxSize?.[0];
          const w = b ? b.inlineSize : (e.target as HTMLElement).offsetWidth, h = b ? b.blockSize : (e.target as HTMLElement).offsetHeight;
          if (Math.abs(w - it.w) > 0.5 || Math.abs(h - it.h) > 0.5) { it.w = w; it.h = h; any = true; }
        }
        if (any) this.onChange();
      });
    }
  }

  // ─────────────────────────────────────────────────────────── module API (SceneContext.labels)

  upsert(l: PlacedLabel): void {
    let it = this.byId.get(l.id);
    if (it && it.el !== l.el) { this.detach(it); it = undefined; }
    let changed = false;
    if (!it) {
      it = makeLabelItem(l.id, l.el);
      it.world = true;
      if (l.el.parentElement !== this.layer) this.layer.appendChild(l.el);
      this.attach(it);
      changed = true;
    }
    const ds = l.el.dataset;
    const color = ds.dot === '0' ? '' : ds.color || '';
    const tag = ds.place === 'center' || (ds.place !== 'above' && l.priority < 30);
    const leaderOk = l.leader !== false;
    if (changed || it.wx !== l.world[0] || it.wy !== l.world[1] || it.wz !== l.world[2] || it.priority !== l.priority
      || it.leaderOk !== leaderOk || it.color !== color || it.tag !== tag || !it.enabled) changed = true;
    it.wx = l.world[0]; it.wy = l.world[1]; it.wz = l.world[2];
    it.priority = l.priority;
    it.leaderOk = leaderOk;
    it.enabled = true;
    it.color = color;
    it.tag = tag;
    // only a real change asks for a frame (a module may upsert every frame without keeping the loop awake)
    if (changed) this.onChange();
  }

  remove(id: string): void {
    const it = this.byId.get(id);
    if (!it) return;
    this.detach(it);
    it.el.style.visibility = 'hidden';
    this.onChange();
  }

  // ─────────────────────────────────────────────────────────── core API

  /** Register a core label (anchor / priority / alpha / enabled updated by its owner every frame). */
  add(it: LabelItem) {
    const old = this.byId.get(it.id);
    if (old && old !== it) this.detach(old);
    if (it.el.parentElement !== this.layer) this.layer.appendChild(it.el);
    this.attach(it);
  }
  delete(it: LabelItem) { if (this.byId.get(it.id) === it) this.detach(it); }

  private attach(it: LabelItem) {
    it.seq = this.seq++;
    this.byId.set(it.id, it);
    this.byEl.set(it.el, it);
    this.order.push(it);
    this.ro?.observe(it.el);
  }
  private detach(it: LabelItem) {
    this.byId.delete(it.id);
    this.byEl.delete(it.el);
    const i = this.order.indexOf(it);
    if (i >= 0) this.order.splice(i, 1);
    this.ro?.unobserve(it.el);
    it.shown = false;
  }

  /** True when the screen rect overlaps a label placed this frame (overlay text uses it to keep clear). */
  hits(x0: number, y0: number, x1: number, y1: number): boolean {
    const R = this.rects;
    for (let k = 0; k < this.nRects; k++) {
      const o = k * 4;
      if (R[o + 2] <= x0 || R[o] >= x1 || R[o + 3] <= y0 || R[o + 1] >= y1) continue;
      return true;
    }
    return false;
  }
  /** Reserve a rect for overlay text so later overlay passes avoid it too. */
  reserve(x0: number, y0: number, x1: number, y1: number) { this.pushRect(x0, y0, x1, y1); }
  inSafe(x0: number, y0: number, x1: number, y1: number): boolean { return x0 >= this.sx0 && y0 >= this.sy0 && x1 <= this.sx1 && y1 <= this.sy1; }

  private pushRect(x0: number, y0: number, x1: number, y1: number) {
    if ((this.nRects + 1) * 4 > this.rects.length) { const n = new Float32Array(this.rects.length * 2); n.set(this.rects); this.rects = n; }
    const o = this.nRects * 4;
    this.rects[o] = x0; this.rects[o + 1] = y0; this.rects[o + 2] = x1; this.rects[o + 3] = y1;
    this.nRects++;
  }

  private free(x0: number, y0: number, x1: number, y1: number, ax: number, ay: number): boolean {
    const R = this.rects;
    for (let k = 0; k < this.nRects; k++) {
      const o = k * 4;
      if (R[o + 2] <= x0 || R[o] >= x1 || R[o + 3] <= y0 || R[o + 1] >= y1) continue;
      // its own anchor dot doesn't count
      if (Math.abs((R[o] + R[o + 2]) * 0.5 - ax) < 0.5 && Math.abs((R[o + 1] + R[o + 3]) * 0.5 - ay) < 0.5) continue;
      return false;
    }
    return true;
  }

  /** Candidate slot k for an item → writes it.x / it.y, returns true if the slot is "displaced" (leader). */
  private slotPos(it: LabelItem, k: number): boolean {
    const w = it.w, h = it.h, ax = it.ax, ay = it.ay;
    if (it.tag) {
      switch (k) {
        case 0: it.x = ax - w / 2; it.y = ay - h / 2; return false;
        case 1: it.x = ax - w / 2; it.y = ay - h - 8; return true;
        case 2: it.x = ax - w / 2; it.y = ay + 8; return true;
        case 3: it.x = ax + 10; it.y = ay - h / 2; return true;
        default: it.x = ax - 10 - w; it.y = ay - h / 2; return true;
      }
    }
    const cx = ax - w / 2, top = ay - STEM - h;
    switch (k) {
      case 0: it.x = cx; it.y = top; return false;
      case 1: it.x = cx; it.y = top - (h + GAP); return true;
      case 2: it.x = ax + 18; it.y = ay - h / 2; return true;
      case 3: it.x = ax - 18 - w; it.y = ay - h / 2; return true;
      case 4: it.x = cx + w * 0.6 + GAP; it.y = top - (h + GAP); return true;
      case 5: it.x = cx - w * 0.6 - GAP; it.y = top - (h + GAP); return true;
      case 6: it.x = cx; it.y = top - 2 * (h + GAP); return true;
      case 7: it.x = cx; it.y = ay + STEM + 4; return true;
      default: it.x = cx; it.y = top - 3 * (h + GAP); return true;
    }
  }

  /**
   * One pass over every label: project, sort, place, write the DOM. `visible` = false (Labels toggle off) hides all.
   */
  place(camera: THREE.Camera, w: number, h: number, ins: Insets, frame: Frame, visible = true) {
    const sx0 = ins.left, sy0 = ins.top, sx1 = w - ins.right, sy1 = h - ins.bottom;
    this.sx0 = sx0; this.sy0 = sy0; this.sx1 = sx1; this.sy1 = sy1;
    const order = this.order;
    // insertion sort, descending priority, stable by registration (nearly sorted frame to frame → O(n))
    for (let i = 1; i < order.length; i++) {
      const it = order[i];
      let j = i - 1;
      while (j >= 0 && (order[j].priority < it.priority || (order[j].priority === it.priority && order[j].seq > it.seq))) { order[j + 1] = order[j]; j--; }
      order[j + 1] = it;
    }
    const o0 = frame.origin, ve = frame.vx;
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      const was = it.shown;
      it.shown = false;
      if (!visible || !it.enabled || it.alpha <= 0.02) { if (!was) it.slot = -1; continue; }
      if (it.world) it.anchor.set(it.wx - o0[0], (it.wz - o0[2]) * ve, -(it.wy - o0[1]));
      const p = this.v.copy(it.anchor).project(camera);
      if (p.z > 1 || p.z < -1) continue;
      it.ax = (p.x * 0.5 + 0.5) * w; it.ay = (-p.y * 0.5 + 0.5) * h;
      if (it.ax < sx0 - 40 || it.ax > sx1 + 40 || it.ay < sy0 - 40 || it.ay > sy1 + 200) continue;
      if (!it.w) { it.w = it.el.offsetWidth || 120; it.h = it.el.offsetHeight || 24; }
      it.shown = true;
      if (!was) it.slot = -1;
    }
    this.nRects = 0;
    // anchor dots are small obstacles so labels don't cover other pins
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (it.shown && !it.tag && it.color) this.pushRect(it.ax - DOT, it.ay - DOT, it.ax + DOT, it.ay + DOT);
    }
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (!it.shown) continue;
      const n = it.tag ? TAG_SLOTS : CALLOUT_SLOTS;
      let ok = false;
      // last frame's slot first (no hopping), then the rest in order
      for (let s = -1; s < n && !ok; s++) {
        const k = s < 0 ? it.slot : s;
        if (k < 0 || (s >= 0 && k === it.slot)) continue;
        const displaced = this.slotPos(it, k);
        if (displaced && !it.leaderOk && it.tag) continue;
        const x0 = it.x - 2, y0 = it.y - 2, x1 = it.x + it.w + 2, y1 = it.y + it.h + 2;
        if (x0 < sx0 || y0 < sy0 || x1 > sx1 || y1 > sy1) continue;
        if (!this.free(x0, y0, x1, y1, it.ax, it.ay)) continue;
        it.leader = displaced; it.slot = k; ok = true;
        this.pushRect(x0, y0, x1, y1);
      }
      if (!ok) { it.shown = false; it.slot = -1; }
    }
    // DOM
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      const op = it.shown ? Math.round(Math.min(1, it.alpha) * 100) : 0;
      if (op !== it.lastOp) {
        it.el.style.opacity = op === 100 ? '' : String(op / 100);
        it.el.style.visibility = op > 0 ? 'visible' : 'hidden';
        it.lastOp = op;
      }
      if (!it.shown) continue;
      const x = Math.round(it.x), y = Math.round(it.y);
      if (x !== it.lastX || y !== it.lastY) { it.el.style.transform = `translate3d(${x}px,${y}px,0)`; it.lastX = x; it.lastY = y; }
    }
  }

  /** Stems / leader lines + anchor dots (overlay canvas, CSS px). */
  drawLeaders(ctx: CanvasRenderingContext2D, ink: string, halo: string) {
    const order = this.order;
    ctx.lineCap = 'round';
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (!it.shown) continue;
      if (it.tag && !it.leader) continue;
      if (it.leader && !it.leaderOk) continue;
      const a = Math.min(1, it.alpha);
      const bx = Math.min(Math.max(it.ax, it.x + 10), it.x + it.w - 10);
      const by = it.y > it.ay ? it.y : it.y + it.h;
      ctx.globalAlpha = a;
      ctx.strokeStyle = halo; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(it.ax, it.ay); ctx.lineTo(bx, by); ctx.stroke();
      if (it.color) {
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(it.ax, it.ay, DOT, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = it.color;
        ctx.beginPath(); ctx.arc(it.ax, it.ay, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  dispose() { this.ro?.disconnect(); this.order.length = 0; this.byId.clear(); }
}
