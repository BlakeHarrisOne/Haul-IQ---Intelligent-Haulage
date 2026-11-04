/**
 * Mesh analysis: topology (closed / boundary edges), statistics (bbox, plan area, volume, centroid),
 * vertex welding, surface-vs-solid classification and Float32 render buffers.
 *
 * Inputs are world-coordinate MeshData (E, N, Z metres, float64). Sums are accumulated relative to the
 * bounding-box centre so MGA-sized coordinates (~236 000 / 7 051 000) do not lose precision.
 */
import type { AssetKind, BBox3, MeshData, MeshStats, Vec3 } from '@/core/types';

/** Edge-level topology of a triangulation. */
export interface MeshTopology {
  /** Distinct undirected edges (edges of degenerate triangles excluded). */
  edges: number;
  /** Edges used by exactly one triangle. */
  boundaryEdges: number;
  /** Edges used by three or more triangles. */
  nonManifoldEdges: number;
  /** Two-triangle edges traversed in the same direction by both (inconsistent winding). */
  inconsistentEdges: number;
  /** Triangles with a repeated vertex index (ignored for topology). */
  degenerateTriangles: number;
  /** True when every edge is shared by exactly two triangles. */
  closed: boolean;
}

/** Number of vertices in a mesh. */
export const vertexCount = (m: MeshData): number => (m.verts.length / 3) | 0;
/** Number of triangles in a mesh. */
export const triangleCount = (m: MeshData): number => (m.tris.length / 3) | 0;

/**
 * Edge topology via a per-vertex CSR edge list (no hash map): O(T) memory, fast for 2M triangles.
 * Each undirected edge is stored under its lower vertex index together with its traversal direction.
 */
export function meshTopology(mesh: MeshData): MeshTopology {
  const tris = mesh.tris;
  const V = vertexCount(mesh), T = triangleCount(mesh);
  const start = new Uint32Array(V + 1);
  let degenerate = 0;
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    if (a === b || b === c || c === a || a >= V || b >= V || c >= V) { degenerate++; continue; }
    start[(a < b ? a : b) + 1]++;
    start[(b < c ? b : c) + 1]++;
    start[(c < a ? c : a) + 1]++;
  }
  for (let v = 0; v < V; v++) start[v + 1] += start[v];
  const fill = start.slice(0, V);
  const nb = new Uint32Array(start[V]);
  const put = (p: number, q: number) => {
    // value = hi * 2 + (1 when traversed lo → hi)
    if (p < q) nb[fill[p]++] = q * 2 + 1;
    else nb[fill[q]++] = p * 2;
  };
  for (let t = 0; t < T; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    if (a === b || b === c || c === a || a >= V || b >= V || c >= V) continue;
    put(a, b); put(b, c); put(c, a);
  }
  let edges = 0, boundary = 0, nonManifold = 0, inconsistent = 0;
  for (let v = 0; v < V; v++) {
    const s = start[v], e = start[v + 1];
    if (e - s > 1) sortSmall(nb, s, e);
    let i = s;
    while (i < e) {
      const hi = nb[i] >>> 1;
      let j = i, fwd = 0;
      while (j < e && nb[j] >>> 1 === hi) { fwd += nb[j] & 1; j++; }
      const k = j - i;
      edges++;
      if (k === 1) boundary++;
      else if (k === 2) { if (fwd !== 1) inconsistent++; }
      else nonManifold++;
      i = j;
    }
  }
  return {
    edges, boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent,
    degenerateTriangles: degenerate, closed: edges > 0 && boundary === 0 && nonManifold === 0,
  };
}

function sortSmall(a: Uint32Array, s: number, e: number): void {
  if (e - s > 24) { a.subarray(s, e).sort(); return; }
  for (let i = s + 1; i < e; i++) {
    const x = a[i];
    let j = i - 1;
    while (j >= s && a[j] > x) { a[j + 1] = a[j]; j--; }
    a[j + 1] = x;
  }
}

/** Axis-aligned bounding box of the vertices (m). Empty meshes give a zero box at the origin. */
export function meshBBox(mesh: MeshData): BBox3 {
  const v = mesh.verts;
  if (v.length < 3) return { min: [0, 0, 0], max: [0, 0, 0] };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** Signed volume (m³) by the divergence theorem; positive when triangles wind outward (CCW seen from outside). */
export function signedVolume(mesh: MeshData): number {
  const { verts: v, tris } = mesh;
  const bb = meshBBox(mesh);
  const rx = (bb.min[0] + bb.max[0]) / 2, ry = (bb.min[1] + bb.max[1]) / 2, rz = (bb.min[2] + bb.max[2]) / 2;
  let s = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = v[a] - rx, ay = v[a + 1] - ry, az = v[a + 2] - rz;
    const bx = v[b] - rx, by = v[b + 1] - ry, bz = v[b + 2] - rz;
    const cx = v[c] - rx, cy = v[c + 1] - ry, cz = v[c + 2] - rz;
    s += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return s / 6;
}

/**
 * Statistics for an asset: counts, bbox, plan area (m²), closedness, volume (m³, closed only) and centroid.
 * Plan area: open surfaces sum |plan area| of every triangle; closed solids report the footprint
 * (half the summed |plan area|, exact when the solid has no overhangs).
 * Centroid: volume centroid for closed solids, 3D-area-weighted surface centroid for open surfaces.
 */
export function meshStats(mesh: MeshData, topology: MeshTopology = meshTopology(mesh)): MeshStats {
  const { verts: v, tris } = mesh;
  const bbox = meshBBox(mesh);
  const rx = (bbox.min[0] + bbox.max[0]) / 2, ry = (bbox.min[1] + bbox.max[1]) / 2, rz = (bbox.min[2] + bbox.max[2]) / 2;
  let plan = 0, vol6 = 0, vcx = 0, vcy = 0, vcz = 0, area = 0, acx = 0, acy = 0, acz = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = v[a] - rx, ay = v[a + 1] - ry, az = v[a + 2] - rz;
    const bx = v[b] - rx, by = v[b + 1] - ry, bz = v[b + 2] - rz;
    const cx = v[c] - rx, cy = v[c + 1] - ry, cz = v[c + 2] - rz;
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    plan += Math.abs(nz) / 2;
    const ta = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    area += ta;
    acx += ta * (ax + bx + cx) / 3; acy += ta * (ay + by + cy) / 3; acz += ta * (az + bz + cz) / 3;
    const d = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    vol6 += d;
    vcx += d * (ax + bx + cx); vcy += d * (ay + by + cy); vcz += d * (az + bz + cz);
  }
  const closed = topology.closed;
  let centroid: Vec3;
  let volume: number | undefined;
  if (closed && Math.abs(vol6) > 1e-12) {
    volume = Math.abs(vol6) / 6;
    centroid = [rx + vcx / (4 * vol6), ry + vcy / (4 * vol6), rz + vcz / (4 * vol6)];
  } else if (area > 0) {
    if (closed) volume = 0;
    centroid = [rx + acx / area, ry + acy / area, rz + acz / area];
  } else {
    centroid = [rx, ry, rz];
  }
  return {
    vertexCount: vertexCount(mesh),
    triangleCount: triangleCount(mesh),
    bbox,
    planArea: closed ? plan / 2 : plan,
    closed,
    boundaryEdges: topology.boundaryEdges,
    volume,
    centroid,
  };
}

/** 'solid' for a closed mesh with positive volume, otherwise 'surface'. */
export function classifyMesh(mesh: MeshData, stats: MeshStats = meshStats(mesh)): AssetKind {
  return stats.closed && (stats.volume ?? 0) > 1e-9 ? 'solid' : 'surface';
}

/**
 * Merges vertices closer than `tolM` metres (3D) and remaps triangles, dropping triangles that become
 * degenerate. Uses a plan hash grid of cell ≥ tol (3×3 neighbourhood search). Returns a new mesh.
 */
export function weldVertices(mesh: MeshData, tolM: number): MeshData {
  const v = mesh.verts, V = vertexCount(mesh);
  if (V === 0) return { verts: new Float64Array(0), tris: new Uint32Array(0) };
  const bb = meshBBox(mesh);
  const ext = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], 1e-9);
  const tol = Math.max(tolM, 0);
  const cell = Math.max(tol, ext / 1e6, 1e-9);
  const ncol = Math.floor(ext / cell) + 3;
  const heads = new Map<number, number>();
  const next = new Int32Array(V).fill(-1);
  const remap = new Int32Array(V);
  const out: number[] = [];
  const tol2 = tol * tol;
  let reps = 0;
  for (let i = 0; i < V; i++) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    const ci = Math.floor((x - bb.min[0]) / cell) + 1, cj = Math.floor((y - bb.min[1]) / cell) + 1;
    let found = -1;
    for (let dj = -1; dj <= 1 && found < 0; dj++) for (let di = -1; di <= 1 && found < 0; di++) {
      let r = heads.get((cj + dj) * ncol + ci + di);
      while (r !== undefined && r >= 0) {
        const p = remap[r] * 3;
        const ddx = out[p] - x, ddy = out[p + 1] - y, ddz = out[p + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= tol2) { found = remap[r]; break; }
        r = next[r];
      }
    }
    if (found >= 0) { remap[i] = found; continue; }
    remap[i] = reps++;
    out.push(x, y, z);
    const key = cj * ncol + ci;
    const h = heads.get(key);
    next[i] = h === undefined ? -1 : h;
    heads.set(key, i);
  }
  const t = mesh.tris, nt: number[] = [];
  for (let k = 0; k < t.length; k += 3) {
    const a = remap[t[k]], b = remap[t[k + 1]], c = remap[t[k + 2]];
    if (a !== b && b !== c && c !== a) nt.push(a, b, c);
  }
  return { verts: Float64Array.from(out), tris: Uint32Array.from(nt) };
}

/** Concatenates meshes into one (indices offset; no welding). */
export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  let nv = 0, nt = 0;
  for (const m of meshes) { nv += m.verts.length; nt += m.tris.length; }
  const verts = new Float64Array(nv), tris = new Uint32Array(nt);
  let ov = 0, ot = 0;
  for (const m of meshes) {
    verts.set(m.verts, ov);
    const base = ov / 3;
    for (let i = 0; i < m.tris.length; i++) tris[ot + i] = m.tris[i] + base;
    ov += m.verts.length; ot += m.tris.length;
  }
  return { verts, tris };
}

/** Returns a copy with every triangle's winding reversed (normals flipped). */
export function flipWinding(mesh: MeshData): MeshData {
  const t = mesh.tris.slice();
  for (let i = 0; i < t.length; i += 3) { const b = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = b; }
  return { verts: mesh.verts, tris: t };
}

/** Float32 render buffers in the Three.js scene frame. */
export interface LocalBuffers {
  /** [x, y, z, …] scene coordinates (m): x = E − E0, y = (Z − Z0)·vx, z = −(N − N0). */
  positions: Float32Array;
  /** 0-based triangle indices (a copy when faceUp flipped any triangle, else the mesh's own array). */
  index: Uint32Array;
}

/**
 * World mesh → Float32 scene buffers using the core/frame.ts convention (x = E − E0, y = (Z − Z0)·vx,
 * z = −(N − N0)). This mapping is a proper rotation, so winding (and outward normals) is preserved.
 * @param origin site origin [E0, N0, Z0] (m)
 * @param opts.verticalExaggeration multiplies heights (default 1)
 * @param opts.faceUp flip triangles whose normal points down (useful for surfaces with mixed winding)
 */
export function toLocalFloat32(
  mesh: MeshData, origin: Vec3, opts: { verticalExaggeration?: number; faceUp?: boolean } = {},
): LocalBuffers {
  const vx = opts.verticalExaggeration ?? 1;
  const v = mesh.verts, n = v.length / 3;
  const positions = new Float32Array(n * 3);
  const [e0, n0, z0] = origin;
  for (let i = 0; i < n; i++) {
    positions[i * 3] = v[i * 3] - e0;
    positions[i * 3 + 1] = (v[i * 3 + 2] - z0) * vx;
    positions[i * 3 + 2] = -(v[i * 3 + 1] - n0);
  }
  let index = mesh.tris;
  if (opts.faceUp) {
    let copied = false;
    const t = mesh.tris;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      const cz = (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a]);
      if (cz < 0) {
        if (!copied) { index = t.slice(); copied = true; }
        index[k + 1] = t[k + 2]; index[k + 2] = t[k + 1];
      }
    }
  }
  return { positions, index };
}

/**
 * Area-weighted per-vertex normals (unit, Float32) for rendering.
 * @param positions flat xyz (any frame)
 * @param index triangle indices
 */
export function computeNormals(positions: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const n = positions.length / 3;
  const acc = new Float64Array(n * 3);
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k] * 3, b = index[k + 1] * 3, c = index[k + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
    acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
    acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]);
    if (l > 0) { out[i] = acc[i] / l; out[i + 1] = acc[i + 1] / l; out[i + 2] = acc[i + 2] / l; }
    else out[i + 1] = 1;
  }
  return out;
}
