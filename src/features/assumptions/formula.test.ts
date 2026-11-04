import { describe, expect, it } from 'vitest';
import { tokenize, toPlainText } from './formula';

const kinds = (s: string) => tokenize(s).map(t => `${t.k}:${t.v}${t.sub ? '_' + t.sub : ''}${t.sup ? '^' + t.sup : ''}`);

describe('formula tokenizer', () => {
  it('typesets the haul-time formula', () => {
    expect(kinds('Haul time = (T_loaded + T_empty) / η')).toEqual([
      'word:Haul', 'word:time', 'op:=', 'punc:(', 'var:T_loaded', 'op:+', 'var:T_empty', 'punc:)', 'op:/', 'var:η',
    ]);
  });

  it('recognises spreadsheet cell references, sheet-qualified refs and ranges', () => {
    expect(kinds("C20 := MIN(n × C22 × C16, C19)")).toEqual([
      'ref:C20', 'op:≔', 'fn:MIN', 'punc:(', 'var:n', 'op:×', 'ref:C22', 'op:×', 'ref:C16', 'punc:,', 'ref:C19', 'punc:)',
    ]);
    expect(kinds("ActiveRoute!C16")).toEqual(['ref:ActiveRoute!C16']);
    expect(kinds("'Travel Time'!F15 / 60")).toEqual(["ref:'Travel Time'!F15", 'op:/', 'num:60']);
    expect(kinds('INDEX(I4:I32, 25)')).toEqual(['fn:INDEX', 'punc:(', 'ref:I4:I32', 'punc:,', 'num:25', 'punc:)']);
  });

  it('normalises ASCII operators and detects unary minus', () => {
    const t = tokenize('a - -b * c <= d');
    expect(t.map(x => x.v)).toEqual(['a', '−', '−', 'b', '×', 'c', '≤', 'd']);
    expect(t[1].tight).toBeFalsy();
    expect(t[2].tight).toBe(true);
  });

  it('handles numbers with thousands separators, decimals, exponents and superscripts', () => {
    expect(kinds('36,000 / 1.5e3 + x^2 + 10^{-3}')).toEqual(['num:36,000', 'op:/', 'num:1.5e3', 'op:+', 'var:x^2', 'op:+', 'num:10^-3']);
  });

  it('keeps words upright and short symbols as variables', () => {
    const t = tokenize('Trucks needed = H_truck / PT');
    expect(t.map(x => x.k)).toEqual(['word', 'word', 'op', 'var', 'op', 'var']);
    expect(t[3].sub).toBe('truck');
  });

  it('treats braces subscripts and functions', () => {
    expect(kinds('v* = sup{v : F_{rim}(v) ≥ F_res}')).toEqual([
      'var:v*', 'op:=', 'fn:sup', 'punc:{', 'var:v', 'punc::', 'var:F_rim', 'punc:(', 'var:v', 'punc:)', 'op:≥', 'var:F_res', 'punc:}',
    ]);
  });

  it('round-trips to readable plain text', () => {
    expect(toPlainText(tokenize('(171.6+163.9)/0.85'))).toBe('(171.6 + 163.9) / 0.85');
    expect(toPlainText(tokenize('MIN(a,b)'))).toBe('MIN(a, b)');
    expect(toPlainText(tokenize('−0.5 × x'))).toBe('−0.5 × x');
  });

  it('passes unknown symbols through', () => {
    expect(kinds('⌈3.44⌉')).toEqual(['punc:⌈', 'num:3.44', 'punc:⌉']);
  });
});

describe('unicode superscripts and comma spacing', () => {
  it('attaches ² to the previous token', () => {
    expect(kinds('sqrt(ΔE² + (a+b)²)')).toEqual(['fn:sqrt', 'punc:(', 'var:ΔE^2', 'op:+', 'punc:(', 'var:a', 'op:+', 'var:b', 'punc:)^2', 'punc:)']);
  });
  it('spaces a unary minus after a comma', () => {
    expect(toPlainText(tokenize('max(0, -x)'))).toBe('max(0, −x)');
  });
});
