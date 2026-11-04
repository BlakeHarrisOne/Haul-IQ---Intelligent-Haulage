/** Priority view-model helpers over the engine's PriorityResult and ManningResult. */
import type { Circuit, CircuitResult, Id, ManningResult, Scenario } from '@/core/types';
import type { PriorityResultExt } from '@/engine';
import { trucksForPotential } from '@/features/insights/engine';

/** Per-circuit crew split at its requested trucks: loader operator, truck operators, support roles (from the manning lines). */
export function crewSplit(m: ManningResult, c: Circuit) {
  const lines = m.lines.filter(l => l.circuitId === c.id);
  const trucks = lines.filter(l => l.role === 'truck').reduce((a, l) => a + l.count, 0);
  const total = lines.reduce((a, l) => a + l.count, 0);
  const loader = c.trucks > 0 && lines.some(l => l.role === 'excavator' || l.role === 'loader') ? 1 : 0;
  return { loader, trucks, support: Math.max(0, total - trucks - loader), total };
}

/** 'a', 'a and b', 'a, b and c'. */
export const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Short sentence name for a site task: 'Bulk push dozers' → 'bulk push'. */
export function taskShort(name: string): string {
  const n = name.replace(/\s+(dozers?|operators?|crew)$/i, '') || name;
  return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n;
}

export interface Trucking { circuitId: Id; granted: number; fullRate: number; state: 'full' | 'under' | 'over' }

/** Trucking of each running circuit against what the plan GRANTED (not what was requested). */
export function truckingVsGranted(results: Record<Id, CircuitResult>, plan: PriorityResultExt): Trucking[] {
  const out: Trucking[] = [];
  for (const a of plan.allocations) {
    const r = results[a.circuitId];
    if (a.allocatedTrucks <= 0 || !r?.ok) continue;
    const n = trucksForPotential(r);
    out.push({ circuitId: a.circuitId, granted: a.allocatedTrucks, fullRate: n, state: a.allocatedTrucks < n ? 'under' : a.allocatedTrucks > n ? 'over' : 'full' });
  }
  return out;
}

/**
 * The verdict-first sentence at the top of the Priority sheet: crew against need, what gives (tasks stood down,
 * circuits cut or parked, idle trucks released), then the trucking state at the granted trucks.
 * e.g. "Crew 30 of 36 needed: bulk push stands 5 down, LDR1 releases 1 idle truck, EX09 and EX04 under-trucked (−1, −3)."
 */
export function planVerdict(s: Scenario, results: Record<Id, CircuitResult>, plan: PriorityResultExt): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const name = (id: Id) => { const c = s.circuits.find(x => x.id === id); return c?.loaderUnitId || c?.name || id; };
  const short = plan.crewRequired - plan.crewAvailable;
  const head = short > 0 ? `Crew ${plan.crewAvailable} of ${plan.crewRequired} needed` : `Crew ${plan.crewRequired} needed, ${plan.crewAvailable} available`;
  const parts: string[] = [];
  for (const t of plan.tasks) {
    if (t.allocated >= t.requested) continue;
    parts.push(t.allocated <= 0 ? `${taskShort(t.name)} stands down` : `${taskShort(t.name)} stands ${t.requested - t.allocated} down`);
  }
  for (const a of plan.allocations) {
    const k = a.requestedTrucks - a.allocatedTrucks;
    if (a.status === 'parked') parts.push(`${name(a.circuitId)} parked`);
    else if (a.status === 'reduced') {
      parts.push(a.bcmDayLost > 0.5 ? `${name(a.circuitId)} cut to ${a.allocatedTrucks} of ${a.requestedTrucks} trucks` : `${name(a.circuitId)} releases ${k} idle truck${k === 1 ? '' : 's'}`);
    }
  }
  const tr = truckingVsGranted(results, plan);
  const under = tr.filter(x => x.state === 'under'), over = tr.filter(x => x.state === 'over');
  if (!tr.length) parts.push('no circuit running');
  else if (!under.length && !over.length) parts.push(tr.length > 1 ? 'all circuits fully trucked' : `${name(tr[0].circuitId)} fully trucked`);
  else {
    if (under.length) parts.push(`${listJoin(under.map(x => name(x.circuitId)))} under-trucked (${under.map(x => `−${x.fullRate - x.granted}`).join(', ')})`);
    if (over.length) parts.push(`${listJoin(over.map(x => name(x.circuitId)))} over-trucked (${over.map(x => `+${x.granted - x.fullRate}`).join(', ')})`);
  }
  const lost = plan.bcmDayPlanned - plan.bcmDayAchieved;
  const tone = lost > 0.5 ? 'bad' : short > 0 || under.length || over.length ? 'warn' : 'ok';
  return { tone, text: `${head}: ${parts.join(', ')}.` };
}
