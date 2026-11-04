/**
 * hAIul SIM calculation engine - PUBLIC API (pure TypeScript, no DOM; runs in the browser, workers and Node tests).
 *
 * OWNER: engine agent. UI code must import only from '@/engine'.
 *
 *   haul/      route segments, spreadsheet table lookup, rimpull/retarder physics, kinematic pass, computeCircuit
 *   fleet/     macro-button fleet options, queue models (deterministic / M/M/1//N / binomial)
 *   curves/    Truck Curves tab helpers
 *   manning/   generic crew-rule evaluator (+ derived-rule expressions)
 *   priority/  crew/truck allocation by priority with alternatives
 *   shift/     shift profile helpers, discrete-event shift simulation, shift state
 * Every calculation emits CalcSteps (formula, substituted numbers, inputs with sources, sheetRef).
 */
import type { CircuitResult, Id, ManningResult, Scenario } from '@/core/types';
import { computeCircuit } from './haul/circuit';
import { crewCircuits, evaluateCrew } from './manning/evaluate';

export { computeCircuit, KINEMATIC_DEFAULTS, type CircuitOptions } from './haul/circuit';
export { computePriority, type PriorityOptions, type PriorityResultExt, type PriorityTask } from './priority/plan';
export { evaluateCrew, crewCircuits, ROLES, type CrewCircuit, type CrewEvalInput, type CrewEvalResult } from './manning/evaluate';
export { evalExpr } from './manning/expr';
export {
  truckEnvelope, resistanceForce, resistanceForceExact, operatingPoints, derivedSpeedTable, derivedSpeedPoints, speedOnGrade,
  type TruckEnvelope, type OperatingPoint, type OperatingPointDir, type DerivedSpeedRow, type DerivedTableOpts,
} from './curves';
export { productiveMinutes, productiveMinutesAt, clockAt, activeEventAt } from './shift/profile';
export { simulateShift, truckStatesAt, simProductionAt, QUEUE_FRONT_M, QUEUE_GAP_M } from './shift/sim';
export { shiftStateAt } from './shift/state';
export { fleetOption, fleetOptions, truckCapacity, type FleetCtx } from './fleet/options';
export { queueEstimate, type QueueEstimate } from './fleet/queue';
export { steadySpeed, resistanceKN, payloadFor, G, type SteadySolve } from './haul/physics';
export { truckPhysics, type TruckPhysics } from './haul/truck';
export { tableSpeed } from './haul/spreadsheet';
export { buildRoute, PHANTOM_SEGMENT_M } from './haul/route';
export { excelRound } from './util/excel';
export { curveForce, maxSpeedForForce } from './util/curve';
export type * from './types';

/**
 * Compute every circuit of the scenario (inactive circuits too, so the UI can show what they would need).
 * @param scenario scenario
 */
export function computeAllCircuits(scenario: Scenario): Record<Id, CircuitResult> {
  const out: Record<Id, CircuitResult> = {};
  for (const c of scenario.circuits) out[c.id] = computeCircuit(scenario, c);
  return out;
}

/**
 * Crew required by the scenario's rules for the active circuits at their assigned trucks.
 * @param scenario scenario (circuits, crew rules, shifts)
 * @param results circuit results (not needed by the workbook rules; kept for rule extensions)
 * @param shiftId crew shift (default: the active shift) — sets `available`
 */
export function computeManning(scenario: Scenario, results: Record<Id, CircuitResult>, shiftId?: Id): ManningResult {
  void results;
  const shift = scenario.crew.shifts.find(s => s.id === (shiftId ?? scenario.crew.activeShiftId));
  return evaluateCrew({
    circuits: crewCircuits(scenario), rules: scenario.crew.rules, trucksAvailable: scenario.fleet.trucksAvailable,
    available: shift?.available ?? 0, shift, caps: scenario.crew.taskCaps,
  });
}
