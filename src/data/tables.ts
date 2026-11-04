/**
 * The workbook's lookup tables (calc.xlsm, spec 01 §5.3, §7) as typed data.
 * Source JSON: ./spreadsheet-tables.json (verbatim extract of the workbook, see docs/spec/fixtures).
 */
import type { GradeSpeedPoint, LoaderAssumptions } from '@/core/types';
import tables from './spreadsheet-tables.json';

interface Row { grade: number; max_speed_kmh: number }

const toPoints = (rows: Row[]): GradeSpeedPoint[] => rows.map(r => [r.grade, r.max_speed_kmh]);

/**
 * The ONE loaded and ONE unloaded grade → max speed table ('Travel Time'!P3:Q35 / S3:T35), used for every truck
 * type (the workbook has no per-truck tables). Grade = fraction, + uphill in the direction of travel; km/h.
 */
export const WORKBOOK_SPEEDS: { loaded: GradeSpeedPoint[]; empty: GradeSpeedPoint[] } = {
  loaded: toPoints(tables.speed_tables.loaded.rows as Row[]),
  empty: toPoints(tables.speed_tables.unloaded.rows as Row[]),
};

/** Sheet ranges of the speed tables (for CalcStep sources). */
export const WORKBOOK_SPEED_RANGES = { loaded: "'Travel Time'!P3:Q35", empty: "'Travel Time'!S3:T35" } as const;

/** Workbook excavator assumption block per loader (ActiveRoute!H2:J34); cells of dump / spot / load / planned rate. */
export const LOADER_ASSUMPTION_CELLS: Record<string, { block: string; model: string; dump: string; spot: string; load: string; rate: string }> = {
  EX04: { block: 'ActiveRoute!H4:J8', model: 'KOM PC4000 (400-ton class)', dump: 'ActiveRoute!I5', spot: 'ActiveRoute!I6', load: 'ActiveRoute!I7', rate: 'ActiveRoute!I8' },
  EX07: { block: 'ActiveRoute!H10:J14', model: 'LIEB R996B (600-ton class)', dump: 'ActiveRoute!I11', spot: 'ActiveRoute!I12', load: 'ActiveRoute!I13', rate: 'ActiveRoute!I14' },
  EX06: { block: 'ActiveRoute!H16:J20', model: 'HIT EX2600 (250-ton class)', dump: 'ActiveRoute!I17', spot: 'ActiveRoute!I18', load: 'ActiveRoute!I19', rate: 'ActiveRoute!I20' },
  LDR: { block: 'ActiveRoute!H22:J26', model: 'KOM WA900 (100-ton class)', dump: 'ActiveRoute!I23', spot: 'ActiveRoute!I24', load: 'ActiveRoute!I25', rate: 'ActiveRoute!I26' },
  EX09: { block: 'ActiveRoute!H28:J32', model: 'HIT EX5600 (550-ton class)', dump: 'ActiveRoute!I29', spot: 'ActiveRoute!I30', load: 'ActiveRoute!I31', rate: 'ActiveRoute!I32' },
};

/** Workbook block key for a site loader unit id ('LDR1' / 'LDR 2' → 'LDR'). */
export function workbookLoaderKey(unitId: string): string | undefined {
  const u = unitId.toUpperCase().replace(/\s+/g, '');
  if (LOADER_ASSUMPTION_CELLS[u]) return u;
  if (u.startsWith('LDR')) return 'LDR';
  return undefined;
}

type ExRow = { dump_time_s: number; spot_time_s: number; loading_time_s: number; planned_rate_bcm_per_pt_hr: number };
const EX = tables.excavator_assumptions.excavators as unknown as Record<string, ExRow>;

/**
 * Loader assumptions exactly as the workbook's EXCAVATOR ASSUMPTIONS block; PT h/day from the Targets sheet
 * (EX09 / EX04 Hours 20, LDR 1 Hours 18; others the ActiveRoute I34 default 20).
 * Unit ids follow the site convention: LDR1 / LDR2 are the two coal loader circuits ('LDR 1/2', 'LDR 2/2').
 */
export function workbookLoaderAssumptions(): LoaderAssumptions[] {
  const mk = (unitId: string, key: string, pt: number): LoaderAssumptions => ({
    unitId, dumpS: EX[key].dump_time_s, spotS: EX[key].spot_time_s, loadS: EX[key].loading_time_s,
    plannedRateBcmPerPtHr: EX[key].planned_rate_bcm_per_pt_hr, ptHrsPerDay: pt,
  });
  return [mk('EX04', 'EX04', 20), mk('EX07', 'EX07', 20), mk('EX06', 'EX06', 20), mk('LDR1', 'LDR', 18), mk('LDR2', 'LDR', 18), mk('EX09', 'EX09', 20)];
}

/** Truck load bcm per workbook truck type (ActiveRoute!N12:N18, mapped by C21). */
export const WORKBOOK_TRUCK_LOADS: Record<string, { OB: number; CL: number; cells: { OB: string; CL: string } }> = {
  CAT_789C: { OB: 104, CL: 100, cells: { OB: 'ActiveRoute!N12', CL: 'ActiveRoute!N16' } },
  KOM_HD1500_7: { OB: 89, CL: 100, cells: { OB: 'ActiveRoute!N13', CL: 'ActiveRoute!N17' } },
  CAT_789D: { OB: 104, CL: 100, cells: { OB: 'ActiveRoute!N14', CL: 'ActiveRoute!N18' } },
};

/** ActiveRoute!AD4: LCM density × 1.2 = BCM density ("Swelled to get bank density"). */
export const WORKBOOK_SWELL = tables.swell_factor.value as number;

/** Ideal Avg Hours (PT/day), ActiveRoute!I34. */
export const WORKBOOK_PT_HRS = tables.excavator_assumptions.ideal_avg_hours_pt_per_day.value as number;

/** Stop sign + start/stop accel penalty per stop, s (ActiveRoute!C12 = 60*C11). */
export const WORKBOOK_STOP_PENALTY_S = 60;
