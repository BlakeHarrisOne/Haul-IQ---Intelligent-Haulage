import { it } from 'vitest';
import { createDemoScenario } from '@/state/demo';
import { computeAllCircuits } from '@/engine';
it('probe', async () => {
  const s = await createDemoScenario();
  console.log('circuits', s.circuits.map(c => ({ id: c.id, hs: c.haulStringId, alts: c.altHaulStringIds, trucks: c.trucks, p: c.params })));
  console.log('strings', s.strings.map(h => ({ id: h.id, name: h.name, n: h.points.length, stops: h.points.filter(p => p.stop).length, segs: h.points.filter(p=>p.seg).length })));
  const R = computeAllCircuits(s);
  for (const [id, r] of Object.entries(R)) {
    console.log(id, r.ok, r.error, 'len', r.lengthM.toFixed(1), 'tl', r.travelLoadedS.toFixed(2), 'te', r.travelEmptyS.toFixed(2), 'cyc', r.cycleS.toFixed(2), 'warn', r.warnings);
    for (const st of r.steps) console.log('  ', st.id, '|', st.value, '|', st.substituted, '|', st.formula);
  }
  console.log('trucksAvailable', s.fleet.trucksAvailable, 'shift', JSON.stringify(s.shift), 'crew shifts', JSON.stringify(s.crew.shifts));
  console.log('rules', JSON.stringify(s.crew.rules, null, 0));
});
