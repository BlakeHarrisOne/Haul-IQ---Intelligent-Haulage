/**
 * Manning view model: notional unit ↔ task assignment, machine coverage and grouping of manning lines.
 * Pure functions over the scenario + the engine's ManningResult.
 */
import type { Circuit, CrewRole, FleetUnit, Id, ManningLine, ManningResult, Scenario } from '@/core/types';
import { ROLE_META, unitActive, unitMachine, type RoleMeta } from './roles';
import { prettyExpr } from './rules';

export type Machine = NonNullable<RoleMeta['machine']>;

export interface UnitTask {
  state: 'working' | 'spare' | 'parked';
  task: string;
  circuitId?: Id;
}

export interface Coverage {
  machine: Machine;
  label: string;
  demand: number;
  active: number;
  total: number;
  /** Σ availability of active units (expected machines on the day). */
  expected: number;
  short: number;
}

const MACHINE_LABEL: Record<Machine, string> = {
  truck: 'Trucks', excavator: 'Excavators', loader: 'Loaders', dozer: 'Dozers', wheelDozer: 'Wheel dozers', grader: 'Graders', waterCart: 'Water carts',
};

const cname = (c?: Circuit) => (c ? c.loaderUnitId || c.name : '');

/** Expand manning lines into one demand per operator seat for a given machine kind. */
function demands(m: ManningResult, s: Scenario, machine: Machine, skipOwnLoaders: boolean): { label: string; text: string; circuitId?: Id }[] {
  const out: { label: string; text: string; circuitId?: Id }[] = [];
  const ownTaken = new Set<Id>();
  for (const l of m.lines) {
    if (ROLE_META[l.role].machine !== machine) continue;
    const c = l.circuitId ? s.circuits.find(x => x.id === l.circuitId) : undefined;
    const rule = s.crew.rules.find(r => r.id === l.ruleId);
    for (let k = 0; k < l.count; k++) {
      // the circuit's own loading unit is assigned explicitly, not from the pool
      if (skipOwnLoaders && c && !ownTaken.has(c.id)) {
        const lu = s.fleet.units.find(u => u.id === c.loaderUnitId);
        if (lu && unitMachine(lu, s.fleet.loaders) === machine) { ownTaken.add(c.id); continue; }
      }
      const base = rule?.name ?? ROLE_META[l.role].short;
      out.push({ label: c ? `${base} · ${cname(c)}` : base, text: `${rule?.name ?? ''} ${rule?.note ?? ''} ${l.reason}`, circuitId: c?.id });
    }
  }
  return out;
}

/** Pick pool units for demands: a unit named in the demand's rule text first, then units no other demand names. */
function matchUnits(pool: FleetUnit[], dem: { text: string }[]): (FleetUnit | undefined)[] {
  const left = [...pool];
  const named = (u: FleetUnit) => dem.some(d => d.text.includes(u.id));
  return dem.map(d => {
    let i = left.findIndex(u => d.text.includes(u.id));
    if (i < 0) i = left.findIndex(u => !named(u));
    if (i < 0) i = 0;
    return left.length ? left.splice(i, 1)[0] : undefined;
  });
}

/** Notional assignment of fleet units to tasks (trucks by circuit truck counts, support units by manning lines). */
export function assignUnits(s: Scenario, m: ManningResult): { tasks: Record<string, UnitTask>; coverage: Coverage[] } {
  const tasks: Record<string, UnitTask> = {};
  const units = s.fleet.units;
  const byMachine = new Map<string, FleetUnit[]>();
  for (const u of units) {
    const k = unitMachine(u, s.fleet.loaders) ?? 'other';
    if (!byMachine.has(k)) byMachine.set(k, []);
    byMachine.get(k)!.push(u);
  }
  const active = s.circuits.filter(c => c.active).sort((a, b) => a.priority - b.priority);
  const coverage: Coverage[] = [];

  // loading units: explicit via circuit.loaderUnitId
  for (const u of units.filter(x => x.kind === 'loader')) {
    if (!unitActive(u)) { tasks[u.id] = { state: 'parked', task: 'Parked' }; continue; }
    const c = active.find(x => x.loaderUnitId === u.id);
    if (c && c.trucks > 0) tasks[u.id] = { state: 'working', task: `Loading · ${c.name}`, circuitId: c.id };
    else if (c) tasks[u.id] = { state: 'spare', task: 'Circuit has 0 trucks', circuitId: c.id };
  }

  // trucks: fill circuits in priority order, matching the circuit's truck model first
  const trucks = (byMachine.get('truck') ?? []).filter(unitActive)
    .sort((a, b) => (a.ownership === b.ownership ? b.availability - a.availability : a.ownership === 'own' ? -1 : 1));
  const free = new Set(trucks.map(t => t.id));
  for (const c of active) {
    let need = c.trucks;
    for (const pass of [0, 1]) {
      for (const t of trucks) {
        if (need <= 0) break;
        if (!free.has(t.id) || (pass === 0 && t.modelId !== c.truckModelId)) continue;
        free.delete(t.id); need--;
        tasks[t.id] = { state: 'working', task: c.name, circuitId: c.id };
      }
    }
  }
  for (const id of free) tasks[id] = { state: 'spare', task: 'Spare' };
  for (const t of byMachine.get('truck') ?? []) if (!unitActive(t)) tasks[t.id] = { state: 'parked', task: 'Parked' };
  {
    const demand = active.reduce((a, c) => a + c.trucks, 0);
    const all = byMachine.get('truck') ?? [];
    coverage.push({ machine: 'truck', label: MACHINE_LABEL.truck, demand, active: trucks.length, total: all.length,
      expected: trucks.reduce((a, u) => a + u.availability, 0), short: Math.max(0, demand - trucks.length) });
  }

  // pooled machines: dozers, wheel dozers, graders, water carts, and support excavators / loaders
  for (const machine of ['excavator', 'loader', 'dozer', 'wheelDozer', 'grader', 'waterCart'] as Machine[]) {
    const all = byMachine.get(machine) ?? [];
    const pool = all.filter(u => unitActive(u) && !tasks[u.id]);
    const isLoading = machine === 'excavator' || machine === 'loader';
    const dem = demands(m, s, machine, isLoading);
    matchUnits(pool, dem).forEach((u, k) => { if (u) tasks[u.id] = { state: 'working', task: dem[k].label, circuitId: dem[k].circuitId }; });
    for (const u of pool) if (!tasks[u.id]) tasks[u.id] = { state: 'spare', task: 'Spare' };
    for (const u of all) if (!unitActive(u)) tasks[u.id] = { state: 'parked', task: 'Parked' };
    // loading units that were left without a task (e.g. circuit inactive) count as spare
    for (const u of all) if (!tasks[u.id]) tasks[u.id] = { state: 'spare', task: 'Spare' };
    const activeN = all.filter(unitActive).length;
    const ownLoaders = isLoading ? all.filter(u => tasks[u.id]?.task.startsWith('Loading')).length : 0;
    const demandTotal = dem.length + ownLoaders;
    if (all.length || demandTotal) {
      coverage.push({ machine, label: MACHINE_LABEL[machine], demand: demandTotal, active: activeN, total: all.length,
        expected: all.filter(unitActive).reduce((a, u) => a + u.availability, 0), short: Math.max(0, dem.length - pool.length) });
    }
  }
  return { tasks, coverage };
}

export interface LineGroup { key: string; circuit?: Circuit; title: string; total: number; lines: ManningLine[] }

/** Manning lines grouped per circuit (priority order) then site-wide. */
export function groupLines(s: Scenario, m: ManningResult): LineGroup[] {
  const groups: LineGroup[] = [];
  const circuits = [...s.circuits].sort((a, b) => a.priority - b.priority);
  for (const c of circuits) {
    const lines = m.lines.filter(l => l.circuitId === c.id && l.count !== 0);
    if (!lines.length) continue;
    groups.push({ key: c.id, circuit: c, title: c.name, total: lines.reduce((a, l) => a + l.count, 0), lines });
  }
  const site = m.lines.filter(l => !l.circuitId || !s.circuits.some(c => c.id === l.circuitId));
  if (site.length) groups.push({ key: 'site', title: 'Site-wide', total: site.reduce((a, l) => a + l.count, 0), lines: site });
  return groups;
}

/** Role totals with optional caps for the active shift. */
export function roleRows(m: ManningResult, caps?: Partial<Record<CrewRole, number>>) {
  return (Object.keys(ROLE_META) as CrewRole[])
    .map(role => ({ role, need: m.required[role] ?? 0, cap: caps?.[role] }))
    .filter(r => r.need > 0 || r.cap != null);
}

/** Concise label for a manning line inside its circuit group: rule name + the arithmetic that fired. */
export function lineLabel(s: Scenario, l: ManningLine): { name: string; detail?: string } {
  const rule = s.crew.rules.find(r => r.id === l.ruleId) as (Scenario['crew']['rules'][number] & { expr?: string; params?: Record<string, number> }) | undefined;
  if (!rule) return { name: l.reason };
  const c = l.circuitId ? s.circuits.find(x => x.id === l.circuitId) : undefined;
  if (rule.scope === 'per-truck' && c) {
    const per = rule.perUnits && rule.perUnits > 1 ? ` ÷ ${rule.perUnits} (rounded up)` : '';
    return { name: rule.name, detail: `${c.trucks} truck${c.trucks === 1 ? '' : 's'}${per}${rule.count !== 1 ? ` × ${rule.count}` : ''}` };
  }
  if (rule.expr) return { name: rule.name, detail: `${prettyExpr(rule.expr, rule, { rules: s.crew.rules })} = ${l.count}` };
  return { name: rule.name, detail: rule.note && rule.note.length < 48 ? rule.note : undefined };
}
