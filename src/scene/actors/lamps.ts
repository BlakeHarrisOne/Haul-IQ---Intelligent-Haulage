/**
 * Night running lights (only while the scene core's clock says night - never because of the UI theme):
 *  - every truck: headlight and tail-light glows (one additive point sprite batch, kept ≥ a few px so a fleet reads
 *    from across the pit) and a warm lit pool on the road ahead (one instanced additive quad per truck);
 *  - the followed truck in POV / chase: a real spot light, so its headlights light the road, windrows, delineators
 *    and the trucks ahead like the sun does by day.
 * About 40 trucks cost two draw calls; the spot light is added only at night in the ride cameras.
 */
import * as THREE from 'three';
import type { TruckGeoms } from './vehicle';

const HEAD = new THREE.Color('#FFF1D2'), TAIL = new THREE.Color('#FF2A18');

const PT_VS = /* glsl */ `
attribute vec3 color;
attribute float aSize;
uniform float uViewH, uMinPx;
varying vec3 vC;
varying float vK;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
  gl_PointSize = clamp(px, uMinPx, 180.0);
  vK = clamp(px / uMinPx, 0.45, 1.0);
  vC = color;
}`;
const PT_FS = /* glsl */ `
uniform float uAmt;
varying vec3 vC;
varying float vK;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float halo = exp(-r * r * 6.0) * 0.75;
  float core = 1.0 - smoothstep(0.08, 0.3, r);
  gl_FragColor = vec4(vC * (halo + core * 1.4) * uAmt * vK, 1.0);
}`;

function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  // a long soft cone: brightest a little ahead of the bumper, fading to the far end
  const grd = g.createRadialGradient(32, 30, 2, 32, 46, 66);
  grd.addColorStop(0, 'rgba(255,236,200,0.9)');
  grd.addColorStop(0.45, 'rgba(255,226,180,0.42)');
  grd.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class NightLamps {
  private readonly root = new THREE.Group();
  private readonly pts: THREE.Points;
  private readonly ptGeo = new THREE.BufferGeometry();
  private readonly ptMat: THREE.ShaderMaterial;
  private pools: THREE.InstancedMesh;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly spot: THREE.SpotLight;
  private cap = 0;
  private n = 0;
  private nPool = 0;
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private size = new Float32Array(0);
  private readonly v = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly t = new THREE.Matrix4();
  private spotOn = false;

  constructor(parent: THREE.Object3D, private readonly scene: THREE.Scene) {
    this.root.name = 'night-lamps';
    this.root.visible = false;
    parent.add(this.root);
    this.ptMat = new THREE.ShaderMaterial({
      vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uViewH: { value: 800 }, uMinPx: { value: 3.5 }, uAmt: { value: 1 } },
    });
    this.pts = new THREE.Points(this.ptGeo, this.ptMat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 20;
    this.root.add(this.pts);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, color: new THREE.Color(0.55, 0.5, 0.42),
    });
    const pg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // flat, local x forward after the instance turn
    this.pools = new THREE.InstancedMesh(pg, this.poolMat, 64);
    this.pools.frustumCulled = false;
    this.pools.count = 0;
    this.pools.renderOrder = 7;
    this.root.add(this.pools);
    this.spot = new THREE.SpotLight(0xfff0d4, 0, 320, 0.52, 0.55, 1.6);
    this.spot.name = 'headlights';
    this.spot.castShadow = false;
  }

  private grow(trucks: number) {
    if (trucks * 4 <= this.cap) return;
    this.cap = Math.max(64, trucks * 4 * 2);
    this.pos = new Float32Array(this.cap * 3); this.col = new Float32Array(this.cap * 3); this.size = new Float32Array(this.cap);
    this.ptGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ptGeo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.ptGeo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    if (trucks > this.pools.instanceMatrix.count) {
      const old = this.pools;
      const ni = new THREE.InstancedMesh(old.geometry, this.poolMat, trucks * 2);
      ni.frustumCulled = false; ni.count = 0; ni.renderOrder = 7;
      this.root.remove(old); old.dispose();
      this.pools = ni;
      this.root.add(ni);
    }
  }

  begin(trucks: number) { this.grow(trucks); this.n = 0; this.nPool = 0; }

  /** One truck (pose matrix in scene space, local truck axes). `pool` = draw its fake lit pool on the road. */
  add(M: THREE.Matrix4, g: TruckGeoms, scale: number, pool: boolean) {
    if (scale <= 0) return;
    const put = (p: [number, number, number], c: THREE.Color, s: number) => {
      if (this.n >= this.cap) return;
      this.v.set(p[0], p[1], p[2]).applyMatrix4(M);
      this.pos.set([this.v.x, this.v.y, this.v.z], this.n * 3);
      this.col.set([c.r, c.g, c.b], this.n * 3);
      this.size[this.n++] = s * scale;
    };
    put(g.lamps.head[1], HEAD, 1.1); put(g.lamps.head[2], HEAD, 1.1);
    put(g.lamps.tail[0], TAIL, 0.7); put(g.lamps.tail[1], TAIL, 0.7);
    if (pool && this.nPool < this.pools.instanceMatrix.count) {
      // 40 m × 20 m soft cone starting at the bumper, on the truck's ground plane
      this.t.makeTranslation(g.frontX + 20, 0.25, 0).multiply(this.m.makeScale(40, 1, 20)).multiply(this.m.makeRotationY(Math.PI / 2));
      this.m.multiplyMatrices(M, this.t);
      this.pools.setMatrixAt(this.nPool++, this.m);
    }
  }

  /** Finish the frame: `amount` 0..1 (night), the followed truck for the spot light (POV / chase), viewport height. */
  end(amount: number, follow: { M: THREE.Matrix4; g: TruckGeoms } | null, viewH: number) {
    const on = amount > 0.02;
    this.root.visible = on;
    this.ptGeo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'aSize']) { const a = this.ptGeo.getAttribute(k) as THREE.BufferAttribute | undefined; if (a) a.needsUpdate = true; }
    this.ptMat.uniforms.uViewH.value = viewH;
    this.ptMat.uniforms.uAmt.value = amount;
    this.pools.count = this.nPool;
    this.pools.instanceMatrix.needsUpdate = true;
    this.poolMat.opacity = amount;
    const wantSpot = on && !!follow;
    if (wantSpot !== this.spotOn) {
      this.spotOn = wantSpot;
      if (wantSpot) this.scene.add(this.spot, this.spot.target); else { this.scene.remove(this.spot, this.spot.target); }
    }
    if (wantSpot && follow) {
      const g = follow.g;
      this.v.set(g.frontX + 0.3, g.lamps.head[0][1], 0).applyMatrix4(follow.M);
      this.spot.position.copy(this.v);
      this.v.set(g.frontX + 36, 0, 0).applyMatrix4(follow.M);
      this.spot.target.position.copy(this.v);
      this.spot.target.updateMatrixWorld();
      this.spot.intensity = 520 * amount;
    }
  }

  dispose() {
    if (this.spotOn) this.scene.remove(this.spot, this.spot.target);
    this.spot.dispose();
    this.ptGeo.dispose(); this.ptMat.dispose();
    this.pools.geometry.dispose(); this.pools.dispose();
    this.poolMat.map?.dispose(); this.poolMat.dispose();
    this.root.removeFromParent();
  }
}
