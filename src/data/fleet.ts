/**
 * Site fleet units (unit ids from the workbook's Equipment register and Haul Road Lab fleet library).
 * Workbook fleet notes (ActiveRoute!H36:I42): 8 × CAT 789 owned (789D/"789XD"), 3 × CAT 789 hired (789C),
 * 3 × KOM HD1500 → 14 trucks; ~12 operating at 85 % availability ("balance to 12"), ~13 at 92 %.
 */
import type { FleetUnit } from '@/core/types';

const u = (id: string, modelId: string, kind: FleetUnit['kind'], ownership: FleetUnit['ownership'], availability: number, notes?: string): FleetUnit =>
  notes ? { id, modelId, kind, ownership, availability, notes } : { id, modelId, kind, ownership, availability };

/** Trucks operating after availability, the workbook's "balance to 12" (Targets!E57, ActiveRoute!H42 = 14 × 0.85). */
export const TRUCKS_AVAILABLE = 12;

export function defaultFleetUnits(): FleetUnit[] {
  return [
    // loading units (site ids as used in the calculator: EX dropdown ActiveRoute!U5:U9, Targets LDR 1/2)
    u('EX09', 'HIT_EX5600_7', 'loader', 'own', 0.9, 'Equipment EX009 (from Feb 2026)'),
    u('EX04', 'KOM_PC4000_11', 'loader', 'own', 0.88, 'Equipment EX004 (parked from Jul 2025; re-commissioning option 2026)'),
    u('EX07', 'LIE_R996B', 'loader', 'own', 0.86, 'Equipment EX007 (to be replaced Q1 2026)'),
    u('EX06', 'HIT_EX2600_7', 'loader', 'hire', 0.88, 'Equipment EX006 (hire); "EX06 DZR Assist" in the crew block'),
    u('LDR1', 'KOM_WA900_8', 'loader', 'own', 0.9, 'Coal loader 1 (LD409 mining loader, WA900)'),
    u('LDR2', 'KOM_WA900_8', 'loader', 'own', 0.85, 'Coal loader 2 (LD401 WA900-3EO HL)'),
    u('EX03', 'EX003_50T', 'loader', 'hire', 0.92, 'Support excavator for coal (EX03/EX08 support line)'),
    u('EX08', 'EX003_50T', 'loader', 'own', 0.9, 'Support excavator for coal (backup)'),
    // haul trucks
    ...['DT189', 'DT190', 'DT191', 'DT192', 'DT193', 'DT194', 'DT195', 'DT196'].map(id => u(id, 'CAT_789D', 'truck', 'own', 0.92, 'CAT 789D ("789XD"), owned')),
    ...['DT126', 'DT128', 'DT198'].map(id => u(id, 'CAT_789C', 'truck', 'hire', 0.85, 'CAT 789C, hired')),
    ...['DT103', 'DT105', 'DT107'].map(id => u(id, 'KOM_HD1500_7', 'truck', 'own', 0.85, 'KOM HD1500-7 (register: Own; ActiveRoute!H38 says hired)')),
    // dozers
    ...['DZ201', 'DZ203', 'DZ209', 'DZ210'].map(id => u(id, 'KOM_D475SD-5EO', 'dozer', 'own', 0.88)),
    ...['DZ215', 'DZ216', 'DZ217', 'DZ218', 'DZ219'].map(id => u(id, 'CAT_D11_KSN', 'dozer', 'own', 0.9)),
    u('DZ204', 'KOM_D375A-6', 'dozer', 'own', 0.85, 'Mining dozer'),
    u('DZ225', 'KOM_D375A-5', 'dozer', 'own', 0.85, 'CHPP dozer'),
    u('DZ226', 'CAT_D10T', 'dozer', 'own', 0.88, 'Mining dozer'),
    u('DZ227', 'KOM_D375A-8', 'dozer', 'own', 0.88, 'Mining dozer'),
    u('WD207', 'KOM_WD900-3', 'wheelDozer', 'own', 0.88),
    u('GR309', 'CAT_18M', 'grader', 'hire', 0.9),
    u('GR310', 'CAT_18M', 'grader', 'hire', 0.9),
    u('WT607', 'KOM_HD785-7', 'waterCart', 'own', 0.85, 'Backup water cart'),
    u('WT609', 'CAT_773E', 'waterCart', 'hire', 0.88),
  ];
}
