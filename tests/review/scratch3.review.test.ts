import { it } from 'vitest';
import { computeAllCircuits } from '@/engine';
import { simulateShift } from '@/engine/shift/sim';
import { circuitFor, scenarioWith, straightString } from '@/engine/testing';

it('sim vs analytic', () => {
  const h1 = straightString('h1', [{ len: 300, grade: 0 }, { len: 700, grade: 0.08 }, { len: 900, grade: 0 }]);
  for (const variant of ['default', 'nofuel', 'fuel-f1']) {
    for (const n of [5, 6, 8, 10, 14]) {
      const c = circuitFor('c', 'EX09', 'CAT_789D', 'OB', 'h1', n, {});
      const s = scenarioWith([h1], [c]);
      if (variant === 'nofuel') s.shift = { ...s.shift, events: s.shift.events.filter(e => e.kind !== 'fuel') };
      if (variant === 'fuel-f1') s.shift = { ...s.shift, events: s.shift.events.map(e => e.kind === 'fuel' ? { ...e, durMin: 15, fleetStopFraction: 1 } : e) };
      const res = computeAllCircuits(s);
      const sim = simulateShift(s, res, 'c') as any;
      const analytic = res.c.assigned.bcmPerDay / 2;
      // loader idle while a truck sits paused mid spot/load
      let blocked = 0;
      for (const tl of sim.timelines) for (const r of tl.records) if (r.phase === 'load' || r.phase === 'spot') {
        const nominal = r.phase === 'load' ? c.params.loadS : c.params.spotS;
        if (r.t1 - r.t0 > nominal + 1) blocked += (r.t1 - r.t0 - nominal);
      }
      console.log(variant, n, 'sim', sim.bcm.toFixed(0), 'analytic', analytic.toFixed(0), ((sim.bcm / analytic - 1) * 100).toFixed(1) + '%', 'gap', sim.loaderGapS.toFixed(1), 'stretched spot/load s', blocked.toFixed(0), 'loads', sim.loads, 'prodMin', sim.productiveMin);
    }
  }
});
