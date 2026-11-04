/**
 * Default circuit parameters and the demo circuits mirroring the workbook's Targets sheet:
 *   EX09 OB  · CAT 789D     · 5 trucks · priority 1 · 1800 bcm/PT h · 20 h
 *   EX04 OB  · KOM HD1500-7 · 4 trucks · priority 2 · 1300 bcm/PT h · 20 h
 *   LDR1 coal· CAT 789C     · 3 trucks · priority 3 ·  650 bcm/PT h · 18 h
 */
import type { Circuit, CircuitParams, HaulString, LoaderAssumptions, MeshAsset, Scenario, TruckModel } from '@/core/types';
import { WORKBOOK_STOP_PENALTY_S } from './tables';

type Data = Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'>;

/** Global defaults not in the workbook (physics mode only) — spec 04 §B.10. */
export const DEFAULT_RR_PCT = 2.0;
export const DEFAULT_SPEED_LIMIT_KMH = 50;

/**
 * Circuit parameters from a loader's assumptions and a truck's nominal load (workbook defaults:
 * η 0.85 (C6), 2 stop signs (C11), 60 s per stop (C12), 2 shifts/day; spreadsheet speed model).
 * @param la loader assumptions (dump/spot/load s, planned rate, PT h/day)
 * @param truck truck model (loadBcmByMaterial)
 * @param materialId material hauled
 */
export function defaultCircuitParams(la: LoaderAssumptions | undefined, truck: TruckModel | undefined, materialId: string, patch: Partial<CircuitParams> = {}): CircuitParams {
  const rate = la?.plannedRateBcmPerPtHr ?? 1000;
  const pt = la?.ptHrsPerDay ?? 20;
  return {
    haulEff: 0.85, stopSigns: 2, stopPenaltyS: WORKBOOK_STOP_PENALTY_S, spotS: la?.spotS ?? 30, loadS: la?.loadS ?? 120, dumpS: la?.dumpS ?? 60,
    truckLoadBcm: truck?.loadBcmByMaterial?.[materialId] ?? 100, plannedRateBcmPerPtHr: rate, truckPtHrsPerDay: pt, desiredDailyBcm: rate * pt,
    rrPct: DEFAULT_RR_PCT, speedLimitKmh: DEFAULT_SPEED_LIMIT_KMH, speedModel: 'spreadsheet', shiftsPerDay: 2, ...patch,
  };
}

interface DemoSpec { id: string; unit: string; aliases: string[]; truck: string; loaderModel: string; material: string; trucks: number; priority: number; dumpHints: string[]; color: string; tags?: string[] }

const DEMO: DemoSpec[] = [
  { id: 'c-ex09', unit: 'EX09', aliases: [], truck: 'CAT_789D', loaderModel: 'HIT_EX5600_7', material: 'OB', trucks: 5, priority: 1, dumpHints: ['S51', 'WEST'], color: '#2A78D6', tags: ['prestrip'] },
  { id: 'c-ex04', unit: 'EX04', aliases: [], truck: 'KOM_HD1500_7', loaderModel: 'KOM_PC4000_11', material: 'OB', trucks: 4, priority: 2, dumpHints: ['S52', 'EAST'], color: '#EDA100' },
  { id: 'c-ldr1', unit: 'LDR1', aliases: ['LDR', 'LDR 1'], truck: 'CAT_789C', loaderModel: 'KOM_WA900_8', material: 'CL', trucks: 3, priority: 3, dumpHints: ['ROM', 'COAL'], color: '#6250D6', tags: ['coal'] },
];

const token = (name: string) => (name.trim().toUpperCase().match(/^[A-Z]+\s?\d*/)?.[0] ?? '').replace(/\s+/g, '');
const isAlt = (name: string) => /long\s*haul|short\s*haul|\balt\b|alternative|option\s*[2-9]/i.test(name);

/**
 * Demo circuits linked to the demo site's strings and dig/dump solids by name.
 * Strings are matched by their leading loader unit id (e.g. "EX09 …", "LDR …"); a string whose name says long/short
 * haul (or alternative) becomes an altHaulStringId. Dig = string.digId or a dig solid named after the unit; dump =
 * string.dumpId or a dump solid matching the circuit's hints ('S51 West lift', 'S52 East lift', 'ROM coal stockpile').
 */
export function demoCircuits(assets: MeshAsset[], strings: HaulString[], data: Data): Circuit[] {
  return DEMO.map(d => {
    const keys = [d.unit, ...d.aliases].map(k => k.toUpperCase().replace(/\s+/g, ''));
    const mine = strings.filter(s => keys.includes(token(s.name)));
    const primary = mine.find(s => !isAlt(s.name)) ?? mine[0];
    const alts = mine.filter(s => s !== primary).map(s => s.id);
    const digs = assets.filter(a => a.role === 'dig');
    const dumps = assets.filter(a => a.role === 'dump');
    const dig = assets.find(a => a.id === primary?.digId) ?? digs.find(a => keys.includes(token(a.name)))
      ?? digs.find(a => a.block?.loaderUnitId && keys.includes(a.block.loaderUnitId.toUpperCase()));
    const dump = assets.find(a => a.id === primary?.dumpId)
      ?? dumps.find(a => d.dumpHints.every(h => a.name.toUpperCase().includes(h)))
      ?? dumps.find(a => a.name.toUpperCase().includes(d.dumpHints[0]));
    const la = data.fleet.loaderAssumptions.find(l => l.unitId === d.unit);
    const truck = data.fleet.trucks.find(t => t.id === d.truck);
    const mat = data.materials.find(m => m.id === d.material);
    const dest = dump?.name ?? (primary ? primary.name.replace(/^\S+\s*[-–]?\s*/, '') : 'dump');
    return {
      id: d.id, name: `${d.unit} ${mat?.id === 'CL' ? 'coal' : d.material} → ${dest}`, loaderUnitId: d.unit, loaderModelId: d.loaderModel,
      truckModelId: d.truck, materialId: d.material, haulStringId: primary?.id, altHaulStringIds: alts.length ? alts : undefined,
      digId: dig?.id, dumpId: dump?.id, trucks: d.trucks, priority: d.priority, active: true,
      params: defaultCircuitParams(la, truck, d.material), color: primary?.color ?? d.color, tags: d.tags,
    };
  });
}
