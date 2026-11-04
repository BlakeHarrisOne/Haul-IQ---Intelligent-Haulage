/** Priority view-model helpers over the engine's PriorityResult and ManningResult. */
import type { Circuit, ManningResult } from '@/core/types';

/** Per-circuit crew split at its requested trucks: loader operator, truck operators, support roles (from the manning lines). */
export function crewSplit(m: ManningResult, c: Circuit) {
  const lines = m.lines.filter(l => l.circuitId === c.id);
  const trucks = lines.filter(l => l.role === 'truck').reduce((a, l) => a + l.count, 0);
  const total = lines.reduce((a, l) => a + l.count, 0);
  const loader = c.trucks > 0 && lines.some(l => l.role === 'excavator' || l.role === 'loader') ? 1 : 0;
  return { loader, trucks, support: Math.max(0, total - trucks - loader), total };
}
