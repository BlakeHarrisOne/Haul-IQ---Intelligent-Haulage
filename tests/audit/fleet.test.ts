/**
 * Audit 4 — fleet options and queue models: monotonicity in n, match factor, M/M/1//N against a hand calculation and
 * against the spec 04 §C.4 worked example table.
 */
import { describe, expect, it } from 'vitest';
import { computeCircuit, queueEstimate } from '@/engine';
import type { CircuitResultExt, QueueModel } from '@/engine/types';
import { createDemoScenario } from '@/state/demo';

/** Finite-source M/M/1//N by hand (spec 04 §C.3, machine-repairman), explicit factorials. */
function mm1nHand(N: number, tL: number, c: number) {
  const tA = c - tL, rho = tL / tA;
  let sum = 0;
  for (let k = 0; k <= N; k++) {
    let perm = 1; // N! / (N − k)!
    for (let j = 0; j < k; j++) perm *= N - j;
    sum += perm * rho ** k;
  }
  const P0 = 1 / sum, U = 1 - P0, X = U / tL, L = N - X * tA, Lq = L - U;
  return { P0, U, X, L, Lq, Wq: Lq / X, cycle: N / X };
}

describe('audit 4 · fleet / queuing', () => {
  it('options are monotone in n; MF, C17/C24/C26 identities hold (demo × speed models × queue models)', async () => {
    const s = await createDemoScenario();
    const bad: string[] = [];
    for (const c of s.circuits) for (const speedModel of ['spreadsheet', 'rimpull'] as const) for (const queueModel of ['deterministic', 'mm1n', 'binomial'] as QueueModel[]) {
      const r = computeCircuit(s, c, { speedModel, queueModel, maxTrucks: 20 }) as CircuitResultExt;
      const p = c.params, tag = `${c.id}/${speedModel}/${queueModel}`;
      const rank = { under: 0, balanced: 1, over: 2 } as const;
      r.options.forEach((o, k) => {
        const n = k + 1;
        if (o.trucks !== n) bad.push(`${tag}: option ${k} has trucks ${o.trucks}`);
        if (Math.abs(o.matchFactor - (n * (p.spotS + p.loadS)) / r.cycleS) > 1e-12) bad.push(`${tag} n=${n}: MF ${o.matchFactor}`);
        if (Math.abs(o.truckHoursReq - o.bcmPerDay / r.truckProdBcmPerPtHr) > 1e-9) bad.push(`${tag} n=${n}: C17`);
        if (Math.abs(o.trucksNeeded - o.truckHoursReq / p.truckPtHrsPerDay) > 1e-12) bad.push(`${tag} n=${n}: C24`);
        if (Math.abs(o.loaderPtHrsDay - o.bcmPerDay / p.plannedRateBcmPerPtHr) > 1e-12) bad.push(`${tag} n=${n}: C26`);
        if (o.bcmPerDay > r.idealDailyBcm + 1e-9) bad.push(`${tag} n=${n}: production ${o.bcmPerDay} above ideal ${r.idealDailyBcm}`);
        if (k === 0) return;
        const q = r.options[k - 1];
        if (o.bcmPerDay < q.bcmPerDay - 1e-9) bad.push(`${tag} n=${n}: production falls ${q.bcmPerDay} → ${o.bcmPerDay}`);
        if (o.lostLoaderPtHrsShift > q.lostLoaderPtHrsShift + 1e-12) bad.push(`${tag} n=${n}: lost PT rises`);
        if (o.truckQueueHrsShift < q.truckQueueHrsShift - 1e-12) bad.push(`${tag} n=${n}: truck queue falls ${q.truckQueueHrsShift} → ${o.truckQueueHrsShift}`);
        if (rank[o.status] < rank[q.status]) bad.push(`${tag} n=${n}: status ${q.status} → ${o.status}`);
        if (o.queueWaitMinPerLoad < q.queueWaitMinPerLoad - 1e-12) bad.push(`${tag} n=${n}: queue wait falls`);
        if (o.loaderBusy < q.loaderBusy - 1e-12) bad.push(`${tag} n=${n}: loader busy falls`);
      });
    }
    expect(bad.slice(0, 20), bad.slice(0, 20).join('\n')).toEqual([]);
  });

  it('M/M/1//N equals a hand calculation (demo EX09: N = 5, t_L = 140 s, c = cycle)', async () => {
    const s = await createDemoScenario();
    const c = s.circuits[0];
    const r = computeCircuit(s, c, { queueModel: 'mm1n' }) as CircuitResultExt;
    const tL = c.params.spotS + c.params.loadS;
    expect(tL).toBe(140);
    const h = mm1nHand(5, tL, r.cycleS);
    const q = queueEstimate('mm1n', 5, tL, r.cycleS);
    expect(q.loaderBusy).toBeCloseTo(h.U, 12);
    expect(q.loadsPerHr).toBeCloseTo(h.X * 3600, 9);
    expect(q.meanQueue).toBeCloseTo(h.Lq, 9);
    expect(q.waitS).toBeCloseTo(h.Wq, 9);
    expect(q.cycleActualS).toBeCloseTo(h.cycle, 9);
    // the option at 5 trucks carries X · load · PT (capped at C19)
    const o = r.options[4];
    expect(o.truckCapacityBcmDay).toBeCloseTo(h.X * 3600 * c.params.truckLoadBcm * c.params.truckPtHrsPerDay, 6);
    expect(o.bcmPerDay).toBeCloseTo(Math.min(o.truckCapacityBcmDay, r.idealDailyBcm), 6);
    // N = 1: no queue possible, X = 1/c
    expect(queueEstimate('mm1n', 1, tL, r.cycleS).loadsPerHr).toBeCloseTo(3600 / r.cycleS, 9);
  });

  it('spec 04 §C.4 worked example: t_L 2.75 min, t_A 22 min, 181 t (deterministic / binomial / M/M/1//N t/h, M/M/1 wait)', () => {
    const doc: [number, number, number, number, number, number][] = [ // N, MF, det, binomial, mm1n, mm1n wait min
      [6, 0.67, 2633, 2001, 2410, 2.29], [7, 0.78, 3072, 2218, 2732, 3.07], [8, 0.89, 3510, 2410, 3019, 4.03], [9, 1.0, 3949, 2581, 3265, 5.18],
      [10, 1.11, 3949, 2733, 3469, 6.56], [11, 1.22, 3949, 2868, 3628, 8.18], [12, 1.33, 3949, 2988, 3746, 10.04],
    ];
    const tL = 2.75 * 60, c = (2.75 + 22) * 60, t = 181;
    const bad: string[] = [];
    for (const [N, mf, det, bin, mm, wait] of doc) {
      const d = queueEstimate('deterministic', N, tL, c).loadsPerHr * t;
      const b = queueEstimate('binomial', N, tL, c).loadsPerHr * t;
      const m = queueEstimate('mm1n', N, tL, c);
      if (Math.abs((N * tL) / c - mf) > 0.006) bad.push(`N=${N} MF`);
      if (Math.abs(d - det) > 1) bad.push(`N=${N} deterministic ${d.toFixed(0)} vs ${det}`);
      if (Math.abs(b - bin) > 1) bad.push(`N=${N} binomial ${b.toFixed(0)} vs ${bin}`);
      if (Math.abs(m.loadsPerHr * t - mm) > 1) bad.push(`N=${N} M/M/1//N ${(m.loadsPerHr * t).toFixed(0)} vs ${mm}`);
      if (Math.abs(m.waitS / 60 - wait) > 0.006) bad.push(`N=${N} M/M/1 wait ${(m.waitS / 60).toFixed(2)} vs ${wait}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('INFO: match factor (service-time based) vs trucking status (planned-rate based) disagree on the demo', async () => {
    const s = await createDemoScenario();
    const rows: string[] = [];
    for (const c of s.circuits) {
      const r = computeCircuit(s, c, { maxTrucks: 12 }) as CircuitResultExt;
      const firstBalanced = r.options.find(o => o.status !== 'under')!;
      const mf1 = r.options.find(o => o.matchFactor >= 1);
      rows.push(`${c.id}: status leaves 'under' at n=${firstBalanced.trucks} (MF ${firstBalanced.matchFactor.toFixed(2)}); MF ≥ 1 first at n=${mf1?.trucks ?? '>12'}; `
        + `planned rate ${c.params.plannedRateBcmPerPtHr} vs service capacity ${(3600 / (c.params.spotS + c.params.loadS) * c.params.truckLoadBcm).toFixed(0)} bcm/h`);
      expect(firstBalanced.matchFactor).toBeLessThan(1);
    }
    console.log('[audit4]', rows.join('\n'));
  });
});
