/**
 * hAIul SIM master data - PUBLIC API ('@/data'). OWNER: engine agent.
 *
 * Contract (state/demo.ts):
 *   defaultScenarioData(): Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'>
 *   demoCircuits(assets, strings, data): Circuit[]
 * Sources: calc.xlsm (spec 01, fixtures spreadsheet-*.json), oem-curves.json (spec 04 §G), Haul Road Lab fleet library.
 */
import type { Scenario } from '@/core/types';
import { defaultCrewRules, defaultCrewShifts } from './crew';
import { defaultFleetUnits, TRUCKS_AVAILABLE } from './fleet';
import { DEFAULT_MATERIALS } from './materials';
import { defaultShiftProfile } from './shift';
import { workbookLoaderAssumptions } from './tables';
import { LOADER_MODELS, TRUCK_MODELS } from './trucks';

export { DEFAULT_MATERIALS, MATERIAL_SOURCES } from './materials';
export { TRUCK_MODELS, LOADER_MODELS } from './trucks';
export { defaultFleetUnits, TRUCKS_AVAILABLE } from './fleet';
export { defaultCrewRules, defaultCrewShifts, PUSH_BCM_PER_DOZER_DAY } from './crew';
export { defaultShiftProfile } from './shift';
export { defaultCircuitParams, demoCircuits, DEFAULT_RR_PCT, DEFAULT_SPEED_LIMIT_KMH } from './circuits';
export {
  WORKBOOK_SPEEDS, WORKBOOK_SPEED_RANGES, WORKBOOK_TRUCK_LOADS, WORKBOOK_SWELL, WORKBOOK_PT_HRS, WORKBOOK_STOP_PENALTY_S,
  LOADER_ASSUMPTION_CELLS, workbookLoaderAssumptions, workbookLoaderKey,
} from './tables';

/** Materials, fleet library + units, loader assumptions, crew rules/shifts and the shift profile (fresh copies). */
export function defaultScenarioData(): Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'> {
  const shifts = defaultCrewShifts();
  return {
    materials: structuredClone(DEFAULT_MATERIALS),
    fleet: {
      trucks: structuredClone(TRUCK_MODELS),
      loaders: structuredClone(LOADER_MODELS),
      units: defaultFleetUnits(),
      loaderAssumptions: workbookLoaderAssumptions(),
      trucksAvailable: TRUCKS_AVAILABLE,
    },
    crew: { rules: defaultCrewRules(), shifts, activeShiftId: shifts[0].id },
    shift: defaultShiftProfile(),
  };
}
