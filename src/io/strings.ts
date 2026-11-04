/**
 * Haul-string text import / export.
 *
 * Reads pasted or loaded text in the formats crews actually have:
 *  - plain XYZ: CSV, TSV, '|' or whitespace separated, with or without a header (X/Y/Z, E/N/RL,
 *    EASTING/NORTHING/ELEVATION …);
 *  - Vulcan / Deswik "export properties" tables pasted from the calculator's 'Raw Data' sheet: a title row
 *    ("EX07 - S51 Haul West from Mid Point (Option 1 - FRONT DUMP TIER)", maybe "5 trucks" further along),
 *    a header row `No. | T | ype | Colour | X | Y | Z | W Name` (Type split by text-to-columns), then point
 *    rows whose point number is mis-parsed as a time ("1:00:00");
 *  - the calculator's 'Data Dump' sheet: header NORTHING | EASTING | ELEVATION whose first column actually
 *    holds eastings. Easting vs northing is decided by magnitude (MGA eastings 100 000 – 900 000, northings
 *    1 000 000 – 10 000 000) whatever the labels say, with a warning when labels are overridden.
 * Strings split at title rows, repeated header rows and blank lines.
 *
 * Writes CSV, XYZ, AutoCAD R12 ASCII DXF (3D POLYLINE / VERTEX, readable by Deswik and Vulcan) and the
 * spreadsheet's Data Dump clipboard layout.
 */
import type { Vec3 } from '@/core/types';
import type { XYZ } from '@/geom/types';

/** One parsed string. */
export interface ParsedString { name: string; points: Vec3[] }

/** Result of `parseStringsText`. */
export interface ParsedStrings { strings: ParsedString[]; warnings: string[] }

type Axis = 'e' | 'n' | 'z';

function axisOf(cell: string): Axis | null {
  const t = cell.toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return null;
  if (t === 'x' || t === 'e' || t.startsWith('east') || t === 'mgae' || t === 'xm') return 'e';
  if (t === 'y' || t === 'n' || t.startsWith('north') || t === 'mgan' || t === 'ym') return 'n';
  if (t === 'z' || t === 'rl' || t === 'zrl' || t === 'rlm' || t === 'zm' || t.startsWith('elev') || t === 'height' || t === 'level' || t === 'reducedlevel') return 'z';
  return null;
}

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const THOUSANDS = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Numeric cell value; thousands separators are accepted (a CSV cell can only hold commas when quoted). */
function num(cell: string): number | null {
  let s = cell.trim();
  if (THOUSANDS.test(s)) s = s.replace(/,/g, '');
  if (!NUM.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(stripQuotes);
  if (line.includes('|')) return line.split('|').map(stripQuotes);
  if (line.includes(',')) return splitCsv(line).map(stripQuotes);
  return line.trim().split(/\s+/).map(stripQuotes);
}

function stripQuotes(c: string): string {
  let s = c.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) s = s.slice(1, -1).trim();
  else if (s[0] === "'") s = s.slice(1); // Excel's text marker
  return s;
}

interface Header { e: number; n: number; z: number; labels: string[] }

function headerOf(cells: string[]): Header | null {
  const h: Header = { e: -1, n: -1, z: -1, labels: cells };
  let hits = 0;
  for (let i = 0; i < cells.length; i++) {
    const a = axisOf(cells[i]);
    if (a && h[a] < 0) { h[a] = i; hits++; }
  }
  return h.e >= 0 && h.n >= 0 && hits >= 2 ? h : null;
}

/** Coordinates from a headerless row: the first numeric pair that looks like map coordinates, else the last three numbers. */
function guessRow(vals: Array<number | null>): Vec3 | null {
  const idx: number[] = [];
  vals.forEach((v, i) => { if (v != null) idx.push(i); });
  if (idx.length < 2) return null;
  if (idx.length === 2) return [vals[idx[0]]!, vals[idx[1]]!, 0];
  if (idx.length === 3) return [vals[idx[0]]!, vals[idx[1]]!, vals[idx[2]]!];
  for (let k = 0; k + 1 < idx.length; k++) {
    const a = vals[idx[k]]!, b = vals[idx[k + 1]]!;
    if (idx[k + 1] === idx[k] + 1 && Math.abs(a) >= 1000 && Math.abs(b) >= 1000) {
      const z = k + 2 < idx.length && idx[k + 2] === idx[k + 1] + 1 ? vals[idx[k + 2]]! : 0;
      return [a, b, z];
    }
  }
  const m = idx.length;
  return [vals[idx[m - 3]]!, vals[idx[m - 2]]!, vals[idx[m - 1]]!];
}

interface Building { name: string | null; points: Vec3[]; header: Header | null; missingZ: number }

const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const isMgaE = (v: number) => v > 1e5 && v < 1e6;
const isMgaN = (v: number) => v > 1e6 && v < 1e7;

/**
 * Parses pasted / loaded text into named strings of [E, N, Z] points (m).
 * @param name base name for strings without a title row (e.g. the file name)
 */
export function parseStringsText(text: string, name?: string): ParsedStrings {
  const warnings: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const done: Building[] = [];
  let header: Header | null = null;
  let cur: Building = { name: null, points: [], header: null, missingZ: 0 };
  let pendingTitle: string | null = null;
  const flush = () => { if (cur.points.length) done.push(cur); cur = { name: null, points: [], header, missingZ: 0 }; };
  for (const raw of lines) {
    if (!raw.trim()) { flush(); continue; }
    const cells = splitLine(raw);
    const vals = cells.map(c => num(c));
    const h = vals.every(v => v == null) ? headerOf(cells) : null;
    if (h) { flush(); header = h; cur.header = h; continue; }
    let p: Vec3 | null = null;
    if (header) {
      const e = vals[header.e], n = vals[header.n], z = header.z >= 0 ? vals[header.z] : null;
      if (e != null && n != null) {
        p = [e, n, z ?? 0];
        if (z == null) cur.missingZ++;
      }
    } else p = guessRow(vals);
    if (p) {
      if (!cur.points.length) { cur.name = pendingTitle; cur.header = header; pendingTitle = null; }
      cur.points.push(p);
      continue;
    }
    // a title row: first non-empty text cell
    const title = cells.find(c => c && num(c) == null && /[A-Za-z0-9]/.test(c));
    if (title) { flush(); pendingTitle = title; header = null; cur.header = null; }
  }
  flush();
  const strings: ParsedString[] = [];
  let unnamed = 0;
  const base = (name ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'Imported string';
  for (const b of done) {
    let pts = b.points;
    // easting / northing by magnitude, whatever the labels say
    const c0 = median(pts.map(p => p[0])), c1 = median(pts.map(p => p[1]));
    const label = (i: number) => (b.header ? `'${b.header.labels[i]}'` : '');
    if (isMgaN(c0) && isMgaE(c1)) {
      pts = pts.map(p => [p[1], p[0], p[2]]);
      const nm = b.name ?? base;
      warnings.push(b.header
        ? `${nm}: the column headed ${label(b.header.n)} holds eastings (≈${Math.round(c1).toLocaleString('en-AU')}) and ${label(b.header.e)} holds northings; read them swapped`
        : `${nm}: the first column looks like northings (≈${Math.round(c0).toLocaleString('en-AU')}); read as N, E, Z`);
    }
    if (b.missingZ) warnings.push(`${b.name ?? base}: ${b.missingZ} point${b.missingZ === 1 ? '' : 's'} had no Z; set to 0`);
    const clean: Vec3[] = [];
    let dups = 0;
    for (const p of pts) {
      const q = clean[clean.length - 1];
      if (q && Math.abs(q[0] - p[0]) <= 1e-3 && Math.abs(q[1] - p[1]) <= 1e-3 && Math.abs(q[2] - p[2]) <= 1e-3) { dups++; continue; }
      clean.push(p);
    }
    const nm = b.name ?? (done.length > 1 || unnamed ? `${base} ${++unnamed}` : base);
    if (dups) warnings.push(`${nm}: removed ${dups} repeated point${dups === 1 ? '' : 's'}`);
    if (clean.length < 2) { warnings.push(`${nm}: skipped (fewer than 2 points)`); continue; }
    strings.push({ name: nm, points: clean });
  }
  if (!strings.length) warnings.push('No coordinates found. Paste rows of easting, northing, RL (with or without a header).');
  return { strings, warnings };
}

/** Anything with a name and points (HaulString, ParsedString …). */
export interface StringLike { name: string; points: ReadonlyArray<XYZ | ArrayLike<number>> }

const xyzOf = (p: XYZ | ArrayLike<number>): Vec3 =>
  'e' in (p as XYZ) ? [(p as XYZ).e, (p as XYZ).n, (p as XYZ).z] : [(p as ArrayLike<number>)[0], (p as ArrayLike<number>)[1], (p as ArrayLike<number>)[2] ?? 0];

/** CSV with an `E,N,Z` header line (decimals default 3). */
export function toCsv(s: StringLike, opts: { header?: boolean; decimals?: number } = {}): string {
  const d = opts.decimals ?? 3;
  const rows = s.points.map(p => xyzOf(p).map(v => v.toFixed(d)).join(','));
  return (opts.header === false ? '' : 'E,N,Z\n') + rows.join('\n') + '\n';
}

/** Space-separated "E N Z" lines, no header (decimals default 3). */
export function toXyz(s: StringLike, opts: { decimals?: number } = {}): string {
  const d = opts.decimals ?? 3;
  return s.points.map(p => xyzOf(p).map(v => v.toFixed(d)).join(' ')).join('\n') + '\n';
}

/**
 * The calculator's 'Data Dump' clipboard layout: tab-separated rows of easting, northing, RL (in that
 * order, which is what the sheet's formulas read). With `header`, the sheet's own (mislabelled)
 * NORTHING / EASTING / ELEVATION header line is included for pasting at A1.
 */
export function toDataDump(s: StringLike, opts: { header?: boolean } = {}): string {
  const rows = s.points.map(p => xyzOf(p).map(v => String(Math.round(v * 1e6) / 1e6)).join('\t'));
  return (opts.header ? 'NORTHING\tEASTING\tELEVATION\r\n' : '') + rows.join('\r\n') + '\r\n';
}

/** DXF R12 layer name: letters, digits, $ - _ only, at most 31 characters. */
export function dxfLayerName(name: string): string {
  const s = name.toUpperCase().replace(/[^A-Z0-9$_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 31);
  return s || 'STRING';
}

/**
 * AutoCAD R12 ASCII DXF with one 3D POLYLINE (70 = 8) per string on its own layer, VERTEX entities
 * (70 = 32) and SEQEND. Coordinates are written as given (site grid metres, 4 decimals).
 * @param opts.colour ACI colour for the layers (default 2, yellow)
 */
export function toDxf3dPolyline(strings: StringLike | readonly StringLike[], opts: { colour?: number } = {}): string {
  const list = (Array.isArray(strings) ? strings : [strings]) as readonly StringLike[];
  const colour = opts.colour ?? 2;
  const out: string[] = [];
  const g = (code: number, value: string | number) => { out.push(String(code), typeof value === 'number' ? fmt(value) : value); };
  const used = new Map<string, number>();
  const layers = list.map(s => {
    const base = dxfLayerName(s.name);
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    return k === 1 ? base : `${base.slice(0, 27)}_${k}`;
  });
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, '1');
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, '0'); g(3, 'Solid line'); g(72, '65'); g(73, '0'); g(40, '0.0');
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, String(layers.length + 1));
  for (const name of ['0', ...layers]) { g(0, 'LAYER'); g(2, name); g(70, '0'); g(62, String(colour)); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  list.forEach((s, i) => {
    const layer = layers[i];
    g(0, 'POLYLINE'); g(8, layer); g(66, '1'); g(10, '0.0'); g(20, '0.0'); g(30, '0.0'); g(70, '8');
    for (const p of s.points) {
      const [x, y, z] = xyzOf(p);
      g(0, 'VERTEX'); g(8, layer); g(10, x); g(20, y); g(30, z); g(70, '32');
    }
    g(0, 'SEQEND'); g(8, layer);
  });
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : '0.0');
