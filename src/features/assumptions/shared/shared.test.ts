import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, fileSafe } from './csv';
import { delta, deltaTone, fmtDelta, fmtPctDelta, smartDp } from './delta';
import { excelRound } from './excel';

describe('csv', () => {
  it('quotes only when needed and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(true)).toBe('true');
  });
  it('writes numbers at 10 significant digits without separators', () => {
    expect(csvCell(36000)).toBe('36000');
    expect(csvCell(171.56703384077264)).toBe('171.5670338');
    expect(csvCell(-0.0012)).toBe('-0.0012');
  });
  it('joins rows with CRLF and a trailing newline', () => {
    expect(toCsv([['a', 1], ['b', 2.5]])).toBe('a,1\r\nb,2.5\r\n');
  });
  it('makes safe file names', () => {
    expect(fileSafe('EX09 OB → S51 West / ledger')).toBe('EX09-OB-S51-West-ledger');
    expect(fileSafe('***')).toBe('export');
  });
});

describe('deltas', () => {
  it('computes absolute and relative change', () => {
    expect(delta(10, 12)).toEqual({ abs: 2, rel: 0.2 });
    expect(delta(0, 3).rel).toBeNull();
  });
  it('tones by better direction', () => {
    expect(deltaTone(2, 'up')).toBe('ok');
    expect(deltaTone(2, 'down')).toBe('bad');
    expect(deltaTone(-2, 'down')).toBe('ok');
    expect(deltaTone(0, 'up')).toBe('na');
    expect(deltaTone(5, 'none')).toBe('na');
  });
  it('formats signed deltas with a true minus and units', () => {
    expect(fmtDelta(1.24, 1)).toBe('+1.2');
    expect(fmtDelta(-0.44, 1, 'h')).toBe('−0.4 h');
    expect(fmtDelta(0.01, 1)).toBe('±0.0');
    expect(fmtPctDelta(0.105)).toBe('+10.5%');
    expect(fmtPctDelta(null)).toBe('');
  });
  it('chooses decimals by magnitude', () => {
    expect(smartDp(36000)).toBe(0);
    expect(smartDp(394.7)).toBe(1);
    expect(smartDp(11.91)).toBe(2);
    expect(smartDp(0.85)).toBe(3);
  });
});

describe('excelRound (ROUND half away from zero on 15 sig. digits)', () => {
  it('matches Excel on the documented ties', () => {
    expect(excelRound(0.015, 2)).toBe(0.02);
    expect(excelRound(-0.165, 2)).toBe(-0.17);
    expect(excelRound(-0.004, 2)).toBe(0);
    expect(excelRound(0.020552941219446837, 2)).toBe(0.02);
    expect(excelRound(0.1649999, 2)).toBe(0.16);
    expect(excelRound(1.005, 2)).toBe(1.01); // binary 1.00499999… but Excel rounds the 15-digit decimal
    expect(excelRound(1e-7, 2)).toBe(0);
    expect(excelRound(-0.312, 2)).toBe(-0.31);
  });
});
