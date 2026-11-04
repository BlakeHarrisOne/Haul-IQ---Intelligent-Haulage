/**
 * Actors module: haul trucks (instanced, one InstancedMesh per part per truck model), excavators / wheel loaders at
 * each circuit's dig point (dig–swing–dump synced to the loading truck), a dozer working each dump, the follow pose
 * for the POV / chase cameras, the floating card of the selected truck - and shift PLAYBACK.
 *
 * Playback (single owner): while store.timeline.playing, this module advances store.timeline.tMin by
 * timeline.speed (simulated minutes per real second) × dt every rendered frame (it keeps the loop alive meanwhile) and
 * stops at the end of the shift. Other UI must not advance tMin while playing - they only set playing / speed / tMin.
 */
import * as THREE from 'three';
import type { SceneContext, SceneModule } from '../context';
import type { Circuit, CircuitResult, Id, Scenario, TruckModel } from '@/core/types';
import { useApp, type AppState } from '@/state/store';
import { resultsFor } from '@/state/derived';
import { truckStatesAt } from '@/engine';
import { worldToScene } from '@/core/frame';
import { busOf, type TruckInfo, type TruckPhase } from '../strings/bus';
import { buildPath, legAt, legGrade, sampleAt, type PathTable } from '../strings/path';
import { makeProjector } from '../strings/screen';
import { ACCENT, literalColor, materialColor } from '../strings/palette';
import css from '../strings/ui.module.css';
import { buildPlan, isParkUp, presentEngineState, truckStateAt, LANE_M, PARK_M, type CircuitPlan, type EngineTruckState, type PauseInfo, type TruckSimState } from './sim';
import { poseOnPath, wrapAngle, type Pose } from './pose';
import { buildTruck, type TruckGeoms } from './vehicle';
import { machineMaterial } from './kit';
import { CabMirrors } from './mirror';
import { NightLamps } from './lamps';
import { nightOf } from '../strings/env';
import {
  applyExcavatorPose, buildDozer, buildExcavator, buildWheelLoader, excavatorPass, idleExcavatorPose, paintForMake,
  type DozerRig, type ExcavatorRig, type LoaderRig,
} from './machines';

interface ModelRes {
  id: Id;
  geoms: TruckGeoms;
  body: THREE.InstancedMesh;
  tray: THREE.InstancedMesh;
  load: THREE.InstancedMesh;
  wheelHi: THREE.InstancedMesh;
  wheelLo: THREE.InstancedMesh;
  cap: number;
  n: number;
  nHi: number;
  nLo: number;
}

interface CircuitRt {
  circuit: Circuit;
  result: CircuitResult;
  plan: CircuitPlan;
  path: PathTable;
  model: TruckModel;
  res: ModelRes;
  units: string[];
  matColor: THREE.Color;
  bodyColor: THREE.Color;
  matName: string;
  stops: number[];
  states: TruckSimState[];
  /** Shift-event pause label per truck (engine), e.g. 'Crib'. */
  pause: (string | undefined)[];
  poses: Pose[];
  scales: number[];
}

interface LoaderRt {
  unitId: string;
  kind: 'excavator' | 'loader';
  ex?: ExcavatorRig;
  wl?: LoaderRig;
  circuit: CircuitRt;
  pos: THREE.Vector3;
  yaw: number;
  faceYaw: number;
  t: number;
}

interface DozerRt { rig: DozerRig; base: THREE.Vector3; yaw: number; phase: number; path: PathTable; s: number }

const PHASE_LABEL: Record<TruckPhase, string> = {
  queue: 'Queued', spot: 'Spotting', load: 'Loading', haul: 'Hauling loaded', dump: 'Dumping', return: 'Returning empty', parked: 'Parked',
};
export const PHASE_COLOR: Record<TruckPhase, string> = {
  queue: '#B8692E', spot: '#7B5EA7', load: '#3E8A5A', haul: '#0A6FE6', dump: '#A88A1E', return: '#1F8A8A', parked: '#8E949C',
};


const M = new THREE.Matrix4(), MT = new THREE.Matrix4(), TRAY = new THREE.Matrix4(), MW = new THREE.Matrix4(), MX = new THREE.Matrix4();
const Q = new THREE.Quaternion(), EUL = new THREE.Euler(0, 0, 0, 'YZX'), V = new THREE.Vector3(), S = new THREE.Vector3();

export const actorsModule: SceneModule = (ctx: SceneContext) => {
  const bus = busOf(ctx);
  const group = new THREE.Group();
  group.name = 'actors';
  ctx.layers.actors.add(group);
  const mat = machineMaterial();
  const models = new Map<Id, ModelRes>();
  let circuits: CircuitRt[] = [];
  let loaders: LoaderRt[] = [];
  let dozers: DozerRt[] = [];
  let builtFor: Scenario | null = null;
  let builtFrame = '';
  let lastFollow: TruckInfo | null = null;
  let followKey = '';
  let engineWarned = false;
  /** The followed truck seen from the seat: body without the cab exterior + cab interior + tray + heap (count-1 instances). */
  let pov: { modelId: Id; meshes: THREE.InstancedMesh[] } | null = null;
  /** Live rear-view mirrors in the seat; night running lights for every truck (+ the followed truck's headlights). */
  const mirrors = new CabMirrors(group, ctx.renderer);
  const lamps = new NightLamps(group, ctx.scene);
  const drawSize = new THREE.Vector2();
  const st = () => useApp.getState();

  // selected truck card: above every scene label (z --z-card), kept when labels are off
  const root = document.createElement('div');
  root.className = `${css.root} ${css.cardLayer}`;
  (ctx.hudLayer ?? ctx.labelLayer).appendChild(root);
  const card = document.createElement('div');
  card.className = css.card;
  card.style.display = 'none';
  root.appendChild(card);

  const unsub = useApp.subscribe((s: AppState, p: AppState) => {
    if (s.scenario !== p.scenario || s.timeline.tMin !== p.timeline.tMin || s.layers !== p.layers || s.selection !== p.selection || s.camera !== p.camera || s.povCircuitId !== p.povCircuitId)
      ctx.requestRender();
  });
  const offAlive = ctx.keepAlive(() => st().timeline.playing);

  // ── resources ──────────────────────────────────────────────────────────────────────
  function modelRes(m: TruckModel, need: number): ModelRes {
    let r = models.get(m.id);
    const cap = Math.max(4, need);
    if (r && r.cap >= cap) return r;
    if (r) disposeModel(r);
    const geoms = buildTruck(m);
    const mk = (g: THREE.BufferGeometry, n: number, name: string) => {
      const im = new THREE.InstancedMesh(g, mat, n);
      im.name = `${m.id}:${name}`;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.receiveShadow = false;
      im.frustumCulled = false;
      im.count = 0;
      group.add(im);
      return im;
    };
    r = {
      id: m.id, geoms, cap, n: 0, nHi: 0, nLo: 0,
      body: mk(geoms.body, cap, 'body'), tray: mk(geoms.tray, cap, 'tray'), load: mk(geoms.load, cap, 'load'),
      wheelHi: mk(geoms.wheelHi, cap * 6, 'wheelHi'), wheelLo: mk(geoms.wheelLo, cap * 6, 'wheelLo'),
    };
    // instance colours must exist before the first render
    const white = new THREE.Color(1, 1, 1);
    for (const im of [r.body, r.tray, r.load, r.wheelHi, r.wheelLo]) for (let i = 0; i < im.instanceMatrix.count; i++) im.setColorAt(i, white);
    models.set(m.id, r);
    return r;
  }

  function disposeModel(r: ModelRes) {
    for (const im of [r.body, r.tray, r.load, r.wheelHi, r.wheelLo]) { group.remove(im); im.geometry.dispose(); im.dispose(); }
    models.delete(r.id);
  }

  function povFor(r: ModelRes): THREE.InstancedMesh[] {
    if (pov && pov.modelId === r.id) return pov.meshes;
    disposePov();
    const g = r.geoms;
    const meshes = [g.bodyNoCab, g.cabInterior, g.tray, g.load].map((geo, i) => {
      const im = new THREE.InstancedMesh(geo, mat, 1);
      im.name = `${r.id}:pov${i}`;
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      group.add(im);
      return im;
    });
    pov = { modelId: r.id, meshes };
    return meshes;
  }
  function disposePov() {
    if (!pov) return;
    for (const im of pov.meshes) { group.remove(im); im.dispose(); }
    pov = null;
  }

  function disposeMachines() {
    for (const l of loaders) { if (l.ex) { group.remove(l.ex.root); l.ex.dispose(); } if (l.wl) { group.remove(l.wl.root); l.wl.dispose(); } }
    for (const d of dozers) { group.remove(d.rig.root); d.rig.dispose(); }
    loaders = []; dozers = [];
  }

  function rebuild(s: Scenario) {
    builtFor = s;
    const f = ctx.frame();
    builtFrame = `${f.origin.join(',')},${f.vx}`;
    disposeMachines();
    const results = resultsFor(s);
    const need = new Map<Id, number>();
    for (const c of s.circuits) if (c.active !== false) need.set(c.truckModelId, (need.get(c.truckModelId) ?? 0) + Math.max(0, c.trucks));
    const unitPool = new Map<Id, string[]>();
    for (const u of s.fleet.units) if (u.kind === 'truck') { const a = unitPool.get(u.modelId) ?? []; a.push(u.id); unitPool.set(u.modelId, a); }
    const next: CircuitRt[] = [];
    for (const c of s.circuits) {
      if (c.active === false || c.trucks <= 0) continue;
      const result = results[c.id];
      const hs = s.strings.find(h => h.id === c.haulStringId);
      const model = s.fleet.trucks.find(t => t.id === c.truckModelId);
      if (!result?.ok || !hs || hs.points.length < 2 || !model) continue;
      const path = buildPath(hs.points);
      if (path.length < 5) continue;
      const scale = result.lengthM > 0 ? path.length / result.lengthM : 1;
      const p = c.params;
      const stops: { s: number; oneWay?: 'loaded' | 'empty' }[] = [];
      for (let i = 0; i < path.n; i++) { const sp = hs.points[path.src[i]]; if (sp.stop) stops.push({ s: path.s[i], oneWay: sp.stopOneWay }); }
      const loader = s.fleet.loaders.find(l => l.id === c.loaderModelId);
      // lanes follow the carriageway: keep-left lane centres at a quarter of the road width, stopped trucks on the shoulder
      const roadW = Math.max(8, hs.roadWidthM ?? 30), tw = Math.max(2, model.dims.width);
      const laneM = Math.max(Math.min(LANE_M, roadW / 2 - tw / 2), Math.min(roadW / 4, 9));
      const shoulderM = Math.max(laneM, Math.min(laneM + PARK_M, roadW / 2 - tw / 2 - 0.8));
      const plan = buildPlan({
        trucks: c.trucks, spotS: p.spotS, loadS: p.loadS, dumpS: p.dumpS, haulEff: p.haulEff, stopsS: result.stopsS,
        segments: result.segments.map(g => ({ len: g.dist3dM * scale, loadedS: g.timeLoadedS, emptyS: g.timeEmptyS, speedLoadedKmh: g.speedLoadedKmh, speedEmptyKmh: g.speedEmptyKmh })),
        stops, loaderCycleS: loader?.cycleS ?? 30, events: s.shift.events, laneM, shoulderM, parkGapM: Math.max(10, model.dims.length * 1.35),
      });
      const res = modelRes(model, need.get(model.id) ?? c.trucks);
      const pool = unitPool.get(model.id) ?? [];
      const units: string[] = [];
      for (let k = 0; k < c.trucks; k++) units.push(pool.shift() ?? `${c.loaderUnitId}·T${k + 1}`);
      const mat = s.materials.find(m => m.id === c.materialId);
      next.push({
        circuit: c, result, plan, path, model, res, units,
        matColor: new THREE.Color(materialColor(s, c.materialId)), bodyColor: new THREE.Color(literalColor(model.color || '#E3A21B')),
        matName: mat?.name ?? c.materialId, stops: stops.map(x => x.s), states: [], pause: [], poses: [], scales: [],
      });
    }
    circuits = next;
    for (const [id, r] of models) if (!need.has(id)) disposeModel(r);
    // loaders: one per loader unit, at the first circuit's dig end
    const seen = new Set<string>();
    for (const c of circuits) {
      if (seen.has(c.circuit.loaderUnitId)) continue;
      seen.add(c.circuit.loaderUnitId);
      const lm = s.fleet.loaders.find(l => l.id === c.circuit.loaderModelId);
      const kind = lm?.type === 'loader' ? 'loader' : 'excavator';
      const paint = paintForMake(lm?.make);
      const lr: LoaderRt = { unitId: c.circuit.loaderUnitId, kind, circuit: c, pos: new THREE.Vector3(), yaw: 0, faceYaw: 0, t: 0 };
      if (kind === 'excavator') { lr.ex = buildExcavator(paint, lm?.operatingMassT ?? 550); group.add(lr.ex.root); }
      else { lr.wl = buildWheelLoader(paint); group.add(lr.wl.root); }
      placeLoader(lr);
      loaders.push(lr);
    }
    // dozers: one per dump end
    const dumps = new Set<string>();
    for (const c of circuits) {
      const key = c.circuit.dumpId ?? `${Math.round(c.path.e[c.path.n - 1] / 40)},${Math.round(c.path.nn[c.path.n - 1] / 40)}`;
      if (dumps.has(key)) continue;
      dumps.add(key);
      const rig = buildDozer('#E3A21B');
      group.add(rig.root);
      dozers.push({ rig, base: new THREE.Vector3(), yaw: 0, phase: dozers.length * 0.37, path: c.path, s: c.path.length });
    }
  }

  function placeLoader(l: LoaderRt) {
    const c = l.circuit, f = ctx.frame();
    const t0 = sampleAt(c.path, 0);
    const h = t0.heading;
    const fx = Math.cos(h), fy = Math.sin(h), rx = fy, ry = -fx;
    const reach = l.ex ? l.ex.boomLen * 0.85 + l.ex.stickLen * 0.65 + 2.5 : 0;
    // excavator: beside the truck's body (left of forward, slightly behind the loading point); loader: ahead of the truck
    const side = -1;
    const back = l.kind === 'excavator' ? -0.18 * c.model.dims.length : 4;
    const lat = l.kind === 'excavator' ? side * reach : side * 16;
    const e = t0.e + fx * back + rx * lat, n = t0.n + fy * back + ry * lat;
    const z = ctx.heightAt(e, n) ?? t0.z;
    const sp = worldToScene(f, e, n, z);
    l.pos.set(sp[0], sp[1], sp[2]);
    // face: into the dig (away from the road), a little turned from the truck
    l.faceYaw = wrapAngle(h + Math.PI - 0.55 * side);
    const trayE = t0.e - fx * 0.28 * c.model.dims.length, trayN = t0.n - fy * 0.28 * c.model.dims.length;
    const truckYaw = Math.atan2(trayN - n, trayE - e);
    l.yaw = l.kind === 'excavator' ? wrapAngle((l.faceYaw + truckYaw) / 2 + (Math.abs(wrapAngle(l.faceYaw - truckYaw)) > Math.PI / 2 ? Math.PI : 0)) : truckYaw;
    const root = (l.ex ?? l.wl)!.root;
    root.position.copy(l.pos);
    root.rotation.set(0, l.yaw, 0);
    (root.userData as Record<string, unknown>).truckYaw = truckYaw;
  }

  // ── truck states: the engine's deterministic shift simulation (truckStatesAt) drives phase / chainage / speed / load;
  //    sim.ts adds the presentation. Falls back to the interim model when the engine has no states for a circuit.
  function statesFor(c: CircuitRt, tMin: number) {
    c.states.length = 0;
    let es: EngineTruckState[] = [];
    try {
      const s = st().scenario;
      es = truckStatesAt(s, resultsFor(s), c.circuit.id, tMin) as EngineTruckState[];
    } catch (err) {
      if (!engineWarned) { console.warn('truckStatesAt failed, using the interim truck model', err); engineWarned = true; }
    }
    if (es.length) {
      const scale = c.result.lengthM > 0 ? c.path.length / c.result.lengthM : 1;
      es.sort((a, b) => a.truckIndex - b.truckIndex);
      for (const e of es) {
        const pause = e.paused ? pauseInfo(c, e, tMin) : undefined;
        const ps = presentEngineState(e, tMin, c.path.length, scale, c.plan, pause);
        c.states.push(ps);
        if (e.unitId) c.units[e.truckIndex] = e.unitId;
        c.pause[c.states.length - 1] = e.paused ? (pause?.parkUp && ps.phase !== 'parked' ? 'To park-up' : e.pauseLabel ?? 'Paused') : undefined;
      }
      return;
    }
    for (let k = 0; k < c.plan.N; k++) { c.states.push(truckStateAt(c.plan, k, tMin)); c.pause[k] = undefined; }
  }

  /**
   * The shift event pausing a truck and when the truck's own pause began (the engine lets a truck finish spotting /
   * loading first). Found once per truck and event by bisecting the engine's states, then cached.
   */
  const pauseStarts = new Map<string, number>();
  let pauseFor: Scenario | null = null;
  function pauseInfo(c: CircuitRt, e: EngineTruckState, tMin: number): PauseInfo | undefined {
    const s = st().scenario;
    if (pauseFor !== s) { pauseStarts.clear(); pauseFor = s; }
    const evs = s.shift.events.filter(ev => ev.fleetStopFraction > 0 && tMin >= ev.startMin - 1e-6 && tMin <= ev.startMin + ev.durMin + 1e-6);
    const ev = evs.find(x => x.label === e.pauseLabel) ?? evs[0];
    if (!ev) return undefined;
    const key = `${c.circuit.id}|${e.truckIndex}|${ev.id}`;
    let start = pauseStarts.get(key);
    if (start === undefined) {
      let lo = ev.startMin, hi = tMin;
      const pausedAt = (t: number) => {
        try { return !!(truckStatesAt(s, resultsFor(s), c.circuit.id, t) as EngineTruckState[]).find(x => x.truckIndex === e.truckIndex)?.paused; } catch { return true; }
      };
      if (!pausedAt(lo)) for (let i = 0; i < 12 && hi - lo > 1 / 120; i++) { const mid = (lo + hi) / 2; if (pausedAt(mid)) hi = mid; else lo = mid; }
      else hi = lo;
      start = hi;
      pauseStarts.set(key, start);
    }
    return { startMin: start, endMin: ev.startMin + ev.durMin, parkUp: isParkUp(ev) };
  }

  // ── per-frame update ───────────────────────────────────────────────────────────────
  const offFrame = ctx.onFrame((dt, now) => {
    const s = st();
    // playback: the only place tMin advances while playing
    if (s.timeline.playing) {
      const end = s.scenario.shift.lengthH * 60;
      // positions come from the deterministic shift simulation, so a long frame can step far without error; cap at
      // 1 s (not 0.25 s) so the requested speed holds down to 1 fps (slow GPUs / software GL), but a tab switch can't jump
      let t = s.timeline.tMin + s.timeline.speed * Math.min(1, Math.max(0, dt));
      if (t >= end) { t = end; s.setTimeline({ tMin: t, playing: false }); } else s.setTimeline({ tMin: t });
    }
    const f = ctx.frame();
    if (s.scenario !== builtFor || `${f.origin.join(',')},${f.vx}` !== builtFrame) rebuild(s.scenario);
    const visible = s.layers.trucks !== false;
    group.visible = visible;
    const tMin = st().timeline.tMin;
    const P = makeProjector(ctx);
    const cam = ctx.camera();
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const followSel = followTarget(s);
    for (const r of models.values()) { r.n = 0; r.nHi = 0; r.nLo = 0; }
    const tmp = new Float64Array(3);
    const night = nightOf(ctx);
    const ride = s.camera === 'pov' || s.camera === 'chase';
    lamps.begin(circuits.reduce((a, c) => a + c.plan.N, 0));
    let followM: { M: THREE.Matrix4; g: TruckGeoms } | null = null;
    for (const c of circuits) {
      statesFor(c, tMin);
      c.poses.length = 0; c.scales.length = 0;
      const g = c.res.geoms;
      for (let k = 0; k < c.states.length; k++) {
        const ts = c.states[k];
        const pose = poseOnPath(c.path, ts.s, ts.rev, ts.lateral, g.wheelbase, f.vx);
        c.poses.push(pose);
        const sp = worldToScene(f, pose.e, pose.n, pose.z);
        // keep far trucks readable: never shorter than ~22 px on screen (not the followed truck, not in POV/chase)
        let scale = 1;
        const followed = followSel && followSel.c === c && followSel.k === k;
        if (!followed && (s.camera === 'orbit' || s.camera === 'plan') && P.project(sp[0], sp[1], sp[2], tmp)) {
          const mpp = P.mppAt(tmp[2]);
          scale = Math.min(5, Math.max(1, (22 * mpp) / g.L));
        }
        c.scales.push(scale);
        // in POV the driver sits inside the followed truck: its seat view (placePov) replaces the body; wheels stay
        writeInstances(c, k, ts, pose, sp, scale, camPos, !!followed && s.camera === 'pov');
        if (night > 0.02 && visible) {
          // the followed truck in POV / chase lights the road with a real spot light instead of the painted pool
          const lit = !!followed && ride;
          lamps.add(M, g, scale, !lit);
          if (lit) followM = { M: M.clone(), g };
        }
      }
    }
    for (const r of models.values()) {
      r.body.count = r.tray.count = r.load.count = r.n;
      r.wheelHi.count = r.nHi; r.wheelLo.count = r.nLo;
      for (const im of [r.body, r.tray, r.load, r.wheelHi, r.wheelLo]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    placePov(s, followSel, now);
    ctx.renderer.getDrawingBufferSize(drawSize);
    lamps.end(visible ? night : 0, followM, drawSize.y || 800);
    animateLoaders(dt, now);
    animateDozers(tMin);
    publishFollow(s, followSel);
  });

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  /** `hideBody`: the driver's own truck in POV - body, tray and heap come from the seat view; the wheels stay. */
  function writeInstances(c: CircuitRt, k: number, ts: TruckSimState, pose: Pose, sp: [number, number, number], scale: number, camPos: THREE.Vector3, hideBody = false) {
    const r = c.res, g = r.geoms, i = r.n++;
    EUL.set(0, pose.heading, pose.pitch, 'YZX');
    Q.setFromEuler(EUL);
    M.compose(V.set(sp[0], sp[1], sp[2]), Q, S.set(scale, scale, scale));
    if (hideBody) {
      r.body.setMatrixAt(i, ZERO); r.tray.setMatrixAt(i, ZERO); r.load.setMatrixAt(i, ZERO);
      r.body.setColorAt(i, c.bodyColor); r.tray.setColorAt(i, c.bodyColor); r.load.setColorAt(i, c.matColor);
      writeWheels(r, g, ts, scale, sp, camPos);
      return;
    }
    r.body.setMatrixAt(i, M);
    r.body.setColorAt(i, c.bodyColor);
    // tray about the rear hinge
    const tip = ts.tray * (52 * Math.PI) / 180;
    TRAY.makeTranslation(g.hinge[0], g.hinge[1], 0).multiply(MX.makeRotationZ(tip)).multiply(MW.makeTranslation(-g.hinge[0], -g.hinge[1], 0));
    MW.multiplyMatrices(M, TRAY);
    r.tray.setMatrixAt(i, MW);
    r.tray.setColorAt(i, c.bodyColor);
    // heap rides the tray; it squashes towards the floor as the body fills / empties, hidden when empty
    const fill = Math.max(0, Math.min(1, ts.fill));
    if (fill > 0.01) MW.multiplyMatrices(M, TRAY).multiply(scaleAbout(g.hinge[1], 0.3 + 0.7 * fill));
    else MW.makeScale(0, 0, 0);
    r.load.setMatrixAt(i, MW);
    r.load.setColorAt(i, c.matColor);
    writeWheels(r, g, ts, scale, sp, camPos);
  }

  /** Wheels (LOD by distance) for the truck whose pose is in `M`. */
  function writeWheels(r: ModelRes, g: TruckGeoms, ts: TruckSimState, scale: number, sp: [number, number, number], camPos: THREE.Vector3) {
    const dist = camPos.distanceTo(V.set(sp[0], sp[1], sp[2]));
    const hi = dist < 220 * Math.max(scale, 1);
    const im = hi ? r.wheelHi : r.wheelLo;
    const roll = ts.wheelDist / g.wheels[0].r;
    for (const w of g.wheels) {
      const j = hi ? r.nHi++ : r.nLo++;
      MT.makeTranslation(w.x, w.y, w.z);
      if (w.side < 0) MT.multiply(MX.makeRotationY(Math.PI));
      MT.multiply(MX.makeRotationZ(w.side < 0 ? roll : -roll));
      MW.multiplyMatrices(M, MT);
      im.setMatrixAt(j, MW);
    }
  }

  function placePov(s: AppState, sel: { c: CircuitRt; k: number } | null, now: number) {
    if (s.camera !== 'pov' || !sel || !sel.c.poses[sel.k] || s.layers.trucks === false) { if (pov) for (const im of pov.meshes) im.visible = false; mirrors.hide(); return; }
    const { c, k } = sel, g = c.res.geoms, ts = c.states[k], pose = c.poses[k], f = ctx.frame();
    const [body, cab, tray, load] = povFor(c.res);
    const sp = worldToScene(f, pose.e, pose.n, pose.z);
    EUL.set(0, pose.heading, pose.pitch, 'YZX');
    Q.setFromEuler(EUL);
    M.compose(V.set(sp[0], sp[1], sp[2]), Q, S.set(1, 1, 1));
    body.setMatrixAt(0, M); cab.setMatrixAt(0, M);
    TRAY.makeTranslation(g.hinge[0], g.hinge[1], 0).multiply(MX.makeRotationZ((ts.tray * 52 * Math.PI) / 180)).multiply(MW.makeTranslation(-g.hinge[0], -g.hinge[1], 0));
    MW.multiplyMatrices(M, TRAY);
    tray.setMatrixAt(0, MW);
    const fill = Math.max(0, Math.min(1, ts.fill));
    if (fill > 0.01) MW.multiplyMatrices(M, TRAY).multiply(scaleAbout(g.hinge[1], 0.3 + 0.7 * fill)); else MW.makeScale(0, 0, 0);
    load.setMatrixAt(0, MW);
    body.setColorAt(0, c.bodyColor); cab.setColorAt(0, c.bodyColor); tray.setColorAt(0, c.bodyColor); load.setColorAt(0, c.matColor);
    for (const im of [body, cab, tray, load]) { im.visible = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // live mirrors: the seat view's glass shows the flank and the road behind (needs the pose matrix again)
    EUL.set(0, pose.heading, pose.pitch, 'YZX');
    Q.setFromEuler(EUL);
    M.compose(V.set(sp[0], sp[1], sp[2]), Q, S.set(1, 1, 1));
    mirrors.update(M, g, ctx.scene, now);
  }

  const SC = new THREE.Matrix4(), SC2 = new THREE.Matrix4();
  /** Vertical squash of the heap towards the tray floor (y0 = floor height in local axes). */
  function scaleAbout(y0: number, k: number): THREE.Matrix4 {
    return SC.makeTranslation(0, y0, 0).multiply(SC2.makeScale(1, k, 1)).multiply(MX.makeTranslation(0, -y0, 0));
  }

  function animateLoaders(dt: number, now: number) {
    const t = now / 1000;
    for (const l of loaders) {
      const c = l.circuit;
      let loading = -1;
      for (let k = 0; k < c.states.length; k++) if (c.states[k].phase === 'load' && !c.pause[k]) { loading = k; break; }
      const truckYaw = ((l.ex ?? l.wl)!.root.userData as { truckYaw: number }).truckYaw;
      if (l.ex) {
        if (loading >= 0) {
          const ts = c.states[loading];
          const pass = c.plan.loadS / c.plan.passes;
          const u = ((ts.phaseElapsedS % pass) + pass) % pass / pass;
          applyExcavatorPose(l.ex, excavatorPass(u, l.faceYaw, truckYaw), l.yaw);
        } else {
          applyExcavatorPose(l.ex, idleExcavatorPose(l.faceYaw, t), l.yaw);
        }
      } else if (l.wl) {
        // V-cycle in place: back off the truck, turn to the face, lift, return, dump
        let u = 0.85 + 0.15 * Math.sin(t * 0.3);
        if (loading >= 0) { const ts = c.states[loading]; const pass = c.plan.loadS / c.plan.passes; u = ((ts.phaseElapsedS % pass) + pass) % pass / pass; }
        const wl = l.wl;
        const back = Math.sin(Math.PI * Math.min(1, u / 0.7)) * 9;
        const fwd = new THREE.Vector3(Math.cos(l.yaw), 0, -Math.sin(l.yaw));
        wl.root.position.copy(l.pos).addScaledVector(fwd, -back);
        const turn = Math.sin(Math.PI * Math.min(1, u / 0.7)) * 0.9;
        wl.root.rotation.y = l.yaw + turn * 0.35;
        wl.front.rotation.y = turn * 0.45;
        const lift = u > 0.55 ? Math.min(1, (u - 0.55) / 0.25) : u < 0.3 ? 0 : (u - 0.3) * 0.6;
        wl.arms.rotation.z = -0.15 + lift * 0.95;
        wl.bucket.rotation.z = u > 0.82 ? -0.9 * Math.min(1, (u - 0.82) / 0.1) : 0.35 - lift * 0.35;
        for (const w of wl.wheels) w.rotation.z = -back / wl.wheelR;
      }
    }
  }

  function animateDozers(tMin: number) {
    const f = ctx.frame();
    for (const d of dozers) {
      // push 22 m towards the tip edge at ~4 km/h, reverse at ~8 km/h (≈ 30 s cycle)
      const end = sampleAt(d.path, d.path.length);
      const h = end.heading + 1.2;
      const cyc = 30, u = ((tMin * 60) / cyc + d.phase) % 1;
      const x = u < 0.65 ? 22 * (u / 0.65) : 22 * (1 - (u - 0.65) / 0.35);
      const fx = Math.cos(h), fy = Math.sin(h);
      const e0 = end.e + Math.cos(end.heading) * 26 - fx * 11, n0 = end.n + Math.sin(end.heading) * 26 - fy * 11;
      const e = e0 + fx * x, n = n0 + fy * x;
      const z = ctx.heightAt(e, n) ?? end.z;
      const sp = worldToScene(f, e, n, z);
      d.rig.root.position.set(sp[0], sp[1], sp[2]);
      d.rig.root.rotation.set(0, h, 0);
      d.rig.blade.position.y = u < 0.65 ? 0 : 0.45;
    }
  }

  // ── follow / POV ───────────────────────────────────────────────────────────────────
  function followTarget(s: AppState): { c: CircuitRt; k: number } | null {
    if (s.selection.kind === 'truck') {
      const sel = s.selection;
      const c = circuits.find(x => x.circuit.id === sel.circuitId);
      if (c && sel.truckIndex < c.plan.N) return { c, k: sel.truckIndex };
    }
    if (s.camera === 'pov' || s.camera === 'chase') {
      const c = circuits.find(x => x.circuit.id === s.povCircuitId) ?? circuits[0];
      if (c && c.plan.N > 0) return { c, k: 0 };
    }
    return null;
  }

  function truckInfo(c: CircuitRt, k: number): TruckInfo {
    const ts = c.states[k];
    const L = c.path.length;
    const i = legAt(c.path, Math.max(0, Math.min(L, ts.s)));
    const seg = c.result.segments[Math.min(c.result.segments.length - 1, Math.max(0, i))];
    const dir: 1 | -1 | 0 = ts.dir;
    const g = legGrade(c.path, i) * (ts.rev > 0.5 ? -1 : 1);
    let nextStop: number | undefined;
    if (dir !== 0) for (const sc of dir > 0 ? c.stops : [...c.stops].reverse()) if ((dir > 0 && sc > ts.s + 1) || (dir < 0 && sc < ts.s - 1)) { nextStop = sc; break; }
    return {
      circuitId: c.circuit.id, truckIndex: k, unitId: c.units[k] ?? `T${k + 1}`, phase: ts.phase, speedKmh: ts.speedKmh, loaded: ts.loaded,
      chainage: ts.s, dir, phaseRemainS: ts.phaseRemainS, etaDumpS: ts.etaDumpS, grade: g,
      limit: seg ? (ts.loaded ? seg.limitLoaded : seg.limitEmpty) : undefined, pathLength: L, nextStopM: nextStop,
      stringId: c.circuit.haulStringId, modelName: c.model.name, materialName: c.matName, pauseLabel: c.pause[k],
    };
  }

  function publishFollow(s: AppState, sel: { c: CircuitRt; k: number } | null) {
    if (!sel || !sel.c.poses[sel.k]) {
      if (lastFollow || followKey) { ctx.setFollowTarget(null); lastFollow = null; followKey = ''; bus.followed = null; }
      return;
    }
    const { c, k } = sel;
    const pose = c.poses[k], f = ctx.frame(), g = c.res.geoms;
    const info = truckInfo(c, k);
    bus.followed = info;
    lastFollow = info;
    followKey = `${c.circuit.id}:${k}`;
    const front = worldToScene(f, pose.fe, pose.fn, pose.fz);
    // the eye of the seated driver in the model (pitched with the truck); the core rides FollowTarget with an unpitched
    // offset, so the reported position is shifted to make position + offset land exactly on that eye (matters on ramps)
    const back = g.frontAxleX - g.eye[0], height = g.eye[1], right = g.eye[2];
    const sp = worldToScene(f, pose.e, pose.n, pose.z);
    EUL.set(0, pose.heading, pose.pitch, 'YZX');
    const eyeW = new THREE.Vector3(g.eye[0], g.eye[1], g.eye[2]).applyEuler(EUL).add(V.set(sp[0], sp[1], sp[2]));
    const h = pose.heading, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const position = new THREE.Vector3(eyeW.x + fx * back - rx * right, eyeW.y - height, eyeW.z + fz * back - rz * right);
    if (s.camera !== 'pov') position.set(front[0], front[1], front[2]);
    ctx.setFollowTarget({
      position,
      heading: pose.heading,
      pitch: pose.pitch,
      // eye relative to `position` (the front-axle ground point): back of the axle, height, right of the centreline
      eye: { height, back, right },
      speedKmh: c.states[k].speedKmh,
      loaded: c.states[k].loaded,
      label: info.unitId,
      cabKind: c.model.id.toLowerCase().replace(/[^a-z0-9]/g, ''),
    });
  }

  // ── picking ────────────────────────────────────────────────────────────────────────
  bus.pickTruck = (x: number, y: number) => {
    if (st().layers.trucks === false) return null;
    const P = makeProjector(ctx), f = ctx.frame();
    const tmp = new Float64Array(3);
    let best: { circuitId: Id; truckIndex: number } | null = null, bd = Infinity;
    for (const c of circuits) {
      const g = c.res.geoms;
      c.poses.forEach((pose, k) => {
        const sc = c.scales[k] ?? 1;
        const sp = worldToScene(f, pose.e, pose.n, pose.z + (g.H * 0.45 * sc) / f.vx);
        if (!P.project(sp[0], sp[1], sp[2], tmp)) return;
        const rpx = Math.max(10, (g.L * 0.55 * sc) / P.mppAt(tmp[2]));
        const d = Math.hypot(tmp[0] - x, tmp[1] - y);
        if (d < rpx && d < bd) { bd = d; best = { circuitId: c.circuit.id, truckIndex: k }; }
      });
    }
    return best;
  };

  // ── overlay: selection ring + truck card ───────────────────────────────────────────
  const offOverlay = ctx.onOverlay((g2) => {
    const s = st();
    const P = makeProjector(ctx), f = ctx.frame();
    const tmp = new Float64Array(3);
    const rings: { c: CircuitRt; k: number; sel: boolean }[] = [];
    if (s.selection.kind === 'truck') { const sel = s.selection; const c = circuits.find(x => x.circuit.id === sel.circuitId); if (c) rings.push({ c, k: sel.truckIndex, sel: true }); }
    if (s.hover.kind === 'truck') { const hv = s.hover; const c = circuits.find(x => x.circuit.id === hv.circuitId); if (c && !(s.selection.kind === 'truck' && s.selection.circuitId === hv.circuitId && s.selection.truckIndex === hv.truckIndex)) rings.push({ c, k: hv.truckIndex, sel: false }); }
    if (s.camera !== 'pov') for (const r of rings) {
      const pose = r.c.poses[r.k];
      if (!pose) continue;
      const g = r.c.res.geoms, sc = r.c.scales[r.k] ?? 1;
      const rad = g.L * 0.62 * sc;
      g2.beginPath();
      let ok = true;
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const sp = worldToScene(f, pose.e + Math.cos(a) * rad, pose.n + Math.sin(a) * rad, pose.z);
        if (!P.project(sp[0], sp[1], sp[2], tmp)) { ok = false; break; }
        if (i === 0) g2.moveTo(tmp[0], tmp[1]); else g2.lineTo(tmp[0], tmp[1]);
      }
      if (!ok) continue;
      g2.fillStyle = r.sel ? 'rgba(10,111,230,0.16)' : 'rgba(10,111,230,0.08)';
      g2.fill();
      g2.lineWidth = r.sel ? 2.5 : 1.5;
      g2.strokeStyle = r.sel ? ACCENT : 'rgba(10,111,230,0.6)';
      g2.stroke();
    }
    // card
    const selT = s.selection.kind === 'truck' ? s.selection : null;
    const c = selT ? circuits.find(x => x.circuit.id === selT.circuitId) : undefined;
    if (!selT || !c || !c.poses[selT.truckIndex] || s.camera === 'pov') { card.style.display = 'none'; return; }
    const pose = c.poses[selT.truckIndex], g = c.res.geoms, sc = c.scales[selT.truckIndex] ?? 1;
    const top = worldToScene(f, pose.e, pose.n, pose.z + (g.H * 1.15 * sc) / f.vx);
    if (!P.project(top[0], top[1], top[2], tmp)) { card.style.display = 'none'; return; }
    const info = truckInfo(c, selT.truckIndex);
    const html = cardHtml(info, c);
    if (card.dataset.k !== html) { card.innerHTML = html; card.dataset.k = html; }
    card.style.display = '';
    const cw = card.offsetWidth || 212, ch = card.offsetHeight || 150;
    card.style.transform = `translate(${(tmp[0] - cw / 2).toFixed(1)}px, ${(tmp[1] - ch - 14).toFixed(1)}px)`;
  });

  function cardHtml(info: TruckInfo, c: CircuitRt): string {
    const fmtT = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.max(0, Math.round(sec))} s`);
    const col = PHASE_COLOR[info.phase];
    const cycleFrac = (() => { const pl = c.plan; const tau = pl.effCycleS - info.etaDumpS; return Math.max(0, Math.min(1, ((tau % pl.effCycleS) + pl.effCycleS) % pl.effCycleS / pl.effCycleS)); })();
    return `<div class="${css.cardHead}"><span class="${css.cardTitle}">${info.unitId}</span><span class="${css.cardModel}">${info.modelName}</span></div>`
      + `<div class="${css.phase}" style="color:${col};background:${col}1a"><i></i>${PHASE_LABEL[info.phase]}${info.pauseLabel ? ` · ${info.pauseLabel}` : ''}</div>`
      + `<div class="${css.cardGrid}">`
      + `<span>Speed</span><b>${info.speedKmh.toFixed(0)} km/h</b>`
      + `<span>Load</span><b>${info.loaded ? `Loaded · ${info.materialName ?? ''}` : 'Empty'}</b>`
      + `<span>Grade</span><b>${info.grade >= 0 ? '+' : '−'}${(Math.abs(info.grade) * 100).toFixed(1)} %</b>`
      + `<span>Chainage</span><b>${Math.max(0, info.chainage).toFixed(0)} / ${info.pathLength.toFixed(0)} m</b>`
      + `<span>${info.phase === 'dump' ? 'Dump ends in' : 'ETA dump'}</span><b>${fmtT(info.phase === 'dump' ? info.phaseRemainS : info.etaDumpS)}</b>`
      + `</div><div class="${css.bar}"><span style="width:${(cycleFrac * 100).toFixed(1)}%;background:${col}"></span></div>`;
  }

  return () => {
    unsub(); offAlive(); offFrame(); offOverlay();
    if (lastFollow) ctx.setFollowTarget(null);
    bus.followed = null;
    disposePov();
    mirrors.dispose();
    lamps.dispose();
    bus.pickTruck = undefined;
    disposeMachines();
    for (const r of [...models.values()]) disposeModel(r);
    mat.dispose();
    ctx.layers.actors.remove(group);
    root.remove();
  };
};
