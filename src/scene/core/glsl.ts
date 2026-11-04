/** Shared GLSL snippets (noise, bump, hillshade) for scene core materials. */

export const NOISE_GLSL = /* glsl */ `
float hk_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hk_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hk_hash12(i), b = hk_hash12(i + vec2(1.0, 0.0));
  float c = hk_hash12(i + vec2(0.0, 1.0)), d = hk_hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Multi-scale ground detail in metres, each octave faded out before it aliases (fw = metres per pixel).
float hk_ground(vec2 p, float fw) {
  float s = (hk_vnoise(p / 210.0) - 0.5) * 0.9;
  s += (hk_vnoise(p / 53.0 + 3.1) - 0.5) * 0.6 * (1.0 - smoothstep(5.0, 15.0, fw));
  s += (hk_vnoise(p / 13.0 + 7.7) - 0.5) * 0.42 * (1.0 - smoothstep(1.3, 3.8, fw));
  s += (hk_vnoise(p / 3.1 + 1.3) - 0.5) * 0.34 * (1.0 - smoothstep(0.3, 0.9, fw));
  s += (hk_vnoise(p / 0.7 + 9.1) - 0.5) * 0.28 * (1.0 - smoothstep(0.07, 0.2, fw));
  return s;
}
// Bump height for the micro relief (fine octaves only).
float hk_bump(vec2 p, float fw) {
  float s = (hk_vnoise(p / 6.0 + 2.2) - 0.5) * 0.9 * (1.0 - smoothstep(0.6, 1.6, fw));
  s += (hk_vnoise(p / 1.7 + 5.5) - 0.5) * 0.35 * (1.0 - smoothstep(0.17, 0.45, fw));
  s += (hk_vnoise(p / 0.45 + 8.8) - 0.5) * 0.12 * (1.0 - smoothstep(0.05, 0.12, fw));
  return s;
}
`;

export const BUMP_GLSL = /* glsl */ `
vec3 hk_perturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy) {
  vec3 vSigmaX = dFdx(surfPos);
  vec3 vSigmaY = dFdy(surfPos);
  vec3 R1 = cross(vSigmaY, surfNorm);
  vec3 R2 = cross(surfNorm, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surfNorm - vGrad);
}
`;

/** Directions for the 4-light survey hillshade (Rain Model / matplotlib): az, weight; altitude 40°. */
export function hillshadeLights(rotDeg = 0): { dirs: number[][]; weights: number[] } {
  const L: [number, number][] = [[315, 0.45], [45, 0.2], [225, 0.15], [135, 0.2]];
  const al = (40 * Math.PI) / 180;
  return {
    dirs: L.map(([az]) => {
      const a = ((az + rotDeg) * Math.PI) / 180;
      return [Math.sin(a) * Math.cos(al), Math.sin(al), -Math.cos(a) * Math.cos(al)];
    }),
    weights: L.map(l => l[1]),
  };
}
