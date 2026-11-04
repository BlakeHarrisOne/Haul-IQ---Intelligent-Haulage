import { describe, expect, it } from 'vitest';
import { TOP_MAX, anyTouch, fitTopRow, topRowBoxes, touches, type TopRowWidths } from './layout';

describe('touches', () => {
  const a = { l: 0, t: 0, r: 100, b: 44 };
  it('detects overlap and near-misses closer than the gap', () => {
    expect(touches(a, { l: 50, t: 0, r: 150, b: 44 })).toBe(true);
    expect(touches(a, { l: 104, t: 0, r: 150, b: 44 })).toBe(true);   // 4 px apart < 8 px gap
    expect(touches(a, { l: 108, t: 0, r: 150, b: 44 })).toBe(false);
  });
  it('ignores boxes on different rows', () => {
    expect(touches(a, { l: 50, t: 66, r: 150, b: 110 })).toBe(false);
  });
});

/**
 * Natural widths of the top-row surfaces (document · view switcher · show + app controls) per density level, measured
 * in Chromium on the demo site (fresh loads at 1300 / 1366 / 1920 / 2560 px). Level 5 stacks the switcher.
 */
const SITE: TopRowWidths[] = [
  { left: 480, center: 812, right: 775 },  // 0 all labels
  { left: 480, center: 812, right: 469 },  // 1 Show icon-only
  { left: 480, center: 312, right: 469 },  // 2 switcher icon-only except the active view
  { left: 400, center: 312, right: 332 },  // 3 Show folded into a popover, document name 150 px
  { left: 400, center: 272, right: 332 },  // 4 active label dropped
  { left: 400, center: 272, right: 332 },  // 5 switcher on a second row
];
/** On a sheet the Show bar and the inspector toggle are gone. */
const SHEET: TopRowWidths[] = SITE.map(w => ({ ...w, right: 172 }));

describe('fitTopRow (design QA #1: no two chrome surfaces may touch)', () => {
  for (const vw of [1280, 1366, 1440, 1680, 1920, 2560]) {
    it(`site view at ${vw} px fits without a collision`, () => {
      const lv = fitTopRow(vw, SITE);
      expect(lv).toBeLessThan(TOP_MAX);
      expect(anyTouch(topRowBoxes(vw, SITE[lv], lv))).toBe(false);
    });
    it(`sheet view at ${vw} px fits without a collision`, () => {
      const lv = fitTopRow(vw, SHEET);
      expect(anyTouch(topRowBoxes(vw, SHEET[lv], lv))).toBe(false);
    });
  }
  it('drops labels in priority order: Show labels first, then the switcher', () => {
    expect(fitTopRow(2560, SITE)).toBe(0);
    expect(fitTopRow(1920, SITE)).toBe(1);   // the old P0: Show labels went on at 1880 and covered Priority/Scenarios
    expect(fitTopRow(1440, SITE)).toBe(2);
    expect(fitTopRow(1366, SITE)).toBe(2);
    expect(fitTopRow(1280, SITE)).toBe(3);   // Show folds into its popover before the active view loses its label
  });
  it('keeps every switcher label on a sheet at 1920', () => {
    expect(fitTopRow(1920, SHEET)).toBe(0);
  });
  it('falls back to stacking when nothing fits', () => {
    expect(fitTopRow(700, SITE)).toBe(TOP_MAX);
  });
});
