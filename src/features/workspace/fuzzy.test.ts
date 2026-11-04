import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively and rejects non-matches', () => {
    expect(fuzzyMatch('tc', 'Truck curves')).not.toBeNull();
    expect(fuzzyMatch('TRUCK', 'truck curves')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Truck curves')).toBeNull();
    expect(fuzzyMatch('curvest', 'Truck curves')).toBeNull();
  });

  it('empty query matches everything with score 0', () => {
    expect(fuzzyMatch('  ', 'Anything')).toEqual({ score: 0, indices: [] });
  });

  it('returns the indices of the matched characters (word starts preferred)', () => {
    const r = fuzzyMatch('tc', 'Truck curves')!;
    expect(r.indices).toEqual([0, 6]);
    const r2 = fuzzyMatch('sav', 'Save as…')!;
    expect(r2.indices).toEqual([0, 1, 2]);
  });

  it('prefers prefix, word-start and consecutive matches', () => {
    const prefix = fuzzyMatch('com', 'Compare')!.score;
    const inner = fuzzyMatch('com', 'Toggle commands')!.score;
    expect(prefix).toBeGreaterThan(inner);
    const words = fuzzyMatch('ds', 'Draw string')!.score;
    const scattered = fuzzyMatch('ds', 'Shift dashboards')!.score;
    expect(words).toBeGreaterThan(scattered);
  });

  it('lets a space in the query match a separator', () => {
    expect(fuzzyMatch('ex09 s51', 'EX09 OB → S51 West')).not.toBeNull();
    expect(fuzzyMatch('ex09 s51', 'EX09 OB → S51 West')!.indices).toEqual([0, 1, 2, 3, 10, 11, 12]);
  });
});

describe('fuzzyFilter', () => {
  const cmds = [
    { title: 'Go to Assumptions', kw: ['inputs', 'calc'] },
    { title: 'Go to Truck curves', kw: ['rimpull', 'retarder'] },
    { title: 'Save', kw: ['store'] },
    { title: 'Save as…', kw: ['copy'] },
    { title: 'Toggle contours', kw: ['layers'] },
  ];
  const keys = (c: (typeof cmds)[number]) => [c.title, ...c.kw];

  it('ranks the best label match first', () => {
    const r = fuzzyFilter(cmds, 'save', keys);
    expect(r.map(x => x.item.title)).toEqual(['Save', 'Save as…']);
  });

  it('falls back to keywords (without label highlight)', () => {
    const r = fuzzyFilter(cmds, 'rimpull', keys);
    expect(r[0].item.title).toBe('Go to Truck curves');
    expect(r[0].indices).toEqual([]);
  });

  it('returns everything in order for an empty query', () => {
    expect(fuzzyFilter(cmds, '', keys)).toHaveLength(cmds.length);
  });
});

describe('palette ranking by kind', () => {
  // the same name as a circuit, a haul string and a dig block: equal matches order circuit > string > asset (#36)
  const RANK = { circuit: 2.4, string: 1.6, asset: 0.8 };
  const items = [
    { title: 'EX09 OB block', kind: 'asset' as const },
    { title: 'EX09 OB → S51 West lift (long haul)', kind: 'string' as const },
    { title: 'EX09 OB → S51 West lift', kind: 'string' as const },
    { title: 'EX09 OB → S51 West lift', kind: 'circuit' as const },
    { title: 'Ride along · EX09 OB → S51 West lift', kind: 'circuit' as const },
  ];
  it('ranks circuit, then string, then asset for "ex09"', () => {
    const r = fuzzyFilter(items, 'ex09', i => [i.title], i => RANK[i.kind]);
    expect(r.slice(0, 4).map(x => x.item.kind)).toEqual(['circuit', 'string', 'string', 'asset']);
  });
  it('never lets the kind boost beat a clearly better match', () => {
    const r = fuzzyFilter(items, 'ex09 ob block', i => [i.title], i => RANK[i.kind]);
    expect(r[0].item.title).toBe('EX09 OB block');
  });
});
