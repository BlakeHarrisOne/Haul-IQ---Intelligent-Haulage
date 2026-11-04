/**
 * Procedural near-field ground detail: a small tileable "gravel" texture generated once on the CPU (no assets),
 * sampled by the terrain shader within ~150 m of the eye (two rotated scales + triplanar on faces, so the tile never
 * reads). R = albedo (pebbles lighter / darker than the fines, dark gaps), G = height (pebble domes, for the bump),
 * B = fines noise.
 */
import * as THREE from 'three';

function hash(i: number): number {
  let x = (i | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Tileable value noise on an n×n lattice, sampled at (x, y) in texels of a size×size image. */
function tileNoise(x: number, y: number, size: number, n: number, seed: number): number {
  const fx = (x / size) * n, fy = (y / size) * n;
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const h = (a: number, b: number) => hash(((((a % n) + n) % n) * 7919 + (((b % n) + n) % n)) * 31 + seed);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function makeGravelTexture(size = 256): THREE.DataTexture {
  const N = size * size;
  const alb = new Float32Array(N), hgt = new Float32Array(N), fin = new Float32Array(N);
  // fines: three octaves of tileable noise
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const f = tileNoise(x, y, size, 8, 1) * 0.5 + tileNoise(x, y, size, 24, 2) * 0.3 + tileNoise(x, y, size, 64, 3) * 0.2;
    const o = y * size + x;
    fin[o] = f;
    alb[o] = 0.86 + 0.22 * (f - 0.5);
    hgt[o] = 0.25 * f;
  }
  // pebbles: random discs (wrapped), domed height, tone per stone, dark rim (shadowed gap)
  const count = Math.round(N / 70);
  for (let k = 0; k < count; k++) {
    const cx = hash(k * 4 + 11) * size, cy = hash(k * 4 + 12) * size;
    const r = 1.6 + Math.pow(hash(k * 4 + 13), 2.2) * 6.5;
    const tone = 0.72 + hash(k * 4 + 14) * 0.62;
    const elong = 0.7 + hash(k * 7 + 5) * 0.6, rot = hash(k * 7 + 6) * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const R = Math.ceil(r * 1.6 + 1);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const ex = (dx * cr + dy * sr) / elong, ey = -dx * sr + dy * cr;
      const d = Math.sqrt(ex * ex + ey * ey) / r;
      if (d > 1.35) continue;
      const x = (((Math.floor(cx + dx)) % size) + size) % size, y = (((Math.floor(cy + dy)) % size) + size) % size;
      const o = y * size + x;
      if (d < 1) {
        const dome = Math.sqrt(1 - d * d);
        if (0.25 + dome * 0.75 > hgt[o]) {
          // top-left lit facet on the stone, then its own tone
          const lit = 1 + 0.18 * ((-dx - dy) / (r * 1.4)) * dome;
          alb[o] = tone * lit * (0.92 + 0.08 * fin[o]);
          hgt[o] = 0.25 + dome * 0.75;
        }
      } else {
        // the gap round a stone: shaded fines
        alb[o] *= 0.86 + 0.14 * (d - 1) / 0.35;
      }
    }
  }
  const data = new Uint8Array(N * 4);
  for (let o = 0; o < N; o++) {
    data[o * 4] = Math.max(0, Math.min(255, Math.round(alb[o] * 160)));
    data[o * 4 + 1] = Math.max(0, Math.min(255, Math.round(hgt[o] * 255)));
    data[o * 4 + 2] = Math.max(0, Math.min(255, Math.round(fin[o] * 255)));
    data[o * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
