/**
 * Truck and loader library built from ./oem-curves.json (copy of docs/spec/fixtures/oem-curves.json).
 * Rimpull / retarder curves are ESTIMATES (power model, spec 04 §G.2) unless the fixture says otherwise; the
 * `estimated` flags are carried into TruckModel.estimated so the UI can badge them.
 */
import type { CurvePoint, LoaderModel, Source, TruckModel } from '@/core/types';
import type { GearCurve, TruckModelExt } from '@/engine/types';
import { envelopeOf } from '@/engine/util/curve';
import oem from './oem-curves.json';
import { DEFAULT_MATERIALS } from './materials';
import { WORKBOOK_SPEEDS, WORKBOOK_TRUCK_LOADS } from './tables';

interface OemCurve { gear: number | string; points: number[][] }
interface OemTruck {
  id: string;
  make: string;
  model: string;
  site_aliases?: string[];
  drive: string;
  engine: { model?: string; gross_kW: number; net_kW: number | null };
  mass: { empty_t: number; nominal_payload_t: number; gvw_max_t: number; weight_distribution_pct?: { loaded_front_rear: number[]; empty_front_rear: number[] } };
  body?: { default_heaped_m3?: number };
  tyre?: string;
  transmission: { gears: { gear: number; max_kmh: number }[]; top_speed_kmh: number };
  rimpull: { model: string; curves: OemCurve[]; envelope: number[][] };
  retarder: { model: string; continuous_power_kW?: number; descent_speed_rule_default?: string; low_speed_force_cap_kN?: number; curves: OemCurve[] };
  sources: { field: string; url: string }[];
  estimated: Record<string, boolean>;
  data_quality?: Record<string, string>;
  estimation_method?: string;
}
interface OemLoader {
  id: string; make: string; model: string; type: string; operating_weight_t: number | number[] | Record<string, number>;
  bucket_m3_options: Record<string, number[]>; typical_cycle_s: number; cycle_estimated?: boolean; sources: { field: string; url: string }[];
}

const OEM_TRUCKS = (oem as unknown as { trucks: OemTruck[] }).trucks;
const OEM_LOADERS = (oem as unknown as { loaders: OemLoader[] }).loaders;

/** Display names (site convention). */
const NAMES: Record<string, string> = {
  CAT_789C: 'CAT 789C', CAT_789D: 'CAT 789D', KOM_HD1500_7: 'KOM HD1500-7', KOM_HD785_7: 'KOM HD785-7',
  CAT_793F: 'CAT 793F', CAT_777G: 'CAT 777G', KOM_830E_5: 'KOM 830E-5', KOM_930E_5: 'KOM 930E-5',
};

/** Machine dimensions (m) and driver eye position: Haul Road Lab fleet library (hrl-fleet.json) or estimates. */
const DIMS: Record<string, { d: TruckModel['dims']; estimated: boolean }> = {
  CAT_789C: { d: { length: 12.177, width: 7.674, height: 6.15, eyeHeight: 4.52, eyeBack: 3.29, eyeRight: -2.79, tyre: '37.00-R57 (E4)' }, estimated: false },
  CAT_789D: { d: { length: 12.697, width: 7.645, height: 6.496, eyeHeight: 4.8, eyeBack: 3.43, eyeRight: -2.77, tyre: '37.00-R57' }, estimated: false },
  KOM_HD1500_7: { d: { length: 11.37, width: 6.89, height: 5.85, eyeHeight: 4.435, eyeBack: 3.07, eyeRight: -2.39, tyre: '33.00R51' }, estimated: false },
  KOM_HD785_7: { d: { length: 10.29, width: 6.885, height: 5.05, eyeHeight: 3.85, eyeBack: 2.78, eyeRight: -2.39, tyre: '27.00 R49' }, estimated: false },
  CAT_793F: { d: { length: 13.5, width: 7.6, height: 6.5, eyeHeight: 4.9, eyeBack: 3.5, eyeRight: -2.8 }, estimated: true },
  CAT_777G: { d: { length: 10.5, width: 6.1, height: 4.9, eyeHeight: 3.9, eyeBack: 2.8, eyeRight: -2.2 }, estimated: true },
  KOM_830E_5: { d: { length: 14.4, width: 7.3, height: 6.9, eyeHeight: 5.1, eyeBack: 3.6, eyeRight: -2.6 }, estimated: true },
  KOM_930E_5: { d: { length: 15.6, width: 8.7, height: 7.4, eyeHeight: 5.6, eyeBack: 3.9, eyeRight: -3.0 }, estimated: true },
};

/** Body colours: Cat yellow, Komatsu yellow with dark trim. */
const COLOURS: Record<string, { body: string; trim: string }> = {
  Caterpillar: { body: '#E8B321', trim: '#1F1F1F' },
  Komatsu: { body: '#F2C230', trim: '#2B2F36' },
};
const COLOUR_OVERRIDE: Record<string, string> = { CAT_789D: '#E3A91B' };

const pts = (a: number[][]): CurvePoint[] => a.map(p => [p[0], p[1]] as CurvePoint);

const QUALITY_FIELD: Record<string, string> = {
  engine: 'enginePowerKW', gear_speeds: 'gears', gvw: 'gvwT', empty_mass: 'emptyMassT', payload: 'payloadT', body: 'bodyHeapedM3', tyre: 'dims.tyre',
};

function buildTruck(o: OemTruck): TruckModelExt {
  const gearMax = new Map(o.transmission.gears.map(g => [g.gear, g.max_kmh]));
  const rimpullGears: GearCurve[] = o.rimpull.curves.filter(c => typeof c.gear === 'number')
    .map(c => ({ gear: c.gear as number, maxKmh: gearMax.get(c.gear as number) ?? c.points[c.points.length - 1][0], points: pts(c.points) }));
  const retarderGears: GearCurve[] = o.retarder.curves.filter(c => typeof c.gear === 'number')
    .map(c => ({ gear: c.gear as number, maxKmh: gearMax.get(c.gear as number) ?? c.points[c.points.length - 1][0], points: pts(c.points) }));
  const retEnv = o.retarder.curves.find(c => c.gear === 'envelope');
  const retarder = retEnv ? pts(retEnv.points) : envelopeOf(retarderGears.map(g => g.points));
  const estimated = new Set<string>();
  if (o.estimated.rimpull) { estimated.add('rimpull'); estimated.add('rimpullGears'); }
  if (o.estimated.stall_rimpull) estimated.add('rimpull.stall');
  if (o.estimated.retarder_power) estimated.add('retarderPowerKW');
  if (o.estimated.retarder_curve_shape) { estimated.add('retarder'); estimated.add('retarderGears'); }
  if (o.estimated.gear_speeds) { estimated.add('gears'); estimated.add('topSpeedKmh'); }
  for (const [k, q] of Object.entries(o.data_quality ?? {})) if ((q === 'third_party' || q === 'estimated') && QUALITY_FIELD[k]) estimated.add(QUALITY_FIELD[k]);
  const dims = DIMS[o.id] ?? { d: { length: 12, width: 7, height: 6, eyeHeight: 4.5 }, estimated: true };
  if (dims.estimated) estimated.add('dims'); else ['dims.eyeHeight', 'dims.eyeBack', 'dims.eyeRight'].forEach(f => estimated.add(f));
  // nominal truck load per material: workbook table where it exists, else payload / bank density (estimated)
  const wl = WORKBOOK_TRUCK_LOADS[o.id];
  const loadBcmByMaterial: Record<string, number> = {};
  for (const m of DEFAULT_MATERIALS) {
    const w = wl ? (wl as unknown as Record<string, number>)[m.id] : undefined;
    if (typeof w === 'number') loadBcmByMaterial[m.id] = w;
    else { loadBcmByMaterial[m.id] = Math.round((o.mass.nominal_payload_t / m.bankDensity) * 10) / 10; estimated.add(`loadBcmByMaterial.${m.id}`); }
  }
  const colour = COLOURS[o.make] ?? COLOURS.Caterpillar;
  const name = NAMES[o.id] ?? `${o.make} ${o.model}`;
  const sources: Source[] = [
    ...o.sources.map(s => ({ title: `${name} · ${s.field}`, url: s.url })),
    { title: `hAIul SIM machine library (oem-curves.json): ${o.rimpull.model} rimpull, ${o.retarder.model} retarder — curves are model outputs, not digitised OEM charts` },
    ...(dims.estimated ? [] : [{ title: `${name} dimensions & eye position · Haul Road Lab fleet library` }]),
    ...(wl ? [{ title: `Truck load bcm · calc.xlsm ActiveRoute!${wl.cells.OB.split('!')[1]} (OB) / ${wl.cells.CL.split('!')[1]} (coal)` }] : []),
    { title: "Spreadsheet speeds · calc.xlsm 'Travel Time'!P3:Q35 / S3:T35 (one table for all trucks)" },
  ];
  const wd = o.mass.weight_distribution_pct;
  return {
    id: o.id, name, make: o.make, model: o.model, drive: o.drive.startsWith('electric') ? 'electric' : 'mechanical',
    emptyMassT: o.mass.empty_t, payloadT: o.mass.nominal_payload_t, gvwT: o.mass.gvw_max_t, enginePowerKW: o.engine.gross_kW,
    topSpeedKmh: o.transmission.top_speed_kmh, gears: o.transmission.gears.map(g => ({ gear: g.gear, maxKmh: g.max_kmh })),
    // gear-aware envelope (max over the per-gear curves at every breakpoint): the fixture's fixed-speed sampled envelope
    // interpolates across gear changes (e.g. 789C 12 → 14 km/h) and would overstate rimpull just above each upshift
    rimpull: rimpullGears.length ? envelopeOf(rimpullGears.map(g => g.points)) : pts(o.rimpull.envelope), retarder, bodyHeapedM3: o.body?.default_heaped_m3, loadBcmByMaterial,
    spreadsheetSpeeds: { loaded: WORKBOOK_SPEEDS.loaded.map(p => [p[0], p[1]]), empty: WORKBOOK_SPEEDS.empty.map(p => [p[0], p[1]]) },
    dims: dims.d, color: COLOUR_OVERRIDE[o.id] ?? colour.body, sources, estimated: [...estimated],
    rimpullGears, retarderGears, retarderPowerKW: o.retarder.continuous_power_kW, retarderCapKN: o.retarder.low_speed_force_cap_kN,
    descentRule: o.retarder.descent_speed_rule_default === 'discrete_gear' ? 'discrete_gear' : 'continuous',
    driveAxleShare: wd ? { loaded: wd.loaded_front_rear[1] / 100, empty: wd.empty_front_rear[1] / 100 } : undefined,
    netPowerKW: o.engine.net_kW ?? undefined, trimColor: colour.trim, dataQuality: o.data_quality, estimationMethod: o.estimation_method,
    siteAliases: o.site_aliases,
  };
}

/** All truck models of the machine library (8 trucks). */
export const TRUCK_MODELS: TruckModelExt[] = OEM_TRUCKS.map(buildTruck);

/** Site loader labels (workbook EXCAVATOR ASSUMPTIONS / bucket table) by model. */
const LOADER_SITE: Record<string, { name: string; type: LoaderModel['type']; classLabel: string; bucketM3?: number; bucketSrc?: string }> = {
  KOM_PC4000_11: { name: 'KOM PC4000', type: 'excavator', classLabel: '400-ton class', bucketM3: 22, bucketSrc: 'calc.xlsm ActiveRoute!R5 (EX04 22 cbm)' },
  LIE_R996B: { name: 'LIEB R996B', type: 'excavator', classLabel: '600-ton class', bucketM3: 34, bucketSrc: 'calc.xlsm ActiveRoute!R6 (EX07 34 cbm)' },
  HIT_EX2600_7: { name: 'HIT EX2600', type: 'excavator', classLabel: '250-ton class', bucketM3: 15, bucketSrc: 'calc.xlsm ActiveRoute!R7 (EX06 15 cbm)' },
  HIT_EX5600_7: { name: 'HIT EX5600', type: 'excavator', classLabel: '550-ton class', bucketM3: 31, bucketSrc: 'OEM loading shovel 29–31 m³ (upper value; not in the workbook)' },
  KOM_WA900_8: { name: 'KOM WA900', type: 'loader', classLabel: '100-ton class', bucketM3: 18, bucketSrc: 'calc.xlsm ActiveRoute!R8 (LDR401/402 18 cbm)' },
};

function buildLoader(o: OemLoader): LoaderModel {
  const site = LOADER_SITE[o.id];
  const w = o.operating_weight_t;
  const mass = typeof w === 'number' ? w : Array.isArray(w) ? (w[0] + w[w.length - 1]) / 2 : Math.max(...Object.values(w));
  const bucket = site?.bucketM3 ?? Object.values(o.bucket_m3_options).flat()[0];
  const name = site?.name ?? `${o.make} ${o.model}`;
  return {
    id: o.id, name, make: o.make, model: o.model, type: site?.type ?? (/wheel/i.test(o.type) ? 'loader' : 'excavator'), classLabel: site?.classLabel,
    bucketM3: bucket, cycleS: o.typical_cycle_s, operatingMassT: mass,
    sources: [...o.sources.map(s => ({ title: `${name} · ${s.field}`, url: s.url })), ...(site?.bucketSrc ? [{ title: `Bucket · ${site.bucketSrc}` }] : [])],
    estimated: o.cycle_estimated ? ['cycleS'] : [],
  };
}

/** Loader library (5 loaders). */
export const LOADER_MODELS: LoaderModel[] = OEM_LOADERS.map(buildLoader);
