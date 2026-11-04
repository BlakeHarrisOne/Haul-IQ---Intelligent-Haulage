/**
 * Derived calculation results, memoised by scenario identity (the scenario is immutable, so a new object
 * means something changed). Use these hooks in React components; use `resultsFor(scenario)` elsewhere.
 */
import { useApp } from './store';
import type { CircuitResult, Id, ManningResult, PriorityResult, Scenario, ShiftState } from '@/core/types';
import { computeAllCircuits, computeManning, computePriority, shiftStateAt } from '@/engine';

let lastScenario: Scenario | null = null;
let lastResults: Record<Id, CircuitResult> = {};
let lastManning: ManningResult | null = null;
let lastPriority: PriorityResult | null = null;

export function resultsFor(s: Scenario): Record<Id, CircuitResult> {
  if (s !== lastScenario) {
    lastScenario = s;
    try { lastResults = computeAllCircuits(s); } catch (e) { console.error('engine failed', e); lastResults = {}; }
    lastManning = null;
    lastPriority = null;
  }
  return lastResults;
}

export function manningFor(s: Scenario): ManningResult {
  const r = resultsFor(s);
  if (!lastManning) lastManning = computeManning(s, r);
  return lastManning;
}

export function priorityFor(s: Scenario): PriorityResult {
  const r = resultsFor(s);
  if (!lastPriority) lastPriority = computePriority(s, r);
  return lastPriority;
}

export const useScenario = () => useApp(st => st.scenario);
export const useResults = () => resultsFor(useApp(st => st.scenario));
export const useCircuitResult = (id: Id | undefined) => {
  const r = useResults();
  return id ? r[id] : undefined;
};
export const useManning = () => manningFor(useApp(st => st.scenario));
export const usePriority = () => priorityFor(useApp(st => st.scenario));
export function useShiftState(): ShiftState {
  const s = useApp(st => st.scenario);
  const t = useApp(st => st.timeline.tMin);
  return shiftStateAt(s, resultsFor(s), t);
}
