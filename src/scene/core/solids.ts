/**
 * Dig / dump solids with live depletion — the shift's work is the hero of playback.
 *  - dig blocks: a translucent volume (sides shaded darker than the top, fresnel rim, crisp visible edges, hidden
 *    edges and faces as an x-ray hatch through the terrain) for what is still to dig; the terrain itself is carved
 *    where the block has been dug (carve.ts) and recoloured cut-blue; the volume mined THIS period is a bright
 *    luminous slab on the advancing face (between the period-start plane and the face), with a glowing face line;
 *    older dug volume is a faint dashed ghost;
 *  - dump lifts: the placed part is an opaque, lit, shadow-casting mesh (fresh material of this period a lighter
 *    tint, cap on the tip face); what is still to place is a faint dashed ghost;
 *  - depletion: a plane moved through the solid so the dug / placed volume equals the fraction ('@/geom'
 *    depletionPlane convention: normal = direction the face moves, BACK side = done). GPU clipping planes cut
 *    the bodies; cut faces are capped;
 *  - one label per block in the shared label service: a pill with a "+7,050 bcm this shift" counter while the
 *    block is active, a full card on hover / selection / playing.
 */
import * as THREE from 'three';
import type { DepletionMode, MeshAsset, Vec3 } from '@/core/types';
import { num } from '@/core/format';
import { capLoops, depletionPlane, prepareSolid, type SolidHandle } from '@/geom';
import { toLocal, type LocalMesh } from './meshUtil';
import { makeLabelItem, type LabelItem, type LabelService } from './labels';
import type { CarveAtlas } from './carve';
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
  // world-up faces lighter than the sides: the hidden body still reads as a box
  float up = inverseTransformDirection(n, viewMatrix).y;
  float shade = mix(0.7, 1.15, smoothstep(-0.2, 0.85, abs(up)));
  // diagonal screen hatch so the hidden body reads as "inside the ground"
  float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
  float a = uAlpha * (0.45 + 0.55 * fr) * (0.7 + 0.3 * hatch);
  gl_FragColor = vec4(uColor * shade * (0.85 + 0.5 * fr), a);
  #include <colorspace_fragment>
}`;

/** Depletion state of one solid for the current timeline position. */
export interface SolidDepletion {
  /** Done fraction now (dug / placed). */
  f: number;
  /** Done fraction at the start of the highlighted period (this shift / the trailing shift). */
  f0: number;
  /** bcm the counter shows (+X bcm this shift / this week / to date). */
  delta: number;
  period: 'shift' | 'week' | 'completion';
}

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
  xedges: THREE.LineSegments;
  ghost: THREE.LineSegments;
  ghostFill: THREE.Mesh;
  slab: THREE.Mesh;
  slabBack: THREE.Mesh;
  slabEdges: THREE.LineSegments;
  cap: THREE.Mesh;
  capLine: THREE.LineSegments;
  cap0: THREE.Mesh;
  mats: THREE.Material[];
  /** Local (VE-1) planes; world copies are synced into the materials' clipping arrays. */
  lVis: THREE.Plane; lGhost: THREE.Plane; lSlabA: THREE.Plane; lSlabB: THREE.Plane; lFresh: THREE.Plane;
  keepVis: THREE.Plane; keepGhost: THREE.Plane; slabA: THREE.Plane; slabB: THREE.Plane; fresh: THREE.Plane;
  freshU: { value: THREE.Vector4 };
  fraction: number;
  applied: number;
  appliedF0: number;
  dep: SolidDepletion;
  label: HTMLDivElement;
  labelParts: { title: HTMLElement; value: HTMLElement; sub: HTMLElement; bar: HTMLElement; name: HTMLElement; pct: HTMLElement; delta: HTMLElement; deltaRow: HTMLElement };
  anchor: THREE.Vector3;
  li: LabelItem;
  expanded: boolean;
  bcm: number;
  /** Face loop at the cut (local VE-1 xyz pairs per segment) for the overlay face line. */
  faceLine: Float32Array;
  faceN: number;
  active: boolean;
}

const CUT_FRESH = new THREE.Color('#5FA8FF');
const FILL_FRESH = new THREE.Color('#BFE3B8');

function patchSolid(m: THREE.MeshStandardMaterial, rim: { value: THREE.Color }, rimK: { value: number }, fresh?: { value: THREE.Vector4 }, freshCol?: THREE.Color) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = rim; sh.uniforms.uRimK = rimK;
    if (fresh) { sh.uniforms.uFresh = fresh; sh.uniforms.uFreshCol = { value: freshCol }; }
    if (fresh) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uRim; uniform float uRimK;${fresh ? '\nuniform vec4 uFresh; uniform vec3 uFreshCol; varying vec3 vWPos;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${fresh ? `
  {
    // material placed this period: a lighter, fresher tint
    float fr0 = smoothstep(-0.15, 0.15, dot(uFresh.xyz, vWPos) + uFresh.w);
    diffuseColor.rgb = mix(diffuseColor.rgb, uFreshCol, fr0 * 0.55);
  }` : ''}`)
      .replace('#include <opaque_fragment>', `
  {
    // volumes: sides darker than tops (whatever the sun), plus a fresnel rim
    float up = inverseTransformDirection(normal, viewMatrix).y;
    outgoingLight *= mix(0.58, 1.0, smoothstep(-0.1, 0.8, up));
    float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.4);
    outgoingLight += uRim * fr * uRimK;
    diffuseColor.a = clamp(diffuseColor.a + fr * 0.35 * uRimK, 0.0, 1.0);
  }
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => (fresh ? 'hk-solid-fresh-v2' : 'hk-solid-v2');
}

function depthBias(m: THREE.Material, k = 0.0008) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\ngl_Position.z -= ${k.toFixed(5)} * gl_Position.w;`);
  };
}

function hatchCap(m: THREE.MeshStandardMaterial, key: string) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCapW;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCapW = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCapW;').replace('#include <color_fragment>', `#include <color_fragment>
  {
    float s = (vCapW.x + vCapW.y * 1.0 + vCapW.z) / 3.2;
    float w = fwidth(s);
    float l = 1.0 - smoothstep(0.0, max(w * 1.2, 0.02), abs(fract(s) - 0.5) - 0.38);
    diffuseColor.rgb *= 1.0 - 0.22 * l * (1.0 - smoothstep(0.3, 0.8, w));
  }`);
  };
  m.customProgramCacheKey = () => key;
}

export class SolidsLayer {
  readonly root = new THREE.Group();
  readonly ve = new THREE.Group();
  items = new Map<string, SolidItem>();
  private labelLayer: HTMLDivElement;
  private labels: LabelService;
  private carve: CarveAtlas;
  private selected: string | null = null;
  private pal: Palette | null = null;
  private labelsOn = true;
  private hovered: string | null = null;
  private playingIds = new Set<string>();
  private onPick: ((id: string) => void) | null = null;
  private onHover: ((id: string | null) => void) | null = null;
  private origin: Vec3 = [0, 0, 0];
  private night = 0;
  private pv = new THREE.Vector3();

  constructor(labelLayer: HTMLDivElement, labels: LabelService, carve: CarveAtlas) {
    this.labelLayer = labelLayer;
    this.labels = labels;
    this.carve = carve;
    this.root.name = 'solids-core';
    this.root.add(this.ve);
  }

  clear() {
    for (const it of this.items.values()) this.disposeItem(it);
    this.items.clear();
  }

  private disposeItem(it: SolidItem) {
    this.ve.remove(it.group);
    it.geom.dispose(); it.edgesGeom.dispose(); it.cap.geometry.dispose(); it.capLine.geometry.dispose(); it.cap0.geometry.dispose();
    for (const m of it.mats) m.dispose();
    this.labels.delete(it.li);
    it.label.remove();
  }

  /** Rebuild from the dig/dump solid assets. Existing items whose mesh is unchanged are kept. */
  build(assets: MeshAsset[], origin: Vec3) {
    const sameOrigin = origin[0] === this.origin[0] && origin[1] === this.origin[1] && origin[2] === this.origin[2];
    this.origin = origin;
    const keep = new Set<string>();
    for (const a of assets) {
      const old = this.items.get(a.id);
      if (old && sameOrigin && old.asset.mesh === a.mesh && (old.asset.role === 'dump') === (a.role === 'dump')) {
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
    this.carve.build([...this.items.values()].map(i => ({ id: i.asset.id, kind: i.kind, local: i.local, volume: i.volume })));
    for (const it of this.items.values()) { it.applied = -1; this.applyFraction(it, it.dep, true); }
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
    const rimK = { value: kind === 'dig' ? 0.9 : 0.25 };
    const lVis = new THREE.Plane(), lGhost = new THREE.Plane(), lSlabA = new THREE.Plane(), lSlabB = new THREE.Plane(), lFresh = new THREE.Plane();
    const keepVis = new THREE.Plane(), keepGhost = new THREE.Plane(), slabA = new THREE.Plane(), slabB = new THREE.Plane(), fresh = new THREE.Plane();
    const freshU = { value: new THREE.Vector4(0, 0, 0, -1e9) };
    const dig = kind === 'dig';
    // body: dig = translucent volume, dump = opaque lit lift (casts / receives shadows like ground)
    const frontM = new THREE.MeshStandardMaterial({
      color: col, roughness: dig ? 0.55 : 0.92, metalness: 0, flatShading: true, side: THREE.FrontSide, clippingPlanes: [keepVis], clipShadows: true,
      transparent: dig, opacity: dig ? 0.5 : 1, depthWrite: !dig, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    });
    patchSolid(frontM, rim, rimK, dig ? undefined : freshU, dig ? undefined : FILL_FRESH.clone().lerp(col, 0.25));
    const backM = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.55, metalness: 0, flatShading: true, side: THREE.BackSide, clippingPlanes: [keepVis], clipShadows: true,
      transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    });
    patchSolid(backM, rim, rimK);
    const xrayM = new THREE.ShaderMaterial({
      vertexShader: XRAY_VS, fragmentShader: XRAY_FS, transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
      side: THREE.FrontSide, clipping: true, clippingPlanes: [keepVis],
      uniforms: { uColor: { value: col.clone() }, uAlpha: { value: 0.3 } },
    });
    const edgeM = new THREE.LineBasicMaterial({ color: col.clone(), transparent: true, opacity: 1, clippingPlanes: [keepVis], depthWrite: false });
    depthBias(edgeM);
    const xedgeM = new THREE.LineDashedMaterial({ color: col.clone(), transparent: true, opacity: 0.42, dashSize: 3, gapSize: 3, clippingPlanes: [keepVis], depthWrite: false, depthFunc: THREE.GreaterDepth });
    const ghostM = new THREE.LineDashedMaterial({ color: col.clone(), transparent: true, opacity: 0.55, dashSize: 4, gapSize: 3, clippingPlanes: [keepGhost], depthWrite: false });
    depthBias(ghostM);
    const ghostFillM = new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: dig ? 0.05 : 0.09, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [keepGhost], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    // this period's mined volume: a luminous cut-blue slab on the advancing face
    const slabM = new THREE.MeshStandardMaterial({
      color: CUT_FRESH, emissive: CUT_FRESH, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0, flatShading: true, side: THREE.FrontSide,
      transparent: true, opacity: 0.62, depthWrite: false, clippingPlanes: [slabA, slabB], polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8,
    });
    patchSolid(slabM, { value: new THREE.Color('#E8F3FF') }, { value: 1.2 });
    const slabBackM = new THREE.MeshStandardMaterial({
      color: CUT_FRESH.clone().multiplyScalar(0.6), emissive: CUT_FRESH, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0, flatShading: true, side: THREE.BackSide,
      transparent: true, opacity: 0.5, depthWrite: false, clippingPlanes: [slabA, slabB],
    });
    const slabEdgeM = new THREE.LineBasicMaterial({ color: '#EAF4FF', transparent: true, opacity: 0.95, clippingPlanes: [slabA, slabB], depthWrite: false });
    depthBias(slabEdgeM, 0.0012);
    const capM = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(dig ? 0.8 : 0.92), roughness: 0.85, metalness: 0, side: THREE.DoubleSide, transparent: dig, opacity: dig ? 0.94 : 1, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    hatchCap(capM, 'hk-cap-v1');
    const cap0M = new THREE.MeshStandardMaterial({ color: CUT_FRESH, emissive: CUT_FRESH, emissiveIntensity: 0.5, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 });
    const capLineM = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
    depthBias(capLineM, 0.0015);

    const group = new THREE.Group();
    group.name = `solid:${a.id}`;
    const xray = new THREE.Mesh(geom, xrayM); xray.renderOrder = 10;
    const back = new THREE.Mesh(geom, backM); back.renderOrder = 11; back.visible = dig;
    const front = new THREE.Mesh(geom, frontM); front.renderOrder = dig ? 12 : 0; front.castShadow = true; front.receiveShadow = true;
    const ghostFill = new THREE.Mesh(geom, ghostFillM); ghostFill.renderOrder = 9;
    const edges = new THREE.LineSegments(edgesGeom, edgeM); edges.renderOrder = 14;
    const xedges = new THREE.LineSegments(edgesGeom, xedgeM); xedges.renderOrder = 13;
    xedges.computeLineDistances();
    const ghost = new THREE.LineSegments(edgesGeom, ghostM); ghost.renderOrder = 13;
    ghost.computeLineDistances();
    const slabBack = new THREE.Mesh(geom, slabBackM); slabBack.renderOrder = 15;
    const slab = new THREE.Mesh(geom, slabM); slab.renderOrder = 16;
    const slabEdges = new THREE.LineSegments(edgesGeom, slabEdgeM); slabEdges.renderOrder = 17;
    const cap = new THREE.Mesh(new THREE.BufferGeometry(), capM); cap.renderOrder = dig ? 12 : 1; cap.castShadow = true; cap.receiveShadow = true;
    const cap0 = new THREE.Mesh(new THREE.BufferGeometry(), cap0M); cap0.renderOrder = 16;
    const capLine = new THREE.LineSegments(new THREE.BufferGeometry(), capLineM); capLine.renderOrder = 18;
    for (const o of [xray, back, front, ghostFill, edges, xedges, ghost, slabBack, slab, slabEdges, cap, cap0, capLine]) { o.userData.assetId = a.id; group.add(o); }
    front.userData.pickKind = 'solid';
    this.ve.add(group);

    const label = document.createElement('div');
    label.className = css.solidLabel;
    label.innerHTML = `<div class="${css.slPill}"><i class="${css.slDot}"></i><b class="${css.slName}"></b><span class="${css.slPct}"></span><span class="${css.slDelta}"></span></div>`
      + `<div class="${css.slCard}"><div class="${css.slTitle}"></div><div class="${css.slValue}"></div><div class="${css.slBar}"><i></i></div><div class="${css.slSub}"></div><div class="${css.slDeltaRow}"></div></div>`;
    const q = (c: string) => label.querySelector(`.${c}`) as HTMLElement;
    const parts = { title: q(css.slTitle), value: q(css.slValue), sub: q(css.slSub), bar: label.querySelector(`.${css.slBar} i`) as HTMLElement, name: q(css.slName), pct: q(css.slPct), delta: q(css.slDelta), deltaRow: q(css.slDeltaRow) };
    label.style.setProperty('--sl-c', a.color);
    label.dataset.kind = kind;
    label.addEventListener('pointerenter', () => this.onHover?.(a.id));
    label.addEventListener('pointerleave', () => this.onHover?.(null));
    label.addEventListener('click', e => { e.stopPropagation(); this.onPick?.(a.id); });
    this.labelLayer.appendChild(label);
    const li = makeLabelItem(`block:${a.id}`, label);
    li.color = a.color || '#888';
    this.labels.add(li);
    const anchor = new THREE.Vector3(cx, local.max[1], cz);
    const it: SolidItem = {
      asset: a, local, geom, edgesGeom, volume: handle.volume, handle, mode, az: a.block?.advanceAzimuthDeg ?? 0, kind, group,
      front, back, xray, edges, xedges, ghost, ghostFill, slab, slabBack, slabEdges, cap, capLine, cap0,
      mats: [frontM, backM, xrayM, edgeM, xedgeM, ghostM, ghostFillM, slabM, slabBackM, slabEdgeM, capM, cap0M, capLineM],
      lVis, lGhost, lSlabA, lSlabB, lFresh, keepVis, keepGhost, slabA, slabB, fresh, freshU,
      fraction: 0, applied: -1, appliedF0: -1, dep: { f: 0, f0: 0, delta: 0, period: 'shift' }, label, labelParts: parts, anchor, li, expanded: false,
      bcm: a.block?.plannedBcm ?? a.stats.volume ?? handle.volume,
      faceLine: new Float32Array(0), faceN: 0, active: false,
    };
    this.applyStyle(it);
    return it;
  }

  private applyStyle(it: SolidItem) {
    const sel = this.selected === it.asset.id;
    const vis = it.asset.visible !== false;
    it.group.visible = vis;
    it.li.enabled = vis && this.labelsOn && this.root.visible;
    const op = it.asset.opacity ?? 1;
    const dig = it.kind === 'dig';
    const fm = it.front.material as THREE.MeshStandardMaterial;
    if (dig) fm.opacity = 0.5 * op + (sel ? 0.12 : 0);
    else { fm.transparent = op < 0.999; fm.opacity = op; fm.depthWrite = op >= 0.999; }
    (it.back.material as THREE.MeshStandardMaterial).opacity = 0.28 * op;
    const dark = (this.pal?.def.stars ?? 0) > 0;
    ((it.xray.material as THREE.ShaderMaterial).uniforms.uAlpha.value as number) = (sel ? 0.42 : 0.28) * (dark ? 1.2 : 1);
    const em = it.edges.material as THREE.LineBasicMaterial;
    // crisp top edge: darker ink of the block colour by day, lighter at night / dark theme
    em.color.set(sel ? (dark ? '#79AEFF' : '#0A6FE6') : new THREE.Color(it.asset.color).lerp(new THREE.Color(dark || this.night > 0.5 ? '#ffffff' : '#2a221b'), dark ? 0.45 : 0.5));
    (it.xedges.material as THREE.LineDashedMaterial).color.copy(em.color);
    const capLine = it.capLine.material as THREE.LineBasicMaterial;
    capLine.color.set(dark ? '#FFE3A8' : '#FFFFFF');
    it.label.classList.toggle(css.slSel, sel);
    this.applyExpanded(it);
  }

  private applyExpanded(it: SolidItem) {
    const id = it.asset.id;
    const ex = this.selected === id || this.hovered === id || this.playingIds.has(id);
    if (ex !== it.expanded) { it.expanded = ex; it.label.classList.toggle(css.slOpen, ex); }
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
  setNight(n: number) { if (Math.abs(n - this.night) > 0.05) { this.night = n; for (const it of this.items.values()) this.applyStyle(it); } }
  setSelected(id: string | null) { this.selected = id; for (const it of this.items.values()) this.applyStyle(it); }
  setLabels(on: boolean) { this.labelsOn = on; for (const it of this.items.values()) this.applyStyle(it); }
  setVisible(on: boolean) {
    this.root.visible = on;
    for (const it of this.items.values()) { this.applyStyle(it); this.pushCarve(it); }
  }

  /** Set depletion per asset id; recompute only when a fraction moved > 0.2 % (or the period start moved). */
  setDepletion(map: Map<string, SolidDepletion>, force = false): boolean {
    let changed = false;
    for (const it of this.items.values()) {
      const d = map.get(it.asset.id);
      const f = Math.max(0, Math.min(1, d?.f ?? 0)), f0 = Math.max(0, Math.min(f, d?.f0 ?? 0));
      const delta = d?.delta ?? 0, period = d?.period ?? 'shift';
      const dep = it.dep;
      // counter text moves in 10 bcm steps (no DOM churn every frame)
      const textChanged = Math.round(delta / 10) !== Math.round(dep.delta / 10) || period !== dep.period;
      dep.f = f; dep.f0 = f0; dep.delta = delta; dep.period = period;
      it.fraction = f;
      if (force || Math.abs(f - it.applied) > 0.002 || Math.abs(f0 - it.appliedF0) > 0.002 || ((f === 0 || f === 1) && f !== it.applied) || (f0 === 0 && it.appliedF0 !== 0)) {
        this.applyFraction(it, dep, force);
        changed = true;
      } else if (textChanged) this.applyText(it);
    }
    return changed;
  }

  /** Legacy: plain done fractions (no period slab). */
  setFractions(f: Map<string, number>, force = false): boolean {
    const m = new Map<string, SolidDepletion>();
    for (const [k, v] of f) m.set(k, { f: v, f0: 0, delta: 0, period: 'shift' });
    return this.setDepletion(m, force);
  }

  private planeOf(it: SolidItem, f: number) {
    const dp = depletionPlane(it.handle, it.mode, it.az, f);
    const n = dp.normal, o = this.origin;
    return { dp, n, d: dp.constant - (n[0] * o[0] + n[1] * o[1] + n[2] * o[2]) };
  }

  private applyFraction(it: SolidItem, dep: SolidDepletion, force: boolean) {
    const f = dep.f, f0 = dep.f0;
    it.applied = f; it.appliedF0 = f0;
    // '@/geom' convention: normal = direction the face moves; BACK side (n·p < c) is dug (dig) / placed (dump)
    const P = this.planeOf(it, f);
    const P0 = f0 > 1e-4 ? this.planeOf(it, f0) : null;
    const n = P.n;
    const nl = this.pv.set(n[0], n[2], -n[1]).normalize();
    const eps = f <= 0 ? -1e-3 : f >= 1 ? 1e-3 : 0;
    const d = P.d + eps, d0 = P0 ? P0.d : -Infinity;
    const dig = it.kind === 'dig';
    // three keeps distance ≥ 0: "front of c" = n·p ≥ c, "back of c" = n·p ≤ c (local VE-1 space)
    const setFront = (pl: THREE.Plane, c: number) => pl.set(nl, -c);
    const setBack = (pl: THREE.Plane, c: number) => { pl.normal.copy(nl).negate(); pl.constant = c; };
    if (dig) {
      setFront(it.lVis, d);                         // still to dig
      if (P0) setBack(it.lGhost, d0); else setBack(it.lGhost, -1e9); // dug before this period
      if (P0) setFront(it.lSlabA, d0); else setFront(it.lSlabA, -1e9);
      setBack(it.lSlabB, d);                        // slab = [f0, f]
      setFront(it.lFresh, 1e9);
    } else {
      setBack(it.lVis, d);                          // placed
      setFront(it.lGhost, d);                       // still to place
      if (P0) setFront(it.lFresh, d0); else setFront(it.lFresh, -1e9);
      setFront(it.lSlabA, 1e9); setBack(it.lSlabB, -1e9);
    }
    this.syncPlanes(it);
    const solidFrac = dig ? 1 - f : f;
    it.front.visible = it.xray.visible = it.edges.visible = it.xedges.visible = solidFrac > 1e-4;
    it.back.visible = dig && solidFrac > 1e-4;
    const ghostOn = dig ? f0 > 1e-4 : f < 1 - 1e-4;
    it.ghost.visible = it.ghostFill.visible = ghostOn;
    const slabOn = dig && f - f0 > 1e-4;
    it.slab.visible = it.slabBack.visible = it.slabEdges.visible = slabOn;
    it.active = f - f0 > 1e-4;
    // cap at the cut (+ the period-start face of the slab)
    const capOn = f > 1e-4 && f < 1 - 1e-4;
    it.cap.visible = it.capLine.visible = capOn;
    if (capOn) this.buildCap(it, P.dp); else it.faceN = 0;
    const cap0On = dig && !!P0 && f0 < 1 - 1e-4 && slabOn;
    it.cap0.visible = cap0On;
    if (cap0On && P0) this.buildCap0(it, P0.dp);
    this.pushCarve(it, n, P.d + (f <= 0 ? -0.05 : f >= 1 ? 0.05 : 0), P0 ? P0.d : (f > 0 ? this.planeOf(it, 0).d - 0.05 : -1e9));
    this.applyText(it);
    // anchor: top of the remaining body near its centre (dump: top of what is placed)
    const L = it.local;
    it.anchor.set((L.min[0] + L.max[0]) / 2, L.max[1], (L.min[2] + L.max[2]) / 2);
    if (!dig) it.anchor.y = L.min[1] + (L.max[1] - L.min[1]) * Math.max(0.15, f);
    void force;
  }

  private carveArgs = new Map<string, { n: [number, number, number]; c: number; c0: number }>();
  /** Push (or re-push after a visibility change) the solid's plane to the terrain carve atlas. */
  private pushCarve(it: SolidItem, n?: Vec3, c?: number, c0?: number) {
    let a = this.carveArgs.get(it.asset.id);
    if (n && c !== undefined && c0 !== undefined) {
      if (!a) { a = { n: [0, 0, 1], c: 0, c0: 0 }; this.carveArgs.set(it.asset.id, a); }
      a.n[0] = n[0]; a.n[1] = n[1]; a.n[2] = n[2]; a.c = c; a.c0 = c0;
    }
    if (!a) return;
    this.carve.setPlane(it.asset.id, a.n, a.c, a.c0, this.root.visible && it.asset.visible !== false);
  }

  private applyText(it: SolidItem) {
    const dep = it.dep, f = dep.f;
    const done = f * it.bcm;
    const P = it.labelParts;
    const pc = `${num(f * 100, f > 0 && f < 0.01 ? 1 : 0)} %`;
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
    const active = dep.delta >= 1 && f > 0;
    const when = dep.period === 'shift' ? 'this shift' : dep.period === 'week' ? 'this week' : 'to date';
    const txt = active ? `+${num(dep.delta)} bcm` : '';
    P.delta.textContent = txt;
    P.delta.dataset.when = when;
    P.deltaRow.textContent = active ? `+${num(dep.delta)} bcm ${it.kind === 'dig' ? 'mined' : 'placed'} ${when}` : '';
    it.label.classList.toggle(css.slActive, active);
    P.bar.style.transform = `scaleX(${f.toFixed(4)})`;
  }

  /** Clipping planes are world-space: transform the local ones by the VE group matrix. */
  syncPlanes(it?: SolidItem) {
    this.ve.updateMatrixWorld(true);
    const m = this.ve.matrixWorld;
    const one = (x: SolidItem) => {
      x.keepVis.copy(x.lVis).applyMatrix4(m);
      x.keepGhost.copy(x.lGhost).applyMatrix4(m);
      x.slabA.copy(x.lSlabA).applyMatrix4(m);
      x.slabB.copy(x.lSlabB).applyMatrix4(m);
      x.fresh.copy(x.lFresh).applyMatrix4(m);
      x.freshU.value.set(x.fresh.normal.x, x.fresh.normal.y, x.fresh.normal.z, x.fresh.constant);
    };
    if (it) one(it);
    else for (const x of this.items.values()) one(x);
  }

  private capGeom(it: SolidItem, plane: { normal: Vec3; constant: number }, keep: 'front' | 'back', target: THREE.Mesh) {
    const o = this.origin;
    let cap;
    try { cap = capLoops(it.handle, plane, keep); } catch (e) { console.warn('[scene] cap failed', e); return null; }
    const v = cap.mesh.verts, t = cap.mesh.tris;
    const pos = new Float32Array(t.length * 3);
    for (let k = 0; k < t.length; k++) {
      const i = t[k] * 3;
      pos[k * 3] = v[i] - o[0]; pos[k * 3 + 1] = v[i + 2] - o[2]; pos[k * 3 + 2] = -(v[i + 1] - o[1]);
    }
    const g = target.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return cap;
  }

  private buildCap(it: SolidItem, plane: { normal: Vec3; constant: number }) {
    const cap = this.capGeom(it, plane, it.kind === 'dig' ? 'front' : 'back', it.cap);
    if (!cap) return;
    const o = this.origin;
    let n = 0;
    for (const loop of cap.loops) n += loop.length;
    const lp = new Float32Array(n * 6);
    let k = 0;
    for (const loop of cap.loops) {
      const m = loop.length;
      for (let i = 0; i < m; i++) {
        const a = loop[i], b = loop[(i + 1) % m];
        lp[k++] = a[0] - o[0]; lp[k++] = a[2] - o[2]; lp[k++] = -(a[1] - o[1]);
        lp[k++] = b[0] - o[0]; lp[k++] = b[2] - o[2]; lp[k++] = -(b[1] - o[1]);
      }
    }
    const lg = it.capLine.geometry;
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.computeBoundingSphere();
    it.faceLine = lp;
    it.faceN = n;
  }

  private buildCap0(it: SolidItem, plane: { normal: Vec3; constant: number }) { this.capGeom(it, plane, 'front', it.cap0); }

  /**
   * Per frame: priorities (selected 100 > hovered 90 > block 50, digs and big blocks first on ties), distance fade,
   * POV/chase = selected only. Placement itself happens in the shared label service.
   */
  updateLabels(camera: THREE.Camera, ve: number, refDist: number, follow: boolean) {
    const cam = camera.position;
    for (const it of this.items.values()) {
      const li = it.li;
      const id = it.asset.id;
      li.enabled = this.labelsOn && this.root.visible && it.asset.visible !== false && (!follow || this.selected === id);
      li.anchor.set(it.anchor.x, it.anchor.y * ve, it.anchor.z);
      li.priority = this.selected === id ? 100 : this.hovered === id ? 90 : 50 + (it.kind === 'dig' ? 0.5 : 0) + (it.active ? 0.3 : 0) + Math.min(0.15, it.bcm / 1e7);
      const d = li.anchor.distanceTo(cam);
      li.alpha = this.selected === id || this.hovered === id || it.active ? 1 : 1 - THREE.MathUtils.smoothstep(d, refDist * 1.5, refDist * 2.6);
    }
  }

  /** Glowing advancing-face lines (overlay, CSS px) for blocks that moved this period. */
  drawFaces(ctx: CanvasRenderingContext2D, camera: THREE.Camera, w: number, h: number, ve: number) {
    const v = this.pv;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const it of this.items.values()) {
      if (!it.active || !it.faceN || !it.cap.visible || it.asset.visible === false) continue;
      const L = it.faceLine;
      ctx.beginPath();
      let any = false;
      for (let k = 0; k < it.faceN; k++) {
        const o = k * 6;
        v.set(L[o], L[o + 1] * ve, L[o + 2]).project(camera);
        if (v.z > 1 || v.z < -1) continue;
        const x0 = (v.x * 0.5 + 0.5) * w, y0 = (-v.y * 0.5 + 0.5) * h;
        v.set(L[o + 3], L[o + 4] * ve, L[o + 5]).project(camera);
        if (v.z > 1 || v.z < -1) continue;
        ctx.moveTo(x0, y0); ctx.lineTo((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h);
        any = true;
      }
      if (!any) continue;
      const dig = it.kind === 'dig';
      ctx.strokeStyle = dig ? 'rgba(95,168,255,0.35)' : 'rgba(150,205,140,0.35)'; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = dig ? '#2F7EEA' : '#4E9A55'; ctx.lineWidth = 1.6; ctx.stroke();
    }
  }

  /** Working-face positions (local VE-1) for the night lighting-plant pools: digs first, then dumps. */
  glowSpots(): { x: number; y: number; z: number; r: number }[] {
    const out: { x: number; y: number; z: number; r: number }[] = [];
    const items = [...this.items.values()].filter(i => i.asset.visible !== false).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dig' ? -1 : 1));
    for (const it of items) {
      const L = it.local;
      const span = Math.max(L.max[0] - L.min[0], L.max[2] - L.min[2]);
      const c = it.cap.visible && it.cap.geometry.boundingSphere ? it.cap.geometry.boundingSphere.center : null;
      out.push({ x: c ? c.x : it.anchor.x, y: c ? c.y : L.max[1], z: c ? c.z : it.anchor.z, r: Math.min(170, Math.max(60, span * 0.42)) });
    }
    return out.slice(0, 8);
  }

  /** Local meshes for section cuts. */
  locals(): { local: LocalMesh; color: string; id: string }[] {
    return [...this.items.values()].filter(i => i.asset.visible !== false).map(i => ({ local: i.local, color: i.asset.color, id: i.asset.id }));
  }

  pickables(): THREE.Object3D[] { return [...this.items.values()].filter(i => i.group.visible).map(i => i.front); }

  dispose() { this.clear(); }
}
