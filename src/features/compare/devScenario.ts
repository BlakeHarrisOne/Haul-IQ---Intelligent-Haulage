/**
 * DEV-ONLY synthetic scenario for the analytics harness (harness.html). Never imported by the views.
 *
 * Built from the user's own workbook fixtures (docs/spec/fixtures) so the ledger can be checked against the
 * Haulage Calculator: circuit 1 is the current Data Dump string "EX09 - B7-9 to RL282" (117 points) with the
 * exact ActiveRoute inputs, so ActiveRoute!C4…C28 must reproduce (C4 171.567 s, C7 394.71 s, C24 3.436).
 * Used until '@/state/demo' createDemoScenario() returns circuits (geometry + data agents).
 */
import type { Circuit, CircuitParams, HaulString, Scenario } from '@/core/types';
import { emptyScenario } from '@/state/store';
import { defaultScenarioData } from '@/data';
import tables from '../../../docs/spec/fixtures/spreadsheet-tables.json';
import raw from '../../../docs/spec/fixtures/raw-data-strings.json';

function stringFrom(id: string, name: string, color: string): HaulString {
  const r = (raw.strings as { id: string; points: number[][] }[]).find(s => s.id === id)!;
  return {
    id: `hs-${id}`, name, color, source: 'imported', visible: true, createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z',
    points: r.points.map((p, i) => ({ id: `${id}-${i}`, e: p[0], n: p[1], z: p[2] })),
  };
}

const EX = (tables.excavator_assumptions as unknown as { excavators: Record<string, { model: string; dump_time_s: number; spot_time_s: number; loading_time_s: number; planned_rate_bcm_per_pt_hr: number }> }).excavators;

function params(unit: string, p: Partial<CircuitParams>): CircuitParams {
  const ex = EX[unit.startsWith('LDR') ? 'LDR' : unit];
  return {
    haulEff: 0.85, stopSigns: 2, stopPenaltyS: 60, spotS: ex.spot_time_s, loadS: ex.loading_time_s, dumpS: ex.dump_time_s,
    truckLoadBcm: 104, plannedRateBcmPerPtHr: ex.planned_rate_bcm_per_pt_hr, truckPtHrsPerDay: 20,
    desiredDailyBcm: ex.planned_rate_bcm_per_pt_hr * 20, rrPct: 2.5, speedLimitKmh: 60, speedModel: 'spreadsheet', shiftsPerDay: 2, ...p,
  };
}

export function buildDevScenario(variant: 0 | 1 | 2 = 0): Scenario {
  const s = emptyScenario(['Week 45 – base plan', 'Week 45 – EX04 long haul', 'Week 45 – 789D swap'][variant]);
  s.id = `dev-scn-${variant}`;
  s.description = 'Analytics harness fixture built from the Haulage Calculator workbook strings.';
  s.site = { name: 'Bowen Basin strip pit (fixture)', origin: [236000, 7051000, 280], crs: 'GDA2020 / MGA zone 56' };
  const data = defaultScenarioData();
  const strings = [
    stringFrom('ex09-b7-9-to-rl282', 'EX09 B7-9 → RL282', '#0A6FE6'),
    stringFrom(variant === 1 ? 'ex04-b07-b10-ob-to-rl325-dump-hauling-west-to-western-rl325-dump' : 'ex04-b10-b07-ob-to-rl325-dump-2', variant === 1 ? 'EX04 B07-B10 → RL325 West' : 'EX04 B10-B07 → RL325', '#B8692E'),
    stringFrom('ldr-b6-7-ma-coal-to-rom', 'LDR B6-7 MA coal → ROM', '#3E8A5A'),
    stringFrom('ex07-s51-haul-east-from-mid-point-option-1-short-haul', 'EX07 S51 East short haul', '#7B5EA7'),
    stringFrom('ex07-s51-haul-east-from-mid-point-option-2-long-haul', 'EX07 S51 East long haul', '#7B5EA7'),
  ];
  const t789 = variant === 2 ? 'CAT_789D' : 'CAT_789C';
  const mk = (id: string, name: string, unit: string, truck: string, mat: string, hs: string, n: number, prio: number, color: string, p: Partial<CircuitParams>): Circuit => ({
    id, name, loaderUnitId: unit, loaderModelId: data.fleet.units.find(u => u.id === unit)?.modelId ?? `ldr-${unit}`, truckModelId: truck, materialId: mat, haulStringId: hs, trucks: n, priority: prio, active: true,
    params: params(unit, p), color,
  });
  s.circuits = [
    mk('c-ex09', 'EX09 OB → RL282', 'EX09', 'CAT_789D', 'OB', strings[0].id, 3, 1, 'var(--c1)', { desiredDailyBcm: 36000 }),
    mk('c-ex04', variant === 1 ? 'EX04 OB → RL325 West' : 'EX04 OB → RL325', 'EX04', 'KOM_HD1500_7', 'OB', strings[1].id, variant === 1 ? 5 : 3, 2, 'var(--c2)', { truckLoadBcm: 89, desiredDailyBcm: 26000 }),
    mk('c-ldr', 'LDR coal → ROM', 'LDR1', t789, 'CL', strings[2].id, 3, 3, 'var(--c3)', { truckLoadBcm: 100, desiredDailyBcm: 11700, truckPtHrsPerDay: 18, stopSigns: 3 }),
    mk('c-ex07', 'EX07 OB → S51 East', 'EX07', t789, 'OB', strings[3].id, 4, 4, 'var(--c4)', { desiredDailyBcm: 36000, speedModel: 'rimpull' }),
  ];
  s.circuits[3].altHaulStringIds = [strings[4].id];
  s.strings = strings;
  Object.assign(s, data);
  return s;
}
