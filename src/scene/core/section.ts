/**
 * Section plane: when store.section is set, a vertical A–B wall (subtle translucent tint with RL/chainage grid
 * fading upward), end poles with A/B chips, and bright cut lines where the plane meets the terrain (sampled from
 * the height grid, haloed fat line) and the solids (plane slices in their colours).
 */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Vec3 } from '@/core/types';
import type { HeightGrid } from './heightGrid';
import { sliceSegments, type LocalMesh } from './meshUtil';
import type { Palette } from './theme';
import css from './core.module.css';

const WALL_VS = /* glsl */ `
varying vec2 vUV; varying vec3 vL;
void main() { vUV = uv; vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WALL_FS = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uLen; uniform float uZ0; uniform float uTopY; uniform float uBotY;
varying vec2 vUV; varying vec3 vL;
void main() {
  float ch = vUV.x * uLen;
  float rl = vL.y + uZ0;
  vec2 g = vec2(ch / 25.0, rl / 10.0);
  vec2 gw = fwidth(g);
  vec2 gd = abs(fract(g - 0.5) - 0.5) / max(gw, vec2(1e-5));
  float line = 1.0 - smoothstep(0.4, 1.2, min(gd.x, gd.y));
  float hgt = clamp((vL.y - uBotY) / max(uTopY - uBotY, 1.0), 0.0, 1.0);
  float a = uAlpha * (1.0 - smoothstep(0.55, 1.0, hgt)) * (0.55 + 0.45 * (1.0 - hgt));
  a += line * 0.18 * (1.0 - smoothstep(0.6, 1.0, hgt));
  // bright edges at the ends
  float ends = 1.0 - smoothstep(0.0, 2.5 * fwidth(vUV.x * uLen), min(ch, uLen - ch));
  a = max(a, ends * 0.6 * (1.0 - hgt));
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export class SectionLayer {
  readonly root = new THREE.Group();
  readonly ve = new THREE.Group();
  private wallMat: THREE.ShaderMaterial;
  private haloMat: LineMaterial;
  private cutMat: LineMaterial;
  private solidMats: LineMaterial[] = [];
  private poleMat: THREE.LineBasicMaterial;
  private dotMat: THREE.MeshBasicMaterial;
  private objs: THREE.Object3D[] = [];
  private labels: HTMLDivElement[] = [];
  private anchors: THREE.Vector3[] = [];
  private labelLayer: HTMLDivElement;
  private accent = new THREE.Color('#0A6FE6');
  private dark = false;

  constructor(labelLayer: HTMLDivElement) {
    this.labelLayer = labelLayer;
    this.root.name = 'section-core';
    this.root.add(this.ve);
    this.wallMat = new THREE.ShaderMaterial({
      vertexShader: WALL_VS, fragmentShader: WALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: this.accent.clone() }, uAlpha: { value: 0.12 }, uLen: { value: 1 }, uZ0: { value: 0 }, uTopY: { value: 1 }, uBotY: { value: 0 } },
    });
    this.haloMat = new LineMaterial({ color: 0xffffff, linewidth: 6, transparent: true, opacity: 0.9, depthTest: true, worldUnits: false });
    this.cutMat = new LineMaterial({ color: 0x0a6fe6, linewidth: 3, transparent: true, depthTest: true, worldUnits: false });
    for (const m of [this.haloMat, this.cutMat]) {
      m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace(/gl_Position = clip;/, 'gl_Position = clip; gl_Position.z -= 0.0015 * gl_Position.w;'); };
    }
    this.poleMat = new THREE.LineBasicMaterial({ color: 0x0a6fe6, transparent: true, opacity: 0.9 });
    this.dotMat = new THREE.MeshBasicMaterial({ color: 0x0a6fe6 });
  }

  setTheme(p: Palette) {
    this.dark = p.def.stars > 0;
    this.accent.set(this.dark ? '#4C95FF' : '#0A6FE6');
    (this.wallMat.uniforms.uColor.value as THREE.Color).copy(this.accent);
    this.wallMat.uniforms.uAlpha.value = this.dark ? 0.14 : 0.1;
    this.cutMat.color.copy(this.accent);
    this.haloMat.color.set(this.dark ? '#0B0F15' : '#FFFFFF');
    this.poleMat.color.copy(this.accent);
    this.dotMat.color.copy(this.accent);
  }

  setResolution(w: number, h: number) {
    for (const m of [this.haloMat, this.cutMat, ...this.solidMats]) m.resolution.set(w, h);
  }

  clear() {
    for (const o of this.objs) {
      this.ve.remove(o);
      const g = (o as THREE.Mesh).geometry;
      g?.dispose();
    }
    this.objs = [];
    for (const m of this.solidMats) m.dispose();
    this.solidMats = [];
    for (const l of this.labels) l.remove();
    this.labels = [];
    this.anchors = [];
  }

  /**
   * Build for a section (world plan points). `grid` local, `solids` local meshes, VE applied by the group scale.
   */
  build(a: [number, number], b: [number, number], origin: Vec3, grid: HeightGrid | null, solids: { local: LocalMesh; color: string }[], botY: number, topY: number, w: number, h: number) {
    this.clear();
    const ax = a[0] - origin[0], az = -(a[1] - origin[1]), bx = b[0] - origin[0], bz = -(b[1] - origin[1]);
    const len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0.5)) return;
    const top = topY + 40, bot = botY;
    // wall
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute([ax, bot, az, bx, bot, bz, bx, top, bz, ax, top, az], 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    wg.setIndex([0, 1, 2, 0, 2, 3]);
    const wall = new THREE.Mesh(wg, this.wallMat);
    wall.renderOrder = 20;
    this.wallMat.uniforms.uLen.value = len;
    this.wallMat.uniforms.uZ0.value = origin[2];
    this.wallMat.uniforms.uTopY.value = top;
    this.wallMat.uniforms.uBotY.value = bot;
    this.add(wall);
    // terrain cut line
    if (grid) {
      const step = Math.max(0.5, grid.dx * 0.5);
      const n = Math.min(4000, Math.ceil(len / step) + 1);
      const runs: number[][] = [];
      let cur: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const y = grid.at(x, -z);
        if (y === y) cur.push(x, y + 0.15, z);
        else if (cur.length) { if (cur.length >= 6) runs.push(cur); cur = []; }
      }
      if (cur.length >= 6) runs.push(cur);
      for (const r of runs) {
        const lg = new LineGeometry();
        lg.setPositions(r);
        const halo = new Line2(lg, this.haloMat); halo.renderOrder = 30; halo.computeLineDistances();
        const lg2 = new LineGeometry();
        lg2.setPositions(r);
        const cut = new Line2(lg2, this.cutMat); cut.renderOrder = 31;
        this.add(halo); this.add(cut);
      }
    }
    // solid cuts (vertical plane through A–B)
    const nx = -(bz - az) / len, nz = (bx - ax) / len, d = nx * ax + nz * az;
    for (const s of solids) {
      const seg = sliceSegments(s.local.positions, s.local.index, { nx, ny: 0, nz, d });
      // keep only segments within the A–B span
      const keep: number[] = [];
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      for (let i = 0; i < seg.length; i += 6) {
        const t0 = (seg[i] - ax) * tx + (seg[i + 2] - az) * tz, t1 = (seg[i + 3] - ax) * tx + (seg[i + 5] - az) * tz;
        if (Math.max(t0, t1) < 0 || Math.min(t0, t1) > len) continue;
        for (let k = 0; k < 6; k++) keep.push(seg[i + k]);
      }
      if (!keep.length) continue;
      const g = new LineSegmentsGeometry();
      g.setPositions(keep);
      const m = new LineMaterial({ color: new THREE.Color(s.color).lerp(new THREE.Color(this.dark ? '#ffffff' : '#000000'), 0.15), linewidth: 2.5, transparent: true, depthTest: false, opacity: 0.95 });
      m.resolution.set(w, h);
      this.solidMats.push(m);
      const ls = new LineSegments2(g, m);
      ls.renderOrder = 32;
      this.add(ls);
    }
    // end poles + dots + labels
    const dotG = new THREE.SphereGeometry(1, 16, 8);
    for (const [px, pz, name] of [[ax, az, 'A'], [bx, bz, 'B']] as [number, number, string][]) {
      const gy = grid ? grid.at(px, -pz) : NaN;
      const y0 = gy === gy ? gy : bot;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute([px, y0, pz, px, top, pz], 3));
      const pole = new THREE.Line(pg, this.poleMat);
      pole.renderOrder = 30;
      this.add(pole);
      const dot = new THREE.Mesh(name === 'A' ? dotG : dotG.clone(), this.dotMat);
      dot.position.set(px, y0, pz);
      dot.scale.set(3, 3, 3);
      dot.renderOrder = 31;
      this.add(dot);
      const el = document.createElement('div');
      el.className = css.secChip;
      el.textContent = name;
      this.labelLayer.appendChild(el);
      this.labels.push(el);
      this.anchors.push(new THREE.Vector3(px, top, pz));
    }
    this.setResolution(w, h);
  }

  private add(o: THREE.Object3D) { this.objs.push(o); this.ve.add(o); }

  /** Dot size stays ~constant on screen; labels follow the poles. */
  update(camera: THREE.Camera, w: number, h: number, ve: number, mpp: number) {
    if (!this.objs.length) return;
    for (const o of this.objs) if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'SphereGeometry') o.scale.set(mpp * 5, (mpp * 5) / ve, mpp * 5);
    const v = new THREE.Vector3();
    this.labels.forEach((el, i) => {
      const a = this.anchors[i];
      v.set(a.x, a.y * ve, a.z).project(camera);
      const vis = v.z < 1;
      el.style.opacity = vis ? '1' : '0';
      if (vis) el.style.transform = `translate3d(${(((v.x * 0.5 + 0.5) * w)).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px, 0) translate(-50%, -120%)`;
    });
  }

  get active() { return this.objs.length > 0; }

  dispose() {
    this.clear();
    this.wallMat.dispose(); this.haloMat.dispose(); this.cutMat.dispose(); this.poleMat.dispose(); this.dotMat.dispose();
  }
}
