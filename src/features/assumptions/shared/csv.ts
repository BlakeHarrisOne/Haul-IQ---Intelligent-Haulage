/**
 * CSV export helpers shared by the Assumptions, Curves and Compare tabs.
 * RFC 4180 quoting, CRLF line endings, numbers written at full useful precision (no thousands separators)
 * so the file round-trips into Excel / the Haulage Calculator workbook without re-typing.
 */
export type CsvCell = string | number | boolean | null | undefined;

/** Format one cell. Numbers keep up to 10 significant digits; non-finite numbers become empty cells. */
export function csvCell(v: CsvCell): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    const s = Number.isInteger(v) ? String(v) : String(+v.toPrecision(10));
    return s;
  }
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Safe file name: letters, digits, dash, underscore, dot. */
export function fileSafe(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'export';
}

/** Trigger a browser download (UTF-8 BOM so Excel opens accents / units like m³ correctly). */
export function downloadCsv(fileName: string, rows: CsvCell[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
