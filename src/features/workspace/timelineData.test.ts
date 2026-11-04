import { describe, expect, it } from 'vitest';
import { DOT_GAP, DOT_W, dotsFit, eventLabelFor, kbcm } from './timelineData';

describe('kbcm', () => {
  it('formats chip volumes compactly', () => {
    expect(kbcm(0)).toBe('0');
    expect(kbcm(650)).toBe('650');
    expect(kbcm(7050)).toBe('7.1k');
    expect(kbcm(15_700)).toBe('15.7k');
    expect(kbcm(123_400)).toBe('123k');
  });
});

describe('dotsFit', () => {
  it('shows every dot when they fit', () => {
    expect(dotsFit(3, 3 * DOT_W + 2 * DOT_GAP)).toEqual({ visible: 3, hidden: 0 });
  });
  it('puts the rest behind "+N" when they do not', () => {
    const r = dotsFit(8, 120);
    expect(r.visible + r.hidden).toBe(8);
    expect(r.hidden).toBeGreaterThan(0);
    expect(r.visible * (DOT_W + DOT_GAP) + 40).toBeLessThanOrEqual(120);
  });
});

describe('eventLabelFor', () => {
  it('uses the full label, then the short kind label, then none', () => {
    expect(eventLabelFor(200, 'Fuel & lube', 'Fuel')).toBe('Fuel & lube');
    expect(eventLabelFor(64, 'Fuel & lube', 'Fuel')).toBe('Fuel');
    expect(eventLabelFor(30, 'Fuel & lube', 'Fuel')).toBe('');
  });
});
