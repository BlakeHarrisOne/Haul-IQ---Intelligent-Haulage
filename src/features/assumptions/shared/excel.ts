/**
 * Excel ROUND(x, dp): half AWAY from zero, applied to the value's 15-significant-digit decimal form
 * (docs/spec/01 §5.2). JavaScript's Math.round / toFixed work on the binary value and disagree on ties
 * such as 0.015 → 0.02 and −0.165 → −0.17.
 */
export function excelRound(x: number, dp = 2): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;
  const neg = x < 0;
  // 15 significant digits, then plain (non-exponent) decimal digits
  const s = toPlain(Math.abs(x).toPrecision(15));
  const [ip, fp = ''] = s.split('.');
  const frac = fp.padEnd(dp + 1, '0');
  const keep = ip + frac.slice(0, dp);
  const roundUp = frac.charCodeAt(dp) - 48 >= 5;
  let digits = BigInt(keep || '0');
  if (roundUp) digits += 1n;
  const r = Number(digits) / 10 ** dp;
  return neg ? (r === 0 ? 0 : -r) : r;
}

function toPlain(s: string): string {
  if (!/e/i.test(s)) return s;
  const [m, eStr] = s.toLowerCase().split('e');
  const e = Number(eStr);
  const [i, f = ''] = m.split('.');
  const digits = i + f;
  const point = i.length + e;
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0, point) + '.' + digits.slice(point);
}
