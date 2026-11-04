/**
 * Haul-string ribbons: a strip of per-leg quads (mitred at the joints) widened in the vertex shader so the road keeps
 * its true carriageway width (`uWidthM` = HaulString.roadWidthM) when near and never gets thinner than `uMinPx` when far.
 * One shader, three passes:
 *   mode 0 road  - the string line (grade / circuit colour, white casing with a hairline rim, chainage ticks, drifting
 *                  direction chevrons) at `uMinPx`; once the true carriageway is clearly wider on screen, a calm
 *                  grade-tinted band out to ±roadWidth/2 with thin casing lines on its edges (HRL width band) appears
 *                  round it, so planners see the real road geometry, not just the centre line
 *   mode 1 glow  - soft accent halo outside the road (selected / hovered)
 *   mode 2 ghost - dashed, faint copy drawn only where the road is hidden by the terrain (cuts), so it is never lost.
 * Pattern from the Rain Model VS_LINE/FS_LINE (§3.10 of docs/spec/03-design-rainmodel.md), ported to Three.js.
 */
import * as THREE from 'three';

export interface RibbonInput {
  /** Scene-space points (x, y, z). */
  pts: Float32Array;
  /** Cumulative chainage at each point (m). */
  chain: Float64Array | Float32Array;
  /** RGB per leg (0..1), length = (n − 1) × 3. */
  legColor: Float32Array;
  /** 1 where the point lies below the topo surface (the ghost pass only draws there). */
  buried?: Float32Array;
}

export function buildRibbonGeometry(inp: RibbonInput): THREE.BufferGeometry {
  const n = inp.pts.length / 3;
  const g = new THREE.BufferGeometry();
  if (n < 2) return g;
  // plan normals per leg
  const nx = new Float32Array(n - 1), nz = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = inp.pts[3 * i + 3] - inp.pts[3 * i], dz = inp.pts[3 * i + 5] - inp.pts[3 * i + 2];
    const l = Math.hypot(dx, dz) || 1;
    nx[i] = -dz / l; nz[i] = dx / l;
  }
  // mitred side vector per point
  const sx = new Float32Array(n), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) { sx[i] = nx[0]; sz[i] = nz[0]; continue; }
    if (i === n - 1) { sx[i] = nx[n - 2]; sz[i] = nz[n - 2]; continue; }
    let mx = nx[i - 1] + nx[i], mz = nz[i - 1] + nz[i];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-4) { sx[i] = nx[i]; sz[i] = nz[i]; continue; }
    mx /= ml; mz /= ml;
    const k = 1 / Math.max(0.4, mx * nx[i] + mz * nz[i]);
    sx[i] = mx * k; sz[i] = mz * k;
  }
  const legs = n - 1, V = legs * 4;
  const pos = new Float32Array(V * 3), side = new Float32Array(V * 2), across = new Float32Array(V);
  const chain = new Float32Array(V), col = new Float32Array(V * 3), leg = new Float32Array(V), bur = new Float32Array(V);
  const idx = new Uint32Array(legs * 6);
  for (let i = 0; i < legs; i++) {
    for (let k = 0; k < 4; k++) {
      const p = i + (k >> 1), v = i * 4 + k;
      pos[3 * v] = inp.pts[3 * p]; pos[3 * v + 1] = inp.pts[3 * p + 1]; pos[3 * v + 2] = inp.pts[3 * p + 2];
      side[2 * v] = sx[p]; side[2 * v + 1] = sz[p];
      across[v] = k & 1 ? 1 : -1;
      chain[v] = inp.chain[p];
      col[3 * v] = inp.legColor[3 * i]; col[3 * v + 1] = inp.legColor[3 * i + 1]; col[3 * v + 2] = inp.legColor[3 * i + 2];
      leg[v] = i;
      bur[v] = inp.buried ? inp.buried[p] : 0;
    }
    const b = i * 4;
    idx.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], i * 6);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 2));
  g.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
  g.setAttribute('aChain', new THREE.BufferAttribute(chain, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLeg', new THREE.BufferAttribute(leg, 1));
  g.setAttribute('aBuried', new THREE.BufferAttribute(bur, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 40; // widened in the shader
  return g;
}

const VS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aSide;
attribute float aAcross;
attribute float aChain;
attribute vec3 aColor;
attribute float aLeg;
attribute float aBuried;
uniform float uWidthM, uMinPx, uViewH, uLift, uExtraPx, uDpr;
varying float vAcross, vChain, vHalfPx, vMpp, vLeg, vBuried;
varying vec3 vColor;
void main() {
  vBuried = aBuried;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 cp = projectionMatrix * viewMatrix * wp;
  float w = max(cp.w, 1e-3);
  float mpp = 2.0 * w / (abs(projectionMatrix[1][1]) * uViewH);
  float halfPx = max(uWidthM * 0.5 / mpp, uMinPx * 0.5 * uDpr);
  float ext = halfPx + 1.0 + uExtraPx * uDpr;
  wp.xz += aSide * aAcross * ext * mpp;
  vec3 toEye = cameraPosition - wp.xyz;
  float d = length(toEye);
  wp.xyz += toEye / max(d, 1e-3) * min(d * uLift, 25.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
  vAcross = aAcross * ext;
  vChain = aChain;
  vHalfPx = halfPx;
  vMpp = mpp;
  vLeg = aLeg;
  vColor = aColor;
}`;

const FS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform int uMode;
uniform float uTime, uChevSpeed, uChev, uOpacity, uHover, uHoverLeg, uDpr, uTicks, uExtraPx, uDir, uMinPx, uBand, uBandA, uEdgeA;
uniform vec3 uCasing, uGlow;
varying float vAcross, vChain, vHalfPx, vMpp, vLeg, vBuried;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float ax = abs(vAcross);                 // device px from the centre line
  float halfPx = vHalfPx;
  if (uMode == 1) {                        // glow: a halo just outside the road edge, a faint tint inside
    float out_ = ax - halfPx;
    float gp = uExtraPx * uDpr;
    float a = out_ > 0.0 ? 1.0 - smoothstep(0.0, gp, out_) : 0.35;
    a *= a;
    gl_FragColor = vec4(uGlow, a * uOpacity);
    return;
  }
  // carriageway band: shown once the true road is clearly wider than the string line; the line then keeps uMinPx
  float coreMin = uMinPx * 0.5 * uDpr;
  float bandK = uBand * smoothstep(coreMin * 1.6, coreMin * 3.2, halfPx);
  float coreHalf = mix(halfPx, coreMin, bandK);
  float outA = clamp(halfPx - ax + 0.5, 0.0, 1.0);
  if (outA <= 0.0) discard;
  if (uMode == 2) {                        // ghost: stretches below the surface, dashed (string line only)
    float ga = clamp(coreHalf - ax + 0.5, 0.0, 1.0);
    if (vBuried < 0.5 || ga <= 0.0) discard;
    float dashPx = mod(vChain / vMpp, 16.0 * uDpr);
    if (dashPx > 9.0 * uDpr) discard;
    vec3 c = mix(vColor, vec3(1.0), 0.35);
    gl_FragColor = vec4(c, ga * 0.32 * uOpacity);
    return;
  }
  if (ax > coreHalf + 0.5 * uDpr) {
    // band: grade tint at a calm alpha, a thin darker casing line just inside each edge, a soft light halo outside it
    float fe = halfPx - ax;                                   // device px in from the edge
    float line = 1.0 - smoothstep(0.55 * uDpr, 1.25 * uDpr, abs(fe - 1.15 * uDpr));
    float halo = (1.0 - smoothstep(0.0, 1.0 * uDpr, abs(fe - 2.6 * uDpr))) * 0.5;
    vec3 edgeC = vColor * 0.52;
    vec3 c = mix(vColor, vec3(1.0), halo);
    c = mix(c, edgeC, line);
    float a = max(uBandA * (1.0 - halo * 0.6), max(line * uEdgeA, halo * 0.35));
    // soft hand-off into the string line's casing
    a *= smoothstep(0.0, 1.5 * uDpr, ax - coreHalf);
    gl_FragColor = vec4(c, a * bandK * outA * uOpacity);
    return;
  }
  halfPx = coreHalf;
  float fromEdge = halfPx - ax;
  float alpha = clamp(fromEdge + 0.5, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  float cw = clamp(halfPx * 0.16, 1.0 * uDpr, 3.2 * uDpr);
  vec3 col = vColor;
  float rel = ax / max(halfPx, 1.0);
  col *= 0.93 + 0.07 * (1.0 - rel * rel);  // crowned road
  // chainage ticks across the core (every 25..1000 m, at least 64 px apart)
  if (uTicks > 0.5 && halfPx > 4.0 * uDpr) {
    float stepM = 25.0;
    for (int k = 0; k < 6; k++) { if (stepM / vMpp < 64.0 * uDpr) stepM *= (k == 1 || k == 3) ? 2.5 : 2.0; }
    float dpx = abs(mod(vChain + stepM * 0.5, stepM) - stepM * 0.5) / vMpp;
    float tick = (1.0 - smoothstep(0.55 * uDpr, 1.35 * uDpr, dpx)) * step(ax, halfPx - cw - 1.0);
    col = mix(col, vec3(1.0), tick * 0.55);
  }
  // direction chevrons, drifting dig -> dump
  if (uChev > 0.0 && halfPx > 3.5 * uDpr) {
    float spacing = max(36.0, 84.0 * uDpr * vMpp);
    float ph = fract((vChain - uTime * uChevSpeed) / spacing);
    float along = (ph - 0.5) * spacing / vMpp * uDir;
    float hw = (halfPx - cw) * 0.66;
    float th = max(1.15 * uDpr, halfPx * 0.17);
    float dch = abs(along + 0.85 * ax);
    float ch = (1.0 - smoothstep(th * 0.5, th * 0.5 + uDpr, dch)) * (1.0 - smoothstep(hw - uDpr, hw, ax));
    col = mix(col, vec3(1.0), ch * mix(0.5, 0.28, smoothstep(14.0, 60.0, halfPx / uDpr)) * uChev);
  }
  // hover
  col = mix(col, vec3(1.0), 0.10 * uHover);
  if (abs(vLeg - uHoverLeg) < 0.5) col = mix(col, vec3(1.0), 0.22);
  // casing + rim
  float inCasing = 1.0 - smoothstep(cw - 0.5, cw + 0.5, fromEdge);
  col = mix(col, uCasing, inCasing);
  float rim = 1.0 - smoothstep(0.0, 0.9 * uDpr, fromEdge);
  col = mix(col, vec3(0.12, 0.15, 0.2), rim * 0.45);
  gl_FragColor = vec4(col, alpha * uOpacity);
}`;

export interface RibbonUniforms {
  [k: string]: THREE.IUniform;
  uMode: THREE.IUniform<number>;
  uWidthM: THREE.IUniform<number>;
  uMinPx: THREE.IUniform<number>;
  uViewH: THREE.IUniform<number>;
  uLift: THREE.IUniform<number>;
  uExtraPx: THREE.IUniform<number>;
  uDpr: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uChevSpeed: THREE.IUniform<number>;
  uChev: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uHover: THREE.IUniform<number>;
  uHoverLeg: THREE.IUniform<number>;
  uTicks: THREE.IUniform<number>;
  uDir: THREE.IUniform<number>;
  /** 1 = draw the carriageway band (mode 0) once the true width is wider than the line. */
  uBand: THREE.IUniform<number>;
  /** Band fill alpha / edge casing alpha. */
  uBandA: THREE.IUniform<number>;
  uEdgeA: THREE.IUniform<number>;
  uCasing: THREE.IUniform<THREE.Color>;
  uGlow: THREE.IUniform<THREE.Color>;
}

export function makeRibbonMaterial(mode: 0 | 1 | 2, shared: Pick<RibbonUniforms, 'uViewH' | 'uDpr' | 'uTime'>): THREE.ShaderMaterial & { uniforms: RibbonUniforms } {
  const uniforms: RibbonUniforms = {
    uMode: { value: mode },
    uWidthM: { value: 10 },
    uMinPx: { value: mode === 1 ? 6 : 5.5 },
    uViewH: shared.uViewH,
    uLift: { value: 0.0025 },
    uExtraPx: { value: mode === 1 ? 7 : 0 },
    uDpr: shared.uDpr,
    uTime: shared.uTime,
    uChevSpeed: { value: 9 },
    uChev: { value: 1 },
    uOpacity: { value: mode === 1 ? 0.0 : 1 },
    uHover: { value: 0 },
    uHoverLeg: { value: -10 },
    uTicks: { value: 1 },
    uDir: { value: 1 },
    uBand: { value: mode === 0 ? 1 : 0 },
    uBandA: { value: 0.18 },
    uEdgeA: { value: 0.8 },
    uCasing: { value: new THREE.Color('#ffffff') },
    uGlow: { value: new THREE.Color('#0A6FE6') },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VS,
    fragmentShader: FS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  if (mode === 2) m.depthFunc = THREE.GreaterDepth;
  return m as THREE.ShaderMaterial & { uniforms: RibbonUniforms };
}
