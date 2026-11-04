/**
 * Audit 2 — CalcStep integrity on the demo scenario: every step's value equals the result field it explains, and the
 * `substituted` expression (where it is arithmetic) evaluates to the value within its display rounding.
 * Covers circuits in spreadsheet (demo default), rimpull steady, rimpull kinematic and M/M/1//N, plus manning,
 * priority and shift-simulation steps.
 */
import { describe, expect, it } from 'vitest';
import type { CalcStep, Circuit, Scenario } from '@/core/types';
import { computeAllCircuits, computeCircuit, computeManning, computePriority, queueEstimate, simulateShift } from '@/engine';
import type { CircuitResultExt, SegmentResultExt } from '@/engine/types';
import { createDemoScenario } from '@/state/demo';

/** Evaluate a substituted arithmetic string (×, −, MIN/MAX/ROUNDUP); undefined when it is not plain arithmetic. */
export function evalSubst(src: string): number | undefined {
  let s = src.replace(/×/g, '*').replace(/−/g, '-').replace(/÷/g, '/');
  s = s.replace(/ROUNDUP\(([^,()]+),\s*0\)/g, 'Math.ceil($1)').replace(/\bMIN\(/g, 'Math.min(').replace(/\bMAX\(/g, 'Math.max(').replace(/\bmax\(/g, 'Math.max(').replace(/\bmin\(/g, 'Math.min(');
  s = s.replace(/,(?=\d{3}\b)/g, ''); // thousands separators
  if (!/^[\d\s.+\-*/(),]*$/.test(s.replace(/Math\.(min|max|ceil)/g, ''))) return undefined;
  try {
    const v = Function(`"use strict"; return (${s});`)() as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  } catch { return undefined; }
}

/** Display tolerance: half a unit of the least significant decimal shown, propagated generously. */
const close = (got: number, exp: number) => Math.abs(got - exp) <= Math.max(2e-3 * Math.abs(exp), 0.06);

interface Tally { checked: number; parsed: number; unparsed: string[]; bad: string[] }
const tally = (): Tally => ({ checked: 0, parsed: 0, unparsed: [], bad: [] });

function checkSubst(t: Tally, tag: string, st: CalcStep) {
  if (!st.substituted) return;
  const parts = st.substituted.split(' = ');
  const v0 = evalSubst(parts[0]);
  if (v0 == null) { t.unparsed.push(`${tag} ${st.id}: ${st.substituted}`); return; }
  t.parsed++;
  if (st.id === 'fleet.recommended') { if (v0 !== st.value) t.bad.push(`${tag} ${st.id}: "${st.substituted}" = ${v0} but value ${st.value}`); return; }
  if (!close(v0, st.value)) t.bad.push(`${tag} ${st.id}: "${st.substituted}" = ${v0} but value ${st.value}`);
  for (const p of parts.slice(1)) {
    const v = evalSubst(p);
    if (v != null && !close(v, st.value)) t.bad.push(`${tag} ${st.id}: rhs "${p}" = ${v} but value ${st.value}`);
  }
}

function circuitSteps(t: Tally, tag: string, c: Circuit, r: CircuitResultExt) {
  const p = c.params;
  const s = p.shiftsPerDay || 2;
  const n = Math.round(c.trucks);
  const segs = r.segments as SegmentResultExt[];
  // independent recomputation of each step's quantity from the primitive fields
  const sumL = segs.reduce((a, g) => a + g.timeLoadedS, 0), sumE = segs.reduce((a, g) => a + g.timeEmptyS, 0);
  const haul = (r.travelLoadedS + r.travelEmptyS) / p.haulEff;
  const cycle = haul + p.dumpS + p.spotS + p.loadS + r.stopsS;
  const prod = (60 / (cycle / 60)) * p.truckLoadBcm;
  const target = p.loaderPtHrsPerDay ?? p.truckPtHrsPerDay;
  const expect: Record<string, number> = {
    'route.length': segs.reduce((a, g) => a + g.dist3dM, 0), 'travel.loaded': sumL, 'travel.empty': sumE,
    'cycle.haul': haul, 'cycle.dump': p.dumpS, 'cycle.spot': p.spotS, 'cycle.load': p.loadS,
    'cycle.stops': r.speedModel === 'spreadsheet' ? p.stopPenaltyS * p.stopSigns : p.stopPenaltyS * Math.max(0, p.stopSigns - r.stopsModelled),
    'cycle.total': cycle, 'cycle.min': cycle / 60, 'prod.load': p.truckLoadBcm, 'prod.truck': prod,
    'fleet.ideal': p.plannedRateBcmPerPtHr * target, 'fleet.desired': p.desiredDailyBcm, 'fleet.truckHours': p.desiredDailyBcm / prod,
    'fleet.trucks': p.desiredDailyBcm / prod / p.truckPtHrsPerDay, 'fleet.recommended': Math.ceil(p.desiredDailyBcm / prod / p.truckPtHrsPerDay),
    'loader.pt': p.desiredDailyBcm / p.plannedRateBcmPerPtHr, 'loader.lost': target / s - p.desiredDailyBcm / p.plannedRateBcmPerPtHr / s,
    'fleet.assigned': r.assigned.bcmPerDay, 'fleet.matchFactor': (n * (p.spotS + p.loadS)) / cycle,
  };
  // and each result field the step claims to explain
  const field: Record<string, number | undefined> = {
    'route.length': r.lengthM, 'travel.loaded': r.travelLoadedS, 'travel.empty': r.travelEmptyS, 'cycle.haul': r.haulTimeS, 'cycle.stops': r.stopsS,
    'cycle.total': r.cycleS, 'cycle.min': r.cycleMin, 'prod.load': r.truckLoadBcm, 'prod.truck': r.truckProdBcmPerPtHr, 'fleet.ideal': r.idealDailyBcm,
    'fleet.desired': r.desiredDailyBcm, 'fleet.truckHours': r.truckHoursReq, 'fleet.trucks': r.trucksExact, 'fleet.recommended': r.trucksRecommended,
    'loader.pt': r.loaderPtHrs, 'fleet.assigned': r.assigned.bcmPerDay, 'fleet.matchFactor': r.assigned.matchFactor,
    'phys.payload': r.payloadT, 'phys.mass': r.massLoadedT,
  };
  for (const st of r.steps) {
    t.checked++;
    if (!Number.isFinite(st.value)) t.bad.push(`${tag} ${st.id}: non-finite value ${st.value}`);
    const rel = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    if (st.id in field && field[st.id] != null && !rel(st.value, field[st.id] as number)) t.bad.push(`${tag} ${st.id}: value ${st.value} ≠ result field ${field[st.id]}`);
    if (st.id in expect && !rel(st.value, expect[st.id])) t.bad.push(`${tag} ${st.id}: value ${st.value} ≠ recomputed ${expect[st.id]}`);
    if (st.id.startsWith('travel.dropped.') && st.value !== 0) t.bad.push(`${tag} ${st.id}: dropped step value ${st.value}`);
    if (st.id.startsWith('queue.')) {
      const m = st.id.slice(6) as 'deterministic' | 'mm1n' | 'binomial';
      const q = queueEstimate(m, n, p.spotS + p.loadS, r.cycleS);
      if (!rel(st.value, q.loadsPerHr)) t.bad.push(`${tag} ${st.id}: ${st.value} ≠ ${q.loadsPerHr}`);
    }
    if (st.id.startsWith('phys.example.')) {
      // "<m> × 9.81 × (<sin> + <cos> × <rr>/100) = <F> kN → F_rim(<v>) = <F> kN": the LHS must equal the shown force, the
      // value must be a segment's steady speed in that direction
      const loaded = st.id.includes('.loaded.');
      const hit = segs.find(g => Math.abs(((loaded ? g.physLoaded : g.physEmpty)?.steadyKmh ?? NaN) - st.value) < 1e-9);
      if (!hit) t.bad.push(`${tag} ${st.id}: value ${st.value} km/h is not any segment's steady ${loaded ? 'loaded' : 'empty'} speed`);
      const m = st.substituted?.match(/^(.*) = ([\d.]+) kN/);
      if (m) {
        const lhs = evalSubst(m[1]);
        if (lhs != null) { t.parsed++; if (!close(lhs, +m[2])) t.bad.push(`${tag} ${st.id}: "${m[1]}" = ${lhs} vs shown ${m[2]} kN`); }
        if (hit && !close(Math.abs((loaded ? hit.physLoaded : hit.physEmpty)!.resistanceKN), +m[2])) t.bad.push(`${tag} ${st.id}: shown ${m[2]} kN ≠ segment resistance ${(loaded ? hit.physLoaded : hit.physEmpty)!.resistanceKN}`);
      }
      continue;
    }
    checkSubst(t, tag, st);
  }
  // the CalcStep inputs that restate the travel totals
  const haulStep = r.steps.find(x => x.id === 'cycle.haul');
  const tlIn = haulStep?.inputs?.find(i => i.label === 'T_loaded')?.value as number;
  if (Math.abs(tlIn - r.travelLoadedS) > 5e-4) t.bad.push(`${tag} cycle.haul input T_loaded ${tlIn} ≠ ${r.travelLoadedS}`);
}

async function demo(): Promise<Scenario> { return createDemoScenario(); }

describe('audit 2 · CalcStep integrity on the demo scenario', () => {
  const variants: [string, Partial<Circuit['params']>][] = [
    ['spreadsheet', {}], ['rimpull-steady', { speedModel: 'rimpull', motion: 'steady' }], ['rimpull-kinematic', { speedModel: 'rimpull', motion: 'kinematic' }],
    ['spreadsheet-mm1n', { queueModel: 'mm1n' }], ['spreadsheet-clamp', { outOfRange: 'clamp' }],
  ];
  it.each(variants)('circuit steps · %s', async (name, patch) => {
    const s = await demo();
    s.circuits = s.circuits.map(c => ({ ...c, params: { ...c.params, ...patch } }));
    const t = tally();
    for (const c of s.circuits) circuitSteps(t, `${name}/${c.id}`, c, computeCircuit(s, c) as CircuitResultExt);
    // also every alternative haul string and every macro button
    for (const c of s.circuits) for (const alt of c.altHaulStringIds ?? []) circuitSteps(t, `${name}/${c.id}@${alt}`, c, computeCircuit(s, c, { haulStringId: alt }) as CircuitResultExt);
    for (const c of s.circuits) for (const n of [1, 3, 8]) circuitSteps(t, `${name}/${c.id}#${n}`, { ...c, trucks: n }, computeCircuit(s, { ...c, trucks: n }) as CircuitResultExt);
    console.log(`[audit2] ${name}: ${t.checked} steps, ${t.parsed} substituted parsed, ${t.unparsed.length} descriptive, ${t.bad.length} mismatches`);
    if (t.unparsed.length) console.log('[audit2] descriptive (not arithmetic):', [...new Set(t.unparsed.map(u => u.replace(/^\S+ /, '').replace(/:.*/, '')))].join(', '));
    expect(t.bad, t.bad.slice(0, 15).join('\n')).toEqual([]);
  });

  it('manning, priority and shift steps', async () => {
    const s = await demo();
    const R = computeAllCircuits(s);
    const t = tally();
    const m = computeManning(s, R);
    for (const st of m.steps) {
      t.checked++;
      if (st.id === 'manning.total') {
        if (st.value !== m.total) t.bad.push(`manning.total ${st.value} ≠ ${m.total}`);
        const sum = (st.substituted ?? '').split(' + ').reduce((a, x) => a + Number(x.split(' ').pop()), 0);
        if (sum !== m.total) t.bad.push(`manning.total substituted sums to ${sum}`);
      } else if (st.id === 'manning.surplus') { if (st.value !== m.surplus) t.bad.push(`manning.surplus ${st.value} ≠ ${m.surplus}`); checkSubst(t, 'manning', st); }
      else if (st.id.startsWith('manning.R')) {
        const id = st.id.slice(8);
        const lines = m.lines.filter(l => l.ruleId === id).reduce((a, l) => a + l.count, 0);
        if (st.value !== lines) t.bad.push(`${st.id} ${st.value} ≠ Σ lines ${lines}`);
      }
    }
    for (const crew of [36, 30, 28, 20, 12]) {
      const pr = computePriority(s, R, { crewAvailable: crew });
      for (const st of pr.steps) {
        t.checked++;
        if (st.id === 'priority.trucks' && st.value !== pr.trucksUsed && !pr.allocations.some(a => a.allocatedTrucks !== a.requestedTrucks)) t.bad.push(`priority.trucks ${st.value} ≠ ${pr.trucksUsed}`);
        if (st.id === 'priority.required' && st.value !== pr.crewRequired) t.bad.push(`priority.required ${st.value} ≠ ${pr.crewRequired}`);
        if (st.id === 'priority.result') {
          if (Math.abs(st.value - (pr.bcmDayAchieved ?? NaN)) > 1e-6) t.bad.push(`priority.result ${st.value} ≠ ${pr.bcmDayAchieved}`);
          const mm = st.substituted?.match(/planned (\d+) − lost (\d+)/);
          if (mm && Math.abs(+mm[1] - +mm[2] - st.value) > 1.01) t.bad.push(`priority.result substituted ${st.substituted} vs ${st.value}`);
        }
        const a = pr.allocations.find(x => st.id === `priority.${x.circuitId}`);
        if (a && Math.abs(st.value - a.bcmDayLost) > 1e-6) t.bad.push(`${st.id} ${st.value} ≠ allocation lost ${a.bcmDayLost}`);
        const tk = pr.tasks.find(x => st.id === `priority.task.${x.ruleId}`);
        if (tk && st.value !== tk.allocated) t.bad.push(`${st.id} ${st.value} ≠ task allocated ${tk.allocated}`);
      }
    }
    for (const c of s.circuits) {
      const sim = simulateShift(s, R, c.id);
      for (const st of sim.steps) {
        t.checked++;
        if (st.id === 'shift.bcm' && Math.abs(st.value - sim.bcm) > 1e-9) t.bad.push(`${c.id} shift.bcm ${st.value} ≠ ${sim.bcm}`);
        if (st.id === 'shift.gap' && Math.abs(st.value - sim.loaderGapS) > 1e-9) t.bad.push(`${c.id} shift.gap ${st.value} ≠ ${sim.loaderGapS}`);
        if (st.id === 'shift.productive' && Math.abs(st.value - sim.productiveMin) > 1e-9) t.bad.push(`${c.id} shift.productive ${st.value} ≠ ${sim.productiveMin}`);
        checkSubst(t, `shift/${c.id}`, st);
      }
    }
    console.log(`[audit2] manning/priority/shift: ${t.checked} steps, ${t.parsed} parsed, ${t.bad.length} mismatches`);
    expect(t.bad, t.bad.slice(0, 15).join('\n')).toEqual([]);
  });
});
