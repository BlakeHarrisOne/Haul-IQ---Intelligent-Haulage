/**
 * Default crew rules reproducing the workbook's manning ('Targets & Haulage Priorities' rows 47, 65–116; spec 01 §9.5)
 * and the crew shifts. Rule ids / roles match the manning feature's rendering (features/manning/rules.ts).
 *
 * R7 (bulk push = 7 − enabling − max(0, trucks − 12)) and R8 (assist only while push > 0) cannot be expressed with
 * a fixed count: they use the CrewRuleExt `expr` / `whenExpr` extension (contract request). R9 is listed before R7
 * because R7 reads its count.
 */
import type { CrewRule, ShiftCrew } from '@/core/types';
import type { CrewRuleExt } from '@/engine/types';

const T = 'Targets & Haulage Priorities';

/** Bulk push production per dozer per day: Targets DZR Hours 18 × Rate 320 bcm/h (E45 × E46). */
export const PUSH_BCM_PER_DOZER_DAY = 18 * 320;

export function defaultCrewRules(): CrewRule[] {
  const rules: CrewRuleExt[] = [
    { id: 'R1_TRUCK_OPERATORS', name: 'Truck operators', enabled: true, scope: 'per-truck', role: 'truck', count: 1, perUnits: 1,
      note: 'Every truck allocated to a circuit needs one truck operator.', sheetRef: `${T}!D68 =$E$6` },
    { id: 'R2_EX_OPERATOR', name: 'Excavator operator', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['excavator', 'shovel'], minTrucks: 1 },
      role: 'excavator', count: 1, note: 'Prime-mover excavator operator for a trucked EX circuit.', sheetRef: `${T}!E68 =IF(D68>0,1,0)` },
    { id: 'R3_EX_DOZERS', name: 'EX floor & dump dozers', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['excavator', 'shovel'], minTrucks: 1 },
      role: 'dumpDozer', count: 2, note: '1 floor / clean-up dozer at the face + 1 dump dozer at the tip head.', sheetRef: `${T}!E69 =IF(D68>0,2,0)` },
    { id: 'R4_LOADER_OPERATOR', name: 'Loader operator', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['loader'], minTrucks: 1 },
      role: 'loader', count: 1, note: 'Coal loader (WA900) operator.', sheetRef: `${T}!E75 =IF(D75>0,1,0)` },
    { id: 'R5_COAL_DOZER', name: 'Coal dozer', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['loader'], minTrucks: 1 },
      role: 'coalDozer', count: 1, note: 'A coal loader circuit needs its coal dozer (push-up / clean-up).', sheetRef: `${T}!E76 =IF(D75>0,1,0)` },
    { id: 'R6_SUPPORT_EX', name: 'Support excavator (EX03/EX08)', enabled: true, scope: 'per-circuit', when: { loaderUnitIds: ['LDR1', 'LDR'], minTrucks: 1 },
      role: 'excavator', count: 1, note: 'Workbook keys this to LDR 1 only (LDR 2 alone gets no support EX).', sheetRef: `${T}!E79 =IF(D75>0,1,0)` },
    { id: 'R9_ENABLING_DOZERS', name: 'Enabling-task dozer', enabled: true, scope: 'site', role: 'pushDozer', count: 1,
      note: 'Dozers taken off push for enabling tasks (DR prep), Targets!E52.', sheetRef: `${T}!E83 =$E$52` },
    { id: 'R7_BULK_PUSH', name: 'Bulk push dozers', enabled: true, scope: 'site', role: 'pushDozer', count: 6,
      expr: 'params.pushFleet - rules.R9_ENABLING_DOZERS - max(0, totals.trucks - params.maxTrucks)', params: { pushFleet: 7, maxTrucks: 12 },
      priority: 4, bcmPerUnitDay: PUSH_BCM_PER_DOZER_DAY,
      note: '7 push dozers − enabling − one per truck above 12 (operators re-deployed to trucks). No clamp at 0 (workbook). Targets DZR priority 4.',
      sheetRef: `${T}!E47 =IF(E57>12,7-(E57-12)-E52,7-E52)` },
    { id: 'R8_PUSH_ASSIST', name: 'EX06 dozer-push assist', enabled: true, scope: 'site', role: 'excavator', count: 1, whenExpr: 'rules.R7_BULK_PUSH > 0',
      note: '"EX06 DZR Assist": manned whenever bulk push dozers > 0.', sheetRef: `${T}!E82 =IF(E81>0,1,0)` },
    { id: 'R10_WATER_CARTS', name: 'Water carts', enabled: true, scope: 'site', role: 'waterCart', count: 2, note: 'Fixed daily manning.', sheetRef: `${T}!E85` },
    { id: 'R10_GRADERS', name: 'Graders', enabled: true, scope: 'site', role: 'grader', count: 2, note: 'Fixed daily manning.', sheetRef: `${T}!E86` },
    { id: 'R10_SUPERVISORS', name: 'Supervisors', enabled: true, scope: 'site', role: 'supervisor', count: 2, note: 'Supervisors/OCE row = 3 (2 supervisors + 1 OCE, AG15:AG16).', sheetRef: `${T}!E87` },
    { id: 'R10_OCE', name: 'Open cut examiner', enabled: true, scope: 'site', role: 'oce', count: 1, note: 'Statutory: an OCE present whenever mining (CMSHR 2017 s.104).', sheetRef: `${T}!E87` },
  ];
  return rules;
}

/**
 * Crews (4-panel roster). Available counts from the workbook notes: AG19 = 30 (unlabelled, presumably available),
 * C91 "32 crew cap minus 4 for AL/PL/Training = 28 operating".
 */
export function defaultCrewShifts(): ShiftCrew[] {
  return [
    { id: 'crew-a', name: 'A Crew – Day', available: 30 },
    { id: 'crew-b', name: 'B Crew – Night', available: 30 },
    { id: 'crew-c', name: 'C Crew – Day', available: 28 },
    { id: 'crew-d', name: 'D Crew – Night', available: 32 },
  ];
}
