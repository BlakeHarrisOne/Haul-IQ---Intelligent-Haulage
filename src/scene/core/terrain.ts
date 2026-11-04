/**
 * Terrain layer: topo surface mesh with the survey material (earthy elevation/slope palette, 4-light hillshade
 * emphasis, multi-octave micro detail + bump, anti-aliased contours and site grid, baked horizon AO, optional slope
 * heat), strata skirt walls around the model boundary, a crisp rim line, and a seamless backdrop ground with a soft
 * contact shadow and the real sun shadow.
 */
import * as THREE from 'three';
import type { MeshAsset, Vec3 } from '@/core/types';
import { HeightGrid } from './heightGrid';
import { boundaryEdges, smoothNormals, toLocal, windsDown, type LocalMesh } from './meshUtil';
import { BUMP_GLSL, NOISE_GLSL, hillshadeLights } from './glsl';
import type { Palette } from './theme';
import { GRADE_HEX } from '@/ui';

export interface TerrainUniforms {
  [k: string]: THREE.IUniform;
}

/** Inject `#include` replacements into a material's shader (onBeforeCompile helper). */
function patch(src: string, chunk: string, code: string, mode: 'before' | 'after' | 'replace' = 'after'): string {
  const tag = `#include <${chunk}>`;
  if (!src.includes(tag)) return src;
  return src.replace(tag, mode === 'replace' ? code : mode === 'before' ? `${code}\n${tag}` : `${tag}\n${code}`);
}

export class TerrainLayer {
  readonly root = new THREE.Group();
  /** Exaggerated group (scale.y = VE) holding everything built in local VE-1 coordinates. */
  readonly ve = new THREE.Group();
  readonly u: TerrainUniforms;
  grid: HeightGrid | null = null;
  meshes: THREE.Mesh[] = [];
  triangles = 0;
  /** Local bounds of the topo (VE 1). */
  min = new THREE.Vector3();
  max = new THREE.Vector3();
  datumY = 0;
  floorY = 0;
  edgeMeanY = 0;
  hasData = false;

  private terrainMat: THREE.MeshStandardMaterial;
  private skirtMat: THREE.MeshStandardMaterial;
  private rimMat: THREE.LineBasicMaterial;
  private groundMat: THREE.MeshBasicMaterial;
  private contactMat: THREE.MeshBasicMaterial;
  private shadowCatcherMat: THREE.ShadowMaterial;
  private ground: THREE.Mesh;
  private contact: THREE.Mesh;
  private shadowCatcher: THREE.Mesh;
  private skirt: THREE.Mesh | null = null;
  private apron: THREE.Mesh | null = null;
  private rim: THREE.LineSegments | null = null;
  private aoTex: THREE.DataTexture;
  private contactTex: THREE.Texture | null = null;
  private owned: { dispose(): void }[] = [];
  private driving = false;

  constructor() {
    this.root.name = 'terrain-core';
    this.root.add(this.ve);
    this.aoTex = new THREE.DataTexture(new Uint8Array([255, 128]), 1, 1, THREE.RGFormat);
    this.aoTex.unpackAlignment = 1;
    this.aoTex.needsUpdate = true;
    const hs = hillshadeLights();
    this.u = {
      uZ0: { value: 0 },
      uRange: { value: new THREE.Vector2(0, 100) },
      uFloorRL: { value: -1e6 },
      uContour: { value: new THREE.Vector4(5, 5, 1, 0) },
      uInk: { value: new THREE.Color('#4A3F33') },
      uInkAlpha: { value: 0.4 },
      uGrid: { value: new THREE.Vector4(100, 0.1, 1, 0) },
      uGridInk: { value: new THREE.Color('#3B4A5C') },
      uGridOff: { value: new THREE.Vector2(0, 0) },
      uAO: { value: this.aoTex },
      uAOX: { value: new THREE.Vector4(0, 0, 1, 0) },
      uAOSize: { value: new THREE.Vector2(1, 1) },
      uAOStr: { value: 0.85 },
      uLow: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHigh: { value: new THREE.Color() },
      uBatter: { value: new THREE.Color() },
      uFloor: { value: new THREE.Color() },
      uVeg: { value: new THREE.Color() },
      uSlopeOn: { value: 0 },
      uHS: { value: 0.38 },
      uShadeVex: { value: 2.0 },
      uHSL: { value: hs.dirs.map(d => new THREE.Vector3(d[0], d[1], d[2])) },
      uHSW: { value: new THREE.Vector4(...(hs.weights as [number, number, number, number])) },
      uDetail: { value: 0.15 },
      uCurv: { value: 0.32 },
      uGlowP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e6, 0, 1)) },
      uGlowCol: { value: new THREE.Color('#FFB46A') },
      uGlowK: { value: 0 },
      uBump: { value: 0.9 },
      uHeat: { value: [new THREE.Color(GRADE_HEX.flat), new THREE.Color(GRADE_HEX.mod), new THREE.Color(GRADE_HEX.steep), new THREE.Color(GRADE_HEX.max)] },
      // skirt
      uTopsoil: { value: new THREE.Color() },
      uWeathered: { value: new THREE.Color() },
      uRockA: { value: new THREE.Color() },
      uRockB: { value: new THREE.Color() },
      uCoal: { value: new THREE.Color() },
    };
    this.terrainMat = this.makeTerrainMaterial();
    this.skirtMat = this.makeSkirtMaterial();
    this.rimMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
    this.rimMat.onBeforeCompile = sh => {
      sh.vertexShader = patch(sh.vertexShader, 'project_vertex', 'gl_Position.z -= 0.0006 * gl_Position.w;');
    };
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0xe6eaee, toneMapped: false, fog: true });
    this.contactMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, fog: true });
    this.shadowCatcherMat = new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false });
    const big = new THREE.PlaneGeometry(1, 1);
    big.rotateX(-Math.PI / 2);
    this.owned.push(big, this.terrainMat, this.skirtMat, this.rimMat, this.groundMat, this.contactMat, this.shadowCatcherMat, this.aoTex);
    this.ground = new THREE.Mesh(big, this.groundMat);
    this.ground.name = 'backdrop-ground';
    this.ground.renderOrder = -5;
    this.contact = new THREE.Mesh(big, this.contactMat);
    this.contact.renderOrder = -4;
    this.shadowCatcher = new THREE.Mesh(big, this.shadowCatcherMat);
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.renderOrder = -3;
    this.root.add(this.ground, this.contact, this.shadowCatcher);
    this.ground.visible = this.contact.visible = this.shadowCatcher.visible = false;
  }

  // ─────────────────────────────────────────────────────────── materials

  private makeTerrainMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, side: THREE.FrontSide });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\nvarying vec3 vNObj;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;\nvNObj = normal;');
      let f = sh.fragmentShader;
      f = f.replace('#include <common>', `#include <common>
varying vec3 vLoc;
varying vec3 vNObj;
uniform float uZ0; uniform vec2 uRange; uniform float uFloorRL;
uniform vec4 uContour; uniform vec3 uInk; uniform float uInkAlpha;
uniform vec4 uGrid; uniform vec3 uGridInk; uniform vec2 uGridOff;
uniform sampler2D uAO; uniform vec4 uAOX; uniform vec2 uAOSize; uniform float uAOStr;
uniform vec3 uLow; uniform vec3 uMid; uniform vec3 uHigh; uniform vec3 uBatter; uniform vec3 uFloor; uniform vec3 uVeg;
uniform float uSlopeOn; uniform float uHS; uniform float uShadeVex; uniform vec3 uHSL[4]; uniform vec4 uHSW;
uniform float uDetail; uniform float uBump; uniform vec3 uHeat[4]; uniform float uCurv;
uniform vec4 uGlowP[8]; uniform vec3 uGlowCol; uniform float uGlowK;
${NOISE_GLSL}
${BUMP_GLSL}
float hk_tanS; float hk_rl; float hk_fw; vec2 hk_pw; float hk_bh;`);
      f = patch(f, 'color_fragment', /* glsl */ `
  {
    vec3 nT = normalize(vNObj);
    hk_rl = vLoc.y + uZ0;
    hk_pw = vec2(vLoc.x, -vLoc.z);
    hk_fw = max(length(fwidth(hk_pw)), 1e-4);
    hk_tanS = length(nT.xz) / max(nT.y, 1e-3);
    float t = clamp((hk_rl - uRange.x) / max(uRange.y - uRange.x, 1.0), 0.0, 1.0);
    vec3 base = mix(mix(uLow, uMid, smoothstep(0.0, 0.42, t)), uHigh, smoothstep(0.42, 1.0, t));
    float lowFlat = (1.0 - smoothstep(uFloorRL + 0.8, uFloorRL + 5.0, hk_rl)) * (1.0 - smoothstep(0.06, 0.22, hk_tanS));
    base = mix(base, uFloor, lowFlat * 0.55);
    // sparse olive vegetation patches on gentle undisturbed ground (mid elevations only)
    float vegN = hk_vnoise(hk_pw / 170.0 + 4.0) * 0.65 + hk_vnoise(hk_pw / 37.0 + 9.0) * 0.35;
    float veg = smoothstep(0.5, 0.78, vegN) * (1.0 - smoothstep(0.08, 0.2, hk_tanS)) * smoothstep(0.28, 0.45, t) * (1.0 - smoothstep(0.86, 0.97, t));
    base = mix(base, uVeg * (0.92 + 0.16 * hk_vnoise(hk_pw / 9.0)), veg * 0.38);
    // batters: darker by slope, with rock strata banding by RL (warped so beds undulate)
    float bat = smoothstep(0.2, 0.9, hk_tanS);
    float warp = (hk_vnoise(hk_pw / 140.0) - 0.5) * 7.0;
    float bed = hk_vnoise(vec2((hk_rl + warp) * 0.42, 1.7));
    float bed2 = hk_vnoise(vec2((hk_rl + warp) * 1.9, 5.3));
    vec3 batCol = uBatter * (0.86 + 0.22 * bed + 0.08 * bed2 * (1.0 - smoothstep(0.15, 0.5, hk_fw)));
    base = mix(base, batCol, bat);
    // micro detail: plan projection on gentle ground, two vertical projections on steep faces (no streaks)
    float wv = smoothstep(0.55, 1.4, hk_tanS);
    float g = 0.0;
    hk_bh = 0.0;
    if (wv < 0.999) { g += hk_ground(hk_pw, hk_fw) * (1.0 - wv); hk_bh += hk_bump(hk_pw, hk_fw) * (1.0 - wv); }
    if (wv > 0.001) {
      float bx = smoothstep(-0.25, 0.25, abs(nT.x) - abs(nT.z));
      vec2 pa = vec2(vLoc.x, hk_rl * 1.6), pb = vec2(vLoc.z, hk_rl * 1.6);
      float fa = max(length(fwidth(pa)), 1e-4), fb = max(length(fwidth(pb)), 1e-4);
      float ga = bx < 0.999 ? hk_ground(pa, fa) : 0.0, gb = bx > 0.001 ? hk_ground(pb + 17.0, fb) : 0.0;
      float ba = bx < 0.999 ? hk_bump(pa, fa) : 0.0, bb = bx > 0.001 ? hk_bump(pb + 17.0, fb) : 0.0;
      g += mix(ga, gb, bx) * wv;
      hk_bh += mix(ba, bb, bx) * wv;
    }
    base *= 1.0 + uDetail * g;
    base = mix(base, base * vec3(1.03, 1.0, 0.95), clamp(g * 1.5, -0.5, 0.5));
    // baked curvature: crests a touch brighter, toes darker (bench lines read at any distance)
    {
      vec2 cUV = vec2(((vLoc.x - uAOX.x) * uAOX.z + 0.5) / uAOSize.x, ((-vLoc.z - uAOX.y) * uAOX.z + 0.5) / uAOSize.y);
      float cv = (texture2D(uAO, cUV).g - 0.5) * 2.0;
      base *= 1.0 + uCurv * (0.55 * max(cv, 0.0) - 0.75 * max(-cv, 0.0));
    }
    // survey hillshade emphasis (normals exaggerated for shading only)
    vec3 ne = normalize(vec3(nT.x * uShadeVex, nT.y, nT.z * uShadeVex));
    vec4 dl = clamp(vec4(dot(ne, uHSL[0]), dot(ne, uHSL[1]), dot(ne, uHSL[2]), dot(ne, uHSL[3])), 0.0, 1.0);
    float hs = dot(uHSW, dl);
    base *= mix(1.0, 0.42 + 0.78 * hs, uHS);
    if (uSlopeOn > 0.5) {
      float gr = hk_tanS;
      // continuous ramp through the grade classes (0 / 4 / 8 / 10 %+), not pass/fail
      vec3 heat = mix(uHeat[0], uHeat[1], smoothstep(0.0, 0.04, gr));
      heat = mix(heat, uHeat[2], smoothstep(0.04, 0.08, gr));
      heat = mix(heat, uHeat[3], smoothstep(0.08, 0.10, gr));
      base = mix(base, heat * (0.55 + 0.6 * hs), 0.62);
    }
    diffuseColor.rgb = base;
  }`);
      f = patch(f, 'normal_fragment_maps', /* glsl */ `
  {
    vec2 dH = vec2(dFdx(hk_bh), dFdy(hk_bh)) * uBump;
    normal = hk_perturb(-vViewPosition, normal, dH);
  }`);
      f = patch(f, 'aomap_fragment', /* glsl */ `
  {
    vec2 aoUV = vec2(((vLoc.x - uAOX.x) * uAOX.z + 0.5) / uAOSize.x, ((-vLoc.z - uAOX.y) * uAOX.z + 0.5) / uAOSize.y);
    float ao = texture2D(uAO, aoUV).r;
    ao = mix(1.0, ao * ao, uAOStr);
    reflectedLight.indirectDiffuse *= ao;
    reflectedLight.directDiffuse *= mix(1.0, ao, 0.5);
  }`, 'replace');
      f = patch(f, 'opaque_fragment', /* glsl */ `
  {
    // night: warm pools from lighting plants at the working faces
    if (uGlowK > 0.0) {
      float gsum = 0.0;
      for (int i = 0; i < 8; i++) {
        vec4 gp = uGlowP[i];
        vec3 dv = vLoc - gp.xyz;
        float r2 = dot(dv, dv) / (gp.w * gp.w);
        gsum += exp(-r2 * 2.2) * (1.0 + 0.0 * gp.w);
      }
      outgoingLight += uGlowCol * diffuseColor.rgb * gsum * uGlowK;
    }
    // site grid (E/N), faded when lines get closer than ~7 px
    if (uGrid.z > 0.5) {
      vec2 gp = (hk_pw + uGridOff) / uGrid.x;
      vec2 gw = fwidth(gp);
      vec2 gd = abs(fract(gp - 0.5) - 0.5) / max(gw, vec2(1e-5));
      float gl = 1.0 - smoothstep(0.4, 1.2, min(gd.x, gd.y));
      float gfade = smoothstep(7.0, 18.0, uGrid.x / hk_fw);
      outgoingLight = mix(outgoingLight, uGridInk * 0.35, gl * gfade * uGrid.y);
    }
    // anti-aliased contours: minor at the interval, major every Nth; faded before they crowd
    if (uContour.z > 0.5) {
      float I = uContour.x;
      float fz = max(fwidth(hk_rl), 1e-5);
      float r = floor(hk_rl / I + 0.5);
      float dpx = abs(hk_rl - r * I) / fz;
      float isMajor = 1.0 - step(0.5, abs(r - uContour.y * floor(r / uContour.y + 0.5)));
      float wpx = mix(0.55, 1.15, isMajor);
      float line = 1.0 - smoothstep(wpx - 0.5, wpx + 0.6, dpx);
      float spacing = I / fz;
      float fade = mix(smoothstep(3.0, 7.0, spacing), smoothstep(1.4, 3.0, spacing * uContour.y), isMajor);
      // flats (dump tops, pit floor) stay clean: no speckle where the slope / height change per pixel vanishes
      fade *= smoothstep(0.006, 0.035, hk_tanS);
      float a = line * fade * uInkAlpha * mix(0.6, 1.0, isMajor);
      outgoingLight = mix(outgoingLight, uInk * 0.12 + outgoingLight * 0.25, a);
    }
  }`, 'before');
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'hk-terrain-v4';
    return m;
  }

  private makeSkirtMaterial(): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, side: THREE.FrontSide });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTop;\nvarying vec3 vLoc;\nvarying float vTop;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;\nvTop = aTop;');
      let f = sh.fragmentShader;
      f = f.replace('#include <common>', `#include <common>
varying vec3 vLoc; varying float vTop;
uniform float uZ0; uniform float uFloorRL;
uniform vec3 uTopsoil; uniform vec3 uWeathered; uniform vec3 uRockA; uniform vec3 uRockB; uniform vec3 uCoal;
${NOISE_GLSL}`);
      f = patch(f, 'color_fragment', /* glsl */ `
  {
    float rl = vLoc.y + uZ0;
    float dpt = vTop - vLoc.y;
    float along = vLoc.x - vLoc.z;
    float fw = max(length(fwidth(vec2(along, rl))), 1e-4);
    float wob = (hk_vnoise(vec2(along / 46.0, 0.5)) - 0.5) * 2.0;
    float wob2 = (hk_vnoise(vec2(along / 9.0, 3.5)) - 0.5);
    vec3 c;
    // fresh rock: interbedded sandstone / siltstone, beds by RL
    float bedT = (rl + wob * 2.2) / 6.5;
    float bedF = fract(bedT);
    float bedI = floor(bedT);
    float alt = step(0.5, hk_hash12(vec2(bedI, 7.0)));
    vec3 rock = mix(uRockA, uRockB, alt) * (0.9 + 0.2 * hk_hash12(vec2(bedI, 2.0)));
    float parting = 1.0 - smoothstep(0.0, max(fw / 6.5 * 1.5, 0.04), min(bedF, 1.0 - bedF));
    rock *= 1.0 - 0.18 * parting;
    c = rock;
    // weathered zone and topsoil follow the surface above
    float wz = 9.0 + wob * 3.0 + wob2 * 1.5;
    c = mix(uWeathered * (0.92 + 0.16 * hk_vnoise(vec2(along / 3.0, rl / 1.3))), c, smoothstep(wz - 1.5, wz + 1.5, dpt));
    float ts = 1.3 + wob2 * 0.6;
    c = mix(uTopsoil, c, smoothstep(ts - 0.25, ts + 0.25, dpt));
    // coal seam just below the pit floor
    float seamTop = uFloorRL + wob * 0.6, seamBot = uFloorRL - 5.5 + wob * 0.8;
    float seam = smoothstep(seamBot - 0.15, seamBot + 0.15, rl) * (1.0 - smoothstep(seamTop - 0.15, seamTop + 0.15, rl));
    c = mix(c, uCoal * (0.85 + 0.3 * hk_vnoise(vec2(along / 2.0, rl * 3.0))), seam);
    // 5 m RL ticks (Rain Model), gone before they alias
    float f5 = rl / 5.0, fwf = max(fwidth(f5), 1e-4), d5 = abs(fract(f5 + 0.5) - 0.5) / fwf;
    c *= 1.0 - (1.0 - smoothstep(0.5, 1.5, d5)) * 0.14 * (1.0 - smoothstep(0.12, 0.35, fwf));
    // fine grain
    c *= 0.94 + 0.12 * hk_vnoise(vec2(along, rl * 2.0) / max(0.8, fw * 2.0));
    diffuseColor.rgb = c;
  }`);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'hk-skirt-v1';
    return m;
  }

  // ─────────────────────────────────────────────────────────── build

  clear() {
    for (const m of this.meshes) { m.geometry.dispose(); this.ve.remove(m); }
    this.meshes = [];
    if (this.skirt) { this.skirt.geometry.dispose(); this.ve.remove(this.skirt); this.skirt = null; }
    if (this.rim) { this.rim.geometry.dispose(); this.ve.remove(this.rim); this.rim = null; }
    if (this.apron) { this.apron.geometry.dispose(); this.ve.remove(this.apron); this.apron = null; }
    this.contactTex?.dispose(); this.contactTex = null;
    this.grid = null;
    this.triangles = 0;
    this.hasData = false;
    this.ground.visible = this.contact.visible = this.shadowCatcher.visible = false;
  }

  build(assets: MeshAsset[], origin: Vec3) {
    this.clear();
    if (!assets.length) return;
    const locals: LocalMesh[] = [];
    for (const a of assets) {
      const L = toLocal(a.mesh, origin);
      if (windsDown(L.positions, L.index)) {
        const r = new Uint32Array(L.index.length);
        for (let k = 0; k < r.length; k += 3) { r[k] = L.index[k]; r[k + 1] = L.index[k + 2]; r[k + 2] = L.index[k + 1]; }
        L.index = r;
      }
      locals.push(L);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(L.positions, L.index, true), 3));
      g.setIndex(new THREE.BufferAttribute(L.index, 1));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(...L.min), new THREE.Vector3(...L.max));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(g, this.terrainMat);
      mesh.name = `topo:${a.id}`;
      mesh.userData.assetId = a.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.ve.add(mesh);
      this.meshes.push(mesh);
      this.triangles += L.index.length / 3;
    }
    this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity);
    for (const L of locals) { this.min.min(new THREE.Vector3(...L.min)); this.max.max(new THREE.Vector3(...L.max)); }
    this.u.uZ0.value = origin[2];
    this.u.uGridOff.value.set(((origin[0] % 1000) + 1000) % 1000, ((origin[1] % 1000) + 1000) % 1000);
    const grid = HeightGrid.fromMeshes(locals);
    this.grid = grid;
    const rangeLo = grid ? grid.percentile(0.01) : this.min.y, rangeHi = grid ? grid.percentile(0.995) : this.max.y;
    this.u.uRange.value.set(rangeLo + origin[2], rangeHi + origin[2]);
    const relief = this.max.y - this.min.y;
    this.floorY = grid ? grid.percentile(0.02) : this.min.y;
    // only call it a "floor" when there's a real pit (a low, flat population well below the median)
    const med = grid ? grid.percentile(0.5) : this.max.y;
    this.u.uFloorRL.value = med - this.floorY > 12 ? this.floorY + origin[2] : -1e6;
    this.datumY = this.min.y - Math.max(10, 0.14 * relief);
    if (grid) this.bakeAO(grid);
    this.buildSkirt(locals);
    this.buildApron();
    this.buildBackdrop();
    this.hasData = true;
  }

  private bakeAO(g: HeightGrid) {
    const t0 = performance.now();
    const ao = g.bakeAO();
    const tex = new THREE.DataTexture(ao.data, ao.w, ao.h, THREE.RGFormat, THREE.UnsignedByteType);
    tex.unpackAlignment = 1; // rows of RG8 are not 4-byte aligned
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.aoTex.dispose();
    this.aoTex = tex;
    this.u.uAO.value = tex;
    this.u.uAOX.value.set(g.ox, g.oy, 1 / (ao.step * g.dx), 0);
    this.u.uAOSize.value.set(ao.w, ao.h);
    this.aoMs = performance.now() - t0;
  }
  aoMs = 0;

  private buildSkirt(locals: LocalMesh[]) {
    const pos: number[] = [], nrm: number[] = [], top: number[] = [], idx: number[] = [], rim: number[] = [];
    let ySum = 0, yCnt = 0;
    const by = this.datumY;
    for (const L of locals) {
      const p = L.positions;
      const edges = boundaryEdges(p, L.index);
      for (const e of edges) {
        const ax = p[e.a * 3], ay = p[e.a * 3 + 1], az = p[e.a * 3 + 2];
        const bx = p[e.b * 3], byy = p[e.b * 3 + 1], bz = p[e.b * 3 + 2];
        const base = pos.length / 3;
        pos.push(ax, ay, az, bx, byy, bz, ax, by, az, bx, by, bz);
        for (let k = 0; k < 4; k++) nrm.push(e.ox, 0, e.oz);
        top.push(ay, byy, ay, byy);
        // outward-facing winding: check (b−a)×(down) against outward normal
        const cx = (bz - az) * 1, cz = -(bx - ax) * 1; // (b−a) × (0,−1,0) → (−(bz−az)·−1 ...) simplified below
        const facing = -(cx * e.ox + cz * e.oz);
        if (facing >= 0) idx.push(base, base + 2, base + 3, base, base + 3, base + 1);
        else idx.push(base, base + 3, base + 2, base, base + 1, base + 3);
        rim.push(ax, ay, az, bx, byy, bz);
        ySum += ay; yCnt++;
      }
    }
    this.edgeMeanY = yCnt ? ySum / yCnt : this.min.y;
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.setIndex(idx);
    // verify winding on the first quad and flip everything if needed (robust to either convention)
    const P = g.getAttribute('position') as THREE.BufferAttribute, N = g.getAttribute('normal') as THREE.BufferAttribute;
    const i0 = idx[0], i1 = idx[1], i2 = idx[2];
    const va = new THREE.Vector3().fromBufferAttribute(P, i0), vb = new THREE.Vector3().fromBufferAttribute(P, i1), vc = new THREE.Vector3().fromBufferAttribute(P, i2);
    const fn = vb.sub(va).cross(vc.sub(va));
    if (fn.dot(new THREE.Vector3().fromBufferAttribute(N, i0)) < 0) {
      const ix = g.getIndex()!;
      for (let k = 0; k < ix.count; k += 3) { const t = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, t); }
    }
    const skirt = new THREE.Mesh(g, this.skirtMat);
    skirt.name = 'terrain-skirt';
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    this.skirt = skirt;
    this.ve.add(skirt);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
    this.rim = new THREE.LineSegments(rg, this.rimMat);
    this.rim.name = 'terrain-rim';
    this.rim.renderOrder = 2;
    this.ve.add(this.rim);
  }

  /**
   * Driving apron: rings around the survey rectangle that continue the edge heights outwards and ease to the mean
   * edge level out to the horizon (terrain material, so POV/chase see continuous ground instead of the model's edge).
   */
  private buildApron() {
    const g = this.grid;
    if (!g) return;
    const x0 = g.ox, x1 = g.ox + (g.nx - 1) * g.dx, y0 = g.oy, y1 = g.oy + (g.ny - 1) * g.dx;
    const mean = this.edgeMeanY;
    const per = 2 * (x1 - x0 + y1 - y0);
    const step = Math.max(g.dx * 2, per / 1600);
    const nW = Math.max(2, Math.round((x1 - x0) / step)), nH = Math.max(2, Math.round((y1 - y0) / step));
    // perimeter parameter → point on a rectangle expanded by `o`, CCW from the SW corner, with its outward dir
    const ring: { u: number; side: number }[] = [];
    for (let i = 0; i < nW; i++) ring.push({ u: i / nW, side: 0 });
    for (let i = 0; i < nH; i++) ring.push({ u: i / nH, side: 1 });
    for (let i = 0; i < nW; i++) ring.push({ u: i / nW, side: 2 });
    for (let i = 0; i < nH; i++) ring.push({ u: i / nH, side: 3 });
    const at = (r: { u: number; side: number }, o: number): [number, number] => {
      const X0 = x0 - o, X1 = x1 + o, Y0 = y0 - o, Y1 = y1 + o;
      switch (r.side) {
        case 0: return [X0 + (X1 - X0) * r.u, Y0];
        case 1: return [X1, Y0 + (Y1 - Y0) * r.u];
        case 2: return [X1 - (X1 - X0) * r.u, Y1];
        default: return [X0, Y1 - (Y1 - Y0) * r.u];
      }
    };
    const inset = g.dx * 0.02;
    const edgeH = ring.map(r => {
      const [x, y] = at(r, -inset);
      const h = g.at(Math.min(x1, Math.max(x0, x)), Math.min(y1, Math.max(y0, y)));
      return h === h ? h : mean;
    });
    const offs = [0, 40, 160, 600, 2000, 9000];
    const blend = [0, 0.2, 0.55, 0.85, 1, 1];
    const drop = [0, 0, 0.3, 1.2, 3, 8];
    const pos: number[] = [];
    for (let k = 0; k < offs.length; k++) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = at(ring[i], offs[k]);
        const h = edgeH[i] + (mean - edgeH[i]) * blend[k] - drop[k];
        pos.push(x, k === 0 ? edgeH[i] : h, -y);
      }
    }
    const n = ring.length, idx: number[] = [];
    for (let k = 0; k < offs.length - 1; k++) for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + ((i + 1) % n), c = (k + 1) * n + ((i + 1) % n), d = (k + 1) * n + i;
      idx.push(a, d, c, a, c, b);
    }
    const P = new Float32Array(pos), I = new Uint32Array(idx);
    if (windsDown(P, I)) for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(smoothNormals(P, I, true), 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, this.terrainMat);
    m.name = 'terrain-apron';
    m.receiveShadow = true;
    m.visible = this.driving;
    this.apron = m;
    this.ve.add(m);
  }

  private buildBackdrop() {
    const cx = (this.min.x + this.max.x) / 2, cz = (this.min.z + this.max.z) / 2;
    const w = this.max.x - this.min.x, d = this.max.z - this.min.z, diag = Math.hypot(w, d);
    // ground positions are set in VE space (y scaled by updateVE)
    this.ground.scale.set(diag * 60, 1, diag * 60);
    this.ground.position.set(cx, 0, cz);
    this.shadowCatcher.scale.set(w * 2.2, 1, d * 2.2);
    this.shadowCatcher.position.set(cx, 0, cz);
    // contact shadow texture from the footprint: two blurred layers (tight + wide)
    if (this.grid && typeof document !== 'undefined') {
      const fp = this.grid.footprint(256);
      const pad = 0.35;
      const W = Math.round(fp.w * (1 + 2 * pad)), H = Math.round(fp.h * (1 + 2 * pad));
      const src = document.createElement('canvas');
      src.width = fp.w; src.height = fp.h;
      src.getContext('2d')!.putImageData(new ImageData(fp.data as unknown as Uint8ClampedArray<ArrayBuffer>, fp.w, fp.h), 0, 0);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c2 = cv.getContext('2d')!;
      const ox = (W - fp.w) / 2, oy = (H - fp.h) / 2;
      const k = Math.max(fp.w, fp.h) / 256;
      c2.filter = `blur(${Math.round(26 * k)}px)`; c2.globalAlpha = 0.55; c2.drawImage(src, ox, oy + 6 * k);
      c2.filter = `blur(${Math.round(7 * k)}px)`; c2.globalAlpha = 0.6; c2.drawImage(src, ox, oy + 2 * k);
      c2.filter = 'none'; c2.globalAlpha = 1;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.NoColorSpace;
      this.contactTex = tex;
      this.contactMat.alphaMap = tex;
      this.contactMat.needsUpdate = true;
      const gx = this.grid.ox, gy = this.grid.oy, gw = (this.grid.nx - 1) * this.grid.dx, gh = (this.grid.ny - 1) * this.grid.dx;
      this.contact.scale.set(gw * (1 + 2 * pad), 1, gh * (1 + 2 * pad));
      this.contact.position.set(gx + gw / 2, 0, -(gy + gh / 2));
    }
    this.ground.visible = this.contact.visible = this.shadowCatcher.visible = true;
  }

  // ─────────────────────────────────────────────────────────── live settings

  setVE(ve: number) {
    this.ve.scale.set(1, ve, 1);
    this.placeGround(ve);
  }

  private curVE = 1;
  private placeGround(ve = this.curVE) {
    this.curVE = ve;
    const y = this.driving ? (this.edgeMeanY - 0.6) * ve : this.datumY * ve - 0.05;
    this.ground.position.y = y;
    this.contact.position.y = y + 0.02;
    this.shadowCatcher.position.y = y + 0.04;
  }

  setDriving(on: boolean, pal: Palette) {
    this.driving = on;
    if (this.skirt) this.skirt.visible = !on;
    if (this.rim) this.rim.visible = !on;
    if (this.apron) this.apron.visible = on && this.meshes.some(m => m.visible);
    this.contact.visible = !on && this.hasData;
    this.ground.visible = this.hasData && !(on && this.apron);
    this.shadowCatcher.visible = this.hasData && !on;
    this.groundMat.color.copy(on ? pal.c.driveGround : pal.c.backdrop);
    this.placeGround();
  }

  setTheme(p: Palette) {
    const u = this.u, c = p.c, d = p.def;
    u.uLow.value.copy(c.tLow); u.uMid.value.copy(c.tMid); u.uHigh.value.copy(c.tHigh);
    u.uBatter.value.copy(c.tBatter); u.uFloor.value.copy(c.tFloor); u.uVeg.value.copy(c.tVeg);
    u.uInk.value.copy(c.ink); u.uInkAlpha.value = d.inkAlpha;
    u.uGridInk.value.copy(c.gridInk); u.uGrid.value.y = d.gridAlpha;
    u.uTopsoil.value.copy(c.topsoil); u.uWeathered.value.copy(c.weathered);
    u.uRockA.value.copy(c.rockA); u.uRockB.value.copy(c.rockB); u.uCoal.value.copy(c.coal);
    this.groundMat.color.copy(this.driving ? c.driveGround : c.backdrop);
    this.contactMat.opacity = d.contact;
    this.shadowCatcherMat.opacity = d.contact * 0.5;
    this.u.uGlowK.value = d.plantGlow * 2.2;
    this.rimMat.color.set(p.def.stars > 0 ? '#9FB0C8' : '#FFFFFF');
    this.rimMat.opacity = p.def.stars > 0 ? 0.35 : 0.75;
  }

  setContours(intervalM: number, on: boolean) {
    this.u.uContour.value.set(Math.max(0.1, intervalM || 5), 5, on ? 1 : 0, 0);
  }
  setGrid(stepM: number, on: boolean) {
    this.u.uGrid.value.x = stepM;
    this.u.uGrid.value.z = on ? 1 : 0;
  }
  setSlope(on: boolean) { this.u.uSlopeOn.value = on ? 1 : 0; }
  /** Night lighting-plant pools: local (VE-1) positions + radius (m). */
  setGlows(list: { x: number; y: number; z: number; r: number }[]) {
    const arr = this.u.uGlowP.value as THREE.Vector4[];
    for (let i = 0; i < arr.length; i++) {
      const g = list[i];
      if (g) arr[i].set(g.x, g.y, g.z, g.r); else arr[i].set(0, -1e6, 0, 1);
    }
  }
  setHillshade(k: number, rotDeg = 0) {
    this.u.uHS.value = k;
    const hs = hillshadeLights(rotDeg);
    (this.u.uHSL.value as THREE.Vector3[]).forEach((v, i) => v.set(hs.dirs[i][0], hs.dirs[i][1], hs.dirs[i][2]));
  }
  setVisible(on: boolean) { for (const m of this.meshes) m.visible = on; if (this.skirt) this.skirt.visible = on && !this.driving; if (this.rim) this.rim.visible = on && !this.driving; }

  dispose() {
    this.clear();
    for (const o of this.owned) o.dispose();
    this.aoTex.dispose();
  }
}
