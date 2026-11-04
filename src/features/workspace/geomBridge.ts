/** Geometry I/O used by the import flow (worker-safe: no DOM, no scene imports). */
import type { HaulString, MeshAsset, MeshData, MeshStats } from '@/core/types';
import { buildHeightIndex, fromVec3, meshStats, parse00t, parseStringsText, snapPoints } from '@/geom';
import { nowIso, uid } from '@/core/ids';

export function read00t(buf: ArrayBuffer): { mesh: MeshData; stats: MeshStats; warnings: string[] } {
  const p = parse00t(buf);
  return { mesh: p.mesh, stats: meshStats(p.mesh), warnings: p.warnings };
}

/**
 * Text strings (.str / .csv / .txt) → HaulStrings. Strings without elevations (all Z = 0) are draped on the
 * topo surface when the scenario has one.
 */
export function readStringsText(text: string, fileName: string, colours: readonly string[], topo?: MeshAsset, existing = 0): { strings: HaulString[]; warnings: string[] } {
  const parsed = parseStringsText(text, fileName.replace(/\.[^.]+$/, ''));
  const warnings = [...parsed.warnings];
  let index: ReturnType<typeof buildHeightIndex> | null = null;
  const t = nowIso();
  const strings = parsed.strings.map((ps, i): HaulString => {
    let points = fromVec3(ps.points);
    if (topo && points.length && points.every(p => !p.z)) {
      index ??= buildHeightIndex(topo.mesh);
      points = snapPoints(index, points);
      if (i === 0) warnings.push('Strings had no elevations – draped on the topo surface.');
    }
    return {
      id: uid('str'), name: ps.name || `String ${existing + i + 1}`, color: colours[(existing + i) % colours.length],
      points, source: 'imported', visible: true, createdAt: t, updatedAt: t,
    };
  });
  return { strings, warnings };
}
