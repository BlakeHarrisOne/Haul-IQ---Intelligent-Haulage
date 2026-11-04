/**
 * Lighting + atmosphere: sun DirectionalLight with soft PCF shadows fitted to the site (or to the followed truck in
 * POV/chase), hemisphere fill, sky dome (gradient, horizon band, 3-lobe sun glow, drifting fair-weather cloud,
 * stars at night — Rain Model RMAtmos lineage), distance haze via scene fog, and the lower-horizon driving sky.
 * Colours and the sun come from the shift clock (environment.ts `Lighting`), never from the UI theme alone.
 */
import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';
import type { Lighting } from './environment';

const D2R = Math.PI / 180;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */ `
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uBack; uniform vec3 uGlow; uniform vec3 uSunDir;
uniform float uSunAmt; uniform float uStars; uniform float uCloud; uniform float uTime; uniform float uDrive; uniform vec3 uSunTrue;
varying vec3 vDir;
${NOISE_GLSL}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * hk_vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHor, uZen, pow(up, mix(0.62, 0.42, uDrive)));
  col += uHor * mix(0.06, 0.12, uDrive) * exp(-abs(d.y) * 14.0);
  if (d.y > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (d.y + 0.18) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float c = smoothstep(0.52, 0.8, n) * smoothstep(0.0, 0.22, d.y);
    vec3 cloud = mix(uHor * 1.05, uZen * 0.9 + uHor * 0.25, 0.35);
    col = mix(col, cloud, c * uCloud);
  }
  if (uStars > 0.0 && d.y > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x) * 180.0, asin(clamp(d.y, -1.0, 1.0)) * 180.0);
    vec2 cell = floor(sp);
    float h = hk_hash12(cell);
    vec2 off = vec2(hk_hash12(cell + 3.1), hk_hash12(cell + 7.9)) - 0.5;
    float dist = length(fract(sp) - 0.5 - off * 0.6);
    float star = step(0.985, h) * smoothstep(0.12, 0.0, dist) * (0.5 + 0.5 * hk_hash12(cell + 1.7));
    col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.02, 0.25, d.y) * 0.9;
  }
  float below = smoothstep(0.0, -0.035, d.y);
  col = mix(col, uBack, below);
  float cs = max(dot(d, uSunTrue), 0.0);
  float glow = (pow(cs, 900.0) * 0.9 + pow(cs, 40.0) * 0.35 + pow(cs, 4.0) * 0.18) * smoothstep(-0.02, 0.1, d.y);
  col += uGlow * glow * uSunAmt;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Atmosphere {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  readonly fog: THREE.Fog;
  readonly skyU: Record<string, THREE.IUniform>;
  /** Unit vector towards the sun (scene). */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private skyMat: THREE.ShaderMaterial;
  private L: Lighting | null = null;
  /** True sun direction (sky glow sits on the real sun even when the key light's elevation is clamped). */
  readonly sunTrue = new THREE.Vector3(0, 1, 0);
  private drive = 0;
  private planK = 0;
  /** Site bounds (scene, exaggerated) for shadow fitting. */
  private siteBox = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 50, 100));
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  shadowFocus: { center: THREE.Vector3; radius: number } | null = null;

  constructor(maxShadow: number) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    const size = Math.min(4096, maxShadow);
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.6;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.fog = new THREE.Fog(0xe6eaee, 1e5, 2e5);
    this.skyU = {
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uBack: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uSunDir: { value: this.sunDir }, uSunAmt: { value: 1 }, uStars: { value: 0 },
      uCloud: { value: 0.35 }, uTime: { value: 0 }, uDrive: { value: 0 }, uSunTrue: { value: this.sunTrue },
    };
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide,
      depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.sky.name = 'sky';
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.sun, this.sun.target, this.hemi, this.sky);
    scene.fog = this.fog;
  }

  setSiteBox(b: THREE.Box3) { this.siteBox.copy(b); this.fitShadow(); }

  /** New clock time / theme. */
  setLighting(L: Lighting) {
    this.L = L;
    this.applyColors();
  }

  /** 0..1 blend towards the driving look (POV/chase) and the plan look (hillshade-friendly sun). */
  setMode(drive: number, plan: number) {
    this.drive = drive; this.planK = plan;
    this.applyColors();
  }

  private applyColors() {
    const L = this.L;
    if (!L) return;
    const k = this.drive, pk = this.planK;
    const u = this.skyU;
    u.uZen.value.copy(L.skyZenith).lerp(L.driveZenith, k);
    u.uHor.value.copy(L.skyHorizon).lerp(L.driveHorizon, k);
    u.uBack.value.copy(L.backdrop).lerp(L.driveGround, k);
    u.uGlow.value.copy(L.glow);
    u.uStars.value = L.stars;
    u.uDrive.value = k;
    u.uCloud.value = L.cloud;
    u.uSunAmt.value = L.sunAmt;
    // haze: the page backdrop at overview, the driving horizon in the cab (far ground melts into the sky)
    this.fog.color.copy(L.backdrop).lerp(L.driveHorizon, k);
    this.sun.color.copy(L.sunColor);
    // plan: the baked 4-light hillshade carries the relief ("engineer's plot"), the sun only adds a little modelling
    this.sun.intensity = L.sunIntensity * (1 - 0.42 * pk);
    this.sun.shadow.intensity = L.shadowIntensity * (1 - 0.55 * pk);
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity * (1 + 0.55 * pk);
    // key light: the clock's sun (or moon), blended to a cartographic NW 50° in plan by day
    const day = L.env.daylight;
    this.tmpV.set(Math.sin(315 * D2R) * Math.cos(52 * D2R), Math.sin(52 * D2R), -Math.cos(315 * D2R) * Math.cos(52 * D2R));
    this.sunDir.copy(L.sunDir).lerp(this.tmpV, pk * day).normalize();
    const e = L.env;
    const az = e.sunAzDeg * D2R, el = Math.max(-0.2, e.sunElDeg * D2R);
    this.sunTrue.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.fitShadow();
  }

  /** Fit the orthographic shadow camera to the site box (or the POV focus) in light space (allocation-free). */
  fitShadow() {
    const cam = this.sun.shadow.camera;
    const box = this.fitBox.copy(this.siteBox);
    if (this.shadowFocus) {
      const { center, radius } = this.shadowFocus;
      box.min.set(center.x - radius, Math.min(center.y - radius, this.siteBox.min.y), center.z - radius);
      box.max.set(center.x + radius, Math.max(center.y + radius, this.siteBox.max.y), center.z + radius);
    }
    const ctr = box.getCenter(this.tmpV2);
    const dist = box.getSize(this.tmpV3).length() + 100;
    this.sun.position.copy(ctr).addScaledVector(this.sunDir, dist);
    this.sun.target.position.copy(ctr);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    // light view matrix (rotation only, about the sun position)
    this.tmpM.lookAt(this.sun.position, ctr, this.up);
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    const view = this.tmpM2.makeRotationFromQuaternion(this.tmpQ).invert();
    const lo = this.tmpLo.set(Infinity, Infinity, Infinity), hi = this.tmpHi.set(-Infinity, -Infinity, -Infinity);
    let i = 0;
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      const v = this.corners[i++].set(x ? box.max.x : box.min.x, y ? box.max.y + 25 : box.min.y, z ? box.max.z : box.min.z);
      v.sub(this.sun.position).applyMatrix4(view);
      lo.min(v); hi.max(v);
    }
    cam.left = lo.x; cam.right = hi.x; cam.bottom = lo.y; cam.top = hi.y;
    cam.near = Math.max(0.5, -hi.z - 10); cam.far = -lo.z + 10;
    cam.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }
  private fitBox = new THREE.Box3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private tmpLo = new THREE.Vector3();
  private tmpHi = new THREE.Vector3();
  private tmpM2 = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  /** Per-frame: keep the sky around the camera, set haze distances. */
  update(camera: THREE.Camera, far: number, hazeNear: number, hazeFar: number, time: number) {
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(far * 0.9);
    this.sky.updateMatrixWorld();
    this.fog.near = hazeNear;
    this.fog.far = hazeFar;
    this.skyU.uTime.value = time;
  }

  dispose() {
    this.skyMat.dispose();
    this.sky.geometry.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
  }
}
