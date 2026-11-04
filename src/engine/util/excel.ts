/**
 * Excel-compatible numerics for the spreadsheet mode.
 */

/**
 * Excel ROUND(x, digits): rounds half AWAY from zero, applied to the value's 15-significant-digit decimal form
 * (so 0.015 → 0.02 and −0.165 → −0.17, unlike Math.round or banker's rounding on the binary value).
 * Matches the spec verifier: Decimal(format(x, '.15g')).quantize(10^-digits, ROUND_HALF_UP).
 * @param x value (any unit)
 * @param digits decimal places (may be negative, as in Excel)
 */
export function excelRound(x: number, digits = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1;
  // fast path: away from a .5 tie the 15-digit view cannot change the result
  if (digits >= 0 && digits <= 10) {
    const p = Math.pow(10, digits);
    const y = Math.abs(x) * p;
    if (y < 1e15) {
      const f = y - Math.floor(y);
      if (Math.abs(f - 0.5) > 1e-7 * Math.max(1, y)) return (sign * Math.floor(y + 0.5)) / p;
    }
  }
  const [mant, expStr] = Math.abs(x).toExponential(14).split('e');
  const exp = parseInt(expStr, 10);
  const ds = mant.replace('.', ''); // 15 digits; |x| = int(ds) × 10^(exp − 14)
  const shift = exp - 14 + digits; // |x| × 10^digits = int(ds) × 10^shift
  let n: number;
  if (shift >= 0) {
    n = Number(ds) * Math.pow(10, shift);
  } else {
    const k = -shift; // digits to drop
    if (k > 15) n = 0;
    else {
      const keep = ds.slice(0, 15 - k);
      const next = ds.charCodeAt(15 - k) - 48;
      n = (keep ? Number(keep) : 0) + (next >= 5 ? 1 : 0);
    }
  }
  return digits >= 0 ? (sign * n) / Math.pow(10, digits) : sign * n * Math.pow(10, -digits);
}

/** Integer key of a grade rounded to whole percent (exact-match lookup without float equality), e.g. 0.07 → 7. */
export function gradeKey(roundedGrade: number): number {
  return Math.round(roundedGrade * 100) + 0; // + 0 normalises −0
}
