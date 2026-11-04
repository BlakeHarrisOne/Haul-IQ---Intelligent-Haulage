import { it } from 'vitest';
import { createDemoScenario } from '@/state/demo';
import { computeCircuit } from '@/engine';
import type { CircuitResultExt, SegmentResultExt } from '@/engine/types';
it('probe', async () => {
  const s = await createDemoScenario();
  const c = { ...s.circuits[0], params: { ...s.circuits[0].params, speedModel: 'rimpull' as const, motion: 'steady' as const } };
  const r = computeCircuit(s, c) as CircuitResultExt;
  for (const st of r.steps.filter(x => x.id.startsWith('phys.example'))) console.log(st.id, st.label, st.value, st.substituted, st.note);
  const segNo = 0;
  const up = (r.segments as SegmentResultExt[]).reduce((a, g) => (g.grade > a.grade ? g : a));
  console.log('steepest', up.i + 1, up.grade, up.rrPct, up.physLoaded, up.physEmpty);
  const dup = (r.segments as SegmentResultExt[]).filter(g => g.i + 1 === up.i + 1);
  console.log(dup.length);
});
