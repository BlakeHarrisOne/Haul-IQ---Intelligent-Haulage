/**
 * Strings module: every visible haul string as a road ribbon (grade or circuit colour, white casing, chainage ticks,
 * drifting dig → dump chevrons, ghosted where it runs under the surface) with its carriageway band at the true road
 * width, start / end pins and grade chips (placed by the scene's shared label placer `ctx.labels` when the core has
 * it), stop-sign markers, vertex handles of the selected string, hover highlight (→ store.setHover) and a hover card
 * for the leg under the cursor (above the labels).
 * In the ride cameras (POV / chase) the ribbons give way to the real 3D haul road (road3d.ts): gravel carriageway,
 * windrows, delineators.
 * Exposes screen-space picking and path tables to the tools / actors / cockpit modules through the bus.
 */
import * as THREE from 'three';
import type { PlacedLabel, SceneContext, SceneModule } from '../context';
import type { HaulString, Id, Scenario, StringPoint } from '@/core/types';
import { useApp, type AppState, type Selection } from '@/state/store';
import { worldToScene, type Frame } from '@/core/frame';
import { busOf, type StringHit } from './bus';
import { buildPath, gradeClassOf, gradeRuns, legGrade, sampleAt, type PathTable } from './path';
import { buildRibbonGeometry, makeRibbonMaterial, type RibbonUniforms } from './ribbon';
import { buildRoads, makePostMaterial, makeRoadMaterial, postGeometry, roadDims, writePosts, type RoadDims } from './road3d';
import { distToSeg2, makeProjector, type Projector } from './screen';
import { ACCENT, circuitOfString, endNames, gradeHex, hexToRgb, STOP_RED, stringColor } from './palette';
import { nightOf } from './env';
import css from './ui.module.css';

interface Entry {
  id: Id;
  hs: HaulString;
  pts: StringPoint[];
  path: PathTable;
  /** Scene coords of the path points. */
  scene: Float32Array;
  color: string;
  key: string;
  group: THREE.Group;
  road: THREE.Mesh;
  glow: THREE.Mesh;
  ghost: THREE.Mesh;
  mats: (THREE.ShaderMaterial & { uniforms: RibbonUniforms })[];
  pinStart: HTMLDivElement;
  pinEnd: HTMLDivElement;
  /** Chip-only pins handed to the shared label placer (ctx.labels). */
  chipStart: HTMLDivElement;
  chipEnd: HTMLDivElement;
  pinText: string;
  dims: RoadDims;
  /** The end sits on a dig / dump block the scene core already labels. */
  startLinked: boolean;
  endLinked: boolean;
}

const frameKey = (f: Frame) => `${f.origin[0]},${f.origin[1]},${f.origin[2]},${f.vx}`;

export function scenePoints(f: Frame, path: PathTable): Float32Array {
  const out = new Float32Array(path.n * 3);
  for (let i = 0; i < path.n; i++) {
    const s = worldToScene(f, path.e[i], path.nn[i], path.z[i]);
    out[3 * i] = s[0]; out[3 * i + 1] = s[1]; out[3 * i + 2] = s[2];
  }
  return out;
}

export const stringsModule: SceneModule = (ctx: SceneContext) => {
  const bus = busOf(ctx);
  const entries = new Map<Id, Entry>();
  const shared = { uViewH: { value: 800 }, uDpr: { value: 1 }, uTime: { value: 0 } };
  const root = document.createElement('div');
  root.className = css.root;
  ctx.labelLayer.appendChild(root);
  const tagRoot = document.createElement('div');
  root.appendChild(tagRoot);
  // the hover card sits above every scene label (and stays when labels are off)
  const cardRoot = document.createElement('div');
  cardRoot.className = `${css.root} ${css.cardLayer}`;
  (ctx.hudLayer ?? ctx.labelLayer).appendChild(cardRoot);
  const tip = document.createElement('div');
  tip.className = css.tip;
  tip.style.display = 'none';
  cardRoot.appendChild(tip);
  // labels handed to the shared placer this frame / last frame (removed when they stop showing)
  let placedIds = new Set<string>();
  let nextIds = new Set<string>();
  /** Last value handed to the placer per id (it re-places on every upsert, so only changes are sent). */
  const sentKey = new Map<string, string>();
  const svc = () => ctx.labels;
  let wanted: PlacedLabel[] = [];
  const share = (id: string, world: [number, number, number], el: HTMLElement, priority: number, leader: boolean) => {
    nextIds.add(id);
    wanted.push({ id, world, el, priority, leader });
  };
  /** Stale labels first (their elements may be reused by a new id), then only the labels that changed. */
  const flushShared = () => {
    const L = svc();
    if (!L) return;
    for (const id of placedIds) if (!nextIds.has(id)) { L.remove(id); sentKey.delete(id); }
    for (const l of wanted) {
      const k = `${l.world[0].toFixed(2)},${l.world[1].toFixed(2)},${l.world[2].toFixed(2)}|${l.priority}|${l.leader}|${l.el.textContent}`;
      if (sentKey.get(l.id) === k && placedIds.has(l.id)) continue;
      sentKey.set(l.id, k);
      L.upsert(l);
    }
    placedIds = nextIds;
    wanted = [];
  };

  let dirty = true;
  let lastFrameKey = '';
  let hoverLeg: { id: Id; leg: number } | null = null;
  let pointer: { x: number; y: number } | null = null;
  const st = () => useApp.getState();

  const unsub = useApp.subscribe((s: AppState, p: AppState) => {
    if (s.scenario !== p.scenario || s.layers !== p.layers || s.selection !== p.selection || s.hover !== p.hover || s.tool !== p.tool) {
      dirty = true;
      ctx.requestRender();
    }
  });
  const onBus = () => { dirty = true; };
  bus.listeners.add(onBus);

  const visibleStrings = (s: AppState): HaulString[] =>
    s.layers.strings === false ? [] : s.scenario.strings.filter(h => h.visible !== false && h.points.length >= 2);
  bus.strings = () => visibleStrings(st());

  bus.pathOf = (id: Id) => {
    const e = entries.get(id);
    if (e) return e.path;
    const hs = st().scenario.strings.find(h => h.id === id);
    return hs ? buildPath(bus.preview.get(id) ?? hs.points) : null;
  };

  function makePin(kind: 'start' | 'end'): HTMLDivElement {
    const d = document.createElement('div');
    d.className = `${css.pin} ${kind === 'end' ? css.pinDump : ''}`;
    d.innerHTML = `<div class="${css.pinChip}"><span class="${css.pinSwatch}"></span><b></b><i></i></div><div class="${css.pinLeader}"></div><div class="${css.pinDot}"></div>`;
    root.appendChild(d);
    return d;
  }
  /** The pin as a bare chip for the shared placer (it draws the stem / leader and the anchor). */
  function makeChip(): HTMLDivElement {
    const d = document.createElement('div');
    d.className = `${css.pinChip} ${css.placed}`;
    d.innerHTML = `<span class="${css.pinSwatch}"></span><b></b><i></i>`;
    d.dataset.dot = '0';
    d.dataset.place = 'above';
    d.style.visibility = 'hidden';
    root.appendChild(d);
    return d;
  }

  function dispose(e: Entry) {
    ctx.layers.strings.remove(e.group);
    e.road.geometry.dispose();
    for (const m of e.mats) m.dispose();
    for (const el of [e.pinStart, e.pinEnd, e.chipStart, e.chipEnd]) el.remove();
    const L = svc();
    if (L) for (const id of [`pin:${e.id}:0`, `pin:${e.id}:1`]) { L.remove(id); placedIds.delete(id); sentKey.delete(id); }
  }

  function sync() {
    dirty = false;
    const s = st();
    const f = ctx.frame();
    const fk = frameKey(f);
    const frameChanged = fk !== lastFrameKey;
    lastFrameKey = fk;
    const vis = visibleStrings(s);
    const gradeOn = s.layers.grade !== false;
    const seen = new Set<Id>();
    vis.forEach((hs, idx) => {
      seen.add(hs.id);
      const pts = bus.preview.get(hs.id) ?? hs.points;
      const color = stringColor(s.scenario, hs, idx);
      const key = `${gradeOn}|${color}`;
      let e = entries.get(hs.id);
      if (e && e.hs === hs && e.pts === pts && e.key === key && !frameChanged) return;
      const path = buildPath(pts);
      const scene = scenePoints(f, path);
      const legColor = new Float32Array(Math.max(0, path.n - 1) * 3);
      const base = hexToRgb(color);
      for (let i = 0; i < path.n - 1; i++) {
        const c = gradeOn ? hexToRgb(gradeHex(legGrade(path, i))) : base;
        legColor.set(c, i * 3);
      }
      const buried = new Float32Array(path.n);
      for (let i = 0; i < path.n; i++) { const h = ctx.heightAt(path.e[i], path.nn[i]); buried[i] = h != null && path.z[i] < h - 1.0 ? 1 : 0; }
      const geo = buildRibbonGeometry({ pts: scene, chain: path.s, legColor, buried });
      if (!e) {
        const mats = [makeRibbonMaterial(1, shared), makeRibbonMaterial(2, shared), makeRibbonMaterial(0, shared)];
        const glow = new THREE.Mesh(geo, mats[0]);
        const ghost = new THREE.Mesh(geo, mats[1]);
        const road = new THREE.Mesh(geo, mats[2]);
        glow.renderOrder = 4; ghost.renderOrder = 5; road.renderOrder = 6;
        for (const m of [glow, ghost, road]) { m.frustumCulled = false; m.userData.stringId = hs.id; }
        const group = new THREE.Group();
        group.name = `string:${hs.name}`;
        group.add(glow, ghost, road);
        ctx.layers.strings.add(group);
        e = {
          id: hs.id, hs, pts, path, scene, color, key, group, road, glow, ghost, mats, pinStart: makePin('start'), pinEnd: makePin('end'),
          chipStart: makeChip(), chipEnd: makeChip(), pinText: '', startLinked: false, endLinked: false, dims: roadDims(s.scenario, hs),
        };
        entries.set(hs.id, e);
      } else {
        e.road.geometry.dispose();
        e.road.geometry = geo; e.glow.geometry = geo; e.ghost.geometry = geo;
        Object.assign(e, { hs, pts, path, scene, color, key, dims: roadDims(s.scenario, hs) });
      }
      const circ = circuitOfString(s.scenario, hs.id);
      const linked = (id: Id | undefined) => !!id && s.scenario.assets.some(a => a.id === id && a.visible !== false);
      e.startLinked = linked(hs.digId ?? circ?.digId);
      e.endLinked = linked(hs.dumpId ?? circ?.dumpId);
      const names = endNames(s.scenario, hs);
      const text = `${names.start.join('|')}|${names.end.join('|')}|${color}`;
      if (text !== e.pinText) {
        e.pinText = text;
        for (const [pin, nm] of [[e.pinStart, names.start], [e.pinEnd, names.end], [e.chipStart, names.start], [e.chipEnd, names.end]] as const) {
          (pin.querySelector('b') as HTMLElement).textContent = nm[0];
          (pin.querySelector('i') as HTMLElement).textContent = `· ${nm[1]}`;
          (pin.querySelector(`.${css.pinSwatch}`) as HTMLElement).style.background = color;
        }
      }
    });
    for (const [id, e] of entries) if (!seen.has(id)) { dispose(e); entries.delete(id); }
    applyHighlight();
    roadsDirty = true;
  }

  function applyHighlight() {
    const s = st();
    const sel = s.selection, hov = s.hover;
    for (const e of entries.values()) {
      const selected = (sel.kind === 'string' && sel.id === e.id) || (sel.kind === 'circuit' && s.scenario.circuits.find(c => c.id === sel.id)?.haulStringId === e.id);
      const hovered = hov.kind === 'string' && hov.id === e.id;
      const [glow, ghost, road] = e.mats;
      glow.uniforms.uOpacity.value = selected ? 0.62 : hovered ? 0.32 : 0;
      glow.visible = selected || hovered;
      road.uniforms.uHover.value = hovered ? 1 : 0;
      road.uniforms.uHoverLeg.value = hoverLeg && hoverLeg.id === e.id ? hoverLeg.leg : -10;
      // the carriageway at its true width: calm grade tint + thin casing lines, stronger on the focused string
      road.uniforms.uWidthM.value = glow.uniforms.uWidthM.value = ghost.uniforms.uWidthM.value = e.dims.widthM;
      road.uniforms.uBandA.value = selected ? 0.26 : hovered ? 0.22 : 0.15;
      road.uniforms.uEdgeA.value = selected ? 0.95 : hovered ? 0.85 : 0.62;
      road.uniforms.uMinPx.value = selected ? 8.5 : 7;
      ghost.uniforms.uMinPx.value = road.uniforms.uMinPx.value;
      glow.uniforms.uMinPx.value = road.uniforms.uMinPx.value;
    }
  }

  // ── picking ────────────────────────────────────────────────────────────────────────
  const tmp = new Float64Array(3), tmpB = new Float64Array(3);
  function pickString(x: number, y: number, opts: { tolPx?: number; onlyId?: Id } = {}): StringHit | null {
    const P = makeProjector(ctx);
    const tol = opts.tolPx ?? 9;
    let best: StringHit | null = null;
    for (const e of entries.values()) {
      if (opts.onlyId && e.id !== opts.onlyId) continue;
      const n = e.path.n;
      let prevOk = false;
      let ax = 0, ay = 0;
      for (let i = 0; i < n; i++) {
        const ok = P.project(e.scene[3 * i], e.scene[3 * i + 1], e.scene[3 * i + 2], tmp);
        if (ok) {
          const dp = Math.hypot(tmp[0] - x, tmp[1] - y);
          if (dp <= Math.max(tol, 10) && (!best || best.pointIndex === undefined || dp < best.distPx)) {
            if (!best || dp < best.distPx + 3 || best.pointIndex === undefined) {
              best = { stringId: e.id, pointIndex: e.path.src[i], segIndex: e.path.src[Math.min(i, n - 2)], chainage: e.path.s[i], distPx: dp };
            }
          }
          if (prevOk && i > 0) {
            const [d2, t] = distToSeg2(x, y, ax, ay, tmp[0], tmp[1]);
            const d = Math.sqrt(d2);
            // a leg wins only when no vertex is under the cursor
            if (d <= tol && (!best || (best.pointIndex === undefined && d < best.distPx))) {
              best = { stringId: e.id, segIndex: e.path.src[i - 1], chainage: e.path.s[i - 1] + (e.path.s[i] - e.path.s[i - 1]) * t, distPx: d };
            }
          }
          ax = tmp[0]; ay = tmp[1];
        }
        prevOk = ok;
      }
    }
    return best;
  }
  bus.pickString = pickString;

  // ── hover ──────────────────────────────────────────────────────────────────────────
  const sameSel = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);
  const offPointer = ctx.onPointer(p => {
    if (p.kind === 'leave') { pointer = null; setHover({ kind: 'none' }, null); return; }
    if (p.kind !== 'move') return;
    pointer = { x: p.x, y: p.y };
    const s = st();
    const buttons = (p.event as PointerEvent).buttons ?? 0;
    if (buttons !== 0 || bus.dragPoint) return;
    if (s.tool !== 'select' && s.tool !== 'edit') { if (s.hover.kind !== 'none') setHover({ kind: 'none' }, null); return; }
    const truck = s.tool === 'select' ? bus.pickTruck?.(p.x, p.y) : null;
    if (truck) { setHover({ kind: 'truck', circuitId: truck.circuitId, truckIndex: truck.truckIndex }, null); return; }
    const hit = pickString(p.x, p.y, { tolPx: 8, onlyId: s.tool === 'edit' && s.selection.kind === 'string' ? s.selection.id : undefined });
    if (hit) {
      const e = entries.get(hit.stringId);
      const leg = e && hit.chainage !== undefined ? legIndexAt(e.path, hit.chainage) : -1;
      setHover({ kind: 'string', id: hit.stringId, pointIndex: hit.pointIndex }, leg >= 0 ? { id: hit.stringId, leg } : null);
    } else setHover({ kind: 'none' }, null);
  });

  function legIndexAt(path: PathTable, ch: number): number {
    for (let i = 0; i < path.n - 1; i++) if (ch <= path.s[i + 1] + 1e-6) return i;
    return path.n - 2;
  }

  function setHover(h: Selection, leg: { id: Id; leg: number } | null) {
    const s = st();
    const legChanged = JSON.stringify(leg) !== JSON.stringify(hoverLeg);
    hoverLeg = leg;
    if (!sameSel(s.hover, h)) s.setHover(h);
    else if (legChanged) { applyHighlight(); }
    ctx.requestRender();
  }

  // ── ride cameras: the real 3D haul road (road3d.ts) instead of the ribbons ───────────────────────────────────
  let roadsDirty = true;
  let roadsFrame = '';
  const roads3d = new Map<Id, { mesh: THREE.Mesh; mat: ReturnType<typeof makeRoadMaterial> }>();
  const postGeo = postGeometry();
  const postMat = makePostMaterial();
  let posts: THREE.InstancedMesh | null = null;
  let rideShown = false;

  function disposeRoads() {
    for (const r of roads3d.values()) { ctx.layers.strings.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose(); }
    roads3d.clear();
    if (posts) { ctx.layers.strings.remove(posts); posts.dispose(); posts = null; }
  }

  function buildRoads3d() {
    roadsDirty = false;
    roadsFrame = frameKey(ctx.frame());
    disposeRoads();
    const list = [...entries.values()];
    const built = buildRoads(list.map(e => ({ id: e.id, path: e.path, dims: e.dims })), ctx.frame(), (e, n) => ctx.heightAt(e, n));
    const allPosts = [];
    for (const e of list) {
      const b = built.get(e.id);
      if (!b) continue;
      const mat = makeRoadMaterial(b.dims);
      const mesh = new THREE.Mesh(b.geometry, mat);
      mesh.name = `road3d:${e.hs.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.stringId = e.id;
      ctx.layers.strings.add(mesh);
      roads3d.set(e.id, { mesh, mat });
      allPosts.push(...b.posts);
    }
    if (allPosts.length) {
      posts = new THREE.InstancedMesh(postGeo, postMat, allPosts.length);
      posts.name = 'road3d:delineators';
      posts.frustumCulled = false;
      writePosts(posts, allPosts);
      ctx.layers.strings.add(posts);
    }
    ctx.requestRender();
  }

  /** Ribbons in the map views; the 3D road (built on first use, rebuilt when a string changes) in POV / chase. */
  function syncRide(ride: boolean) {
    if (ride && (roadsDirty || roadsFrame !== frameKey(ctx.frame()))) buildRoads3d();
    if (ride === rideShown && !ride) return;
    rideShown = ride;
    for (const e of entries.values()) e.group.visible = !ride;
    for (const r of roads3d.values()) r.mesh.visible = ride;
    if (posts) posts.visible = ride;
    if (ride) postMat.userData.post.uGlow.value = 1.8 * nightOf(ctx);
  }

  // ── per-frame ──────────────────────────────────────────────────────────────────────
  const offFrame = ctx.onFrame((dt) => {
    const size = new THREE.Vector2();
    ctx.renderer.getDrawingBufferSize(size);
    shared.uViewH.value = size.y || 800;
    shared.uDpr.value = ctx.renderer.getPixelRatio();
    if (dirty || frameKey(ctx.frame()) !== lastFrameKey) sync();
    const s = st();
    if (s.timeline.playing || s.selection.kind === 'string') shared.uTime.value += Math.min(dt, 0.1);
    syncRide(s.camera === 'pov' || s.camera === 'chase');
    if (svc()) shareLabels(s);
  });
  const offAlive = ctx.keepAlive(() => {
    const s = st();
    return entries.size > 0 && (s.selection.kind === 'string' || s.timeline.playing);
  });

  /** Which pins show: free ends always; ends on a labelled block only for the focused string (the block label names it). */
  function pinOn(s: AppState, e: Entry, end: 0 | 1, labelsOn: boolean): boolean {
    const focus = (s.selection.kind === 'string' && s.selection.id === e.id) || (s.hover.kind === 'string' && s.hover.id === e.id);
    return labelsOn && (!(end === 0 ? e.startLinked : e.endLinked) || focus);
  }
  const isSelected = (s: AppState, id: Id) => (s.selection.kind === 'string' && s.selection.id === id)
    || (s.selection.kind === 'circuit' && s.scenario.circuits.find(c => c.id === (s.selection as { id: Id }).id)?.haulStringId === id);

  /**
   * Shared label placer path (ctx.labels): pins (40; the selected string's 100) and the focused string's grade chips (20)
   * are collision-avoided with the block labels and every other scene label by the core.
   */
  function shareLabels(s: AppState) {
    const L = svc();
    if (!L) return;
    const labelsOn = s.layers.labels !== false && s.camera !== 'pov' && s.camera !== 'chase';
    nextIds = new Set<string>();
    for (const e of entries.values()) {
      for (const end of [0, 1] as const) {
        if (!pinOn(s, e, end, labelsOn)) continue;
        const i = end === 0 ? 0 : e.path.n - 1;
        share(`pin:${e.id}:${end}`, [e.path.e[i], e.path.nn[i], e.path.z[i]], end === 0 ? e.chipStart : e.chipEnd, isSelected(s, e.id) ? 100 : 40, true);
      }
    }
    const focusId = s.selection.kind === 'string' ? s.selection.id : s.hover.kind === 'string' ? s.hover.id : undefined;
    const fe = focusId && labelsOn ? entries.get(focusId) : undefined;
    let used = 0;
    if (fe) {
      const smp = { e: 0, n: 0, z: 0, i: 0, t: 0, heading: 0, grade: 0 };
      const runs = gradeRuns(fe.path);
      for (let k = 0; k < runs.length && used < 48; k++) {
        const r = runs[k];
        if (r.length < 40) continue;
        sampleAt(fe.path, (r.s0 + r.s1) / 2, smp);
        const t = gradeTag(used++, r.grade);
        share(`grade:${fe.id}:${k}`, [smp.e, smp.n, smp.z], t, 20, false);
      }
    }
    for (let i = used; i < tags.length; i++) { tags[i].style.display = 'none'; }
    flushShared();
    // the old self-placed pins stay hidden on this path
    for (const e of entries.values()) { e.pinStart.style.display = 'none'; e.pinEnd.style.display = 'none'; }
  }

  function gradeTag(i: number, g: number): HTMLDivElement {
    let t = tags[i];
    if (!t) { t = document.createElement('div'); t.className = css.tag; tagRoot.appendChild(t); tags.push(t); }
    const txt = `${g > 0.0005 ? '▲' : g < -0.0005 ? '▼' : '•'} ${(Math.abs(g) * 100).toFixed(1)} %`;
    if (t.textContent !== txt) t.textContent = txt;
    t.style.background = gradeHex(g);
    t.style.display = '';
    return t;
  }

  // ── overlay: stop signs, handles, pins, grade chips, hover readout ───────────────────
  const tags: HTMLDivElement[] = [];
  const offOverlay = ctx.onOverlay((g, w, h) => {
    const s = st();
    const P = makeProjector(ctx);
    // in the driver's seat / chase the screen-space marks would float over the cab and the road: only stop signs stay
    const ride = s.camera === 'pov' || s.camera === 'chase';
    const labelsOn = s.layers.labels !== false && !ride;
    const shared_ = !!svc();
    placed.length = 0;
    // strings hauled by a circuit first, so a shared dig / dump shows that circuit's pin
    const ordered = [...entries.values()].sort((a, b) => Number(!!circuitOfString(s.scenario, b.id)) - Number(!!circuitOfString(s.scenario, a.id)));
    for (const e of ordered) {
      if (!shared_) {
        // no shared placer yet: place our own pins, lifted above a block label when the end sits on one
        placePin(e.pinStart, P, e, 0, pinOn(s, e, 0, labelsOn), e.startLinked ? 46 : 16);
        placePin(e.pinEnd, P, e, e.path.n - 1, pinOn(s, e, 1, labelsOn), e.endLinked ? 46 : 16);
      }
      if (!ride) drawEnds(g, P, e);
      drawStops(g, P, e);
    }
    const sel = s.selection;
    const focusId = sel.kind === 'string' ? sel.id : s.hover.kind === 'string' ? s.hover.id : undefined;
    if (!shared_) {
      // grade chips along the focused string
      let used = 0;
      if (focusId && labelsOn) {
        const e = entries.get(focusId);
        if (e) used = placeGradeTags(e, P);
      }
      for (let i = used; i < tags.length; i++) tags[i].style.display = 'none';
    }
    // handles of the selected string
    if (sel.kind === 'string' && !ride) {
      const e = entries.get(sel.id);
      if (e) drawHandles(g, P, e, sel.pointIndex, s.tool === 'edit');
    }
    // a hovered vertex (from the 3D view, the point table or the profile strip): HRL halo ring, any string
    const hv = s.hover;
    if (!ride && hv.kind === 'string' && hv.pointIndex !== undefined && !(sel.kind === 'string' && sel.id === hv.id)) {
      const e = entries.get(hv.id);
      const p = e?.pts[hv.pointIndex];
      if (p) {
        const sp = worldToScene(ctx.frame(), p.e, p.n, p.z);
        if (P.project(sp[0], sp[1], sp[2], tmpB)) drawHandle(g, tmpB[0], tmpB[1], 4.5, { hover: true });
      }
    }
    drawTip(s, P, w, h);
  });

  const placed: [number, number][] = [];
  function placePin(pin: HTMLDivElement, P: Projector, e: Entry, i: number, on: boolean, leader = 16) {
    const ok = on && P.project(e.scene[3 * i], e.scene[3 * i + 1], e.scene[3 * i + 2], tmp);
    if (!ok || tmp[0] < -50 || tmp[1] < -50 || tmp[0] > P.w + 50 || tmp[1] > P.h + 80) { pin.style.display = 'none'; return; }
    if (placed.some(([x, y]) => Math.abs(x - tmp[0]) < 14 && Math.abs(y - tmp[1]) < 14)) { pin.style.display = 'none'; return; }
    placed.push([tmp[0], tmp[1]]);
    const ld = pin.querySelector(`.${css.pinLeader}`) as HTMLElement;
    if (ld.dataset.h !== String(leader)) { ld.style.height = `${leader}px`; ld.dataset.h = String(leader); }
    pin.style.display = '';
    pin.style.transform = `translate(${tmp[0].toFixed(1)}px, ${(tmp[1] + 5).toFixed(1)}px) translate(-50%, -100%)`;
  }

  /** Leader dots at the string's ends (dig: filled, dump: ring) - always, so a pin-less end still reads. */
  function drawEnds(g: CanvasRenderingContext2D, P: Projector, e: Entry) {
    for (const [i, dump] of [[0, false], [e.path.n - 1, true]] as [number, boolean][]) {
      if (!P.project(e.scene[3 * i], e.scene[3 * i + 1], e.scene[3 * i + 2], tmp)) continue;
      g.save();
      g.beginPath(); g.arc(tmp[0], tmp[1], 4.5, 0, Math.PI * 2);
      g.fillStyle = dump ? '#ffffff' : '#1F2329'; g.fill();
      g.lineWidth = dump ? 2.5 : 2; g.strokeStyle = dump ? '#1F2329' : '#ffffff'; g.stroke();
      g.restore();
    }
  }

  function drawStops(g: CanvasRenderingContext2D, P: Projector, e: Entry) {
    for (let i = 0; i < e.path.n; i++) {
      const sp = e.pts[e.path.src[i]];
      if (!sp?.stop) continue;
      if (!P.project(e.scene[3 * i], e.scene[3 * i + 1], e.scene[3 * i + 2], tmp)) continue;
      drawStopSign(g, tmp[0], tmp[1], 1);
    }
  }

  function drawHandles(g: CanvasRenderingContext2D, P: Projector, e: Entry, selIndex: number | undefined, editing: boolean) {
    const hov = bus.hoverPoint && bus.hoverPoint.stringId === e.id ? bus.hoverPoint.index : useApp.getState().hover.kind === 'string' ? (useApp.getState().hover as { pointIndex?: number }).pointIndex : undefined;
    const drag = bus.dragPoint && bus.dragPoint.stringId === e.id ? bus.dragPoint.index : undefined;
    let lx = -1e9, ly = -1e9;
    const n = e.pts.length;
    const r = editing ? 5 : 4;
    for (let k = 0; k < n; k++) {
      const p = e.pts[k];
      const f = ctx.frame();
      const sp = worldToScene(f, p.e, p.n, p.z);
      if (!P.project(sp[0], sp[1], sp[2], tmpB)) continue;
      const x = tmpB[0], y = tmpB[1];
      if (x < -20 || y < -20 || x > P.w + 20 || y > P.h + 20) continue;
      const special = k === selIndex || k === hov || k === drag || k === 0 || k === n - 1;
      if (!special && Math.hypot(x - lx, y - ly) < (editing ? 9 : 14)) continue;
      lx = x; ly = y;
      drawHandle(g, x, y, k === 0 || k === n - 1 ? r + 1 : r, { hover: k === hov, active: k === drag || k === selIndex });
    }
  }

  function placeGradeTags(e: Entry, P: Projector): number {
    const runs = gradeRuns(e.path);
    let used = 0;
    const smp = { e: 0, n: 0, z: 0, i: 0, t: 0, heading: 0, grade: 0 };
    const f = ctx.frame();
    for (const r of runs) {
      if (used >= 48) break;
      const a = sampleAt(e.path, r.s0), b = sampleAt(e.path, r.s1);
      const sa = worldToScene(f, a.e, a.n, a.z), sb = worldToScene(f, b.e, b.n, b.z);
      if (!P.project(sa[0], sa[1], sa[2], tmp) || !P.project(sb[0], sb[1], sb[2], tmpB)) continue;
      if (Math.hypot(tmp[0] - tmpB[0], tmp[1] - tmpB[1]) < 64) continue;
      sampleAt(e.path, (r.s0 + r.s1) / 2, smp);
      const sm = worldToScene(f, smp.e, smp.n, smp.z);
      if (!P.project(sm[0], sm[1], sm[2], tmp)) continue;
      if (tmp[0] < 0 || tmp[1] < 0 || tmp[0] > P.w || tmp[1] > P.h) continue;
      const t = gradeTag(used, r.grade);
      t.style.transform = `translate(${tmp[0].toFixed(1)}px, ${(tmp[1] - 16).toFixed(1)}px) translate(-50%, -50%)`;
      used++;
    }
    return used;
  }

  function drawTip(s: AppState, P: Projector, w: number, h: number) {
    if (!pointer || !hoverLeg || s.tool !== 'select') { tip.style.display = 'none'; return; }
    const e = entries.get(hoverLeg.id);
    if (!e) { tip.style.display = 'none'; return; }
    const i = hoverLeg.leg;
    const g = legGrade(e.path, i);
    const len = e.path.s[i + 1] - e.path.s[i];
    const html = `<div class="${css.tipHead}"><span class="${css.gradeDot}" style="background:${gradeHex(g)}"></span>${escapeHtml(e.hs.name)}<span class="${css.tipSub}">leg ${e.path.src[i] + 1}</span></div>`
      + `<div class="${css.tipRow}"><span>Grade <b>${g >= 0 ? '+' : '−'}${(Math.abs(g) * 100).toFixed(1)} %</b></span><span>${gradeLabel(g)}</span></div>`
      + `<div class="${css.tipRow}"><span>Length <b>${len.toFixed(0)} m</b></span><span>ch <b>${e.path.s[i].toFixed(0)}–${e.path.s[i + 1].toFixed(0)}</b></span></div>`
      + `<div class="${css.tipSub}">RL ${e.path.z[i].toFixed(1)} → ${e.path.z[i + 1].toFixed(1)} · loaded direction</div>`;
    if (tip.dataset.k !== html) { tip.innerHTML = html; tip.dataset.k = html; }
    tip.style.display = '';
    const tw = tip.offsetWidth || 200, th = tip.offsetHeight || 80;
    let x = pointer.x + 16, y = pointer.y + 18;
    if (x + tw > w - 8) x = pointer.x - tw - 16;
    if (y + th > h - 8) y = pointer.y - th - 14;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }

  return () => {
    unsub(); offPointer(); offFrame(); offAlive(); offOverlay();
    bus.listeners.delete(onBus);
    const L = svc();
    if (L) for (const id of placedIds) L.remove(id);
    placedIds.clear();
    for (const e of entries.values()) dispose(e);
    entries.clear();
    disposeRoads();
    postGeo.dispose(); postMat.dispose();
    bus.pickString = undefined;
    bus.pathOf = undefined;
    root.remove();
    cardRoot.remove();
  };
};

export function gradeLabel(g: number): string {
  const c = gradeClassOf(g);
  return c === 'flat' ? '≤ 4 %' : c === 'mod' ? '4–8 %' : c === 'steep' ? '8–10 %' : '> 10 %';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** HRL handle: white disc, 2.5 px blue ring, soft halo on hover, filled blue when dragged / selected. */
export function drawHandle(g: CanvasRenderingContext2D, x: number, y: number, r: number, o: { hover?: boolean; active?: boolean } = {}) {
  g.save();
  if (o.hover || o.active) {
    g.beginPath(); g.arc(x, y, r + 7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,111,230,0.18)'; g.fill();
  }
  g.shadowColor = 'rgba(15,25,40,0.35)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = o.active ? ACCENT : '#ffffff'; g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 2.5; g.strokeStyle = o.active ? '#ffffff' : ACCENT; g.stroke();
  if (o.active) { g.beginPath(); g.arc(x, y, r + 1.6, 0, Math.PI * 2); g.lineWidth = 1.2; g.strokeStyle = ACCENT; g.stroke(); }
  g.restore();
}

/** A small stop sign on a pole, its foot at (x, y). */
export function drawStopSign(g: CanvasRenderingContext2D, x: number, y: number, k = 1) {
  const R = 7.5 * k, pole = 13 * k, cy = y - pole - R;
  g.save();
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, cy + R);
  g.lineWidth = 3 * k; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  g.lineWidth = 1.5 * k; g.strokeStyle = '#5B6470'; g.stroke();
  g.beginPath(); g.ellipse(x, y, 3 * k, 1.5 * k, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(20,25,30,0.35)'; g.fill();
  const oct = (r: number) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const px = x + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  };
  g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
  oct(R + 1.4 * k); g.fillStyle = '#ffffff'; g.fill();
  g.shadowColor = 'transparent';
  oct(R); g.fillStyle = STOP_RED; g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(x - R * 0.55, cy - R * 0.13, R * 1.1, R * 0.26);
  g.restore();
}
