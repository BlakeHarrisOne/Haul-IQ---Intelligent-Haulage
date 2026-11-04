/**
 * Baselines for "changed from default" highlighting on the Site assumptions tables.
 *
 * Preferred source: '@/data' defaultScenarioData() (engine agent). Fallback: the workbook tables in
 * src/data/spreadsheet-tables.json (read-only). Both are loaded through import.meta.glob so this module compiles and
 * runs whether or not the data module exists yet.
 */
import type { GradeSpeedPoint, LoaderAssumptions, Material, MaterialId, Scenario, ShiftProfile, TruckModel } from '@/core/types';

type DataMod = { defaultScenarioData?: () => Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'> };
const dataMods = import.meta.glob<DataMod>('/src/data/index.ts', { eager: true });
const tableMods = import.meta.glob<{ default: SheetTables }>('/src/data/spreadsheet-tables.json', { eager: true });

interface SheetTables {
  speed_tables?: { loaded?: { rows: { grade: number; max_speed_kmh: number }[] }; unloaded?: { rows: { grade: number; max_speed_kmh: number }[] } };
  excavator_assumptions?: {
    ideal_avg_hours_pt_per_day?: { value: number };
    excavators?: Record<string, { dump_time_s: number; spot_time_s: number; loading_time_s: number; planned_rate_bcm_per_pt_hr: number }>;
  };
}

let cache: Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'> | null | undefined;
function data() {
  if (cache !== undefined) return cache;
  const mod = Object.values(dataMods)[0];
  try { cache = mod?.defaultScenarioData ? mod.defaultScenarioData() : null; } catch { cache = null; }
  return cache;
}
const sheet = (): SheetTables => Object.values(tableMods)[0]?.default ?? {};

export type DefaultsSource = 'data' | 'workbook';
export const defaultsSource = (): DefaultsSource => (data() ? 'data' : 'workbook');

export function defaultLoader(unitId: string): LoaderAssumptions | undefined {
  const d = data()?.fleet.loaderAssumptions.find(a => a.unitId === unitId);
  if (d) return d;
  const ea = sheet().excavator_assumptions;
  const key = Object.keys(ea?.excavators ?? {}).find(k => unitId.toUpperCase().startsWith(k));
  const e = key ? ea!.excavators![key] : undefined;
  if (!e) return undefined;
  return { unitId, dumpS: e.dump_time_s, spotS: e.spot_time_s, loadS: e.loading_time_s, plannedRateBcmPerPtHr: e.planned_rate_bcm_per_pt_hr, ptHrsPerDay: ea?.ideal_avg_hours_pt_per_day?.value ?? 20 };
}

/** Workbook truck load table (ActiveRoute!N12:N18) keyed by model family and material. */
const SHEET_LOADS: { match: RegExp; ob: number; coal: number; cells: [string, string] }[] = [
  { match: /789c/i, ob: 104, coal: 100, cells: ['N12', 'N16'] },
  { match: /789d|789xd/i, ob: 104, coal: 100, cells: ['N14', 'N18'] },
  { match: /1500/i, ob: 89, coal: 100, cells: ['N13', 'N17'] },
];
const isCoal = (m: MaterialId) => /^(cl|coal|c)$/i.test(m) || /coal/i.test(m);

export function defaultTruckLoad(truck: TruckModel, materialId: MaterialId): number | undefined {
  const d = data()?.fleet.trucks.find(t => t.id === truck.id)?.loadBcmByMaterial?.[materialId];
  if (d != null) return d;
  const r = SHEET_LOADS.find(x => x.match.test(`${truck.model} ${truck.name}`));
  if (!r) return undefined;
  return isCoal(materialId) ? r.coal : /^ob$/i.test(materialId) ? r.ob : undefined;
}
export function sheetLoadCell(truck: TruckModel, materialId: MaterialId): string | undefined {
  const r = SHEET_LOADS.find(x => x.match.test(`${truck.model} ${truck.name}`));
  if (!r) return undefined;
  return `ActiveRoute!${isCoal(materialId) ? r.cells[1] : r.cells[0]}`;
}

export function defaultMaterial(id: MaterialId): Material | undefined {
  return data()?.materials.find(m => m.id === id);
}

export function defaultSpeeds(truck: TruckModel | undefined): { loaded: GradeSpeedPoint[]; empty: GradeSpeedPoint[] } | undefined {
  const d = truck ? data()?.fleet.trucks.find(t => t.id === truck.id)?.spreadsheetSpeeds : undefined;
  if (d) return d;
  const st = sheet().speed_tables;
  if (!st?.loaded || !st.unloaded) return undefined;
  return {
    loaded: st.loaded.rows.map(r => [r.grade, r.max_speed_kmh] as GradeSpeedPoint),
    empty: st.unloaded.rows.map(r => [r.grade, r.max_speed_kmh] as GradeSpeedPoint),
  };
}

export function defaultShift(): ShiftProfile | undefined {
  return data()?.shift;
}

export const same = (a: number | undefined, b: number | undefined) => a == null || b == null || Math.abs(a - b) < 1e-9;
