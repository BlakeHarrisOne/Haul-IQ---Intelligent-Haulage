/**
 * Dig / dump solids with live depletion.
 *  - translucent faceted bodies with a fresnel rim, crisp feature edges, and an x-ray pass (depthFunc Greater) so
 *    the underground part of a dig block reads as a ghost through the terrain;
 *  - depletion: a plane moved through the solid so the dug (dig) / placed (dump) volume equals the timeline
 *    fraction (divergence-theorem volume table + secant refinement, '@/geom' depletionPlane convention: normal =
 *    direction the face moves, BACK side = done). GPU clipping planes cut the body; the cut face is capped with a
 *    hatched polygon and a bright face line; the done/undone part stays as a faint dashed ghost wireframe;
 *  - floating labels (remaining / placed bcm, % complete) in the HTML label layer.
 */
import * as THREE from 'three';
import type { DepletionMode, MeshAsset, Vec3 } from '@/core/types';
import { num, pct } from '@/core/format';
import { capLoops, depletionPlane, prepareSolid, type SolidHandle } from '@/geom';
import { toLocal, type LocalMesh } from './meshUtil';
import { LabelPlacer, makeLabelItem, type Insets, type LabelItem } from './labels';
import type { Palette } from './theme';
import css from './core.module.css';

const XRAY_VS = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vVP;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vVP = -mvPosition.xyz;
}`;
const XRAY_FS = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uColor; uniform float uAlpha;
varying vec3 vVP;
void main() {
  #include <clipping_planes_fragment>
  vec3 n = normalize(cross(dFdx(vVP), dFdy(vVP)));
  float fr = pow(1.0 - abs(dot(n, normalize(vVP))), 1.6);
  // diagonal screen hatch so the hidden body reads as "inside the ground"
  float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
  float a = uAlpha * (0.45 + 0.55 * fr) * (0.75 + 0.25 * hatch);
  gl_FragColor = vec4(uColor * (0.85 + 0.5 * fr), a);
  #include <colorspace_fragment>
}`;

interface SolidItem {
  asset: MeshAsset;
  local: LocalMesh;
  geom: THREE.BufferGeometry;
  edgesGeom: THREE.BufferGeometry;
  volume: number;
  handle: SolidHandle;
  mode: DepletionMode;
  az: number;
  kind: 'dig' | 'dump';
  group: THREE.Group;
  front: THREE.Mesh;
  back: THREE.Mesh;
  xray: THREE.Mesh;
  edges: THREE.LineSegments;
  ghost: THREE.LineSegments;
  ghostFill: THREE.Mesh;
  cap: THREE.Mesh;
  capLine: THREE.LineSegments;
  mats: THREE.Material[];
  keepVis: THREE.Plane;
  keepGhost: THREE.Plane;
  fraction: number;
  applied: number;
  label: HTMLDivElement;
  labelParts: { title: HTMLElement; value: HTMLElement; sub: HTMLElement; bar: HTMLElement; name: HTMLElement; pct: HTMLElement };
  anchor: THREE.Vector3;
  li: LabelItem;
  expanded: boolean;
  bcm: number;
}

function patchSolid(m: THREE.MeshStandardMaterial, rim: { value: THREE.Color }, rimK: { value: number }) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = rim; sh.uniforms.uRimK = rimK;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimK;')
      .replace('#include <opaque_fragment>', `
  {
    float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.4);
    outgoingLight += uRim * fr * uRimK;
    diffuseColor.a = clamp(diffuseColor.a + fr * 0.35 * uRimK, 0.0, 1.0);
  }
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'hk-solid-v1';
}

function depthBias(m: THREE.Material, k = 0.0008) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\ngl_Position.z -= ${k.toFixed(5)} * gl_Position.w;`);
  };
}

export class SolidsLayer {
  readonly root = new THREE.Group();
  readonly ve = new THREE.Group();
  items = new Map<string, SolidItem>();
  private labelLayer: HTMLDivElement;
  private selected: string | null = null;
  private pal: Palette | null = null;
  private labelsOn = true;
  private placer = new LabelPlacer();
  private hovered: string | null = null;
  private playingIds = new Set<string>();
  private onPick: ((id: string) => void) | null = null;
  private onHover: ((id: string | null) => void) | null = null;
  private tmp = new THREE.Vector3();
  private origin: Vec3 = [0, 0, 0];

  constructor(labelLayer: HTMLDivElement) {
    this.labelLayer = labelLayer;
    this.root.name = 'solids-core';
    this.root.add(this.ve);
  }

  clear() {
    for (const it of this.items.values()) this.disposeItem(it);
    this.items.clear();
  }

  private disposeItem(it: SolidItem) {
    this.ve.remove(it.group);
    it.geom.dispose(); it.edgesGeom.dispose(); it.cap.geometry.dispose(); it.capLine.geometry.dispose();
    for (const m of it.mats) m.dispose();
    it.label.remove();
  }

  /** Rebuild from the dig/dump solid assets. Existing items whose mesh is unchanged are kept. */
  build(assets: MeshAsset[], origin: Vec3) {
    const sameOrigin = origin[0] === this.origin[0] && origin[1] === this.origin[1] && origin[2] === this.origin[2];
    this.origin = origin;
    const keep = new Set<string>();
    for (const a of assets) {
      const old = this.items.get(a.id);
      if (old && sameOrigin && old.asset.mesh === a.mesh) {
        old.asset = a;
        this.applyStyle(old);
        keep.add(a.id);
        continue;
      }
      if (old) { this.disposeItem(old); this.items.delete(a.id); }
      const it = this.makeItem(a, origin);
      if (it) { this.items.set(a.id, it); keep.add(a.id); }
    }
    for (const [id, it] of this.items) if (!keep.has(id)) { this.disposeItem(it); this.items.delete(id); }
  }

  private makeItem(a: MeshAsset, origin: Vec3): SolidItem | null {
    const local = toLocal(a.mesh, origin);
    if (local.index.length < 12) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(local.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(local.index, 1));
    geom.computeVertexNormals();
    geom.computeBoundingBox(); geom.computeBoundingSphere();
    const edgesGeom = new THREE.EdgesGeometry(geom, 32);
    const cx = (local.min[0] + local.max[0]) / 2, cz = (local.min[2] + local.max[2]) / 2;
    const kind: 'dig' | 'dump' = a.role === 'dump' ? 'dump' : 'dig';
    const mode: DepletionMode = a.block?.depletionMode ?? (kind === 'dig' ? 'bench-down' : 'bottom-up');
    const handle = prepareSolid(a.mesh);

    const col = new THREE.Color(a.color || (kind === 'dig' ? '#C79A6B' : '#7FA58E'));
    const rim = { value: col.clone().lerp(new THREE.Color('#ffffff'), 0.55) };
    const rimK = { value: 0.9 };
    const keepVis = new THREE.Plane(), keepGhost = new THREE.Plane();
    const base = {
      color: col, transparent: true, roughness: 0.55, metalness: 0.0, flatShading: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, clipShadows: true,
    };
    const frontM = new THREE.MeshStandardMaterial({ ...base, opacity: 0.52, side: THREE.FrontSide, clippingPlanes: [keepVis] });
    patchSolid(frontM, rim, rimK);
    const backM = new THREE.MeshStandardMaterial({ ...base, opacity: 0.3, side: THREE.BackSide, clippingPlanes: [keepVis] });
    patchSolid(backM, rim, rimK);
    const xrayM = new THREE.ShaderMaterial({
      vertexShader: XRAY_VS, fragmentShader: XRAY_FS, transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
      side: THREE.FrontSide, clipping: true, clippingPlanes: [keepVis],
      uniforms: { uColor: { value: col.clone() }, uAlpha: { value: 0.3 } },
    });
    const edgeM = new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color('#ffffff'), 0.35), transparent: true, opacity: 0.95, clippingPlanes: [keepVis], depthWrite: false });
    depthBias(edgeM);
    const ghostM = new THREE.LineDashedMaterial({ color: col.clone(), transparent: true, opacity: 0.55, dashSize: 4, gapSize: 3, clippingPlanes: [keepGhost], depthWrite: false });
    depthBias(ghostM);
    const ghostFillM = new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [keepGhost], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const capM = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.8, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.92, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    capM.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCapW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCapW = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCapW;').replace('#include <color_fragment>', `#include <color_fragment>
  {
    float s = (vCapW.x + vCapW.y * 1.0 + vCapW.z) / 3.2;
    float w = fwidth(s);
    float l = 1.0 - smoothstep(0.0, max(w * 1.2, 0.02), abs(fract(s) - 0.5) - 0.38);
    diffuseColor.rgb *= 1.0 - 0.22 * l * (1.0 - smoothstep(0.3, 0.8, w));
  }`);
    };
    capM.customProgramCacheKey = () => 'hk-cap-v1';
    const capLineM = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
    depthBias(capLineM, 0.0015);

    const group = new THREE.Group();
    group.name = `solid:${a.id}`;
    const xray = new THREE.Mesh(geom, xrayM); xray.renderOrder = 10;
    const back = new THREE.Mesh(geom, backM); back.renderOrder = 11;
    const front = new THREE.Mesh(geom, frontM); front.renderOrder = 12; front.castShadow = true; front.receiveShadow = true;
    const ghostFill = new THREE.Mesh(geom, ghostFillM); ghostFill.renderOrder = 9;
    const edges = new THREE.LineSegments(edgesGeom, edgeM); edges.renderOrder = 14;
    const ghost = new THREE.LineSegments(edgesGeom, ghostM); ghost.renderOrder = 13;
    ghost.computeLineDistances();
    const cap = new THREE.Mesh(new THREE.BufferGeometry(), capM); cap.renderOrder = 12; cap.castShadow = true; cap.receiveShadow = true;
    const capLine = new THREE.LineSegments(new THREE.BufferGeometry(), capLineM); capLine.renderOrder = 15;
    for (const o of [xray, back, front, ghostFill, edges, ghost, cap, capLine]) { o.userData.assetId = a.id; group.add(o); }
    // tag pickable body
    front.userData.pickKind = 'solid';
    this.ve.add(group);

    const label = document.createElement('div');
    label.className = css.solidLabel;
    label.innerHTML = `<div class="${css.slPill}"><i class="${css.slDot}"></i><b class="${css.slName}"></b><span class="${css.slPct}"></span></div>`
      + `<div class="${css.slCard}"><div class="${css.slTitle}"></div><div class="${css.slValue}"></div><div class="${css.slBar}"><i></i></div><div class="${css.slSub}"></div></div>`;
    const q = (c: string) => label.querySelector(`.${c}`) as HTMLElement;
    const parts = { title: q(css.slTitle), value: q(css.slValue), sub: q(css.slSub), bar: label.querySelector(`.${css.slBar} i`) as HTMLElement, name: q(css.slName), pct: q(css.slPct) };
    label.style.setProperty('--sl-c', a.color);
    label.addEventListener('pointerenter', () => this.onHover?.(a.id));
    label.addEventListener('pointerleave', () => this.onHover?.(null));
    label.addEventListener('click', e => { e.stopPropagation(); this.onPick?.(a.id); });
    this.labelLayer.appendChild(label);
    const anchor = new THREE.Vector3(cx, local.max[1], cz);
    const it: SolidItem = {
      asset: a, local, geom, edgesGeom, volume: handle.volume, handle, mode, az: a.block?.advanceAzimuthDeg ?? 0, kind, group,
      front, back, xray, edges, ghost, ghostFill, cap, capLine,
      mats: [frontM, backM, xrayM, edgeM, ghostM, ghostFillM, capM, capLineM], keepVis, keepGhost,
      fraction: 0, applied: -1, label, labelParts: parts, anchor, li: makeLabelItem(a.id, label), expanded: false,
      bcm: a.block?.plannedBcm ?? a.stats.volume ?? handle.volume,
    };
    this.applyStyle(it);
    this.applyFraction(it, 0, true);
    return it;
  }

  private applyStyle(it: SolidItem) {
    const sel = this.selected === it.asset.id;
    const vis = it.asset.visible !== false;
    it.group.visible = vis;
    it.li.enabled = vis && this.labelsOn && this.root.visible;
    const op = it.asset.opacity ?? 1;
    (it.front.material as THREE.MeshStandardMaterial).opacity = 0.5 * op + (sel ? 0.12 : 0);
    (it.back.material as THREE.MeshStandardMaterial).opacity = 0.28 * op;
    const dark = (this.pal?.def.stars ?? 0) > 0;
    ((it.xray.material as THREE.ShaderMaterial).uniforms.uAlpha.value as number) = (sel ? 0.42 : 0.28) * (dark ? 1.2 : 1);
    const em = it.edges.material as THREE.LineBasicMaterial;
    em.color.set(sel ? (dark ? '#79AEFF' : '#0A6FE6') : new THREE.Color(it.asset.color).lerp(new THREE.Color(dark ? '#ffffff' : '#3a3026'), dark ? 0.45 : 0.35));
    const capLine = it.capLine.material as THREE.LineBasicMaterial;
    capLine.color.set(dark ? '#FFE3A8' : '#FFFFFF');
    it.label.classList.toggle(css.slSel, sel);
    it.label.dataset.kind = it.kind;
    this.applyExpanded(it);
  }

  private applyExpanded(it: SolidItem) {
    const id = it.asset.id;
    const ex = this.selected === id || this.hovered === id || this.playingIds.has(id);
    if (ex !== it.expanded) { it.expanded = ex; it.label.classList.toggle(css.slOpen, ex); it.li.w = 0; }
  }

  /** Label interaction hooks (pill hover → store.hover, click → select). */
  setLabelHandlers(onPick: (id: string) => void, onHover: (id: string | null) => void) { this.onPick = onPick; this.onHover = onHover; }
  /** Hovered asset (store.hover) and assets whose labels expand while playing (selected circuit's dig/dump). */
  setLabelFocus(hovered: string | null, playing: Iterable<string>) {
    this.hovered = hovered;
    this.playingIds = new Set(playing);
    for (const it of this.items.values()) this.applyExpanded(it);
  }

  setTheme(p: Palette) { this.pal = p; for (const it of this.items.values()) this.applyStyle(it); }
  setSelected(id: string | null) { this.selected = id; for (const it of this.items.values()) this.applyStyle(it); }
  setLabels(on: boolean) { this.labelsOn = on; for (const it of this.items.values()) this.applyStyle(it); }
  setVisible(on: boolean) { this.root.visible = on; for (const it of this.items.values()) this.applyStyle(it); }

  /** Set done fractions (dug / placed) per asset id; recompute only when a fraction moved > 0.2 %. */
  setFractions(f: Map<string, number>, force = false): boolean {
    let changed = false;
    for (const it of this.items.values()) {
      const v = Math.max(0, Math.min(1, f.get(it.asset.id) ?? 0));
      it.fraction = v;
      if (force || Math.abs(v - it.applied) > 0.002 || ((v === 0 || v === 1) && v !== it.applied)) {
        this.applyFraction(it, v, force);
        changed = true;
      }
    }
    return changed;
  }

  private applyFraction(it: SolidItem, f: number, force: boolean) {
    it.applied = f;
    // '@/geom' convention: normal = direction the face moves; BACK side (n·p < c) is dug (dig) / placed (dump)
    const dp = depletionPlane(it.handle, it.mode, it.az, f);
    const n = dp.normal, o = this.origin;
    const nl = new THREE.Vector3(n[0], n[2], -n[1]).normalize();
    const d = dp.constant - (n[0] * o[0] + n[1] * o[1] + n[2] * o[2]);
    const eps = f <= 0 ? -1e-3 : f >= 1 ? 1e-3 : 0;
    // three keeps distance >= 0: front = n·p ≥ d, back = n·p ≤ d (local VE-1 space)
    const front = new THREE.Plane(nl.clone(), -(d + eps)), back = new THREE.Plane(nl.clone().negate(), d + eps);
    // dig shows what is still to dig (front); dump shows what has been placed (back)
    const vis = it.kind === 'dig' ? front : back, ghost = it.kind === 'dig' ? back : front;
    it.group.userData.localVis = vis.clone();
    it.group.userData.localGhost = ghost.clone();
    this.syncPlanes(it);
    const solidFrac = it.kind === 'dig' ? 1 - f : f;
    it.front.visible = it.back.visible = it.xray.visible = it.edges.visible = solidFrac > 1e-4;
    it.ghost.visible = it.ghostFill.visible = solidFrac < 1 - 1e-4;
    // cap at the cut
    const capOn = f > 1e-4 && f < 1 - 1e-4;
    it.cap.visible = it.capLine.visible = capOn;
    if (capOn) this.buildCap(it, dp);
    // label (wording: "38 % mined" / "38 % placed")
    const done = f * it.bcm;
    const P = it.labelParts;
    const pc = `${num(f * 100, 0)}\u202f%`;
    P.title.textContent = it.asset.name;
    P.name.textContent = it.asset.name;
    if (it.kind === 'dig') {
      P.value.textContent = `${num(it.bcm - done)} bcm`;
      P.sub.textContent = `remaining · ${pc} mined`;
      P.pct.textContent = `${pc} mined`;
    } else {
      P.value.textContent = `${num(done)} bcm`;
      P.sub.textContent = `of ${num(it.bcm)} bcm · ${pc} placed`;
      P.pct.textContent = `${pc} placed`;
    }
    P.bar.style.transform = `scaleX(${f.toFixed(4)})`;
    it.li.w = 0;
    // anchor: top of the remaining body near its centre
    const L = it.local;
    it.anchor.set((L.min[0] + L.max[0]) / 2, L.max[1], (L.min[2] + L.max[2]) / 2);
    if (it.kind === 'dump') it.anchor.y = L.min[1] + (L.max[1] - L.min[1]) * Math.max(0.15, f);
    void force;
  }

  /** Clipping planes are world-space: transform the local ones by the VE group matrix. */
  syncPlanes(it?: SolidItem) {
    this.ve.updateMatrixWorld(true);
    const list = it ? [it] : [...this.items.values()];
    for (const x of list) {
      const lv = x.group.userData.localVis as THREE.Plane | undefined, lg = x.group.userData.localGhost as THREE.Plane | undefined;
      if (lv) x.keepVis.copy(lv).applyMatrix4(this.ve.matrixWorld);
      if (lg) x.keepGhost.copy(lg).applyMatrix4(this.ve.matrixWorld);
    }
  }

  private buildCap(it: SolidItem, plane: { normal: Vec3; constant: number }) {
    const o = this.origin;
    let cap;
    try { cap = capLoops(it.handle, plane, it.kind === 'dig' ? 'front' : 'back'); } catch (e) { console.warn('[scene] cap failed', e); return; }
    const v = cap.mesh.verts, t = cap.mesh.tris;
    const pos = new Float32Array(t.length * 3);
    for (let k = 0; k < t.length; k++) {
      const i = t[k] * 3;
      pos[k * 3] = v[i] - o[0]; pos[k * 3 + 1] = v[i + 2] - o[2]; pos[k * 3 + 2] = -(v[i + 1] - o[1]);
    }
    const g = it.cap.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const lp: number[] = [];
    for (const loop of cap.loops) {
      const m = loop.length;
      for (let i = 0; i < m; i++) {
        const a = loop[i], b = loop[(i + 1) % m];
        lp.push(a[0] - o[0], a[2] - o[2], -(a[1] - o[1]), b[0] - o[0], b[2] - o[2], -(b[1] - o[1]));
      }
    }
    const lg = it.capLine.geometry;
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.computeBoundingSphere();
  }

  /**
   * Per frame: priorities (selected > hovered > dig > dump > volume), distance fade, POV/chase = selected only,
   * then greedy screen-space placement inside the safe rect.
   */
  updateLabels(camera: THREE.Camera, w: number, h: number, ve: number, insets: Insets, refDist: number, follow: boolean) {
    const list: LabelItem[] = [];
    const cam = camera.position;
    for (const it of this.items.values()) {
      const li = it.li;
      li.enabled = this.labelsOn && this.root.visible && it.asset.visible !== false && (!follow || this.selected === it.asset.id);
      li.anchor.set(it.anchor.x, it.anchor.y * ve, it.anchor.z);
      const id = it.asset.id;
      li.priority = (this.selected === id ? 1e9 : 0) + (this.hovered === id ? 1e8 : 0) + (it.kind === 'dig' ? 1e7 : 0) + Math.min(9e6, it.bcm / 10);
      const d = li.anchor.distanceTo(cam);
      li.alpha = this.selected === id || this.hovered === id ? 1 : 1 - THREE.MathUtils.smoothstep(d, refDist * 1.5, refDist * 2.6);
      list.push(li);
    }
    this.placer.place(list, camera, w, h, insets);
  }

  drawLeaders(ctx: CanvasRenderingContext2D) {
    const dark = (this.pal?.def.stars ?? 0) > 0;
    const list = [...this.items.values()].map(i => i.li);
    this.placer.drawLeaders(ctx, list, dark ? 'rgba(233,237,242,0.75)' : 'rgba(31,35,41,0.55)', dark ? 'rgba(14,17,22,0.7)' : 'rgba(255,255,255,0.9)',
      li => this.items.get(li.id)?.asset.color ?? '#888');
  }

  /** Local meshes for section cuts. */
  locals(): { local: LocalMesh; color: string; id: string }[] {
    return [...this.items.values()].filter(i => i.asset.visible !== false).map(i => ({ local: i.local, color: i.asset.color, id: i.asset.id }));
  }

  pickables(): THREE.Object3D[] { return [...this.items.values()].filter(i => i.group.visible).map(i => i.front); }

  dispose() { this.clear(); }
}
