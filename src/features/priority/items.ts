/**
 * The priority list = active circuits + prioritised site tasks (CrewRuleExt with a priority, e.g. bulk push = Targets
 * DZR priority 4), ordered by priority. Reordering assigns 1..n across both.
 */
import type { Circuit, Id, Scenario } from '@/core/types';
import type { CrewRuleExt } from '@/engine';

export type PItem =
  | { kind: 'circuit'; id: Id; priority: number; circuit: Circuit }
  | { kind: 'task'; id: Id; priority: number; rule: CrewRuleExt };

export function taskRules(s: Scenario): CrewRuleExt[] {
  return (s.crew.rules as CrewRuleExt[]).filter(r => r.enabled && r.scope === 'site' && r.priority != null);
}

export function priorityItems(s: Scenario): PItem[] {
  const items: PItem[] = [
    ...s.circuits.filter(c => c.active).map(c => ({ kind: 'circuit' as const, id: c.id, priority: c.priority, circuit: c })),
    ...taskRules(s).map(r => ({ kind: 'task' as const, id: r.id, priority: r.priority as number, rule: r })),
  ];
  return items.sort((a, b) => a.priority - b.priority || (a.kind === b.kind ? 0 : a.kind === 'circuit' ? -1 : 1));
}

/** Scenario transform: priorities 1..n in the given order (circuits and task rules); inactive circuits follow. */
export function reprioritise(order: Id[]) {
  return (s: Scenario): Scenario => {
    const rank = new Map(order.map((id, i) => [id, i + 1]));
    let next = order.length;
    const inactive = s.circuits.filter(c => !c.active && !rank.has(c.id)).sort((a, b) => a.priority - b.priority);
    for (const c of inactive) rank.set(c.id, ++next);
    return {
      ...s,
      circuits: s.circuits.map(c => ({ ...c, priority: rank.get(c.id) ?? c.priority })),
      crew: { ...s.crew, rules: s.crew.rules.map(r => (rank.has(r.id) ? ({ ...r, priority: rank.get(r.id) } as CrewRuleExt) : r)) },
    };
  };
}
