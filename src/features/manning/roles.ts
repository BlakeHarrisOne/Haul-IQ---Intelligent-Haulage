/**
 * Crew role metadata shared by the manning, priority and insights features: labels, sentence nouns, icons and the
 * machine kind each role operates (for equipment-coverage checks).
 */
import type { CrewRole, FleetUnit, LoaderModel, Scenario, UnitKind } from '@/core/types';
import type { IconName } from '@/ui';

export type RoleGroup = 'haul' | 'load' | 'dozer' | 'roads' | 'supervision' | 'other';

export interface RoleMeta {
  /** Plural label for tables and bars: 'Truck operators'. */
  label: string;
  /** Short label for dense places: 'Trucks'. */
  short: string;
  /** Singular noun used in rule sentences: 'truck operator'. */
  noun: string;
  /** Optional qualifier shown in brackets after the noun in sentences: 'floor & dump'. */
  qual?: string;
  icon: IconName;
  group: RoleGroup;
  /** Machines this role operates (coverage check against the equipment table). */
  machine?: 'truck' | 'excavator' | 'loader' | 'dozer' | 'wheelDozer' | 'grader' | 'waterCart';
}

export const ROLE_META: Record<CrewRole, RoleMeta> = {
  truck: { label: 'Truck operators', short: 'Trucks', noun: 'truck operator', icon: 'truck', group: 'haul', machine: 'truck' },
  excavator: { label: 'Excavator operators', short: 'Excavators', noun: 'excavator operator', icon: 'excavator', group: 'load', machine: 'excavator' },
  loader: { label: 'Loader operators', short: 'Loaders', noun: 'loader operator', icon: 'loader', group: 'load', machine: 'loader' },
  pushDozer: { label: 'Push dozer operators', short: 'Push dozers', noun: 'push dozer operator', icon: 'dozer', group: 'dozer', machine: 'dozer' },
  dumpDozer: { label: 'Floor & dump dozers', short: 'Floor/dump DZR', noun: 'dozer operator', qual: 'floor & dump', icon: 'dozer', group: 'dozer', machine: 'dozer' },
  coalDozer: { label: 'Coal dozer operators', short: 'Coal dozers', noun: 'coal dozer operator', icon: 'dozer', group: 'dozer', machine: 'dozer' },
  wheelDozer: { label: 'Wheel dozer operators', short: 'Wheel dozers', noun: 'wheel dozer operator', icon: 'dozer', group: 'dozer', machine: 'wheelDozer' },
  waterCart: { label: 'Water cart operators', short: 'Water carts', noun: 'water cart operator', icon: 'watercart', group: 'roads', machine: 'waterCart' },
  grader: { label: 'Grader operators', short: 'Graders', noun: 'grader operator', icon: 'grader', group: 'roads', machine: 'grader' },
  supervisor: { label: 'Supervisors', short: 'Supervisors', noun: 'supervisor', icon: 'person', group: 'supervision' },
  oce: { label: 'Open cut examiners', short: 'OCE', noun: 'open cut examiner (OCE)', icon: 'person', group: 'supervision' },
  utility: { label: 'Utility operators', short: 'Utility', noun: 'utility operator', icon: 'person', group: 'other' },
  other: { label: 'Other', short: 'Other', noun: 'operator', icon: 'person', group: 'other' },
};

/** Display order (mirrors the workbook's crew block: trucks, loading units, dozers, roads, supervision). */
export const ROLE_ORDER: CrewRole[] = [
  'truck', 'excavator', 'loader', 'dumpDozer', 'coalDozer', 'pushDozer', 'wheelDozer', 'waterCart', 'grader', 'supervisor', 'oce', 'utility', 'other',
];

export const plural = (n: number, noun: string) => {
  if (Math.abs(n) === 1) return noun;
  // 'open cut examiner (OCE)' → 'open cut examiners (OCE)'
  const m = /^(.*?)(\s*\(.*\))?$/.exec(noun);
  const head = m?.[1] ?? noun, tail = m?.[2] ?? '';
  return `${head}${/s$/.test(head) ? '' : 's'}${tail}`;
};

/** Machine kind of a fleet unit, resolving loader units to excavator vs front-end loader via the loader model. */
export function unitMachine(u: FleetUnit, loaders: LoaderModel[]): RoleMeta['machine'] | 'lv' | 'other' {
  if (u.kind === 'loader') {
    const m = loaders.find(l => l.id === u.modelId);
    return m?.type === 'loader' ? 'loader' : 'excavator';
  }
  const map: Partial<Record<UnitKind, RoleMeta['machine'] | 'lv' | 'other'>> = {
    truck: 'truck', dozer: 'dozer', wheelDozer: 'wheelDozer', grader: 'grader', waterCart: 'waterCart', lv: 'lv', other: 'other',
  };
  return map[u.kind] ?? 'other';
}

/** Human model name for a unit (truck / loader model name, otherwise the raw model id). */
export function unitModelName(s: Pick<Scenario, 'fleet'>, u: FleetUnit): string {
  if (u.kind === 'truck') return s.fleet.trucks.find(t => t.id === u.modelId)?.name ?? u.modelId;
  if (u.kind === 'loader') return s.fleet.loaders.find(l => l.id === u.modelId)?.name ?? u.modelId;
  return u.modelId;
}

/** FleetUnit with the (requested) optional `active` flag; absent = active. */
export type UnitWithActive = FleetUnit & { active?: boolean };
export const unitActive = (u: FleetUnit) => (u as UnitWithActive).active !== false;
