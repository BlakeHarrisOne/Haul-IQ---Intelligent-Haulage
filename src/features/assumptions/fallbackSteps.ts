/**
 * Ledger reconstruction used ONLY when the engine returns a CircuitResult without CalcStep traces
 * (the provisional engine). Mirrors the Haulage Calculator ActiveRoute cells (docs/spec/01 §6.2) using the
 * result's own numbers, so the page is never blank. The view labels these steps "reconstructed".
 */
import type { CalcStep, Circuit, CircuitResult, Scenario } from '@/core/types';
import { num } from '@/core/format';

const f = (v: number, dp = 2) => num(v, dp).replace(/,/g, '');

export function reconstructSteps(sc: Scenario, c: Circuit, r: CircuitResult): CalcStep[] {
  const p = c.params;
  const truck = sc.fleet.trucks.find(t => t.id === c.truckModelId);
  const la = sc.fleet.loaderAssumptions.find(a => a.unitId === c.loaderUnitId);
  const timed = r.segments.filter(s => s.limitLoaded !== 'table-out-of-range');
  const steps: CalcStep[] = [];
  const add = (s: Omit<CalcStep, 'id'>) => steps.push({ id: `rc-${steps.length}`, ...s });
  const cycleMin = r.cycleS / 60;

  add({ group: 'route', label: 'Route length (3D)', formula: 'L = Σ d_i,  d_i = sqrt(ΔE² + ΔN² + ΔZ²)', substituted: `Σ of ${r.segments.length} segments`, value: r.lengthM, unit: 'm', sheetRef: "'Travel Time'!A:A",
    inputs: [{ label: 'Haul string points', value: r.segments.length + 1, source: 'Data Dump!A2:C' }], note: 'Slope (3D) distance, the spreadsheet convention.' });
  add({ group: 'route', label: 'Total rise', formula: 'Rise = Σ max(0, ΔZ_i)', value: r.riseM, unit: 'm' });
  add({ group: 'route', label: 'Total fall', formula: 'Fall = Σ max(0, −ΔZ_i)', value: r.fallM, unit: 'm' });

  add({ group: 'travel', label: 'Travel time loaded', formula: 'T_L = Σ (d_i / 1000) / v_L,i × 3600', substituted: `Σ over ${timed.length} timed segments`, value: r.travelLoadedS, unit: 's', sheetRef: 'ActiveRoute!C4',
    inputs: [{ label: 'Speed model', value: r.speedModel, source: r.speedModel === 'spreadsheet' ? "Grade → speed table 'Travel Time'!P3:Q35" : 'Rimpull envelope (estimated curves)' }] });
  add({ group: 'travel', label: 'Travel time empty', formula: 'T_E = Σ (d_i / 1000) / v_E,i × 3600', value: r.travelEmptyS, unit: 's', sheetRef: 'ActiveRoute!C5' });
  add({ group: 'travel', label: 'Haul time', formula: 'T_haul = (T_L + T_E) / η', substituted: `(${f(r.travelLoadedS, 1)} + ${f(r.travelEmptyS, 1)}) / ${p.haulEff}`, value: r.haulTimeS, unit: 's', sheetRef: 'ActiveRoute!C7',
    inputs: [{ label: 'Haul efficiency η', value: p.haulEff, source: 'ActiveRoute!C6 (typically 0.83–0.85)' }] });

  add({ group: 'cycle', label: 'Dump time', formula: 't_dump', value: p.dumpS, unit: 's', sheetRef: 'ActiveRoute!C8', inputs: [{ label: `${c.loaderUnitId} dump`, value: la?.dumpS ?? p.dumpS, unit: 's', source: 'EX assumptions ActiveRoute!H4:J32' }] });
  add({ group: 'cycle', label: 'Spot time', formula: 't_spot', value: p.spotS, unit: 's', sheetRef: 'ActiveRoute!C9' });
  add({ group: 'cycle', label: 'Loading time', formula: 't_load', value: p.loadS, unit: 's', sheetRef: 'ActiveRoute!C10' });
  add({ group: 'cycle', label: 'Stop signs', formula: 'T_stop = n_stop × t_stop', substituted: `${p.stopSigns} × ${p.stopPenaltyS}`, value: r.stopsS, unit: 's', sheetRef: 'ActiveRoute!C12',
    inputs: [{ label: 'Stop signs incl. return', value: p.stopSigns, source: 'ActiveRoute!C11' }, { label: 'Penalty per stop', value: p.stopPenaltyS, unit: 's', source: 'hard-coded 60 s in ActiveRoute!C12' }] });
  add({ group: 'cycle', label: 'Cycle time', formula: 'T_cycle = T_haul + t_dump + t_spot + t_load + T_stop', substituted: `${f(r.haulTimeS, 1)} + ${p.dumpS} + ${p.spotS} + ${p.loadS} + ${f(r.stopsS, 0)}`, value: r.cycleS, unit: 's', sheetRef: 'ActiveRoute!C14' });
  add({ group: 'cycle', label: 'Cycle time (min)', formula: 'T_cycle / 60', substituted: `${f(r.cycleS, 1)} / 60`, value: cycleMin, unit: 'min', sheetRef: 'ActiveRoute!C15' });

  add({ group: 'productivity', label: 'Truck load', formula: 'V_load', value: p.truckLoadBcm, unit: 'bcm', sheetRef: 'ActiveRoute!C21',
    inputs: [{ label: `${truck?.name ?? c.truckModelId} · ${c.materialId}`, value: p.truckLoadBcm, unit: 'bcm', source: 'Truck load table ActiveRoute!N12:N18' }] });
  add({ group: 'productivity', label: 'Truck productivity', formula: 'P_truck = (60 / T_cycle,min) × V_load', substituted: `(60 / ${f(cycleMin, 3)}) × ${p.truckLoadBcm}`, value: r.truckProdBcmPerPtHr, unit: 'bcm/PT h', sheetRef: 'ActiveRoute!C16' });
  add({ group: 'productivity', label: 'Truck hours required', formula: 'H_truck = V_day / P_truck', substituted: `${f(p.desiredDailyBcm, 0)} / ${f(r.truckProdBcmPerPtHr, 2)}`, value: r.truckHoursReq, unit: 'h/day', sheetRef: 'ActiveRoute!C17',
    inputs: [{ label: 'Desired daily volume', value: p.desiredDailyBcm, unit: 'bcm', source: 'ActiveRoute!C20 (macro-written by the # trucks buttons)' }] });

  add({ group: 'fleet', label: 'Trucks needed (exact)', formula: 'N = H_truck / PT_truck', substituted: `${f(r.truckHoursReq, 2)} / ${p.truckPtHrsPerDay}`, value: r.trucksExact, unit: 'trucks', sheetRef: 'ActiveRoute!C24',
    inputs: [{ label: 'Truck production time', value: p.truckPtHrsPerDay, unit: 'h/day', source: 'ActiveRoute!C22 = I34' }] });
  add({ group: 'fleet', label: 'Trucks recommended', formula: 'N_rec = ⌈N⌉', substituted: `⌈${f(r.trucksExact, 3)}⌉`, value: r.trucksRecommended, unit: 'trucks', note: 'The workbook leaves rounding to the planner (row-28 buttons).' });
  add({ group: 'fleet', label: 'Trucks assigned', formula: 'N_assigned', value: c.trucks, unit: 'trucks', inputs: [{ label: 'Status', value: r.assigned.status }] });

  add({ group: 'loader', label: 'Ideal daily volume', formula: 'V_ideal = R_plan × PT_loader', substituted: `${p.plannedRateBcmPerPtHr} × ${la?.ptHrsPerDay ?? p.truckPtHrsPerDay}`, value: p.plannedRateBcmPerPtHr * (la?.ptHrsPerDay ?? p.truckPtHrsPerDay), unit: 'bcm/day', sheetRef: 'ActiveRoute!C19',
    inputs: [{ label: `${c.loaderUnitId} planned rate`, value: p.plannedRateBcmPerPtHr, unit: 'bcm/PT h', source: 'ActiveRoute!I32 (2025 Budget SPRY)' }] });
  add({ group: 'loader', label: 'Loader PT at planned rate', formula: 'PT_loader = V_day / R_plan', substituted: `${f(p.desiredDailyBcm, 0)} / ${p.plannedRateBcmPerPtHr}`, value: r.loaderPtHrs, unit: 'h/day', sheetRef: 'ActiveRoute!C26' });
  add({ group: 'loader', label: 'Loader PT achieved', formula: 'PT_achieved = min(N × PT_truck × P_truck, V_day) / R_plan', substituted: `${c.trucks} trucks`, value: r.assigned.loaderPtHrsDay, unit: 'h/day' });
  add({ group: 'loader', label: 'Lost PT per shift', formula: 'Lost = (PT_target − PT_achieved) / n_shift', substituted: `(${f(r.loaderPtHrs, 2)} − ${f(r.assigned.loaderPtHrsDay, 2)}) / ${p.shiftsPerDay}`, value: r.assigned.lostLoaderPtHrsShift, unit: 'h/shift', sheetRef: 'ActiveRoute!C28',
    note: 'Workbook: C28 = (C22 / 2) − (C26 / 2) after the # trucks macro sets C20 := MIN(n × C22 × C16, C19).' });
  return steps;
}
