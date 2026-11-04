/**
 * Tools module: the pointer / keyboard behaviour of store.tool on the 3D view.
 *   select   pick trucks, string points, strings, dig / dump blocks → store.select
 *   draw     click snapped points, rubber band with live length / grade / RL, Backspace, Enter / double-click, Esc;
 *            optional "follow the surface" densify at 25 m → store.addString
 *   edit     drag points over the terrain (one undo step on release), Alt / Ctrl-click a leg inserts, Delete removes,
 *            S toggles a stop sign, hover readout
 *   route    click the dig end, then the dump end (snap to block centroids within 60 m) → geom.autoRoute → addString
 *   section  click A then B → store.setSection
 *   measure  click points → legs, 3D / plan length, rise / fall, average grade
 * Each tool shows a hint chip (bottom centre) and sets the cursor. Overlays are drawn on the 2D overlay canvas.
 */
import type { SceneContext, SceneModule, ScenePointer } from '../context';
import type { HaulString, Id, MeshAsset, StringPoint } from '@/core/types';
import { useApp, type AppState, type ToolId } from '@/state/store';
import { uid, nowIso } from '@/core/ids';
import { worldToScene } from '@/core/frame';
import { CAT_HEX } from '@/ui/chart';
import { autoRoute, rasterize, type Grid } from '@/geom';
import { busOf } from '../strings/bus';
import { densifyPoints, polylineStats, type XYZ } from '../strings/path';
import { makeProjector, type Projector } from '../strings/screen';
import { ACCENT, gradeHex } from '../strings/palette';
import { drawHandle, escapeHtml } from '../strings';
import css from '../strings/ui.module.css';
import { fmtGrade, fmtLen, legReadout, lineReduce, nextName, snapTo, type ClickLine } from './machine';

const DENSIFY_M = 25;
const SNAP_M = 60;

export const toolsModule: SceneModule = (ctx: SceneContext) => {
  const bus = busOf(ctx);
  const st = () => useApp.getState();
  const root = document.createElement('div');
  root.className = css.root;
  (ctx.hudLayer ?? ctx.labelLayer).appendChild(root); // hints / HUD stay visible when labels are off
  const hint = document.createElement('div');
  hint.className = css.hint;
  hint.dataset.hidden = 'true';
  root.appendChild(hint);
  const tip = document.createElement('div');
  tip.className = css.tip;
  tip.style.display = 'none';
  root.appendChild(tip);

  // ── tool state ─────────────────────────────────────────────────────────────────────
  let draw: ClickLine = { pts: [], done: false };
  let measure: ClickLine = { pts: [], done: false };
  let sectionA: XYZ | null = null;
  let route: { a: (XYZ & { assetId?: Id; name?: string }) | null; busy: boolean } = { a: null, busy: false };
  let cursor: XYZ | null = null;
  let cursorPx: { x: number; y: number } | null = null;
  let autoDensify = true;
  let drag: { id: Id; index: number; pts: StringPoint[]; moved: boolean; x: number; y: number } | null = null;
  let downAt: { x: number; y: number } | null = null;
  let lastTool: ToolId = st().tool;
  let hintKey = '';

  const reset = () => {
    draw = { pts: [], done: false };
    measure = { pts: [], done: false };
    sectionA = null;
    route = { a: null, busy: false };
    if (drag) endDrag(false);
    tip.style.display = 'none';
  };

  const unsub = useApp.subscribe((s: AppState, p: AppState) => {
    if (s.tool !== p.tool) { if (lastTool === 'section' && s.tool !== 'section') { /* keep the committed section */ } reset(); lastTool = s.tool; updateCursor(); }
    if (s.tool !== p.tool || s.selection !== p.selection || s.scenario !== p.scenario) { updateHint(); ctx.requestRender(); }
  });

  // ── helpers ────────────────────────────────────────────────────────────────────────
  const pick = (x: number, y: number): XYZ | null => {
    const w = ctx.pickTerrain(x, y);
    return w ? { e: w[0], n: w[1], z: w[2] } : null;
  };
  const selectedString = (): HaulString | undefined => {
    const s = st();
    return s.selection.kind === 'string' ? s.scenario.strings.find(h => h.id === (s.selection as { id: Id }).id) : undefined;
  };
  const centroids = (role: 'dig' | 'dump') =>
    st().scenario.assets.filter(a => a.role === role && a.visible !== false).map(a => ({ e: a.stats.centroid[0], n: a.stats.centroid[1], z: ctx.heightAt(a.stats.centroid[0], a.stats.centroid[1]) ?? a.stats.centroid[2], assetId: a.id, name: a.name }));

  function updateCursor() {
    const t = st().tool;
    ctx.setCursor(t === 'draw' || t === 'measure' || t === 'section' || t === 'route' ? 'crosshair' : drag ? 'grabbing' : '');
  }

  function setHint(html: string | null) {
    if (html === null) { hint.dataset.hidden = 'true'; hintKey = ''; return; }
    if (html !== hintKey) { hint.innerHTML = html; hintKey = html; wireHint(); }
    hint.dataset.hidden = 'false';
  }
  const kbd = (k: string) => `<kbd>${k}</kbd>`;
  function updateHint() {
    const s = st();
    const sep = `<span class="${css.hintSep}"></span>`;
    switch (s.tool) {
      case 'draw':
        setHint(`<span class="${css.hintTool}">Draw string</span><span>${draw.pts.length ? `${draw.pts.length} point${draw.pts.length > 1 ? 's' : ''} · ${kbd('Enter')} or double-click to finish · ${kbd('⌫')} undo point` : 'Click on the surface to add points'} · ${kbd('Esc')} cancel</span>${sep}`
          + `<button class="${css.hintOpt}" data-act="densify" aria-pressed="${autoDensify}"><span class="${css.switch}" data-on="${autoDensify}"></span>Follow surface (${DENSIFY_M} m)</button>`
          + (draw.pts.length >= 2 ? `<button class="${css.hintBtn}" data-act="finish">Finish</button>` : ''));
        break;
      case 'edit': {
        const hs = selectedString();
        setHint(hs
          ? `<span class="${css.hintTool}">Edit ${escapeHtml(hs.name)}</span><span>Drag points · ${kbd('Alt')}+click a leg inserts · ${kbd('Del')} removes · ${kbd('S')} stop sign</span>`
          : `<span class="${css.hintTool}">Edit</span><span>Click a string to edit its points</span>`);
        break;
      }
      case 'route':
        setHint(route.busy
          ? `<span class="${css.spinner}"></span><span class="${css.hintTool}">Finding a route</span><span>least cost over the surface, ≤ 10 % grade…</span>`
          : `<span class="${css.hintTool}">Auto-route</span><span>${route.a ? `From ${escapeHtml(route.a.name ?? 'start')} · click the dump end` : 'Click the dig end (snaps to a dig block)'} · ${kbd('Esc')} cancel</span>`);
        break;
      case 'section': {
        const sec = s.section;
        setHint(sectionA
          ? `<span class="${css.hintTool}">Section</span><span>Click point B · ${kbd('Esc')} cancel</span>`
          : sec ? `<span class="${css.hintTool}">Section A–B</span><span>${fmtLen(Math.hypot(sec.b[0] - sec.a[0], sec.b[1] - sec.a[1]))} · click to redraw · ${kbd('Esc')} clear</span>`
            : `<span class="${css.hintTool}">Section</span><span>Click point A on the surface</span>`);
        break;
      }
      case 'measure':
        setHint(`<span class="${css.hintTool}">Measure</span><span>${measure.done ? 'Click to start a new measurement' : measure.pts.length ? `${kbd('Enter')} finish · ${kbd('⌫')} undo point` : 'Click points on the surface'} · ${kbd('Esc')} clear</span>`);
        break;
      default:
        setHint(null);
    }
  }
  function wireHint() {
    hint.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach(b => {
      b.onclick = ev => {
        ev.stopPropagation();
        if (b.dataset.act === 'densify') { autoDensify = !autoDensify; updateHint(); }
        if (b.dataset.act === 'finish') finishDraw();
      };
      b.onpointerdown = ev => ev.stopPropagation();
    });
  }

  // ── draw ───────────────────────────────────────────────────────────────────────────
  function finishDraw() {
    const s = st();
    if (draw.pts.length < 2) return;
    let pts: StringPoint[] = draw.pts.map(p => ({ id: uid('pt'), e: p.e, n: p.n, z: p.z, snapped: true }));
    if (autoDensify) pts = densifyPoints(pts, DENSIFY_M, (e, n) => ctx.heightAt(e, n), (e, n, z, snapped) => ({ id: uid('pt'), e, n, z, snapped }));
    const name = nextName(s.scenario.strings.map(h => h.name));
    const t = nowIso();
    const hs: HaulString = {
      id: uid('str'), name, color: CAT_HEX[s.scenario.strings.length % CAT_HEX.length], points: pts, source: 'drawn', visible: true,
      createdAt: t, updatedAt: t,
    };
    s.addString(hs);
    const len = polylineStats(pts).length3d;
    s.toast('ok', `${name} added · ${fmtLen(len)} · ${pts.length} points`);
    s.select({ kind: 'string', id: hs.id });
    draw = { pts: [], done: false };
    s.setTool('select');
  }

  // ── edit ───────────────────────────────────────────────────────────────────────────
  function startDrag(id: Id, index: number, x: number, y: number) {
    const hs = st().scenario.strings.find(h => h.id === id);
    if (!hs || hs.locked) return false;
    drag = { id, index, pts: hs.points, moved: false, x, y };
    bus.dragPoint = { stringId: id, index };
    ctx.setControlsEnabled(false);
    updateCursor();
    return true;
  }
  function endDrag(commit: boolean) {
    if (!drag) return;
    const d = drag;
    drag = null;
    bus.dragPoint = null;
    ctx.setControlsEnabled(true);
    const preview = bus.preview.get(d.id);
    bus.setPreview(d.id, null);
    if (commit && d.moved && preview) st().setStringPoints(d.id, preview, 'Move point');
    st().select({ kind: 'string', id: d.id, pointIndex: d.index });
    updateCursor();
  }
  function insertAt(hs: HaulString, seg: number, p: XYZ) {
    const a = hs.points[seg], b = hs.points[seg + 1];
    if (!a || !b) return;
    const np: StringPoint = { id: uid('pt'), e: p.e, n: p.n, z: p.z, snapped: true, seg: a.seg ? { ...a.seg } : undefined };
    const pts = [...hs.points.slice(0, seg + 1), np, ...hs.points.slice(seg + 1)];
    st().setStringPoints(hs.id, pts, 'Insert point');
    st().select({ kind: 'string', id: hs.id, pointIndex: seg + 1 });
  }

  // ── route ──────────────────────────────────────────────────────────────────────────
  const gridCache = new WeakMap<MeshAsset['mesh'], Grid>();
  function topoGrid(): Grid | null {
    const topo = st().scenario.assets.find(a => a.role === 'topo');
    if (!topo) return null;
    let g = gridCache.get(topo.mesh);
    if (!g) { g = rasterize(topo.mesh, 5); gridCache.set(topo.mesh, g); }
    return g;
  }
  function runRoute(b: XYZ & { assetId?: Id; name?: string }) {
    const a = route.a!;
    route = { a, busy: true };
    updateHint();
    ctx.requestRender();
    setTimeout(() => {
      const s = st();
      try {
        const grid = topoGrid();
        if (!grid) throw new Error('Import a topography surface first');
        const r = autoRoute(grid, [a.e, a.n], [b.e, b.n], { stepM: DENSIFY_M });
        if (!r.points.length) throw new Error('No drivable route between those points');
        const pts: StringPoint[] = r.points.map(([e, n, z]) => { const h = ctx.heightAt(e, n); return { id: uid('pt'), e, n, z: h ?? z, snapped: h != null }; });
        const t = nowIso();
        const name = a.name && b.name ? `${a.name.replace(/ (OB|coal)? ?block$/i, '')} → ${b.name}` : nextName(s.scenario.strings.map(h => h.name), 'Route');
        const hs: HaulString = {
          id: uid('str'), name, color: CAT_HEX[s.scenario.strings.length % CAT_HEX.length], points: pts, source: 'auto-route', visible: true,
          digId: a.assetId, dumpId: b.assetId, notes: `Auto-routed: max grade ${(r.maxGrade * 100).toFixed(1)} %${r.warnings.length ? ` · ${r.warnings.join('; ')}` : ''}`,
          createdAt: t, updatedAt: t,
        };
        s.addString(hs);
        s.select({ kind: 'string', id: hs.id });
        s.toast(r.warnings.length ? 'warn' : 'ok', `${name} · ${fmtLen(r.lengthM)} · max ${(r.maxGrade * 100).toFixed(1)} %${r.warnings.length ? ` · ${r.warnings[0]}` : ''}`);
      } catch (err) {
        s.toast('error', `Auto-route failed: ${(err as Error).message}`);
      }
      route = { a: null, busy: false };
      updateHint();
      ctx.requestRender();
    }, 40);
  }

  // ── pointer ────────────────────────────────────────────────────────────────────────
  const offPointer = ctx.onPointer((p: ScenePointer) => {
    const s = st();
    const t = s.tool;
    if (p.kind === 'leave') { cursor = null; cursorPx = null; tip.style.display = 'none'; ctx.requestRender(); return; }
    if (p.kind === 'move') {
      cursorPx = { x: p.x, y: p.y };
      if (drag) {
        if (Math.hypot(p.x - drag.x, p.y - drag.y) > 2) drag.moved = true;
        const w = pick(p.x, p.y);
        if (w && drag.moved) {
          const pts = drag.pts.map((q, i) => (i === drag!.index ? { ...q, e: w.e, n: w.n, z: w.z, snapped: true } : q));
          bus.setPreview(drag.id, pts);
          cursor = w;
        }
        return true;
      }
      if (t === 'draw' || t === 'measure' || t === 'section' || t === 'route' || t === 'edit') {
        cursor = pick(p.x, p.y);
        if (t === 'edit') {
          const hs = selectedString();
          const hit = hs ? bus.pickString?.(p.x, p.y, { tolPx: 9, onlyId: hs.id }) : null;
          const over = hit?.pointIndex !== undefined ? hit.pointIndex : null;
          bus.hoverPoint = hs && over !== null ? { stringId: hs.id, index: over } : null;
          ctx.setCursor(over !== null ? 'grab' : hit && (p.alt || p.ctrl) ? 'copy' : '');
        }
        ctx.requestRender();
      }
      return;
    }
    if (p.kind === 'down') {
      downAt = { x: p.x, y: p.y };
      if (t === 'edit' && p.button === 0 && !p.alt && !p.ctrl) {
        const hs = selectedString();
        const hit = hs ? bus.pickString?.(p.x, p.y, { tolPx: 10, onlyId: hs.id }) : null;
        if (hs && hit?.pointIndex !== undefined) return startDrag(hs.id, hit.pointIndex, p.x, p.y);
      }
      return;
    }
    if (p.kind === 'up') {
      if (drag) { endDrag(true); return true; }
      return;
    }
    if (p.kind === 'click') {
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 5) return; // it was an orbit drag
      if (p.button !== 0) return;
      return onClick(p);
    }
    if (p.kind === 'dblclick') {
      if (t === 'draw') { const r = lineReduce(draw, { type: 'dblclick' }); draw = r.state; if (r.action === 'finish') finishDraw(); updateHint(); return true; }
      if (t === 'measure') { measure = lineReduce(measure, { type: 'dblclick' }).state; updateHint(); ctx.requestRender(); return true; }
      return t !== 'select';
    }
    if (p.kind === 'contextmenu' && (t === 'draw' || t === 'measure') && (draw.pts.length || measure.pts.length)) {
      if (t === 'draw') draw = { pts: [], done: false }; else measure = { pts: [], done: false };
      updateHint(); ctx.requestRender();
      return true;
    }
  });

  function onClick(p: ScenePointer): boolean | void {
    const s = st();
    switch (s.tool) {
      case 'select': {
        const truck = bus.pickTruck?.(p.x, p.y);
        if (truck) { s.select({ kind: 'truck', ...truck }); return true; }
        const selId = s.selection.kind === 'string' ? s.selection.id : undefined;
        const onSel = selId ? bus.pickString?.(p.x, p.y, { tolPx: 9, onlyId: selId }) : null;
        if (onSel && selId) { s.select({ kind: 'string', id: selId, pointIndex: onSel.pointIndex }); return true; }
        const hit = bus.pickString?.(p.x, p.y, { tolPx: 8 });
        if (hit) { s.select({ kind: 'string', id: hit.stringId }); return true; }
        const solid = ctx.pick(p.x, p.y, ctx.layers.solids.children, true).find(h => assetIdOf(h.object));
        if (solid) { s.select({ kind: 'asset', id: assetIdOf(solid.object)! }); return true; }
        if (s.selection.kind !== 'none') s.select({ kind: 'none' });
        return;
      }
      case 'draw': {
        const w = pick(p.x, p.y);
        if (!w) { s.toast('warn', 'Click on the surface to add a point'); return true; }
        draw = lineReduce(draw, { type: 'click', p: w }).state;
        updateHint(); ctx.requestRender();
        return true;
      }
      case 'edit': {
        const hs = selectedString();
        if (hs && (p.alt || p.ctrl)) {
          const hit = bus.pickString?.(p.x, p.y, { tolPx: 10, onlyId: hs.id });
          const w = pick(p.x, p.y);
          if (hit && hit.segIndex !== undefined && w) { insertAt(hs, Math.min(hit.segIndex, hs.points.length - 2), w); return true; }
        }
        if (hs) {
          const hit = bus.pickString?.(p.x, p.y, { tolPx: 10, onlyId: hs.id });
          if (hit?.pointIndex !== undefined) { s.select({ kind: 'string', id: hs.id, pointIndex: hit.pointIndex }); return true; }
        }
        const other = bus.pickString?.(p.x, p.y, { tolPx: 8 });
        if (other) { s.select({ kind: 'string', id: other.stringId }); return true; }
        return;
      }
      case 'route': {
        if (route.busy) return true;
        const w = pick(p.x, p.y);
        if (!w) return true;
        if (!route.a) {
          const snap = snapTo(w, centroids('dig'), SNAP_M);
          route = { a: snap ? { ...snap } : w, busy: false };
          updateHint(); ctx.requestRender();
        } else {
          const snap = snapTo(w, centroids('dump'), SNAP_M);
          runRoute(snap ? { ...snap } : w);
        }
        return true;
      }
      case 'section': {
        const w = pick(p.x, p.y);
        if (!w) return true;
        if (!sectionA) { sectionA = w; s.setSection(undefined); }
        else { s.setSection({ a: [sectionA.e, sectionA.n], b: [w.e, w.n], widthM: 0 }); sectionA = null; }
        updateHint(); ctx.requestRender();
        return true;
      }
      case 'measure': {
        const w = pick(p.x, p.y);
        if (!w) return true;
        measure = lineReduce(measure, { type: 'click', p: w }).state;
        updateHint(); ctx.requestRender();
        return true;
      }
    }
  }

  function assetIdOf(o: { userData: Record<string, unknown>; parent: unknown } | null): Id | undefined {
    let cur = o as { userData: Record<string, unknown>; parent: unknown } | null;
    while (cur) {
      const id = cur.userData?.assetId as Id | undefined;
      if (id) return id;
      cur = cur.parent as typeof cur;
    }
    return undefined;
  }

  // ── keys ───────────────────────────────────────────────────────────────────────────
  const offKey = ctx.onKey((e: KeyboardEvent) => {
    if (e.type !== 'keydown' && e.type !== undefined) return;
    const s = st();
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const k = e.key;
    switch (s.tool) {
      case 'draw':
      case 'measure': {
        const isDraw = s.tool === 'draw';
        const ev = k === 'Enter' ? 'enter' : k === 'Backspace' ? 'backspace' : k === 'Escape' ? 'escape' : null;
        if (!ev) return;
        const r = lineReduce(isDraw ? draw : measure, { type: ev });
        if (isDraw) draw = r.state; else measure = r.state;
        if (r.action === 'finish' && isDraw) finishDraw();
        if (r.action === 'exit') s.setTool('select');
        updateHint(); ctx.requestRender();
        return true;
      }
      case 'edit': {
        const hs = selectedString();
        const sel = s.selection.kind === 'string' ? s.selection.pointIndex : undefined;
        if (k === 'Escape') { if (sel !== undefined && hs) s.select({ kind: 'string', id: hs.id }); else s.setTool('select'); return true; }
        if (!hs || sel === undefined || hs.locked) return;
        if (k === 'Delete' || k === 'Backspace') {
          if (hs.points.length <= 2) { s.toast('warn', 'A string needs at least two points'); return true; }
          s.setStringPoints(hs.id, hs.points.filter((_, i) => i !== sel), 'Delete point');
          s.select({ kind: 'string', id: hs.id, pointIndex: Math.min(sel, hs.points.length - 2) });
          return true;
        }
        if (k === 's' || k === 'S') {
          const pts = hs.points.map((q, i) => (i === sel ? { ...q, stop: !q.stop } : q));
          s.setStringPoints(hs.id, pts, pts[sel].stop ? 'Add stop sign' : 'Remove stop sign');
          return true;
        }
        return;
      }
      case 'route':
        if (k === 'Escape') { if (route.a && !route.busy) { route = { a: null, busy: false }; updateHint(); ctx.requestRender(); } else s.setTool('select'); return true; }
        return;
      case 'section':
        if (k === 'Escape') { if (sectionA) sectionA = null; else if (s.section) s.setSection(undefined); else s.setTool('select'); updateHint(); ctx.requestRender(); return true; }
        return;
      case 'select':
        if (k === 'Escape' && s.selection.kind !== 'none') { s.select({ kind: 'none' }); return true; }
        return;
    }
  });

  // ── overlay ────────────────────────────────────────────────────────────────────────
  const offOverlay = ctx.onOverlay((g, w, h) => {
    const s = st();
    const P = makeProjector(ctx);
    let tipHtml: string | null = null;
    switch (s.tool) {
      case 'draw': tipHtml = overlayDraw(g, P); break;
      case 'measure': tipHtml = overlayMeasure(g, P); break;
      case 'section': overlaySection(g, P); break;
      case 'route': overlayRoute(g, P); break;
      case 'edit': tipHtml = overlayEdit(); break;
    }
    if (tipHtml && cursorPx) {
      if (tip.dataset.k !== tipHtml) { tip.innerHTML = tipHtml; tip.dataset.k = tipHtml; }
      tip.style.display = '';
      const tw = tip.offsetWidth || 180, th = tip.offsetHeight || 60;
      let x = cursorPx.x + 18, y = cursorPx.y + 20;
      // usable area = canvas minus the shell's docked chrome (timeline, profile/section dock carry data-hud)
      const floor = chromeFloor(ctx.canvas, h);
      if (x + tw > w - 8) x = cursorPx.x - tw - 18;
      if (y + th > floor - 8) y = cursorPx.y - th - 16;
      if (y + th > floor - 8) y = floor - th - 8;
      tip.style.transform = `translate(${x}px, ${y}px)`;
    } else tip.style.display = 'none';
  });

  const T = new Float64Array(3), T2 = new Float64Array(3);
  /** Top edge (canvas px) of the highest docked shell element covering the bottom of the canvas. */
  function chromeFloor(canvas: HTMLCanvasElement, h: number): number {
    const c = canvas.getBoundingClientRect();
    let floor = h;
    document.querySelectorAll<HTMLElement>('[data-hud]').forEach(el => {
      const r = el.getBoundingClientRect();
      // docked bars in the lower part of the canvas (timeline, profile/section dock); not the tall inspector column
      if (r.height > 0 && r.height < c.height * 0.5 && r.top > c.top + c.height * 0.35 && r.top - c.top < floor) floor = r.top - c.top;
    });
    return floor;
  }
  const proj = (P: Projector, p: XYZ, out: Float64Array) => P.projectWorld(p.e, p.n, p.z, out);

  function strokeLeg(g: CanvasRenderingContext2D, P: Projector, a: XYZ, b: XYZ, color: string, dashed = false) {
    if (!proj(P, a, T) || !proj(P, b, T2)) return;
    g.save();
    g.lineCap = 'round';
    g.setLineDash(dashed ? [7, 5] : []);
    g.beginPath(); g.moveTo(T[0], T[1]); g.lineTo(T2[0], T2[1]);
    g.lineWidth = 6.5; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
    g.lineWidth = 3.5; g.strokeStyle = color; g.stroke();
    g.restore();
  }

  function ring(g: CanvasRenderingContext2D, x: number, y: number, label?: string) {
    g.save();
    g.beginPath(); g.arc(x, y, 14.5, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = 'rgba(27,33,36,0.55)'; g.stroke();
    g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = ACCENT; g.stroke();
    g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fillStyle = '#1F2329'; g.fill();
    if (label) {
      g.font = '600 12px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
      const tw = g.measureText(label).width + 16;
      const lx = x + 16, ly = y - 33;
      g.shadowColor = 'rgba(20,30,50,0.18)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
      g.beginPath(); g.roundRect(lx, ly, tw, 22, 7); g.fillStyle = '#fff'; g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = 1; g.strokeStyle = '#E3E6EB'; g.stroke();
      g.fillStyle = '#1F2329'; g.textBaseline = 'middle'; g.fillText(label, lx + 8, ly + 11.5);
    }
    g.restore();
  }

  function dot(g: CanvasRenderingContext2D, P: Projector, p: XYZ, r = 4.5, active = false) {
    if (!proj(P, p, T)) return;
    drawHandle(g, T[0], T[1], r, { active });
  }

  function overlayDraw(g: CanvasRenderingContext2D, P: Projector): string | null {
    const pts = draw.pts;
    for (let i = 1; i < pts.length; i++) strokeLeg(g, P, pts[i - 1], pts[i], gradeHex(legReadout(pts[i - 1], pts[i]).grade));
    const last = pts[pts.length - 1];
    if (last && cursor) strokeLeg(g, P, last, cursor, gradeHex(legReadout(last, cursor).grade), true);
    pts.forEach((p, i) => dot(g, P, p, i === 0 ? 5.5 : 4.5, i === 0));
    if (cursor && proj(P, cursor, T)) ring(g, T[0], T[1]);
    if (!cursor) return null;
    const total = polylineStats(last ? [...pts, cursor] : [cursor]);
    if (!last) return `<div class="${css.tipHead}">Start here</div><div class="${css.tipSub}">E ${cursor.e.toFixed(1)} · N ${cursor.n.toFixed(1)} · RL ${cursor.z.toFixed(1)}</div>`;
    const leg = legReadout(last, cursor);
    return `<div class="${css.tipHead}"><span class="${css.gradeDot}" style="background:${gradeHex(leg.grade)}"></span>${fmtLen(leg.d3)} · ${fmtGrade(leg.grade)}</div>`
      + `<div class="${css.tipRow}"><span>RL <b>${leg.rl.toFixed(1)}</b></span><span>Δ <b>${leg.dz >= 0 ? '+' : '−'}${Math.abs(leg.dz).toFixed(1)} m</b></span></div>`
      + `<div class="${css.tipSub}">Total ${fmtLen(total.length3d)} · ${pts.length + 1} points</div>`;
  }

  function overlayMeasure(g: CanvasRenderingContext2D, P: Projector): string | null {
    const pts = measure.pts;
    const live = !measure.done && cursor && pts.length ? [...pts, cursor] : pts;
    for (let i = 1; i < live.length; i++) {
      const dashed = !measure.done && i === live.length - 1 && cursor !== null;
      strokeLeg(g, P, live[i - 1], live[i], '#1F2329', dashed);
      const a = live[i - 1], b = live[i];
      const m = { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2, z: (a.z + b.z) / 2 };
      if (proj(P, m, T)) {
        const r = legReadout(a, b);
        const txt = `${fmtLen(r.d3)} · ${fmtGrade(r.grade)}`;
        g.save();
        g.font = '650 11.5px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
        const tw = g.measureText(txt).width + 12;
        g.beginPath(); g.roundRect(T[0] - tw / 2, T[1] - 21, tw, 18, 6);
        g.fillStyle = '#1F2329'; g.fill();
        g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
        g.fillText(txt, T[0], T[1] - 11.5);
        g.restore();
      }
    }
    live.forEach((p, i) => { if (i < pts.length) dot(g, P, p, 4.5); });
    if (cursor && !measure.done && proj(P, cursor, T)) ring(g, T[0], T[1]);
    if (live.length < 2) return cursor && !measure.done ? `<div class="${css.tipSub}">E ${cursor.e.toFixed(1)} · N ${cursor.n.toFixed(1)} · RL ${cursor.z.toFixed(1)}</div>` : null;
    const ps = polylineStats(live);
    return `<div class="${css.tipHead}">${fmtLen(ps.length3d)}<span class="${css.tipSub}">3D</span></div>`
      + `<div class="${css.tipRow}"><span>Plan <b>${fmtLen(ps.lengthPlan)}</b></span><span>Avg <b>${fmtGrade(ps.avgGrade)}</b></span></div>`
      + `<div class="${css.tipRow}"><span>Rise <b>${ps.rise.toFixed(1)} m</b></span><span>Fall <b>${ps.fall.toFixed(1)} m</b></span></div>`
      + `<div class="${css.tipSub}">Max leg grade ${fmtGrade(ps.maxGrade)} · ${live.length} points</div>`;
  }

  function overlaySection(g: CanvasRenderingContext2D, P: Projector) {
    const s = st();
    let a: XYZ | null = sectionA, b: XYZ | null = sectionA ? cursor : null;
    if (!sectionA && s.section) {
      const [ae, an] = s.section.a, [be, bn] = s.section.b;
      a = { e: ae, n: an, z: ctx.heightAt(ae, an) ?? 0 };
      b = { e: be, n: bn, z: ctx.heightAt(be, bn) ?? 0 };
    }
    if (a && b) {
      // sample along the surface so the line drapes
      const n = 48;
      g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const t = i / n, e = a.e + (b.e - a.e) * t, nn = a.n + (b.n - a.n) * t;
        const z = ctx.heightAt(e, nn);
        if (z == null || !P.projectWorld(e, nn, z + 0.5, T)) { pen = false; continue; }
        if (pen) g.lineTo(T[0], T[1]); else g.moveTo(T[0], T[1]);
        pen = true;
      }
      g.setLineDash(sectionA ? [8, 6] : []);
      g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
      g.lineWidth = 3; g.strokeStyle = ACCENT; g.stroke();
      g.restore();
      for (const [p, lbl] of [[a, 'A'], [b, 'B']] as [XYZ, string][]) {
        if (!proj(P, p, T)) continue;
        g.save();
        g.beginPath(); g.arc(T[0], T[1], 10, 0, Math.PI * 2);
        g.fillStyle = ACCENT; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
        g.fillStyle = '#fff'; g.font = '700 11px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(lbl, T[0], T[1] + 0.5);
        g.restore();
      }
      if (sectionA && cursor && cursorPx) {
        const d = Math.hypot(b.e - a.e, b.n - a.n);
        ring(g, cursorPx.x, cursorPx.y, `A → B · ${fmtLen(d)}`);
      }
    } else if (cursor && cursorPx) ring(g, cursorPx.x, cursorPx.y, 'A');
  }

  function overlayRoute(g: CanvasRenderingContext2D, P: Projector) {
    const digs = centroids('dig'), dumps = centroids('dump');
    const cands = route.a ? dumps : digs;
    // candidate targets as soft dots
    for (const c of cands) {
      if (!proj(P, c, T)) continue;
      g.save(); g.beginPath(); g.arc(T[0], T[1], 6, 0, Math.PI * 2);
      g.fillStyle = 'rgba(10,111,230,0.18)'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = ACCENT; g.stroke(); g.restore();
    }
    if (route.a) {
      dot(g, P, route.a, 6, true);
      if (cursor) strokeLeg(g, P, route.a, snapTo(cursor, dumps, SNAP_M) ?? cursor, ACCENT, true);
    }
    if (cursor && !route.busy) {
      const snap = snapTo(cursor, cands, SNAP_M);
      const at = snap ?? cursor;
      if (proj(P, at, T)) ring(g, T[0], T[1], snap ? `${snap.name} · ${route.a ? 'dump' : 'dig'}` : route.a ? 'Dump end' : 'Dig end');
    }
  }

  function overlayEdit(): string | null {
    const hs = selectedString();
    if (!hs) return null;
    const idx = drag ? drag.index : bus.hoverPoint?.stringId === hs.id ? bus.hoverPoint.index : null;
    if (idx === null || idx === undefined) return null;
    const pts = drag ? bus.preview.get(hs.id) ?? hs.points : hs.points;
    const p = pts[idx];
    if (!p) return null;
    const prev = pts[idx - 1], next = pts[idx + 1];
    const gIn = prev ? legReadout(prev, p).grade : null, gOut = next ? legReadout(p, next).grade : null;
    return `<div class="${css.tipHead}">Point ${idx + 1}<span class="${css.tipSub}">of ${pts.length}${p.stop ? ' · stop sign' : ''}</span></div>`
      + `<div class="${css.tipRow}"><span>E <b>${p.e.toFixed(1)}</b></span><span>N <b>${p.n.toFixed(1)}</b></span></div>`
      + `<div class="${css.tipRow}"><span>RL <b>${p.z.toFixed(2)}</b></span>${gIn !== null ? `<span>in <b style="color:${gradeHex(gIn)}">${fmtGrade(gIn)}</b></span>` : ''}${gOut !== null ? `<span>out <b style="color:${gradeHex(gOut)}">${fmtGrade(gOut)}</b></span>` : ''}</div>`
      + (drag ? '' : `<div class="${css.tipSub}">Drag to move · ${hs.points.length > 2 ? 'Del removes · ' : ''}S stop sign</div>`);
  }

  updateHint();
  updateCursor();

  return () => {
    unsub(); offPointer(); offKey(); offOverlay();
    if (drag) endDrag(false);
    ctx.setCursor('');
    root.remove();
  };
};
