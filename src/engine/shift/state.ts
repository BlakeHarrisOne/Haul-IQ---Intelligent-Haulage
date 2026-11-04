/**
 * Shift state at a moment (depletion slider): clock, productive fraction, active event and per-circuit production
 * from the discrete-event simulation.
 *   digFraction  = bcm dug so far / dig block bcm   (block.plannedBcm ?? solid volume)
 *   dumpFraction = bcm dumped × swell / dump volume (or / block.plannedBcm when the dump states a bcm plan)
 */
import type { CircuitResult, Id, Scenario, ShiftState } from '@/core/types';
import { activeEventAt, clockAt, productiveMinutes, productiveMinutesAt } from './profile';
import { simProductionAt, simulateShift } from './sim';

/**
 * @param scenario scenario
 * @param results circuit results
 * @param tMin minutes after shift start
 */
export function shiftStateAt(scenario: Scenario, results: Record<Id, CircuitResult>, tMin: number): ShiftState {
  const prof = scenario.shift;
  const total = productiveMinutes(prof);
  const pf = total > 0 ? Math.min(1, productiveMinutesAt(prof, tMin) / total) : 0;
  return {
    tMin, clock: clockAt(prof, tMin), productiveFraction: pf, activeEvent: activeEventAt(prof, tMin),
    perCircuit: scenario.circuits.map(c => {
      const sim = simulateShift(scenario, results, c.id);
      const now = simProductionAt(sim, tMin);
      const dig = scenario.assets.find(a => a.id === c.digId);
      const dump = scenario.assets.find(a => a.id === c.dumpId);
      const digBcm = dig?.block?.plannedBcm ?? dig?.stats.volume ?? 0;
      const swell = scenario.materials.find(m => m.id === c.materialId)?.swell ?? 1;
      const dumpCap = dump?.block?.plannedBcm != null ? dump.block.plannedBcm : (dump?.stats.volume ?? 0) / swell;
      return {
        circuitId: c.id, bcmSoFar: now.bcm, bcmShift: sim.bcm, loads: now.loads,
        digFraction: digBcm > 0 ? Math.min(1, now.bcm / digBcm) : 0,
        dumpFraction: dumpCap > 0 ? Math.min(1, now.dumpedBcm / dumpCap) : 0,
      };
    }),
  };
}
