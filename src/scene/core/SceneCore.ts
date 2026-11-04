/**
 * SceneCore: owns the WebGL2 renderer, render-on-demand loop, cameras, atmosphere, terrain, solids, section,
 * picking and pointer/key routing; builds the SceneContext and mounts every module in `sceneModules`.
 */
import * as THREE from 'three';
import type { Vec3, Scenario, MeshAsset } from '@/core/types';
import { makeFrame, originFor, worldToScene, type Frame } from '@/core/frame';
import { useApp, type AppState, type CameraMode } from '@/state/store';
import type { ShiftState, CircuitResult, Id } from '@/core/types';
import type { FollowTarget, PointerKind, SceneContext, SceneModule, ScenePointer } from '../context';
import { Atmosphere } from './atmosphere';
import { CameraRig, type CamMode } from './camera';
import { TerrainLayer } from './terrain';
import { SolidsLayer, type SolidDepletion } from './solids';
import { SectionLayer } from './section';
import { currentTheme, palette, watchTheme, type Palette, type ThemeName } from './theme';
import { drawSiteRefs } from './refs';
import { LabelService, type Insets } from './labels';
import { ContourLabels } from './contourLabels';
import { computeLighting, makeLighting, type Lighting, type SceneEnv } from './environment';
import css from './core.module.css';

/** SceneContext as built by the core: the contract plus the shift-clock environment (sun / night state). */
export type CoreSceneContext = SceneContext & {
  /** Current sun / night state from the shift clock (cockpit headlights, actors' lamps). */
  environment(): SceneEnv;
  /** Called whenever the clock / theme lighting changes. Returns an unsubscribe. */
  onEnvironment(cb: (env: SceneEnv) => void): () => void;
};

export interface ViewInfo { heading: number; mpp: number; mode: CamMode; transitioning: boolean }
export type { SceneEnv } from './environment';

export interface SceneStats {
  fps: number;
  frameMs: number;
  frames: number;
  triangles: number;
  calls: number;
  terrainTriangles: number;
  pixelRatio: number;
  buildMs: number;
  aoMs: number;
  gridNodes: number;
  /** JS time per rendered frame (scene update + draw submission), EMA ms. */
  cpuMs: number;
  /** Last depletion update (planes + caps for every solid), ms. */
  depletionMs: number;
  /** Frames that re-rendered the shadow map / total frames (camera-only frames skip it). */
  shadowFrames: number;
}

type LayerKey = keyof SceneContext['layers'];

/** Engine access is loaded lazily so the scene still renders when the engine module is broken or still loading. */
interface EngineFns {
  shiftStateAt: (s: Scenario, r: Record<Id, CircuitResult>, tMin: number) => ShiftState;
  resultsFor: (s: Scenario) => Record<Id, CircuitResult>;
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const GRID_STEPS = [10, 25, 50, 100, 250, 500, 1000];
let engineFns: EngineFns | null = null;
let enginePromise: Promise<EngineFns | null> | null = null;
function loadEngine(): Promise<EngineFns | null> {
  if (!enginePromise) {
    enginePromise = Promise.all([import('@/engine'), import('@/state/derived')])
      .then(([e, d]) => (engineFns = { shiftStateAt: e.shiftStateAt, resultsFor: d.resultsFor }))
      .catch(err => { console.warn('[scene] engine unavailable - depletion follows overrides only', err); enginePromise = null; return null; });
  }
  return enginePromise;
}

export class SceneCore {
  readonly container: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly labelLayer: HTMLDivElement;
  /** DOM layer above labels for tool hints / POV HUD; never hidden by the Labels toggle. */
  readonly hudLayer: HTMLDivElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly layers: Record<LayerKey, THREE.Group>;
  readonly rig: CameraRig;
  readonly atmos: Atmosphere;
  readonly terrain = new TerrainLayer();
  readonly solids: SolidsLayer;
  readonly section: SectionLayer;
  readonly ctx: CoreSceneContext;
  /** The scene's one label placer (core block labels + module labels). */
  readonly labels: LabelService;
  /** Shift-clock lighting (sun / sky / night) for the time on screen. */
  readonly lighting: Lighting = makeLighting();
  private contourLabels = new ContourLabels();
  private envCbs = new Set<(env: SceneEnv) => void>();
  private envKey = '';
  private safeInsets: Insets = { top: 70, right: 428, bottom: 96, left: 70 };
  private probe: HTMLDivElement;
  private probeRo: ResizeObserver | null = null;
  /** The user moved the camera since the last home / fit (insets changes then leave the view alone). */
  private cameraTouched = false;
  private homedAt = 0;
  private depMap = new Map<string, SolidDepletion>();
  stats: SceneStats = { fps: 0, frameMs: 0, frames: 0, triangles: 0, calls: 0, terrainTriangles: 0, pixelRatio: 1, buildMs: 0, aoMs: 0, gridNodes: 0, cpuMs: 0, depletionMs: 0, shadowFrames: 0 };
  ready = false;
  readyPromise: Promise<void>;

  private resolveReady!: () => void;
  private frameV: Frame = makeFrame([0, 0, 0], 1);
  private pal: Palette;
  private theme: ThemeName;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private shadowDirty = true;
  private keepAlives = new Set<() => boolean>();
  private frameCbs = new Set<(dt: number, now: number) => void>();
  private overlayCbs = new Set<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>();
  private pointerCbs: ((p: ScenePointer) => boolean | void)[] = [];
  private keyCbs: ((e: KeyboardEvent) => boolean | void)[] = [];
  private viewCbs = new Set<(v: ViewInfo) => void>();
  private follow: FollowTarget | null = null;
  private unsubs: (() => void)[] = [];
  private moduleDisposers: (() => void)[] = [];
  private w = 1; private h = 1; private dpr = 1; private prMax = 1;
  private ro: ResizeObserver;
  private hovered = false;
  private userCursor = '';
  private downAt: { x: number; y: number; t: number; button: number; consumed: boolean; camera: boolean } | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private builtTopo: MeshAsset[] = [];
  private builtSolids: MeshAsset[] = [];
  private builtOrigin: Vec3 | null = null;
  private homed = false;
  private overrideFrac: number | null = null;
  private lastSectionKey = '';
  private frameTimes: number[] = [];
  private lastInteract = 0;
  private octx: CanvasRenderingContext2D;
  private startT = performance.now();
  private disposed = false;
  private centerHit = new THREE.Vector3();
  private centerOk = false;
  private insetOverride: Partial<import('./labels').Insets> | null = null;

  constructor(container: HTMLDivElement, modules: SceneModule[]) {
    this.container = container;
    this.readyPromise = new Promise(r => (this.resolveReady = r));
    this.theme = currentTheme();
    this.pal = palette(this.theme);
    // DOM layers
    this.canvas = document.createElement('canvas');
    this.canvas.className = css.canvas;
    this.overlay = document.createElement('canvas');
    this.overlay.className = css.overlay;
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = css.labels;
    this.hudLayer = document.createElement('div');
    this.hudLayer.className = css.hud;
    // probe that resolves the shell's layout variables (right column, chrome bands) to pixels
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;box-sizing:content-box;'
      + 'width:var(--right-col,0px);height:var(--below,0px);border-top:var(--top,0px) solid transparent;';
    container.append(this.canvas, this.overlay, this.labelLayer, this.hudLayer, this.probe);
    this.octx = this.overlay.getContext('2d')!;
    this.labels = new LabelService(this.labelLayer, () => this.requestRender());

    // renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.pal.def.exposure;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.localClippingEnabled = true;
    r.setClearColor(this.pal.c.backdrop);
    this.prMax = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = this.prMax;
    r.setPixelRatio(this.dpr);

    // scene graph
    const names: LayerKey[] = ['terrain', 'solids', 'strings', 'actors', 'tools', 'labels', 'fx'];
    this.layers = Object.fromEntries(names.map(n => { const g = new THREE.Group(); g.name = n; this.scene.add(g); return [n, g]; })) as Record<LayerKey, THREE.Group>;
    this.atmos = new Atmosphere(r.capabilities.maxTextureSize);
    this.atmos.addTo(this.scene);
    this.layers.terrain.add(this.terrain.root);
    this.terrain.onAsyncReady = () => this.requestRender(true);
    this.solids = new SolidsLayer(this.labelLayer, this.labels, this.terrain.carve);
    this.layers.solids.add(this.solids.root);
    this.solids.setLabelHandlers(
      id => useApp.getState().select({ kind: 'asset', id }),
      id => { const st = useApp.getState(); if (id) st.setHover({ kind: 'asset', id }); else if (st.hover.kind === 'asset') st.setHover({ kind: 'none' }); },
    );
    this.section = new SectionLayer(this.labelLayer);
    this.layers.fx.add(this.section.root);

    this.rig = new CameraRig({
      pickGround: (x, y) => this.pickTerrainScene(x, y),
      groundY: (x, z) => (this.terrain.grid ? this.terrain.grid.sceneY(x, z, this.frameV.vx) : NaN),
      follow: () => this.follow,
    });
    this.applyTheme();
    this.rig.safe = { ...this.safeInsets };

    // context
    this.ctx = this.makeContext();

    // events
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    if (typeof ResizeObserver !== 'undefined') {
      this.probeRo = new ResizeObserver(() => this.refreshInsets());
      this.probeRo.observe(this.probe, { box: 'border-box' });
    }
    this.resize();
    this.bindEvents();
    this.unsubs.push(watchTheme(t => { this.theme = t; this.pal = palette(t); this.applyTheme(); this.syncEnvironment(true); this.requestRender(true); }));

    // store
    const st = useApp.getState();
    this.syncScenario(st.scenario, true);
    this.syncLayers(st);
    this.rig.setMode(st.camera === 'plan' ? 'plan' : st.camera, 0);
    this.unsubs.push(useApp.subscribe((s, p) => this.onStore(s, p)));
    this.syncEnvironment(true);
    this.syncDepletion();
    this.syncSection(st);
    this.solids.setSelected(st.selection.kind === 'asset' ? st.selection.id : null);

    // modules
    for (const m of modules) {
      try { this.moduleDisposers.push(m(this.ctx)); } catch (e) { console.error('[scene] module failed to mount', e); }
    }
    this.publishDebug();
    this.requestRender(true);
  }

  // ─────────────────────────────────────────────────────────── context

  private makeContext(): CoreSceneContext {
    const self = this;
    return {
      labels: this.labels,
      environment: () => this.lighting.env,
      onEnvironment(cb) { self.envCbs.add(cb); return () => { self.envCbs.delete(cb); }; },
      three: THREE,
      renderer: this.renderer,
      scene: this.scene,
      camera: () => this.rig.active,
      canvas: this.canvas,
      overlay: this.overlay,
      labelLayer: this.labelLayer,
      hudLayer: this.hudLayer,
      frame: () => this.frameV,
      layers: this.layers,
      requestRender: () => this.requestRender(true),
      keepAlive(active) { self.keepAlives.add(active); self.requestRender(); return () => { self.keepAlives.delete(active); }; },
      onFrame(cb) { self.frameCbs.add(cb); return () => { self.frameCbs.delete(cb); }; },
      onOverlay(cb) { self.overlayCbs.add(cb); self.requestRender(); return () => { self.overlayCbs.delete(cb); self.requestRender(); }; },
      onPointer(cb) { self.pointerCbs.push(cb); return () => { self.pointerCbs = self.pointerCbs.filter(c => c !== cb); }; },
      onKey(cb) { self.keyCbs.push(cb); return () => { self.keyCbs = self.keyCbs.filter(c => c !== cb); }; },
      pickTerrain: (x, y) => this.pickTerrain(x, y),
      pick: (x, y, objects, recursive = true) => this.pick(x, y, objects, recursive),
      heightAt: (e, n) => this.heightAt(e, n),
      project: w => this.project(w),
      setFollowTarget: t => { const had = !!this.follow; this.follow = t; if ((this.rig.mode === 'pov' || this.rig.mode === 'chase') && (t || had)) this.requestRender(); },
      getFollowTarget: () => this.follow,
      setControlsEnabled: on => { this.rig.controlsEnabled = on; if (!on) this.rig.pointerUp(); },
      setCursor: c => { this.userCursor = c; if (!this.rig.dragging) this.container.style.cursor = c; },
    };
  }

  // ─────────────────────────────────────────────────────────── picking / projection

  private ray(x: number, y: number): THREE.Raycaster {
    this.ndc.set((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.active);
    return this.raycaster;
  }

  /** Terrain hit in SCENE coordinates. */
  pickTerrainScene(x: number, y: number): THREE.Vector3 | null {
    const g = this.terrain.grid;
    if (!g) return null;
    const r = this.ray(x, y).ray;
    const t = g.raycast(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z, this.frameV.vx);
    if (t < 0) return null;
    return r.origin.clone().addScaledVector(r.direction, t);
  }

  /** Terrain hit (scene coordinates) written into `out`; null off-surface. Allocation-free. */
  private pickTerrainInto(x: number, y: number, out: THREE.Vector3): THREE.Vector3 | null {
    const g = this.terrain.grid;
    if (!g) return null;
    const r = this.ray(x, y).ray;
    const t = g.raycast(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z, this.frameV.vx);
    if (t < 0) return null;
    return out.copy(r.origin).addScaledVector(r.direction, t);
  }

  pickTerrain(x: number, y: number): Vec3 | null {
    const p = this.pickTerrainScene(x, y);
    if (!p || !this.terrain.grid) return null;
    const f = this.frameV;
    const hz = this.terrain.grid.at(p.x, -p.z);
    const e = p.x + f.origin[0], n = -p.z + f.origin[1];
    return [e, n, (hz === hz ? hz : p.y / f.vx) + f.origin[2]];
  }

  pick(x: number, y: number, objects: THREE.Object3D[], recursive = true): THREE.Intersection[] {
    const rc = this.ray(x, y);
    const mpp = this.rig.metersPerPixel(this.centerOk ? this.centerHit : null);
    rc.params.Line = { threshold: Math.max(0.5, mpp * 5) };
    rc.params.Points = { threshold: Math.max(0.5, mpp * 6) };
    return rc.intersectObjects(objects, recursive);
  }

  heightAt(e: number, n: number): number | null {
    const g = this.terrain.grid;
    if (!g) return null;
    const f = this.frameV;
    const h = g.at(e - f.origin[0], n - f.origin[1]);
    return h === h ? h + f.origin[2] : null;
  }

  private pv = new THREE.Vector3();
  project(world: Vec3): { x: number; y: number } | null {
    const s = worldToScene(this.frameV, world[0], world[1], world[2]);
    const cam = this.rig.active;
    const v = this.pv.set(s[0], s[1], s[2]).applyMatrix4(cam.matrixWorldInverse);
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera && v.z > -((cam as THREE.PerspectiveCamera).near)) return null;
    v.applyMatrix4(cam.projectionMatrix);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h };
  }

  // ─────────────────────────────────────────────────────────── store sync

  private onStore(s: AppState, p: AppState) {
    if (this.disposed) return;
    if (s.scenario !== p.scenario) this.syncScenario(s.scenario, false);
    if (s.layers !== p.layers) this.syncLayers(s);
    if (s.camera !== p.camera) this.setCameraMode(s.camera);
    if (s.selection !== p.selection) { this.solids.setSelected(s.selection.kind === 'asset' ? s.selection.id : null); this.requestRender(); }
    if (s.hover !== p.hover || s.selection !== p.selection || s.timeline.playing !== p.timeline.playing || s.scenario !== p.scenario) this.syncLabelFocus(s);
    if (s.panels !== p.panels) this.refreshInsets();
    if (s.section !== p.section || s.scenario !== p.scenario) this.syncSection(s);
    if (s.timeline.tMin !== p.timeline.tMin || s.timeline.horizon !== p.timeline.horizon || s.scenario !== p.scenario) this.syncDepletion(s.timeline.horizon !== p.timeline.horizon);
    if (s.timeline.tMin !== p.timeline.tMin || s.scenario.shift !== p.scenario.shift) this.syncEnvironment();
  }

  private frameFor(sc: Scenario, topo: MeshAsset[]): Frame {
    let origin = sc.site.origin;
    const any = topo[0] ?? sc.assets[0];
    if (any && origin[0] === 0 && origin[1] === 0 && (Math.abs(any.stats.bbox.min[0]) > 1e4 || Math.abs(any.stats.bbox.min[1]) > 1e4)) {
      origin = originFor(any.stats.bbox.min);
    }
    return makeFrame(origin, sc.settings.verticalExaggeration || 1);
  }

  private syncScenario(sc: Scenario, first: boolean) {
    const t0 = performance.now();
    let topo = sc.assets.filter(a => a.role === 'topo' && a.kind === 'surface');
    if (!topo.length) topo = sc.assets.filter(a => a.kind === 'surface').slice(0, 1);
    const solids = sc.assets.filter(a => a.kind === 'solid' && (a.role === 'dig' || a.role === 'dump'));
    const frame = this.frameFor(sc, topo);
    const originChanged = !this.builtOrigin || frame.origin.some((v, i) => v !== this.builtOrigin![i]);
    const veChanged = frame.vx !== this.frameV.vx;
    this.frameV = frame;
    const topoChanged = originChanged || topo.length !== this.builtTopo.length || topo.some((a, i) => a.mesh !== this.builtTopo[i]?.mesh);
    if (topoChanged) {
      this.terrain.build(topo, frame.origin);
      this.builtTopo = topo;
      this.stats.terrainTriangles = this.terrain.triangles;
      this.stats.aoMs = Math.round(this.terrain.aoMs);
      this.stats.gridNodes = this.terrain.grid ? this.terrain.grid.nx * this.terrain.grid.ny : 0;
      this.lastSectionKey = '';
    }
    const visTopo = topo.length ? topo.every(a => a.visible !== false) : true;
    this.terrain.setVisible(visTopo && useApp.getState().layers.topo !== false);
    if (topoChanged || originChanged || solids.length !== this.builtSolids.length || solids.some((a, i) => a !== this.builtSolids[i])) {
      this.solids.build(solids, frame.origin);
      this.builtSolids = solids;
      this.syncDepletion(true);
    }
    this.builtOrigin = frame.origin;
    this.terrain.setVE(frame.vx);
    this.solids.ve.scale.set(1, frame.vx, 1);
    this.section.ve.scale.set(1, frame.vx, 1);
    this.solids.syncPlanes();
    this.terrain.setContours(sc.settings.contourIntervalM, useApp.getState().layers.contours !== false);
    if (topoChanged || veChanged || first) {
      const b = this.sceneBounds(sc);
      this.rig.setBounds(b);
      this.atmos.setSiteBox(b);
      if ((!this.homed || topoChanged) && !b.isEmpty() && (topo.length || solids.length)) {
        this.rig.safe = { ...this.safeInsets };
        this.rig.home(b);
        this.homed = true;
        this.homedAt = performance.now();
        this.cameraTouched = false;
      }
      if (veChanged) this.lastSectionKey = '';
    }
    if (topoChanged) this.stats.buildMs = Math.round(performance.now() - t0);
    if (topo.length && this.terrain.hasData && !this.ready) this.markReadySoon();
    if (!topo.length && !solids.length && !this.ready) this.markReadySoon();
    this.shadowDirty = true;
    this.requestRender(true);
  }

  /** Scene-space bounds (exaggerated) of the terrain, or of all assets. */
  sceneBounds(sc?: Scenario): THREE.Box3 {
    const ve = this.frameV.vx;
    const b = new THREE.Box3();
    if (this.terrain.hasData) {
      b.min.set(this.terrain.min.x, this.terrain.datumY * ve, this.terrain.min.z);
      b.max.set(this.terrain.max.x, this.terrain.max.y * ve, this.terrain.max.z);
      return b;
    }
    const s = sc ?? useApp.getState().scenario;
    for (const a of s.assets) {
      const lo = worldToScene(this.frameV, a.stats.bbox.min[0], a.stats.bbox.min[1], a.stats.bbox.min[2]);
      const hi = worldToScene(this.frameV, a.stats.bbox.max[0], a.stats.bbox.max[1], a.stats.bbox.max[2]);
      b.expandByPoint(new THREE.Vector3(...lo)); b.expandByPoint(new THREE.Vector3(...hi));
    }
    if (b.isEmpty()) b.set(new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 60, 500));
    return b;
  }

  private syncLabelFocus(s: AppState) {
    const hov = s.hover.kind === 'asset' ? s.hover.id : null;
    const playing: string[] = [];
    if (s.timeline.playing) {
      const cid = s.selection.kind === 'circuit' ? s.selection.id : s.selection.kind === 'truck' ? s.selection.circuitId : null;
      const c = cid ? s.scenario.circuits.find(x => x.id === cid) : undefined;
      if (c?.digId) playing.push(c.digId);
      if (c?.dumpId) playing.push(c.dumpId);
    }
    this.solids.setLabelFocus(hov, playing);
    this.requestRender();
  }

  private syncLayers(s: AppState) {
    const L = s.layers;
    this.terrain.setContours(s.scenario.settings.contourIntervalM, L.contours !== false);
    this.terrain.setSlope(!!L.slope);
    this.terrain.setVisible(L.topo !== false && this.builtTopo.every(a => a.visible !== false));
    this.solids.setVisible(L.solids !== false);
    this.solids.setLabels(L.labels !== false);
    this.labelLayer.style.display = L.labels === false ? 'none' : '';
    this.atmos.sky.visible = L.sky !== false;
    this.gridOn = L.grid !== false;
    this.requestRender(true);
  }
  private gridOn = true;

  private depEntry(id: string): SolidDepletion {
    let d = this.depMap.get(id);
    if (!d) { d = { f: 0, f0: 0, delta: 0, period: 'shift' }; this.depMap.set(id, d); }
    return d;
  }

  /**
   * Depletion for the timeline position and horizon (store `timeline.horizon`):
   *  - 'shift': the engine's shift simulation (bcm so far; the slab = everything mined since the shift started);
   *  - 'week': 7 days of each circuit's daily production mapped onto the slider (slab = the trailing shift);
   *  - 'completion': time-lapse 0 → 100 % of each dig block across the slider (slab = the trailing shift).
   */
  private syncDepletion(force = false) {
    const t0 = performance.now();
    const s = useApp.getState();
    const sc = s.scenario;
    const hz = s.timeline.horizon ?? 'shift';
    for (const d of this.depMap.values()) { d.f = 0; d.f0 = 0; d.delta = 0; d.period = hz; }
    if (this.overrideFrac !== null) {
      const f = this.overrideFrac;
      for (const a of sc.assets) if (a.role === 'dig' || a.role === 'dump') {
        const d = this.depEntry(a.id);
        const bcm = a.block?.plannedBcm ?? a.stats.volume ?? 0;
        d.f = f; d.f0 = Math.max(0, f - 0.05); d.delta = (d.f - d.f0) * bcm; d.period = 'shift';
      }
    } else if (sc.circuits.length) {
      if (!engineFns) { void loadEngine().then(f => { if (f && !this.disposed) this.syncDepletion(true); }); return; }
      try {
        const results = engineFns.resultsFor(sc);
        const st = engineFns.shiftStateAt(sc, results, s.timeline.tMin);
        const u = clamp01(s.timeline.tMin / Math.max(1, sc.shift.lengthH * 60));
        for (const pc of st.perCircuit) {
          const c = sc.circuits.find(x => x.id === pc.circuitId);
          if (!c) continue;
          const dig = c.digId ? sc.assets.find(a => a.id === c.digId) : undefined;
          const dump = c.dumpId ? sc.assets.find(a => a.id === c.dumpId) : undefined;
          const digBcm = dig?.block?.plannedBcm ?? dig?.stats.volume ?? 0;
          const swell = sc.materials.find(m => m.id === c.materialId)?.swell ?? 1;
          const dumpCap = dump?.block?.plannedBcm != null ? dump.block.plannedBcm : (dump?.stats.volume ?? 0) / swell;
          const shiftBcm = pc.bcmShift || 0;
          let B: number, B0: number, Bd: number, Bd0: number;
          if (hz === 'shift') {
            B = pc.bcmSoFar || 0; B0 = 0;
            Bd = (pc.dumpFraction || 0) * dumpCap; Bd0 = 0;
          } else if (c.active === false) {
            continue;
          } else {
            const total = hz === 'week' ? 7 * (results[c.id]?.assigned?.bcmPerDay ?? shiftBcm * 2) : digBcm;
            B = Math.min(digBcm > 0 ? digBcm : Infinity, u * total);
            B0 = Math.max(0, B - shiftBcm);
            Bd = B; Bd0 = B0;
          }
          if (dig && digBcm > 0) {
            const d = this.depEntry(dig.id);
            // counter: bcm mined this shift ('shift') or the running total ('week' / 'completion')
            d.f = Math.min(1, d.f + B / digBcm); d.f0 = Math.min(d.f, d.f0 + B0 / digBcm); d.delta += B;
          }
          if (dump && dumpCap > 0) {
            const d = this.depEntry(dump.id);
            d.f = Math.min(1, d.f + Bd / dumpCap); d.f0 = Math.min(d.f, d.f0 + Bd0 / dumpCap); d.delta += Bd;
          }
        }
      } catch (e) { console.warn('[scene] shift state failed', e); }
    }
    if (this.solids.setDepletion(this.depMap, force)) { this.shadowDirty = true; this.requestRender(true); this.stats.depletionMs = Math.round((performance.now() - t0) * 100) / 100; }
    else this.requestRender();
    this.terrain.setGlows(this.solids.glowSpots());
  }

  /** Sun / sky / night from the shift clock (scenario.shift.startHour + timeline.tMin), tinted by the theme. */
  private syncEnvironment(force = false) {
    const s = useApp.getState();
    const hour = (s.scenario.shift?.startHour ?? 6) + s.timeline.tMin / 60;
    // ~1 min of clock resolution: no work while the timeline only nudges
    const key = `${Math.round(hour * 60)}|${this.theme}`;
    if (!force && key === this.envKey) return;
    this.envKey = key;
    const L = computeLighting(this.lighting, hour, this.pal, this.theme);
    this.renderer.toneMappingExposure = L.exposure;
    this.renderer.setClearColor(L.backdrop);
    this.atmos.setLighting(L);
    this.terrain.setLighting(L);
    this.solids.setNight(L.env.night);
    this.shadowDirty = true;
    for (const cb of this.envCbs) { try { cb(L.env); } catch (e) { console.error('[scene] environment listener', e); } }
    this.requestRender(true);
  }

  /** Current sun / night state (also on the context and sceneApi). */
  environment(): SceneEnv { return this.lighting.env; }
  onEnvironment(cb: (env: SceneEnv) => void): () => void { this.envCbs.add(cb); return () => { this.envCbs.delete(cb); }; }

  /** Testing / thumbnails: force a depletion fraction on every solid (null = follow the timeline). */
  setDepletionOverride(f: number | null) { this.overrideFrac = f; this.syncDepletion(true); }

  private syncSection(s: AppState) {
    const sec = s.section;
    const key = sec ? `${sec.a.join(',')}|${sec.b.join(',')}|${this.frameV.vx}|${this.builtTopo.length}` : '';
    if (key === this.lastSectionKey) return;
    this.lastSectionKey = key;
    if (!sec) this.section.clear();
    else {
      const g = this.terrain.grid;
      this.section.build(sec.a, sec.b, this.frameV.origin, g, this.solids.locals(), this.terrain.hasData ? this.terrain.datumY : -20,
        g ? g.maxH : this.terrain.max.y, this.w, this.h);
    }
    this.requestRender(true);
  }

  /**
   * Screen area not covered by app chrome (labels stay inside it; fit / plan / focus frame into it). Follows the
   * shell's layout variables, resolved to pixels by a hidden probe: --right-col (inspector column, 0 when hidden),
   * --top (top chrome band), --below (timeline dock band) and the left tool rail; `setSafeInsets` overrides any
   * side. Cached: recomputed only when the probe resizes (a variable changed), on resize / panels / overrides.
   */
  insets(): Insets { return this.safeInsets; }

  private computeInsets(): Insets {
    const st = useApp.getState();
    let right = st.panels.inspector ? 428 : 16, top = 70, bottom = 96;
    const left = 70;
    const shell = typeof getComputedStyle !== 'undefined' && getComputedStyle(this.container).getPropertyValue('--right-col').trim() !== '';
    if (shell) {
      const cs = getComputedStyle(this.probe);
      const rc = parseFloat(cs.width), below = parseFloat(cs.height), tp = parseFloat(cs.borderTopWidth);
      if (Number.isFinite(rc)) right = rc > 0 ? rc + 14 : 16;
      if (Number.isFinite(below) && below > 0) bottom = below + 6;
      if (Number.isFinite(tp) && tp > 0) top = tp + 6;
    }
    const o = this.insetOverride ?? {};
    const r = { top: o.top ?? top, right: o.right ?? right, bottom: o.bottom ?? bottom, left: o.left ?? left };
    // never let insets eat more than ~60 % of a small viewport
    const kx = Math.min(1, (this.w * 0.6) / Math.max(1, r.left + r.right)), ky = Math.min(1, (this.h * 0.6) / Math.max(1, r.top + r.bottom));
    return { top: r.top * ky, bottom: r.bottom * ky, left: r.left * kx, right: r.right * kx };
  }

  /** Re-read the safe rect; when it moved and the user has not moved the camera since home / fit, re-frame. */
  private refreshInsets() {
    const n = this.computeInsets(), o = this.safeInsets;
    const moved = Math.abs(n.top - o.top) + Math.abs(n.right - o.right) + Math.abs(n.bottom - o.bottom) + Math.abs(n.left - o.left) > 1;
    this.safeInsets = n;
    this.rig.safe = { ...n };
    if (moved && this.homed && !this.cameraTouched && (this.rig.mode === 'orbit' || this.rig.mode === 'plan')) {
      const b = this.sceneBounds();
      if (!b.isEmpty()) {
        if (performance.now() - this.homedAt < 2500 && this.rig.mode === 'orbit' && !this.rig.transitioning) { this.rig.home(b); this.homedAt = performance.now(); }
        else this.rig.frame(b, 600);
      }
    }
    this.requestRender();
  }

  setInsets(i: Partial<Insets> | null) { this.insetOverride = i; this.refreshInsets(); }

  setCameraMode(m: CameraMode) {
    this.rig.setMode(m);
    this.requestRender();
  }

  // ─────────────────────────────────────────────────────────── theme

  private applyTheme() {
    const p = this.pal;
    this.terrain.setTheme(p);
    this.solids.setTheme(p);
    this.section.setTheme(p);
    this.shadowDirty = true;
  }

  // ─────────────────────────────────────────────────────────── events

  private resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.overlay.width = Math.round(w * this.dpr); this.overlay.height = Math.round(h * this.dpr);
    this.rig.resize(w, h);
    this.safeInsets = this.computeInsets();
    this.rig.safe = { ...this.safeInsets };
    this.section.setResolution(w, h);
    this.requestRender();
  }

  private makePointer(kind: PointerKind, e: PointerEvent | MouseEvent | WheelEvent): ScenePointer {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { kind, event: e, x, y, ndc: new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1), button: 'button' in e ? e.button : 0, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
  }

  private route(p: ScenePointer): boolean {
    for (const cb of this.pointerCbs) {
      try { if (cb(p) === true) return true; } catch (err) { console.error('[scene] pointer handler', err); }
    }
    return false;
  }

  private bindEvents() {
    const el = this.container;
    el.tabIndex = 0;
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(t, f as EventListener, opts);
      this.unsubs.push(() => el.removeEventListener(t, f as EventListener, opts));
    };
    on('pointerdown', e => {
      if (e.target !== this.canvas && e.target !== el && e.target !== this.overlay && e.target !== this.hudLayer && e.target !== this.labelLayer) return;
      el.focus({ preventScroll: true });
      const p = this.makePointer('down', e);
      const consumed = this.route(p);
      let camera = false;
      if (!consumed && this.rig.controlsEnabled) {
        camera = this.rig.pointerDown(p.x, p.y, e.button, e.shiftKey);
        if (camera) this.cameraTouched = true;
        if (camera) { el.setPointerCapture(e.pointerId); }
      }
      this.downAt = { x: p.x, y: p.y, t: performance.now(), button: e.button, consumed, camera };
      this.lastInteract = performance.now();
      this.requestRender();
    });
    on('pointermove', e => {
      const p = this.makePointer('move', e);
      if (this.rig.dragging) {
        const d = this.downAt;
        if (d && Math.hypot(p.x - d.x, p.y - d.y) > 3) el.style.cursor = 'grabbing';
        this.rig.pointerMove(p.x, p.y);
        this.lastInteract = performance.now();
        this.requestRender();
        return;
      }
      this.route(p);
    });
    const up = (e: PointerEvent) => {
      const p = this.makePointer('up', e);
      const d = this.downAt;
      this.downAt = null;
      const wasCam = this.rig.dragging;
      if (wasCam) { this.rig.pointerUp(); el.style.cursor = this.userCursor; try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ } }
      this.route(p);
      if (d && e.type === 'pointerup' && Math.hypot(p.x - d.x, p.y - d.y) < 5 && performance.now() - d.t < 700) {
        this.route(this.makePointer('click', e));
      }
      this.requestRender();
    };
    on('pointerup', up);
    on('pointercancel', up);
    on('pointerenter', () => { this.hovered = true; });
    on('pointerleave', e => { this.hovered = false; if (!this.rig.dragging) this.route(this.makePointer('leave', e)); });
    on('dblclick', e => {
      const p = this.makePointer('dblclick', e);
      if (!this.route(p) && this.rig.controlsEnabled) { this.rig.dblclick(p.x, p.y); this.cameraTouched = true; this.requestRender(); }
    });
    on('wheel', e => {
      e.preventDefault();
      const p = this.makePointer('wheel', e);
      if (this.route(p)) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (this.rig.wheel(p.x, p.y, e.ctrlKey ? dy * 3 : dy)) { this.lastInteract = performance.now(); this.cameraTouched = true; this.requestRender(); }
    }, { passive: false });
    on('contextmenu', e => {
      e.preventDefault();
      this.route(this.makePointer('contextmenu', e));
    });
    const isTyping = (t: EventTarget | null) => {
      const n = t as HTMLElement | null;
      return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
    };
    const kd = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (!this.hovered && document.activeElement !== el) return;
      for (const cb of this.keyCbs) { try { if (cb(e) === true) return; } catch (err) { console.error('[scene] key handler', err); } }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyF') { this.fitAll(); e.preventDefault(); return; }
      if (e.code === 'KeyN') { this.rig.faceNorth(); this.requestRender(); return; }
      if (this.rig.controlsEnabled && this.rig.keyDown(e.code)) { e.preventDefault(); this.cameraTouched = true; this.requestRender(); }
    };
    const ku = (e: KeyboardEvent) => { this.rig.keyUp(e.code); };
    const blur = () => this.rig.clearKeys();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.unsubs.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); });
    const lost = (e: Event) => { e.preventDefault(); };
    const restored = () => { this.shadowDirty = true; this.requestRender(true); };
    this.canvas.addEventListener('webglcontextlost', lost);
    this.canvas.addEventListener('webglcontextrestored', restored);
    this.unsubs.push(() => { this.canvas.removeEventListener('webglcontextlost', lost); this.canvas.removeEventListener('webglcontextrestored', restored); });
  }

  // ─────────────────────────────────────────────────────────── loop

  requestRender(contentChanged = false) {
    if (contentChanged) this.shadowDirty = true;
    this.dirty = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    const prevLast = this.last;
    this.last = now;
    let kept = false;
    for (const f of this.keepAlives) { try { if (f()) { kept = true; break; } } catch { /* ignore */ } }
    for (const cb of this.frameCbs) { try { cb(dt, now); } catch (e) { console.error('[scene] onFrame', e); } }
    const moving = this.rig.update(dt, now);
    this.renderFrame(now, kept);
    // frame timing (only meaningful while continuously animating)
    const continuous = moving || kept || this.rig.dragging;
    if (continuous && prevLast && now - prevLast < 250) {
      this.frameTimes.push(now - prevLast);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      this.govern();
    }
    if (continuous || this.dirty) this.raf = requestAnimationFrame(this.tick);
    else {
      this.last = 0;
      // back to full resolution once at rest
      if (this.dpr < this.prMax) { this.setDpr(this.prMax); this.raf = requestAnimationFrame(this.tick); }
    }
  };

  private govern() {
    if (this.frameTimes.length < 20) return;
    const s = [...this.frameTimes].sort((a, b) => a - b), med = s[s.length >> 1];
    const steps = [this.prMax, 1.5, 1.25, 1].filter((v, i, a) => v <= this.prMax && a.indexOf(v) === i);
    const i = steps.indexOf(this.dpr);
    if (med > 26 && i >= 0 && i < steps.length - 1) { this.setDpr(steps[i + 1]); this.frameTimes.length = 0; }
  }

  private setDpr(d: number) {
    this.dpr = d;
    this.renderer.setPixelRatio(d);
    this.renderer.setSize(this.w, this.h, false);
    this.overlay.width = Math.round(this.w * d); this.overlay.height = Math.round(this.h * d);
    this.dirty = true;
  }

  private renderFrame(now: number, kept: boolean) {
    const tStart = performance.now();
    this.dirty = false;
    const cam = this.rig.active;
    const ve = this.frameV.vx;
    const mode = this.rig.mode;
    // atmosphere: driving look in pov/chase, hillshade look in plan
    const drive = (mode === 'pov' || mode === 'chase') && !this.rig.transitioning ? 1 : (mode === 'pov' || mode === 'chase') ? 0.5 : 0;
    const plan = mode === 'plan' ? 1 : 0;
    if (drive !== this.lastDrive || plan !== this.lastPlan) {
      this.atmos.setMode(drive, plan);
      this.terrain.setDriving(drive >= 1, this.pal);
      this.terrain.setHillshade(plan ? 0.62 : 0.42, plan ? 0 : this.pal.def.sunAzDeg - 315);
      this.terrain.setPlot(plan);
      this.lastDrive = drive; this.lastPlan = plan;
      this.shadowDirty = true;
    }
    // shadow focus around the followed truck when driving (sharper truck shadows)
    if (drive >= 1 && this.follow) {
      const f = this.atmos.shadowFocus ?? (this.atmos.shadowFocus = { center: new THREE.Vector3(), radius: 260 });
      if (f.center.distanceToSquared(this.follow.position) > 400) { f.center.copy(this.follow.position); this.atmos.fitShadow(); this.shadowDirty = true; }
    } else if (this.atmos.shadowFocus) { this.atmos.shadowFocus = null; this.atmos.fitShadow(); this.shadowDirty = true; }
    // view centre ground point (scale bar, haze)
    const c = this.pickTerrainInto(this.w / 2, this.h / 2, this.centerHit);
    this.centerOk = !!c;
    const pc = this.rig.persp;
    const dist = cam === this.rig.ortho ? 1e6 : c ? c.distanceTo(pc.position) : this.rig.P.dist;
    // haze: in the cab the far ground melts into the horizon sky (≈ 10 % at 500 m, 45 % at 2 km, full by 3.6 km)
    const hazeNear = drive >= 1 ? 160 : dist * 1.35;
    const hazeFar = drive >= 1 ? 3600 : dist * 7 + this.rig.diag() * 1.5;
    this.atmos.update(cam, cam === this.rig.ortho ? 1e5 : pc.far, cam === this.rig.ortho ? 1e8 : hazeNear, cam === this.rig.ortho ? 2e8 : hazeFar, (now - this.startT) / 1000);
    // site grid step adapts to zoom (aim ~90 px between lines)
    const mpp = this.rig.metersPerPixel(c);
    let gs = 1000;
    for (const st of GRID_STEPS) if (st / mpp >= 120) { gs = st; break; }
    this.terrain.setGrid(gs, this.gridOn && mode !== 'pov' && mode !== 'chase');
    if (this.shadowDirty || kept) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; this.stats.shadowFrames++; }
    this.solids.syncPlanes();
    // clear the overlay BEFORE the 3D draw: if anything later in the frame fails, no stale map marks stay over the view
    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.overlay.width, this.overlay.height);
    o.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderer.render(this.scene, cam);
    try { this.drawLabelsAndOverlay(cam, ve, mode, mpp, gs); } catch (e) { console.error('[scene] labels / overlay', e); }
    this.finishStats(tStart, mpp);
  }

  /**
   * Labels (one placement pass over core + module labels) and the overlay. Ride modes (POV / chase, by the rig OR the
   * store, whichever says so first) are map-free: no map labels, leaders, contour RLs, skirt references or face lines
   * — only the HUD layer (cockpit, cards) and the modules' own ride marks remain.
   */
  private drawLabelsAndOverlay(cam: THREE.Camera, ve: number, mode: CamMode, mpp: number, gs: number) {
    const storeCam = useApp.getState().camera;
    const follow = mode === 'pov' || mode === 'chase' || storeCam === 'pov' || storeCam === 'chase';
    const labelsOn = this.labelLayer.style.display !== 'none' && !follow;
    const vis = follow ? 'hidden' : '';
    if (this.labelLayer.style.visibility !== vis) this.labelLayer.style.visibility = vis;
    this.solids.updateLabels(cam, ve, Math.max(250, cam === this.rig.ortho ? this.rig.diag() : this.rig.P.dist), follow);
    this.labels.place(cam, this.w, this.h, this.safeInsets, this.frameV, labelsOn);
    this.section.update(cam, this.w, this.h, ve, mpp);
    const o = this.octx;
    const dark = this.theme === 'dark';
    if (!follow) this.solids.drawFaces(o, cam, this.w, this.h, ve);
    if (labelsOn) {
      const terrainOn = !!this.terrain.grid && this.terrain.hasData && this.builtTopo.length > 0 && !!this.terrain.meshes[0]?.visible;
      if (mode === 'orbit' && terrainOn && this.gridOn) {
        drawSiteRefs({ ctx: o, camera: cam, w: this.w, h: this.h, grid: this.terrain.grid!, origin: this.frameV.origin, ve, datumY: this.terrain.datumY,
          stepM: gs * (this.rig.transitioning ? 2 : 1), ink: this.pal.def.overlayInk, halo: this.pal.def.overlayHalo, insets: this.safeInsets, dark });
      }
      // RL labels on index contours (orbit / plan), clear of every placed label
      if (terrainOn && this.terrain.contoursOn && !this.rig.transitioning) {
        const J = this.terrain.contourMinor * 5;
        this.contourLabels.update(this.terrain.smoothGrid, J);
        const night = this.lighting.env.night > 0.5;
        const persp = cam !== this.rig.ortho;
        this.mppK = persp ? (2 * Math.tan((this.rig.persp.fov * Math.PI) / 360)) / this.h : 0;
        this.mppO = persp ? 0 : (this.rig.ortho.top - this.rig.ortho.bottom) / this.h;
        this.occlude = persp && this.rig.P.el < 1.0;
        this.seeTests = 0;
        this.contourLabels.draw(o, cam, this.w, this.h, ve, this.frameV.origin[2], J, this.safeInsets, this.labels,
          night ? 'rgba(226,234,246,0.92)' : 'rgba(52,44,36,0.92)', night ? 'rgba(10,14,20,0.75)' : 'rgba(255,255,255,0.82)',
          this.mppAt, this.occlude ? this.seesPoint : null);
      }
      this.labels.drawLeaders(o, dark ? 'rgba(233,237,242,0.75)' : 'rgba(31,35,41,0.55)', dark ? 'rgba(14,17,22,0.7)' : 'rgba(255,255,255,0.9)');
    }
    if (this.overlayCbs.size) {
      for (const cb of this.overlayCbs) { try { o.save(); cb(o, this.w, this.h); o.restore(); } catch (e) { console.error('[scene] overlay', e); } }
    }
  }

  private finishStats(tStart: number, mpp: number) {
    // stats
    const info = this.renderer.info.render;
    this.stats.frames++;
    this.stats.triangles = info.triangles;
    this.stats.calls = info.calls;
    this.stats.pixelRatio = this.dpr;
    if (this.frameTimes.length) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.stats.frameMs = Math.round(avg * 10) / 10;
      this.stats.fps = Math.round(1000 / avg);
    }
    const cpu = performance.now() - tStart;
    this.stats.cpuMs = Math.round((this.stats.cpuMs ? this.stats.cpuMs * 0.8 + cpu * 0.2 : cpu) * 100) / 100;
    const v = this.viewInfo;
    v.heading = this.rig.headingDeg(); v.mpp = mpp; v.mode = this.rig.mode; v.transitioning = this.rig.transitioning;
    for (const cb of this.viewCbs) cb(v);
  }
  private viewInfo: ViewInfo = { heading: 0, mpp: 1, mode: 'orbit', transitioning: false };
  private lastDrive = -1;
  private lastPlan = -1;
  private mppK = 0;
  private mppO = 0;
  private occlude = false;
  private seeV = new THREE.Vector3();
  /** Metres per CSS px at a scene point (contour labels). */
  private mppAt = (x: number, y: number, z: number): number => {
    if (this.mppO > 0) return this.mppO;
    const p = this.rig.persp.position;
    return Math.hypot(x - p.x, y - p.y, z - p.z) * this.mppK;
  };
  /** True when nothing on the terrain hides a scene point from the camera. */
  private seesPoint = (x: number, y: number, z: number): boolean => {
    const g = this.terrain.grid;
    if (!g) return true;
    const p = this.rig.persp.position, d = this.seeV.set(x - p.x, y - p.y, z - p.z);
    if (++this.seeTests > 24) return false;
    // march only up to just short of the point itself
    const t = g.raycast(p.x, p.y, p.z, d.x, d.y, d.z, this.frameV.vx, 0.97);
    return t < 0;
  };
  private seeTests = 0;

  onView(cb: (v: ViewInfo) => void): () => void { this.viewCbs.add(cb); this.requestRender(); return () => { this.viewCbs.delete(cb); }; }

  private markReadySoon() {
    // ready after two rendered frames (shaders compiled, shadow map drawn)
    let n = 0;
    const check = () => {
      if (this.disposed) return;
      if (++n >= 2 || this.stats.frames > 2) { this.ready = true; this.resolveReady(); this.publishDebug(); return; }
      this.requestRender();
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  private publishDebug() {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __haiulScene?: unknown };
    const core = this;
    w.__haiulScene = {
      get ready() { return core.ready; },
      get stats() { return { ...core.stats }; },
      core,
    };
  }

  // ─────────────────────────────────────────────────────────── API helpers

  fitAll() {
    this.rig.safe = { ...this.safeInsets };
    this.cameraTouched = false;
    const b = this.sceneBounds();
    if (this.rig.mode === 'pov' || this.rig.mode === 'chase') useApp.getState().setCamera('orbit');
    this.rig.frame(b);
    this.requestRender();
  }

  focusBox(worldMin: Vec3, worldMax: Vec3, pad = 0.25) {
    const a = worldToScene(this.frameV, worldMin[0], worldMin[1], worldMin[2]);
    const b = worldToScene(this.frameV, worldMax[0], worldMax[1], worldMax[2]);
    const box = new THREE.Box3().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
    const size = box.getSize(new THREE.Vector3());
    const m = Math.max(size.x, size.z) * pad + 20;
    box.expandByVector(new THREE.Vector3(m, 0, m));
    if (this.rig.mode === 'pov' || this.rig.mode === 'chase') useApp.getState().setCamera('orbit');
    this.cameraTouched = true;
    this.rig.frame(box, 1000);
    this.requestRender();
  }

  async screenshot(opts: { width?: number; height?: number; type?: string; quality?: number } = {}): Promise<string> {
    this.rig.update(0, performance.now());
    this.renderFrame(performance.now(), false);
    const src = this.canvas;
    const w = opts.width ?? src.width, h = opts.height ?? Math.round((w * src.height) / src.width);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d')!;
    c2.drawImage(src, 0, 0, w, h);
    c2.drawImage(this.overlay, 0, 0, w, h);
    return cv.toDataURL(opts.type ?? 'image/png', opts.quality);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const d of this.moduleDisposers) { try { d(); } catch (e) { console.error('[scene] module dispose', e); } }
    this.moduleDisposers = [];
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.ro.disconnect();
    this.probeRo?.disconnect();
    this.probe.remove();
    this.labels.dispose();
    this.envCbs.clear();
    this.terrain.dispose();
    this.solids.dispose();
    this.section.dispose();
    this.atmos.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove(); this.overlay.remove(); this.labelLayer.remove(); this.hudLayer.remove();
    const w = window as unknown as { __haiulScene?: { core?: unknown; ready?: boolean; stats?: unknown } };
    if (w.__haiulScene?.core === this) w.__haiulScene = { ready: false, stats: { ...this.stats } };
  }
}
