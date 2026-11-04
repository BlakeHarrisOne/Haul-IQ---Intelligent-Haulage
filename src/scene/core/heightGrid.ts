/**
 * Scene height grid: the topo surface rasterised to a regular node grid in LOCAL coordinates (x = E − E0, and
 * row axis = N − N0). Used for heightAt, fast terrain picking (ray march + bisection), baked ambient occlusion
 * and the contact shadow footprint. Local helper until '@/geom' exports rasterize/heightAt; same maths.
 */
import type { LocalMesh } from './meshUtil';

export class HeightGrid {
  /** Local x of node column 0 (= E − E0). */
  readonly ox: number;
  /** Local northing of node row 0 (= N − N0, so scene z = −(oy + j·dx)). */
  readonly oy: number;
  readonly dx: number;
  readonly nx: number;
  readonly ny: number;
  /** Local heights (Z − Z0), NaN = off-surface. */
  readonly h: Float32Array;
  minH = Infinity;
  maxH = -Infinity;
  validCount = 0;

  constructor(ox: number, oy: number, dx: number, nx: number, ny: number) {
    this.ox = ox; this.oy = oy; this.dx = dx; this.nx = nx; this.ny = ny;
    this.h = new Float32Array(nx * ny).fill(NaN);
  }

  /** Rasterise local meshes (scene coords at VE 1). Max height wins where they overlap. */
  static fromMeshes(meshes: LocalMesh[], maxNodes = 2_400_000): HeightGrid | null {
    if (!meshes.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, triArea = 0, triCount = 0;
    for (const m of meshes) {
      x0 = Math.min(x0, m.min[0]); x1 = Math.max(x1, m.max[0]);
      // local northing = −z
      y0 = Math.min(y0, -m.max[2]); y1 = Math.max(y1, -m.min[2]);
      const p = m.positions, t = m.index;
      const step = Math.max(1, Math.floor(t.length / 3 / 4000));
      for (let k = 0; k < t.length; k += 3 * step) {
        const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
        triArea += Math.abs((p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c] - p[a])) / 2;
        triCount++;
      }
    }
    const W = x1 - x0, H = y1 - y0;
    if (!(W > 0 && H > 0)) return null;
    // node spacing ≈ triangle edge (sqrt(2·area)), at least 0.5 m, grid capped at maxNodes
    let dx = Math.max(0.5, Math.sqrt((2 * triArea) / Math.max(1, triCount)) * 0.9);
    while ((W / dx + 1) * (H / dx + 1) > maxNodes) dx *= 1.15;
    const nx = Math.floor(W / dx) + 2, ny = Math.floor(H / dx) + 2;
    const g = new HeightGrid(x0, y0, dx, nx, ny);
    for (const m of meshes) g.rasterize(m);
    g.finish();
    return g;
  }

  private rasterize(m: LocalMesh) {
    const p = m.positions, t = m.index, { ox, oy, dx, nx, ny, h } = this;
    const inv = 1 / dx;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      const ax = p[a], ay = -p[a + 2], az = p[a + 1];
      const bx = p[b], by = -p[b + 2], bz = p[b + 1];
      const cx = p[c], cy = -p[c + 2], cz = p[c + 1];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - ox) * inv - 1e-9));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - ox) * inv + 1e-9));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - oy) * inv - 1e-9));
      const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - oy) * inv + 1e-9));
      const id = 1 / den;
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * dx;
        for (let i = i0; i <= i1; i++) {
          const x = ox + i * dx;
          const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) * id;
          const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) * id;
          const w3 = 1 - w1 - w2;
          if (w1 < -1e-7 || w2 < -1e-7 || w3 < -1e-7) continue;
          const z = w1 * az + w2 * bz + w3 * cz;
          const o = j * nx + i;
          const cur = h[o];
          if (!(cur >= z)) h[o] = z;
        }
      }
    }
  }

  private finish() {
    let mn = Infinity, mx = -Infinity, cnt = 0;
    const h = this.h;
    for (let i = 0; i < h.length; i++) {
      const v = h[i];
      if (v === v) { cnt++; if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    this.minH = mn; this.maxH = mx; this.validCount = cnt;
  }

  /** Local height at local plan point (x = E − E0, y = N − N0); bilinear, NaN when off-surface. */
  at(x: number, y: number): number {
    const fx = (x - this.ox) / this.dx, fy = (y - this.oy) / this.dx;
    if (fx < 0 || fy < 0 || fx > this.nx - 1 || fy > this.ny - 1) return NaN;
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j, nx = this.nx, h = this.h;
    const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i], d = h[(j + 1) * nx + i + 1];
    if (a === a && b === b && c === c && d === d) return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    // partial cell at the edge: inverse-distance of the valid corners, only if the nearest corner is valid
    const near = h[(ty < 0.5 ? j : j + 1) * nx + (tx < 0.5 ? i : i + 1)];
    if (near !== near) return NaN;
    let s = 0, w = 0;
    const acc = (v: number, wx: number, wy: number) => { if (v === v) { const k = wx * wy + 1e-6; s += v * k; w += k; } };
    acc(a, 1 - tx, 1 - ty); acc(b, tx, 1 - ty); acc(c, 1 - tx, ty); acc(d, tx, ty);
    return w > 0 ? s / w : NaN;
  }

  /** Height in SCENE units at scene (x, z), given vertical exaggeration. NaN off-surface. */
  sceneY(x: number, z: number, ve: number): number {
    return this.at(x, -z) * ve;
  }

  /**
   * March a scene-space ray against the surface. Returns ray parameter t of the first hit or −1.
   * o/d are scene space (d need not be unit). Coarse march at ~0.8 node spacing in plan, then bisection.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ve: number, tLimit = Infinity): number {
    // clip to the grid's AABB in scene space
    const x0 = this.ox, x1 = this.ox + (this.nx - 1) * this.dx;
    const z0 = -(this.oy + (this.ny - 1) * this.dx), z1 = -this.oy;
    const y0 = this.minH * ve - 1, y1 = this.maxH * ve + 1;
    let tmin = 0, tmax = tLimit;
    const slab = (o: number, d: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      tmin = Math.max(tmin, ta); tmax = Math.min(tmax, tb);
      return tmin <= tmax;
    };
    if (!slab(ox, dx, x0, x1) || !slab(oy, dy, y0, y1) || !slab(oz, dz, z0, z1)) return -1;
    const horiz = Math.hypot(dx, dz), len = Math.hypot(dx, dy, dz);
    // step so that plan advance ≈ 0.8 dx, but vertical advance ≤ 4 dx·ve-ish, bounded count
    let step = (0.8 * this.dx) / Math.max(horiz, 1e-6);
    step = Math.min(step, (4 * this.dx) / Math.max(len, 1e-6));
    const n = Math.min(6000, Math.ceil((tmax - tmin) / step) + 1);
    step = (tmax - tmin) / Math.max(1, n - 1);
    let tPrev = tmin, fPrev = NaN;
    for (let s = 0; s < n; s++) {
      const t = tmin + s * step;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const hy = this.at(x, -z) * ve;
      const f = y - hy;
      if (f === f) {
        if (f <= 0) {
          if (fPrev !== fPrev) return t; // entered from off-surface below ground (edge): accept
          // bisection between tPrev (above) and t (below)
          let a = tPrev, b = t;
          for (let it = 0; it < 24; it++) {
            const m = (a + b) / 2;
            const ym = oy + dy * m, hm = this.at(ox + dx * m, -(oz + dz * m)) * ve;
            if (ym - hm > 0 || hm !== hm) a = m; else b = m;
          }
          return (a + b) / 2;
        }
      }
      tPrev = t; fPrev = f;
    }
    return -1;
  }

  /**
   * Horizon-based ambient occlusion (Rain Model lineage) + a fine curvature term, baked to an RG8 image (row 0 =
   * south): R = AO (8 directions, radii out to `reach` m, mean sine of the horizon angle), G = 0.5 + convexity
   * (crest > 0.5, toe < 0.5) from the mean depression vs elevation angles within ~3 nodes. `vex` exaggerates
   * relief for the occlusion test (shading only). Computed on ≤ maxNodes.
   */
  bakeAO(maxNodes = 700_000, reach = 90, vex = 1.5): { data: Uint8Array; w: number; h: number; step: number } {
    const s = Math.max(1, Math.ceil(Math.sqrt((this.nx * this.ny) / maxNodes)));
    const w = Math.ceil(this.nx / s), hgt = Math.ceil(this.ny / s);
    const out = new Uint8Array(w * hgt * 2);
    const d = this.dx * s;
    const radiiM = [d * 0.75, d * 1.5, d * 2.5, 6, 10, 15, 22, 32, 45, 64, reach].filter((r, i, a) => r >= this.dx * 0.6 && (i === 0 || r > a[i - 1]));
    const fine = [this.dx, this.dx * 2, this.dx * 3];
    const dirs: [number, number][] = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; dirs.push([Math.cos(a), Math.sin(a)]); }
    const nx = this.nx, ny = this.ny, h = this.h;
    const sample = (x: number, y: number) => {
      const i = Math.round(x), j = Math.round(y);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return NaN;
      return h[j * nx + i];
    };
    for (let jj = 0; jj < hgt; jj++) {
      const j = Math.min(ny - 1, jj * s);
      for (let ii = 0; ii < w; ii++) {
        const i = Math.min(nx - 1, ii * s);
        const z0 = h[j * nx + i];
        const o = (jj * w + ii) * 2;
        if (z0 !== z0) { out[o] = 255; out[o + 1] = 128; continue; }
        let occ = 0, up = 0, dn = 0;
        for (let k = 0; k < 8; k++) {
          const [cx, cy] = dirs[k];
          let tm = 0;
          for (let r = 0; r < radiiM.length; r++) {
            const R = radiiM[r] / this.dx;
            const zs = sample(i + cx * R, j + cy * R);
            if (zs !== zs) continue;
            const t = ((zs - z0) * vex) / radiiM[r];
            if (t > tm) tm = t;
          }
          occ += tm / Math.sqrt(1 + tm * tm);
          let tp = 0, tn = 0;
          for (let r = 0; r < fine.length; r++) {
            const R = fine[r] / this.dx;
            const zs = sample(i + cx * R, j + cy * R);
            if (zs !== zs) continue;
            const t = (zs - z0) / fine[r];
            if (t > tp) tp = t;
            if (-t > tn) tn = -t;
          }
          up += tp / Math.sqrt(1 + tp * tp);
          dn += tn / Math.sqrt(1 + tn * tn);
        }
        const ao = 1 - occ / 8;
        const curv = (dn - up) / 8; // + crest, − toe
        out[o] = Math.max(0, Math.min(255, Math.round(ao * 255)));
        out[o + 1] = Math.max(0, Math.min(255, Math.round((0.5 + curv * 1.6) * 255)));
      }
    }
    return { data: out, w, h: hgt, step: s };
  }

  /** Valid-node mask as an RGBA canvas-ready alpha image (downsampled to ≤ maxSide), row 0 = NORTH (image order). */
  footprint(maxSide = 256): { data: Uint8ClampedArray; w: number; h: number } {
    const s = Math.max(1, Math.ceil(Math.max(this.nx, this.ny) / maxSide));
    const w = Math.ceil(this.nx / s), hh = Math.ceil(this.ny / s);
    const img = new Uint8ClampedArray(w * hh * 4);
    for (let jj = 0; jj < hh; jj++) {
      for (let ii = 0; ii < w; ii++) {
        const v = this.h[Math.min(this.ny - 1, jj * s) * this.nx + Math.min(this.nx - 1, ii * s)];
        const o = ((hh - 1 - jj) * w + ii) * 4;
        img[o + 3] = v === v ? 255 : 0;
      }
    }
    return { data: img, w, h: hh };
  }

  /**
   * Heights smoothed by `passes` × a 3-tap box in each direction (NaN-aware; off-surface stays NaN). Contours are
   * drawn from this on gentle ground so survey noise does not crinkle them (HRL contours a ~2 m smoothed surface).
   */
  smoothed(passes = 2): Float32Array {
    const { nx, ny } = this;
    let src = this.h;
    const tmp = new Float32Array(nx * ny), out = new Float32Array(nx * ny);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < ny; j++) {
        const r = j * nx;
        for (let i = 0; i < nx; i++) {
          const c = src[r + i];
          if (c !== c) { tmp[r + i] = NaN; continue; }
          let s = c, n = 1;
          if (i > 0) { const v = src[r + i - 1]; if (v === v) { s += v; n++; } }
          if (i < nx - 1) { const v = src[r + i + 1]; if (v === v) { s += v; n++; } }
          tmp[r + i] = s / n;
        }
      }
      for (let j = 0; j < ny; j++) {
        const r = j * nx;
        for (let i = 0; i < nx; i++) {
          const c = tmp[r + i];
          if (c !== c) { out[r + i] = NaN; continue; }
          let s = c, n = 1;
          if (j > 0) { const v = tmp[r - nx + i]; if (v === v) { s += v; n++; } }
          if (j < ny - 1) { const v = tmp[r + nx + i]; if (v === v) { s += v; n++; } }
          out[r + i] = s / n;
        }
      }
      if (p < passes - 1) src = out.slice();
    }
    return out;
  }

  /** Low percentile of valid heights (pit floor estimate). */
  percentile(p: number): number {
    const step = Math.max(1, Math.floor(this.h.length / 60000));
    const vals: number[] = [];
    for (let i = 0; i < this.h.length; i += step) { const v = this.h[i]; if (v === v) vals.push(v); }
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * vals.length)))];
  }
}
