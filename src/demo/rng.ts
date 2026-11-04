/** Deterministic pseudo-random helpers for the demo site (no Math.random). */

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smooth 2D value noise in [−1, 1]: random lattice values every `cellM` metres, smoothstep-interpolated.
 * @param width,height extent covered from (0, 0) (m)
 */
export function valueNoise2D(rand: () => number, width: number, height: number, cellM: number): (x: number, y: number) => number {
  const nx = Math.ceil(width / cellM) + 2, ny = Math.ceil(height / cellM) + 2;
  const lat = new Float64Array(nx * ny);
  for (let i = 0; i < lat.length; i++) lat[i] = rand() * 2 - 1;
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = Math.max(0, Math.min(nx - 1.000001, x / cellM)), fy = Math.max(0, Math.min(ny - 1.000001, y / cellM));
    const i = Math.floor(fx), j = Math.floor(fy), tx = s(fx - i), ty = s(fy - j), k = j * nx + i;
    const a = lat[k] + (lat[k + 1] - lat[k]) * tx;
    const b = lat[k + nx] + (lat[k + nx + 1] - lat[k + nx]) * tx;
    return a + (b - a) * ty;
  };
}
