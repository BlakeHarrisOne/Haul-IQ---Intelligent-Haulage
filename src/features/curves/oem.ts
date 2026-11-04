/**
 * Provenance + per-gear curves for a TruckModel. Prefers fields the data layer puts on the truck (engine
 * TruckModelExt: rimpullGears, retarderGears, dataQuality, estimationMethod); falls back to the machine library
 * src/data/oem-curves.json (read-only, engine-owned) matched by id / model.
 */
import type { CurvePoint, TruckModel } from '@/core/types';
import type { GearCurveX, TruckX } from './physics';

interface OemTruck {
  id: string; make: string; model: string; site_aliases?: string[]; drive: string;
  engine: { model?: string; gross_kW: number; net_kW: number | null; rated_rpm?: number };
  mass: { empty_t: number; nominal_payload_t: number; gvw_max_t: number; notes?: string };
  body?: { default_heaped_m3?: number; struck_m3?: number };
  tyre?: string;
  turning?: { clearance_circle_diameter_m?: number };
  transmission: { type?: string; gears: { gear: number; max_kmh: number }[]; top_speed_kmh: number; reverse_kmh?: number | null; notes?: string };
  rimpull: { curves?: { gear: number | string; points: number[][] }[]; stall_rimpull_kN?: number; stall_rimpull_source?: string; efficiency_rim_over_net?: number; efficiency_rim_over_gross?: number };
  retarder: { curves?: { gear: number | string; points: number[][] }[]; continuous_power_kW?: number; power_source?: string; descent_speed_rule_default?: string };
  sources?: { field: string; url: string }[];
  estimated?: Record<string, boolean>;
  data_quality?: Record<string, string>;
  estimation_method?: string;
}
interface OemFile { status?: string; provenance_note?: string; trucks: OemTruck[] }

const mods = import.meta.glob<{ default: OemFile }>('/src/data/oem-curves.json', { eager: true });
const lib = (): OemFile | undefined => Object.values(mods)[0]?.default;

export const libraryStatus = () => lib()?.status;
export const libraryProvenance = () => lib()?.provenance_note;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function oemFor(t: TruckModel): OemTruck | undefined {
  const L = lib();
  if (!L) return undefined;
  return L.trucks.find(o => o.id === t.id)
    ?? L.trucks.find(o => norm(o.model) === norm(t.model))
    ?? L.trucks.find(o => (o.site_aliases ?? []).some(a => norm(a) === norm(t.model) || norm(t.name).endsWith(norm(a))))
    ?? L.trucks.find(o => norm(t.name).includes(norm(o.model)));
}

function gearCurves(raw: { gear: number | string; points: number[][] }[] | undefined, gears: { gear: number; max_kmh: number }[]): GearCurveX[] | undefined {
  if (!raw?.length || raw.some(c => typeof c.gear !== 'number')) return undefined;
  return raw.map(c => ({
    gear: c.gear as number,
    maxKmh: gears.find(g => g.gear === c.gear)?.max_kmh ?? Math.max(...c.points.map(p => p[0])),
    points: c.points.map(p => [p[0], p[1]] as CurvePoint),
  }));
}

/** TruckModel enriched with per-gear curves / provenance when the data layer has not attached them. */
export function withPhysics(t: TruckModel): TruckX {
  const x = t as TruckX;
  if (x.rimpullGears && x.dataQuality) return x;
  const o = oemFor(t);
  if (!o) return x;
  return {
    ...x,
    rimpullGears: x.rimpullGears ?? gearCurves(o.rimpull.curves, o.transmission.gears),
    retarderGears: x.retarderGears ?? gearCurves(o.retarder.curves, o.transmission.gears),
    retarderPowerKW: x.retarderPowerKW ?? o.retarder.continuous_power_kW,
    descentRule: x.descentRule ?? (o.retarder.descent_speed_rule_default as TruckX['descentRule']),
    dataQuality: x.dataQuality ?? o.data_quality,
    estimationMethod: x.estimationMethod ?? o.estimation_method,
    netPowerKW: x.netPowerKW ?? o.engine.net_kW ?? undefined,
  };
}

export type Quality = 'oem' | 'oem_derived' | 'third_party' | 'estimated' | 'n/a' | 'unknown';
export const QUALITY_LABEL: Record<Quality, string> = {
  oem: 'OEM', oem_derived: 'OEM-derived', third_party: '3rd party', estimated: 'Estimated', 'n/a': 'n/a', unknown: 'not recorded',
};
export const qualityTone = (q: Quality): 'ok' | 'info' | 'warn' | 'na' => (q === 'oem' ? 'ok' : q === 'oem_derived' ? 'info' : q === 'estimated' || q === 'third_party' ? 'warn' : 'na');

/** Provenance of a spec-sheet field: data_quality key, else the TruckModel.estimated list. */
export function qualityOf(t: TruckX, key: string, estimatedField?: string): Quality {
  const dq = t.dataQuality ?? oemFor(t)?.data_quality;
  const v = dq?.[key];
  if (v) return (['oem', 'oem_derived', 'third_party', 'estimated', 'n/a'].includes(v) ? v : 'unknown') as Quality;
  if (t.estimated?.includes(estimatedField ?? key)) return 'estimated';
  return 'unknown';
}

export interface SpecRow { label: string; value: string; quality: Quality; note?: string }

export function specRows(t: TruckX): SpecRow[] {
  const o = oemFor(t);
  const f = (v: number | undefined, dp = 1, unit = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('en-AU', { maximumFractionDigits: dp })}${unit ? ' ' + unit : ''}`);
  const gears = t.gears?.length ? t.gears.map(g => `${g.gear}: ${f(g.maxKmh, 1)}`).join(' · ') : t.drive === 'electric' ? 'AC electric — no gears' : '—';
  return [
    { label: 'Drive', value: t.drive === 'electric' ? 'AC electric' : 'Mechanical', quality: 'oem', note: o?.transmission.type },
    { label: 'Engine', value: `${f(o?.engine.gross_kW, 0, 'kW gross')}${o?.engine.net_kW ? ` / ${f(o.engine.net_kW, 0)} net` : ''}`, quality: qualityOf(t, 'engine', 'enginePowerKW'), note: o?.engine.model },
    { label: 'Empty mass', value: f(t.emptyMassT, 1, 't'), quality: qualityOf(t, 'empty_mass', 'emptyMassT'), note: o?.mass.notes },
    { label: 'Nominal payload', value: f(t.payloadT, 1, 't'), quality: qualityOf(t, 'payload', 'payloadT') },
    { label: 'GVW (max)', value: f(t.gvwT, 1, 't'), quality: qualityOf(t, 'gvw', 'gvwT') },
    { label: 'Gears (max km/h)', value: gears, quality: qualityOf(t, 'gear_speeds', 'gears') },
    { label: 'Top speed', value: f(t.topSpeedKmh, 1, 'km/h'), quality: qualityOf(t, 'gear_speeds', 'topSpeedKmh'), note: o?.transmission.notes },
    { label: 'Stall rimpull', value: f(o?.rimpull.stall_rimpull_kN ?? t.rimpull[0]?.[1], 0, 'kN'), quality: qualityOf(t, 'stall_rimpull'), note: o?.rimpull.stall_rimpull_source },
    { label: 'Rimpull curves', value: t.rimpullGears?.length ? `${t.rimpullGears.length} gears + envelope` : `${t.rimpull.length}-point envelope`, quality: qualityOf(t, 'rimpull_curve', 'rimpull'), note: 'Power-based model from net power and OEM gear speeds — see method below.' },
    { label: 'Retarder', value: `${f(t.retarderPowerKW ?? o?.retarder.continuous_power_kW, 0, 'kW continuous')} · ${descent(t)}`, quality: qualityOf(t, 'retarder', 'retarder'), note: o?.retarder.power_source },
    { label: 'Body (heaped)', value: f(t.bodyHeapedM3 ?? o?.body?.default_heaped_m3, 1, 'm³'), quality: qualityOf(t, 'body', 'bodyHeapedM3') },
    { label: 'Tyre', value: t.dims.tyre ?? o?.tyre ?? '—', quality: qualityOf(t, 'tyre', 'tyre') },
    { label: 'Dimensions L × W × H', value: `${f(t.dims.length, 1)} × ${f(t.dims.width, 1)} × ${f(t.dims.height, 1)} m`, quality: dimsQuality(t, 'dims'), note: srcNote(t, /dimension/i) },
    { label: 'Operator eye height', value: f(t.dims.eyeHeight, 1, 'm'), quality: dimsQuality(t, 'dims.eyeHeight'), note: t.dims.eyeBack != null ? `${f(t.dims.eyeBack, 2)} m behind front · ${f(Math.abs(t.dims.eyeRight ?? 0), 2)} m ${(t.dims.eyeRight ?? 0) < 0 ? 'left' : 'right'} of centre` : undefined },
    { label: 'Turning circle', value: f(o?.turning?.clearance_circle_diameter_m, 1, 'm'), quality: qualityOf(t, 'turning') },
  ];
}

function dimsQuality(t: TruckX, field: string): Quality {
  if (t.estimated?.some(e => e === 'dims' || e === field)) return 'estimated';
  if (t.dataQuality?.dims) return qualityOf(t, 'dims');
  return t.sources?.some(x => /dimension/i.test(x.title)) ? 'third_party' : 'unknown';
}
const srcNote = (t: TruckModel, re: RegExp) => t.sources?.find(x => re.test(x.title))?.title.replace(/^.*? · /, '');

function descent(t: TruckX) {
  const r = t.descentRule ?? oemFor(t)?.retarder.descent_speed_rule_default;
  return r === 'discrete_gear' ? 'holds highest sustainable gear (Cat ARC)' : r === 'continuous' ? 'continuous speed control' : 'descent rule n/a';
}

export function sourcesOf(t: TruckModel): { field: string; url?: string; title: string }[] {
  if (t.sources?.length) {
    return t.sources.map(x => {
      const parts = x.title.split(' · ');
      if (x.url) return { field: parts.length > 1 ? parts[parts.length - 1] : 'source', url: x.url, title: hostOf(x.url) };
      return { field: 'reference', title: x.title.startsWith(t.name) ? x.title.slice(t.name.length).trim() : x.title };
    });
  }
  const o = oemFor(t);
  return (o?.sources ?? []).map(x => ({ field: x.field, url: x.url, title: hostOf(x.url) }));
}
function hostOf(u: string) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
