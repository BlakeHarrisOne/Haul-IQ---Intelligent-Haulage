/**
 * Audit 5 — shift simulation invariants on the demo: one truck at a loader at a time; loads × truck load vs
 * shiftStateAt; trucks stationary during full-stop events; positions continuous in time; digFraction monotone ≤ 1.
 */
import { describe, expect, it } from 'vitest';
import type { CircuitResult, Id, Scenario } from '@/core/types';
import { computeAllCircuits, shiftStateAt, simProductionAt, simulateShift, truckStatesAt } from '@/engine';
import { createDemoScenario } from '@/state/demo';

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function setup(): Promise<{ s: Scenario; R: Record<Id, CircuitResult> }> {
  const s = await createDemoScenario();
  return { s, R: computeAllCircuits(s) };
}

describe('audit 5 · shift simulation (demo)', () => {
  it('one truck at the loader at a time; loader rate not exceeded', async () => {
    const { s, R } = await setup();
    const bad: string[] = [];
    for (const c of s.circuits) {
      const sim = simulateShift(s, R, c.id);
      const svc = sim.timelines.flatMap(t => {
        const out: { k: number; t0: number; t1: number }[] = [];
        for (let i = 0; i < t.records.length; i++) {
          const r = t.records[i];
          if (r.phase === 'spot') { const l = t.records[i + 1]; out.push({ k: t.truckIndex, t0: r.t0, t1: l?.phase === 'load' ? l.t1 : r.t1 }); }
        }
        return out;
      }).sort((a, b) => a.t0 - b.t0);
      for (let i = 1; i < svc.length; i++) if (svc[i].t0 < svc[i - 1].t1 - 1e-6) bad.push(`${c.id}: truck ${svc[i].k} spots at ${svc[i].t0.toFixed(1)} s while truck ${svc[i - 1].k} is at the loader until ${svc[i - 1].t1.toFixed(1)} s`);
      const perShift = R[c.id].assigned.bcmPerDay / (c.params.shiftsPerDay || 2);
      if (sim.bcm > perShift + c.params.truckLoadBcm + 1e-6) bad.push(`${c.id}: simulated ${sim.bcm.toFixed(0)} bcm > calculation ${perShift.toFixed(0)} + one load`);
      if (sim.loads !== sim.loadEndsS.filter(t => t <= sim.shiftS).length) bad.push(`${c.id}: loads ${sim.loads} ≠ load ends within the shift`);
      console.log(`[audit5] ${c.id}: ${sim.trucks} trucks, ${sim.loads} loads, sim ${sim.bcm.toFixed(0)} bcm vs calc ${perShift.toFixed(0)} bcm/shift (${((sim.bcm / perShift - 1) * 100).toFixed(1)} %)`);
    }
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });

  it('loads × truck load = shiftStateAt bcm; Σ per-truck loads = circuit loads; digFraction monotone and ≤ 1', async () => {
    const { s, R } = await setup();
    const bad: string[] = [];
    const prev: Record<string, { dig: number; dump: number; bcm: number }> = {};
    for (let tMin = 0; tMin <= s.shift.lengthH * 60; tMin += 2) {
      const st = shiftStateAt(s, R, tMin);
      if (!(st.productiveFraction >= 0 && st.productiveFraction <= 1)) bad.push(`t=${tMin}: productiveFraction ${st.productiveFraction}`);
      for (const pc of st.perCircuit) {
        const c = s.circuits.find(x => x.id === pc.circuitId)!;
        const sim = simulateShift(s, R, c.id);
        const now = simProductionAt(sim, tMin);
        if (pc.loads !== now.loads) bad.push(`${c.id} t=${tMin}: loads ${pc.loads} ≠ ${now.loads}`);
        if (pc.bcmSoFar + 1e-9 < pc.loads * c.params.truckLoadBcm || pc.bcmSoFar > (pc.loads + 1) * c.params.truckLoadBcm + 1e-9) bad.push(`${c.id} t=${tMin}: bcm ${pc.bcmSoFar} not within loads × load (+1 in progress)`);
        const perTruck = truckStatesAt(s, R, c.id, tMin).reduce((a, x) => a + x.loads, 0);
        if (perTruck !== pc.loads) bad.push(`${c.id} t=${tMin}: Σ truck loads ${perTruck} ≠ ${pc.loads}`);
        if (pc.digFraction > 1 || pc.dumpFraction > 1 || pc.digFraction < 0) bad.push(`${c.id} t=${tMin}: fractions ${pc.digFraction}/${pc.dumpFraction}`);
        const p = prev[c.id];
        if (p && (pc.digFraction < p.dig - 1e-12 || pc.dumpFraction < p.dump - 1e-12 || pc.bcmSoFar < p.bcm - 1e-9)) bad.push(`${c.id} t=${tMin}: not monotone (dig ${p.dig}→${pc.digFraction}, bcm ${p.bcm}→${pc.bcmSoFar})`);
        prev[c.id] = { dig: pc.digFraction, dump: pc.dumpFraction, bcm: pc.bcmSoFar };
      }
    }
    const end = shiftStateAt(s, R, s.shift.lengthH * 60);
    for (const pc of end.perCircuit) if (Math.abs(pc.bcmSoFar - pc.bcmShift) > 1e-9) bad.push(`${pc.circuitId}: end-of-shift bcm ${pc.bcmSoFar} ≠ sim.bcm ${pc.bcmShift}`);
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });

  it('every truck is stationary during full-stop events (prestart, crib, park-up)', async () => {
    const { s, R } = await setup();
    const bad: string[] = [];
    for (const ev of s.shift.events.filter(e => e.fleetStopFraction >= 0.999)) for (const c of s.circuits) {
      const t0 = ev.startMin + 0.02, t1 = Math.min(ev.startMin + ev.durMin - 0.02, s.shift.lengthH * 60);
      const ref = truckStatesAt(s, R, c.id, t0);
      for (let t = t0; t <= t1; t += 0.5) {
        for (const x of truckStatesAt(s, R, c.id, t)) {
          const r0 = ref[x.truckIndex];
          if (x.speedKmh > 1e-9 || dist(x.pos, r0.pos) > 1e-6) { bad.push(`${c.id} truck ${x.truckIndex} during "${ev.label}" t=${t.toFixed(2)} min: ${x.phase} v=${x.speedKmh.toFixed(2)} km/h, moved ${dist(x.pos, r0.pos).toFixed(2)} m`); break; }
        }
      }
    }
    expect(bad.slice(0, 10), `${bad.length} samples\n${bad.slice(0, 10).join('\n')}`).toEqual([]);
  });

  it('positions are continuous in time (no jump larger than speed × dt + 0.5 m at 1 s sampling)', async () => {
    const { s, R } = await setup();
    const bad: string[] = [];
    const kinds = new Map<string, number>();
    for (const c of s.circuits) {
      let prev = truckStatesAt(s, R, c.id, 0);
      for (let tS = 1; tS <= s.shift.lengthH * 3600; tS += 1) {
        const cur = truckStatesAt(s, R, c.id, tS / 60);
        for (const x of cur) {
          const p = prev[x.truckIndex];
          const d = dist(x.pos, p.pos);
          const allow = (Math.max(x.speedKmh, p.speedKmh, 31) / 3.6) * 1 + 0.5;
          if (d > allow) {
            const key = `${p.phase}${p.queueIndex != null ? `[q${p.queueIndex}]` : ''} → ${x.phase}${x.queueIndex != null ? `[q${x.queueIndex}]` : ''}`;
            kinds.set(key, (kinds.get(key) ?? 0) + 1);
            if (bad.length < 12) bad.push(`${c.id} truck ${x.truckIndex} t=${tS} s: ${key} jumped ${d.toFixed(1)} m (allow ${allow.toFixed(1)}), chainage ${p.chainageM.toFixed(1)} → ${x.chainageM.toFixed(1)}`);
          }
        }
        prev = cur;
      }
    }
    if (kinds.size) console.log('[audit5] jump kinds:', JSON.stringify([...kinds]));
    expect(bad, `${[...kinds.values()].reduce((a, b) => a + b, 0)} jumps\n${bad.join('\n')}`).toEqual([]);
  });
});
