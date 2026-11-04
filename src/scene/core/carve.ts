/**
 * Solid "column" atlas for the terrain shader: each dig / dump solid rasterised to a small plan grid of its lowest
 * and highest surface (zmin, zmax) + coverage, packed side by side in one RGBA half-float texture. With the
 * solid's live depletion plane as a uniform, the terrain vertex shader carves the dug part of a dig block out of
 * the surface (face-advance faces snap onto the plane, so the face moves continuously) and the fragment shader
 * recolours cut / fill keeping the hillshade (Rain Model's carved-blue / built-sage trick) — no CPU work per
 * timeline step beyond a few uniforms.
 */
import * as THREE from 'three';
import type { LocalMesh } from './meshUtil';

export const CARVE_MAX = 8;

/** GLSL shared by the terrain material and its shadow-depth material (vertex stage). */
export const CARVE_GLSL = /* glsl */ `
uniform sampler2D uSCol; uniform int uSN; uniform float uSnap;
uniform vec4 uSRect[${CARVE_MAX}]; uniform vec4 uSUV[${CARVE_MAX}]; uniform vec4 uSPlane[${CARVE_MAX}]; uniform vec4 uSInfo[${CARVE_MAX}];
// p: local VE-1 position (x = E, y = Z, z = −N). Returns the carved position; cf = (cut depth, fill thickness, fresh).
vec3 hk_carve(vec3 p, inout vec3 cf, inout float carved) {
  for (int i = 0; i < ${CARVE_MAX}; i++) {
    if (i >= uSN) break;
    vec2 pw = vec2(p.x, -p.z);
    vec4 R = uSRect[i];
    vec2 uv = (pw - R.xy) * R.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    vec4 I = uSInfo[i];
    if (I.x < 0.5) continue;
    vec4 col = textureLod(uSCol, uSUV[i].xy + uv * uSUV[i].zw, 0.0);
    float cov = smoothstep(0.2, 0.8, col.b);
    if (cov <= 0.0) continue;
    float zmin = I.z + col.r, zmax = I.z + col.g;
    if (p.y > zmax + 3.0 || p.y < zmin - 3.0) continue;
    vec4 P = uSPlane[i];
    float nz = P.z;
    float dPlan = dot(P.xy, pw) - P.w;
    if (I.x < 1.5) {
      // dig: the done part of the column is gone
      float top = p.y, newTop = top;
      if (nz < -0.3) newTop = min(top, max(-dPlan / nz, zmin));
      else if (nz > 0.3) { if (-dPlan / nz >= zmax - 0.05) newTop = zmin; }
      else {
        float d = dPlan + nz * 0.5 * (zmin + zmax);
        if (d <= 0.0) {
          newTop = min(top, zmin);
          // within one terrain cell behind the face: slide onto the face so it advances smoothly
          if (d > -uSnap) { float l2 = max(dot(P.xy, P.xy), 1e-6); pw -= P.xy * (d / l2); p.x = pw.x; p.z = -pw.y; }
        }
      }
      float depth = max(0.0, top - newTop) * cov;
      if (depth > 0.0) {
        p.y = top - depth;
        carved = 1.0;
        cf.x = max(cf.x, depth);
        // fresh = exposed this shift: beyond the slab-start plane (n·p > c0)
        float d0 = dot(P.xyz, vec3(pw, p.y)) - I.y;
        cf.z = max(cf.z, smoothstep(-0.05, 0.05, d0) * cov);
      }
    } else {
      // dump: placed thickness (tint only; the lift itself is a lit mesh)
      float t;
      if (nz > 0.3) t = clamp(-dPlan / nz - zmin, 0.0, zmax - zmin);
      else if (nz < -0.3) t = clamp(zmax + dPlan / nz, 0.0, zmax - zmin);
      else t = dPlan + nz * 0.5 * (zmin + zmax) <= 0.0 ? zmax - zmin : 0.0;
      cf.y = max(cf.y, t * cov);
    }
  }
  return p;
}`;

interface Slot { id: string; kind: 1 | 2; x0: number; y0: number; w: number; h: number; cs: number; zBase: number; ox: number }

export class CarveAtlas {
  readonly uniforms: Record<string, THREE.IUniform>;
  private tex: THREE.DataTexture;
  private slots = new Map<string, number>();
  private list: Slot[] = [];

  constructor() {
    this.tex = CarveAtlas.emptyTex();
    this.uniforms = {
      uSCol: { value: this.tex },
      uSN: { value: 0 },
      uSnap: { value: 4 },
      uSRect: { value: Array.from({ length: CARVE_MAX }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uSUV: { value: Array.from({ length: CARVE_MAX }, () => new THREE.Vector4(0, 0, 1, 1)) },
      uSPlane: { value: Array.from({ length: CARVE_MAX }, () => new THREE.Vector4(0, 0, 1, -1e9)) },
      uSInfo: { value: Array.from({ length: CARVE_MAX }, () => new THREE.Vector4(0, -1e9, 0, 0)) },
    };
  }

  private static emptyTex(): THREE.DataTexture {
    const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    t.needsUpdate = true;
    return t;
  }

  /** Terrain node spacing (m): faces within one cell slide onto the plane. */
  setSnap(m: number) { this.uniforms.uSnap.value = Math.max(0.5, m * 1.05); }

  /** Rebuild from the solids (digs first, then dumps; at most CARVE_MAX). */
  build(solids: { id: string; kind: 'dig' | 'dump'; local: LocalMesh; volume: number }[]) {
    this.slots.clear();
    this.list = [];
    const sorted = [...solids].sort((a, b) => (a.kind === b.kind ? b.volume - a.volume : a.kind === 'dig' ? -1 : 1)).slice(0, CARVE_MAX);
    const grids: { slot: Slot; data: Float32Array }[] = [];
    let atlasW = 0, atlasH = 1;
    for (const s of sorted) {
      const L = s.local;
      const minX = L.min[0], maxX = L.max[0], minN = -L.max[2], maxN = -L.min[2];
      const span = Math.max(maxX - minX, maxN - minN, 1);
      const cs = Math.max(0.75, span / 110);
      const w = Math.ceil((maxX - minX) / cs) + 3, h = Math.ceil((maxN - minN) / cs) + 3;
      const x0 = minX - cs * 1.5, y0 = minN - cs * 1.5;
      const zBase = L.min[1];
      const slot: Slot = { id: s.id, kind: s.kind === 'dig' ? 1 : 2, x0, y0, w, h, cs, zBase, ox: atlasW };
      grids.push({ slot, data: rasterColumns(L, x0, y0, cs, w, h, zBase) });
      atlasW += w + 1;
      atlasH = Math.max(atlasH, h);
    }
    const data = new Uint16Array(Math.max(1, atlasW) * atlasH * 4);
    const toH = THREE.DataUtils.toHalfFloat;
    for (const { slot, data: g } of grids) {
      for (let j = 0; j < slot.h; j++) for (let i = 0; i < slot.w; i++) {
        const s = (j * slot.w + i) * 4, d = (j * atlasW + slot.ox + i) * 4;
        data[d] = toH(g[s]); data[d + 1] = toH(g[s + 1]); data[d + 2] = toH(g[s + 2]); data[d + 3] = toH(1);
      }
    }
    this.tex.dispose();
    const tex = new THREE.DataTexture(data, Math.max(1, atlasW), atlasH, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.tex = tex;
    this.uniforms.uSCol.value = tex;
    const U = this.uniforms;
    grids.forEach(({ slot }, k) => {
      this.slots.set(slot.id, k);
      this.list.push(slot);
      (U.uSRect.value as THREE.Vector4[])[k].set(slot.x0, slot.y0, 1 / (slot.w * slot.cs), 1 / (slot.h * slot.cs));
      (U.uSUV.value as THREE.Vector4[])[k].set(slot.ox / Math.max(1, atlasW), 0, slot.w / Math.max(1, atlasW), slot.h / atlasH);
      (U.uSInfo.value as THREE.Vector4[])[k].set(slot.kind, -1e9, slot.zBase, 0);
      (U.uSPlane.value as THREE.Vector4[])[k].set(0, 0, 1, -1e9);
    });
    U.uSN.value = grids.length;
  }

  /**
   * Live depletion plane of one solid, '@/geom' convention (normal = direction the face moves, world E/N/Z
   * components; done where n·p ≤ c). `cLocal` / `c0Local` are relative to the scene origin; c0 = the plane at the
   * start of the period (fresh = exposed since then). `on` = false hides the solid's effect (asset hidden).
   */
  setPlane(id: string, n: [number, number, number], cLocal: number, c0Local: number, on = true) {
    const k = this.slots.get(id);
    if (k === undefined) return;
    (this.uniforms.uSPlane.value as THREE.Vector4[])[k].set(n[0], n[1], n[2], cLocal);
    const info = (this.uniforms.uSInfo.value as THREE.Vector4[])[k];
    info.x = on ? this.list[k].kind : 0;
    info.y = c0Local;
  }

  dispose() { this.tex.dispose(); }
}

/**
 * zmin / zmax (relative to zBase) and coverage of a closed solid on a plan grid (texel centres), RGBA floats.
 * Cells the solid does not cover hold zmin = zmax = mid height (so linear filtering ramps the thickness to 0).
 */
function rasterColumns(L: LocalMesh, x0: number, y0: number, cs: number, w: number, h: number, zBase: number): Float32Array {
  const zmin = new Float32Array(w * h).fill(Infinity), zmax = new Float32Array(w * h).fill(-Infinity);
  const p = L.positions, t = L.index;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const ax = p[a], ay = -p[a + 2], az = p[a + 1];
    const bx = p[b], by = -p[b + 2], bz = p[b + 1];
    const cx = p[c], cy = -p[c + 2], cz = p[c + 1];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cs - 0.5));
    const i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cs - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / cs - 0.5));
    const j1 = Math.min(h - 1, Math.floor((Math.max(ay, by, cy) - y0) / cs - 0.5));
    const id = 1 / den;
    for (let j = j0; j <= j1; j++) {
      const y = y0 + (j + 0.5) * cs;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * cs;
        const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) * id;
        const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) * id;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
        const z = w1 * az + w2 * bz + w3 * cz;
        const o = j * w + i;
        if (z < zmin[o]) zmin[o] = z;
        if (z > zmax[o]) zmax[o] = z;
      }
    }
  }
  const mid = (L.min[1] + L.max[1]) / 2 - zBase;
  const out = new Float32Array(w * h * 4);
  for (let o = 0; o < w * h; o++) {
    const ok = zmax[o] > -Infinity;
    out[o * 4] = ok ? zmin[o] - zBase : mid;
    out[o * 4 + 1] = ok ? zmax[o] - zBase : mid;
    out[o * 4 + 2] = ok ? 1 : 0;
    out[o * 4 + 3] = 1;
  }
  return out;
}
