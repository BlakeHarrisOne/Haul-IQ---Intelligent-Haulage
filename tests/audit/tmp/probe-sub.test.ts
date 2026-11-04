import { it } from 'vitest';
import { evalSubst } from '../calcsteps.test';
it('p', () => {
  for (const s of ['MIN(5 × 20 × 313.573, 36000)', 'MIN(3 × 18 × 405.6, 11700)', '60 × max(0, 2 − 0)']) console.log(JSON.stringify(s), evalSubst(s));
});
