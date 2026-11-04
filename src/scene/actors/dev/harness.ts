/**
 * DEV ONLY - a minimal SceneContext implementation so the actors / strings / tools / cockpit modules can be verified
 * before (and independently of) the scene core. Open /src/scene/actors/dev/harness.html on the dev server.
 * Not imported by the app.
 */
import * as THREE from 'three';
import type { FollowTarget, SceneContext, ScenePointer } from '../../context';
import { sceneModules } from '../../modules';
import { useApp } from '@/state/store';
import type { Circuit, LoaderModel, Material, Scenario, TruckModel } from '@/core/types';
import { emptyScenario } from '@/state/store';
import { makeFrame, sceneToWorld, worldToScene } from '@/core/frame';
import { buildDemoSite, buildHeightIndex, heightAt as gHeightAt } from '@/geom';
import { WORKBOOK_SPEEDS } from '@/data/tables';

function fleet(): Pick<Scenario, 'materials' | 'fleet' | 'shift'> {
  const truck = (id: string, name: string, make: string, color: string, dims: TruckModel['dims'], payload: number): TruckModel => ({
    id, name, make, model: name, drive: 'mechanical', emptyMassT: payload * 0.9, payloadT: payload, gvwT: payload * 1.9, enginePowerKW: 1400,
    topSpeedKmh: 54, rimpull: [], retarder: [], spreadsheetSpeeds: WORKBOOK_SPEEDS, dims, color, sources: [], estimated: [],
    loadBcmByMaterial: { OB: 78, CL: 120 },
  });
  const trucks = [
    truck('CAT_789C', 'Cat 789C', 'Caterpillar', '#E3A21B', { length: 12.18, width: 7.67, height: 6.15, eyeHeight: 4.52, eyeBack: 3.29, eyeRight: -2.79, tyre: '37.00R57' }, 180),
    truck('KOM_HD1500_7', 'Komatsu HD1500-7', 'Komatsu', '#E8B320', { length: 10.4, width: 6.8, height: 5.9, eyeHeight: 4.3, eyeBack: 3.1, eyeRight: -2.4, tyre: '33.00R51' }, 144),
  ];
  const loader = (id: string, name: string, make: string, type: LoaderModel['type'], bucket: number, cycle: number, mass: number): LoaderModel => ({ id, name, make, model: name, type, bucketM3: bucket, cycleS: cycle, operatingMassT: mass, sources: [], estimated: [] });
  const materials: Material[] = [
    { id: 'OB', name: 'Overburden', bankDensity: 2.4, swell: 1.3, color: '#B08A62' },
    { id: 'CL', name: 'Coal', bankDensity: 1.45, swell: 1.35, color: '#2E3238' },
  ];
  return {
    materials,
    fleet: {
      trucks,
      loaders: [loader('HIT_EX5600', 'Hitachi EX5600-7', 'Hitachi', 'excavator', 29, 32, 537), loader('KOM_PC4000', 'Komatsu PC4000-11', 'Komatsu', 'excavator', 22, 30, 392), loader('KOM_WA900', 'Komatsu WA900-8', 'Komatsu', 'loader', 13, 42, 116)],
      units: [
        ...['DT124', 'DT125', 'DT126', 'DT127', 'DT128', 'DT129', 'DT130', 'DT197', 'DT198', 'DT199'].map(id => ({ id, modelId: 'CAT_789C', kind: 'truck' as const, ownership: 'own' as const, availability: 0.9 })),
        ...['DT301', 'DT302', 'DT303', 'DT304', 'DT305'].map(id => ({ id, modelId: 'KOM_HD1500_7', kind: 'truck' as const, ownership: 'own' as const, availability: 0.9 })),
      ],
      loaderAssumptions: [], trucksAvailable: 14,
    },
    shift: {
      name: 'Day shift', startHour: 6, lengthH: 12,
      events: [
        { id: 'e1', label: 'Pre-start', kind: 'prestart', startMin: 0, durMin: 20, fleetStopFraction: 1 },
        { id: 'e2', label: 'Crib', kind: 'crib', startMin: 330, durMin: 30, fleetStopFraction: 0.5 },
      ],
    },
  };
}

function scenario(): Scenario {
  const s = emptyScenario('Harness');
  const d = buildDemoSite();
  Object.assign(s, fleet());
  s.site = d.site; s.assets = d.assets;
  s.strings = d.strings.map((h, i) => (i === 0 ? { ...h, points: h.points.map((p, j) => (j === 18 ? { ...p, stop: true } : p)) } : h));
  const params = (truckLoadBcm: number): Circuit['params'] => ({
    haulEff: 0.85, stopSigns: 2, stopPenaltyS: 60, spotS: 40, loadS: 150, dumpS: 60, truckLoadBcm, plannedRateBcmPerPtHr: 2200,
    truckPtHrsPerDay: 20, desiredDailyBcm: 40000, rrPct: 2, speedLimitKmh: 60, speedModel: 'spreadsheet', shiftsPerDay: 2,
  });
  const byName = (k: string) => s.strings.find(h => h.name.startsWith(k) && !h.name.includes('long'));
  const c = (id: string, name: string, loader: string, loaderModel: string, truck: string, mat: string, str: string | undefined, n: number, color: string, load: number): Circuit => ({
    id, name, loaderUnitId: loader, loaderModelId: loaderModel, truckModelId: truck, materialId: mat, haulStringId: str, trucks: n, priority: 1,
    active: true, params: params(load), color, digId: s.strings.find(h => h.id === str)?.digId, dumpId: s.strings.find(h => h.id === str)?.dumpId,
  });
  s.circuits = [
    c('c1', 'EX09 OB → S51', 'EX09', 'HIT_EX5600', 'CAT_789C', 'OB', byName('EX09')?.id, 7, '#0A6FE6', 78),
    c('c2', 'EX04 OB → S52', 'EX04', 'KOM_PC4000', 'KOM_HD1500_7', 'OB', byName('EX04')?.id, 4, '#B8692E', 62),
    c('c3', 'LDR coal → ROM', 'LDR', 'KOM_WA900', 'CAT_789C', 'CL', byName('LDR')?.id, 3, '#3E8A5A', 110),
  ];
  return s;
}

export function startHarness(host: HTMLElement) {
  const s = scenario();
  useApp.getState().replaceScenario(s, { markClean: true });
  useApp.getState().setTimeline({ tMin: 95 });
  const frame = makeFrame(s.site.origin, s.settings.verticalExaggeration);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  host.appendChild(canvas);
  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  host.appendChild(overlay);
  const labelLayer = document.createElement('div');
  labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  host.appendChild(labelLayer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe5ec');
  scene.fog = new THREE.Fog('#dfe5ec', 2500, 7000);
  const hemi = new THREE.HemisphereLight('#f4f7fb', '#8a7f6c', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.3);
  sun.position.set(-600, 900, 500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -300; sun.shadow.camera.right = 300; sun.shadow.camera.top = 300; sun.shadow.camera.bottom = -300;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 3000; sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const layers = Object.fromEntries(['terrain', 'solids', 'strings', 'actors', 'tools', 'labels', 'fx'].map(k => { const g = new THREE.Group(); g.name = k; scene.add(g); return [k, g]; })) as SceneContext['layers'];

  // terrain from the topo asset
  const topo = s.assets.find(a => a.role === 'topo')!;
  const v = topo.mesh.verts, nV = v.length / 3;
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < nV; i++) { zmin = Math.min(zmin, v[3 * i + 2]); zmax = Math.max(zmax, v[3 * i + 2]); }
  const lo = new THREE.Color('#a59a86'), hi = new THREE.Color('#e9e3d6'), tmpC = new THREE.Color();
  for (let i = 0; i < nV; i++) {
    const p = worldToScene(frame, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
    pos.set(p, 3 * i);
    tmpC.copy(lo).lerp(hi, (v[3 * i + 2] - zmin) / (zmax - zmin));
    col.set([tmpC.r, tmpC.g, tmpC.b], 3 * i);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setIndex(new THREE.BufferAttribute(topo.mesh.tris, 1));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  terrain.receiveShadow = true;
  layers.terrain.add(terrain);
  for (const a of s.assets.filter(x => x.role === 'dig' || x.role === 'dump')) {
    const av = a.mesh.verts, n = av.length / 3, ap = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) ap.set(worldToScene(frame, av[3 * i], av[3 * i + 1], av[3 * i + 2]), 3 * i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ap, 3));
    g.setIndex(new THREE.BufferAttribute(a.mesh.tris, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: a.color, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.8 }));
    m.userData.assetId = a.id;
    layers.solids.add(m);
  }
  const index = buildHeightIndex(topo.mesh);

  // camera
  const persp = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  const cam = { target: new THREE.Vector3(0, 0, 0), dist: 1600, az: 0.5, el: 0.62, mode: 'orbit' as string };
  const bb = topo.stats.bbox;
  const c0 = worldToScene(frame, (bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2);
  cam.target.set(c0[0], c0[1], c0[2]);
  let follow: FollowTarget | null = null;
  let controls = true;
  let sHead = 0;
  let camDt = 0.016;
  function updateCamera() {
    const mode = useApp.getState().camera;
    if ((mode === 'pov' || mode === 'chase') && follow) {
      const t = follow;
      sHead += Math.atan2(Math.sin(t.heading - sHead), Math.cos(t.heading - sHead)) * (1 - Math.exp(-camDt / 0.14));
      const h = sHead, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
      if (mode === 'pov') {
        const e = t.eye;
        persp.position.set(t.position.x - fx * e.back + rx * e.right, t.position.y + e.height, t.position.z - fz * e.back + rz * e.right);
        persp.fov = 62;
        const pitch = t.pitch * 0.85 - 0.035;
        persp.lookAt(persp.position.x + fx * Math.cos(pitch) * 10, persp.position.y + Math.sin(pitch) * 10, persp.position.z + fz * Math.cos(pitch) * 10);
      } else {
        persp.fov = 55;
        persp.position.set(t.position.x - fx * 38, t.position.y + 17, t.position.z - fz * 38);
        persp.lookAt(t.position.x + fx * 8, t.position.y + 3.5, t.position.z + fz * 8);
      }
    } else {
      persp.fov = 40;
      const ce = Math.cos(cam.el);
      persp.position.set(cam.target.x + Math.sin(cam.az) * ce * cam.dist, cam.target.y + Math.sin(cam.el) * cam.dist, cam.target.z + Math.cos(cam.az) * ce * cam.dist);
      persp.lookAt(cam.target);
    }
    persp.near = Math.max(0.3, cam.dist / 2000);
    if (mode === 'pov' || mode === 'chase') persp.near = 0.3;
    persp.updateProjectionMatrix();
    persp.updateMatrixWorld();
  }

  const frameCbs = new Set<(dt: number, now: number) => void>();
  const overlayCbs = new Set<(c: CanvasRenderingContext2D, w: number, h: number) => void>();
  const pointerCbs: ((p: ScenePointer) => boolean | void)[] = [];
  const keyCbs: ((e: KeyboardEvent) => boolean | void)[] = [];
  const alive = new Set<() => boolean>();
  let needs = true;
  const raycaster = new THREE.Raycaster();
  const ndcOf = (x: number, y: number) => new THREE.Vector2((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);

  const ctx: SceneContext = {
    three: THREE, renderer, scene, camera: () => persp, canvas, overlay, labelLayer, frame: () => frame, layers,
    requestRender: () => { needs = true; },
    keepAlive: (f) => { alive.add(f); return () => alive.delete(f); },
    onFrame: (cb) => { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    onOverlay: (cb) => { overlayCbs.add(cb); return () => overlayCbs.delete(cb); },
    onPointer: (cb) => { pointerCbs.push(cb); return () => { const i = pointerCbs.indexOf(cb); if (i >= 0) pointerCbs.splice(i, 1); }; },
    onKey: (cb) => { keyCbs.push(cb); return () => { const i = keyCbs.indexOf(cb); if (i >= 0) keyCbs.splice(i, 1); }; },
    pickTerrain: (x, y) => {
      raycaster.setFromCamera(ndcOf(x, y), persp);
      const hit = raycaster.intersectObject(terrain, false)[0];
      return hit ? sceneToWorld(frame, hit.point.x, hit.point.y, hit.point.z) : null;
    },
    pick: (x, y, objects, recursive = true) => { raycaster.setFromCamera(ndcOf(x, y), persp); return raycaster.intersectObjects(objects, recursive); },
    heightAt: (e, n) => gHeightAt(index, e, n),
    project: (w) => { const p = worldToScene(frame, w[0], w[1], w[2]); const q = new THREE.Vector3(p[0], p[1], p[2]).project(persp); if (q.z > 1) return null; return { x: (q.x * 0.5 + 0.5) * canvas.clientWidth, y: (-q.y * 0.5 + 0.5) * canvas.clientHeight }; },
    setFollowTarget: (t) => { follow = t; },
    getFollowTarget: () => follow,
    setControlsEnabled: (on) => { controls = on; },
    setCursor: (c) => { canvas.style.cursor = c; },
  };

  // pointer routing + tiny orbit controls
  let drag: { x: number; y: number; b: number; moved: boolean } | null = null;
  const route = (kind: ScenePointer['kind'], e: PointerEvent | MouseEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const p: ScenePointer = { kind, event: e, x, y, ndc: ndcOf(x, y), button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
    for (const cb of pointerCbs) if (cb(p)) { needs = true; return true; }
    return false;
  };
  canvas.addEventListener('pointerdown', e => { if (!route('down', e)) drag = { x: e.clientX, y: e.clientY, b: e.button, moved: false }; else drag = { x: e.clientX, y: e.clientY, b: -1, moved: false }; });
  window.addEventListener('pointermove', e => {
    route('move', e);
    if (drag && controls && drag.b >= 0 && (e.buttons & 1 || e.buttons & 2)) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.b === 2 || e.shiftKey) {
        const k = cam.dist * 0.0012;
        cam.target.x -= (Math.cos(cam.az) * dx - Math.sin(cam.az) * dy) * k;
        cam.target.z -= (-Math.sin(cam.az) * dx - Math.cos(cam.az) * dy) * k;
      } else { cam.az -= dx * 0.005; cam.el = Math.max(0.1, Math.min(1.55, cam.el + dy * 0.005)); }
      drag.x = e.clientX; drag.y = e.clientY; needs = true;
    } else if (drag && drag.b < 0) { if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true; }
  });
  window.addEventListener('pointerup', e => { route('up', e); if (drag && !drag.moved) route('click', e); drag = null; });
  canvas.addEventListener('dblclick', e => route('dblclick', e));
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerleave', e => route('leave', e));
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (!route('wheel', e)) { cam.dist *= Math.exp(e.deltaY * 0.0012); needs = true; } }, { passive: false });
  window.addEventListener('keydown', e => { for (const cb of keyCbs) if (cb(e)) { e.preventDefault(); needs = true; return; } });

  const mods = sceneModules.map(m => m(ctx));
  let last = performance.now();
  function resize() {
    const w = host.clientWidth, h = host.clientHeight, dpr = renderer.getPixelRatio();
    renderer.setSize(w, h, false);
    overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr);
    persp.aspect = w / h;
    needs = true;
  }
  window.addEventListener('resize', resize);
  resize();
  useApp.subscribe(() => { needs = true; });
  function loop(now: number) {
    requestAnimationFrame(loop);
    const anyAlive = [...alive].some(f => f()) || useApp.getState().camera === 'pov' || useApp.getState().camera === 'chase';
    if (!needs && !anyAlive) return;
    // headless screenshots (SwiftShader): throttle continuous rendering so captures are not starved
    if (navigator.webdriver && !needs && now - last < 2500) return;
    needs = false;
    const dt = Math.min(0.1, (now - last) / 1000);
    camDt = Math.min(1, (now - last) / 1000);
    last = now;
    updateCamera();
    for (const cb of frameCbs) cb(dt, now);
    updateCamera();
    // sun follows the view target for crisp shadows
    const tgt = follow && useApp.getState().camera !== 'orbit' ? follow.position : cam.target;
    sun.target.position.copy(tgt); sun.position.copy(tgt).add(new THREE.Vector3(-600, 900, 500));
    const sz = Math.min(1500, Math.max(120, cam.dist * 0.5));
    sun.shadow.camera.left = -sz; sun.shadow.camera.right = sz; sun.shadow.camera.top = sz; sun.shadow.camera.bottom = -sz; sun.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, persp);
    const g = overlay.getContext('2d')!;
    const dpr = renderer.getPixelRatio();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, overlay.width, overlay.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const cb of overlayCbs) cb(g, host.clientWidth, host.clientHeight);
  }
  requestAnimationFrame(loop);

  // screenshot / test API
  const api = {
    ctx, cam, store: useApp,
    look(e: number, n: number, z: number, dist: number, az: number, el: number) { const p = worldToScene(frame, e, n, z); cam.target.set(p[0], p[1], p[2]); cam.dist = dist; cam.az = az; cam.el = el; needs = true; },
    lookAtTruck(ci: number, k: number, dist = 60, az = 0.8, el = 0.35) {
      const f = useApp.getState();
      f.select({ kind: 'truck', circuitId: f.scenario.circuits[ci].id, truckIndex: k });
      needs = true;
      setTimeout(() => { const t = follow; if (t) { cam.target.copy(t.position); cam.dist = dist; cam.az = az; cam.el = el; needs = true; } }, 60);
    },
    stringStart(i: number) { const h = useApp.getState().scenario.strings[i]; return h.points[0]; },
    /** Screen position of a world point. */
    screenOf(e: number, n: number, z: number) { return ctx.project([e, n, z]); },
    /** Synthetic pointer: kind = down | move | up | click | dblclick; mods = { alt, ctrl, shift, button }. */
    ptr(kind: ScenePointer['kind'], x: number, y: number, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean; button?: number } = {}) {
      const r = canvas.getBoundingClientRect();
      const ev = new PointerEvent(kind === 'dblclick' ? 'dblclick' : 'pointermove', { clientX: r.left + x, clientY: r.top + y, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, button: mods.button ?? 0 });
      if (kind === 'down') { if (!route('down', ev)) drag = { x: ev.clientX, y: ev.clientY, b: 0, moved: false }; else drag = { x: ev.clientX, y: ev.clientY, b: -1, moved: false }; }
      else if (kind === 'up') { route('up', ev); drag = null; }
      else if (kind === 'click') { route('down', ev); route('up', ev); route('click', ev); }
      else route(kind, ev);
      needs = true;
    },
    key(k: string) { const e = new KeyboardEvent('keydown', { key: k }); for (const cb of keyCbs) if (cb(e)) { needs = true; return; } },
    mods,
  };
  (window as unknown as { __h: typeof api }).__h = api;
  return api;
}
