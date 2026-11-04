/** Haul string exports: CSV (one row per point, with overrides) and DXF R12 (3D POLYLINE per string, layer = string name). */
import type { HaulString, Scenario } from '@/core/types';
import { toDxf3dPolyline } from '@/geom';

const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function stringsToCsv(strings: HaulString[]): string {
  const rows = ['string,name,point,easting,northing,rl,snapped,speed_limit_kmh,rr_pct,zone,stop,label'];
  for (const s of strings) {
    s.points.forEach((p, i) => {
      rows.push([
        q(s.id), q(s.name), i + 1, p.e.toFixed(3), p.n.toFixed(3), p.z.toFixed(3), p.snapped ? 1 : 0,
        p.seg?.speedLimitKmh ?? '', p.seg?.rrPct ?? '', p.seg?.zone ?? '', p.stop ? 1 : 0, q(p.label ?? ''),
      ].join(','));
    });
  }
  return rows.join('\n') + '\n';
}

/** AutoCAD R12 DXF (3D POLYLINE per string) - the geometry module's writer. */
export const stringsToDxf = (strings: HaulString[]) => toDxf3dPolyline(strings);

export const stringsFileBase = (s: Scenario) => (s.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'scenario') + '-strings';
