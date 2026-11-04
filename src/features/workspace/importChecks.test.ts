import { describe, expect, it } from 'vitest';
import { sheetLikeSolid } from './importChecks';

describe('sheetLikeSolid (design QA #38)', () => {
  const plan = 250 * 100;
  it('flags a 250 × 100 m block that reports 250 bcm', () => {
    const w = sheetLikeSolid({ closed: true, volume: 250, planArea: plan });
    expect(w).toMatch(/looks like a sheet, check the solid/);
    expect(w).toMatch(/0\.01 m thick/);
  });
  it('accepts a real 10 m block', () => {
    expect(sheetLikeSolid({ closed: true, volume: plan * 10, planArea: plan })).toBeNull();
  });
  it('ignores open surfaces and missing volumes', () => {
    expect(sheetLikeSolid({ closed: false, volume: 1, planArea: plan })).toBeNull();
    expect(sheetLikeSolid({ closed: true, volume: undefined, planArea: plan })).toBeNull();
  });
});
