/** Shared priority-plan hook (Priority view + Insights): the engine planner at a crew / trucks what-if. */
import { useMemo } from 'react';
import { computePriority, type PriorityResultExt } from '@/engine';
import { useResults, useScenario } from '@/state/derived';

export type PlanResult = PriorityResultExt;

export function usePriorityPlan(crewOverride?: number | null, trucksOverride?: number | null): PlanResult {
  const s = useScenario();
  const results = useResults();
  return useMemo(
    () => computePriority(s, results, { crewAvailable: crewOverride ?? undefined, trucksAvailable: trucksOverride ?? undefined }),
    [s, results, crewOverride, trucksOverride],
  );
}
