/**
 * Haulage feature ↔ '@/geom': height-index memoisation (per immutable mesh), topo lookup and a memoised section cut.
 * Everything else is used straight from '@/geom'.
 */
import { buildHeightIndex, sectionCut as geomSectionCut, type HeightIndex, type SectionCut } from '@/geom';
import type { MeshAsset, MeshData, Scenario } from '@/core/types';

export type { HeightIndex, SectionCut };

const indexCache = new WeakMap<MeshData, HeightIndex | null>();

/** Height index of a mesh, built once per mesh object (meshes are never mutated in the scenario). */
export function heightIndexFor(mesh: MeshData | undefined): HeightIndex | null {
  if (!mesh) return null;
  if (indexCache.has(mesh)) return indexCache.get(mesh) ?? null;
  let idx: HeightIndex | null = null;
  try { idx = buildHeightIndex(mesh); } catch (e) { console.warn('buildHeightIndex failed', e); }
  indexCache.set(mesh, idx);
  return idx;
}

/** The topo surface used for snapping, profiles and sections. */
export function topoAsset(s: Scenario): MeshAsset | undefined {
  return s.assets.find(a => a.role === 'topo' && a.kind === 'surface') ?? s.assets.find(a => a.role === 'topo');
}

export const topoIndex = (s: Scenario): HeightIndex | null => heightIndexFor(topoAsset(s)?.mesh);

const cutCache = new WeakMap<MeshData, { key: string; cut: SectionCut }>();

/** geom.sectionCut, memoised per mesh for the last A–B line. */
export function sectionCut(mesh: MeshData, a: [number, number], b: [number, number]): SectionCut {
  const key = `${a[0]},${a[1]},${b[0]},${b[1]}`;
  const hit = cutCache.get(mesh);
  if (hit && hit.key === key) return hit.cut;
  let cut: SectionCut;
  try { cut = geomSectionCut(mesh, a, b); } catch (e) { console.warn('sectionCut failed', e); cut = { lengthM: Math.hypot(b[0] - a[0], b[1] - a[1]), paths: [] }; }
  cutCache.set(mesh, { key, cut });
  return cut;
}
