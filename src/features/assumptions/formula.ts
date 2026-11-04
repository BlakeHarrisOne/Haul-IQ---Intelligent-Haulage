/**
 * Formula typesetting tokenizer.
 *
 * Turns the engine's plain-text CalcStep formulas ("Haul time = (T_loaded + T_empty) / η",
 * "C20 := MIN(n × C22 × C16, C19)") into typed tokens the ledger renders like a maths text:
 * variables italic with subscripts, words / functions upright, operators spaced, numbers tabular,
 * spreadsheet cell references as mono chips.
 */
export type TokKind = 'var' | 'word' | 'fn' | 'num' | 'op' | 'punc' | 'ref' | 'text';

export interface Tok {
  k: TokKind;
  v: string;
  /** Subscript (T_loaded → v 'T', sub 'loaded'). */
  sub?: string;
  /** Superscript (x^2 → v 'x', sup '2'). */
  sup?: string;
  /** Operator rendered without surrounding space (unary minus, prefix ±). */
  tight?: boolean;
}

const FUNCS = new Set([
  'sqrt', 'min', 'max', 'sum', 'ceil', 'floor', 'round', 'abs', 'sin', 'cos', 'tan', 'atan', 'asin', 'acos', 'ln', 'log', 'exp',
  'sup', 'inf', 'argmin', 'argmax', 'avg', 'mean', 'if', 'roundup', 'rounddown', 'vlookup', 'index', 'match', 'iferror', 'lookup', 'clamp', 'interp',
]);

/** Greek letters and math symbols treated as single-letter variables. */
const GREEK = 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ';

const OPS: [string, string][] = [
  [':=', '≔'], ['<=', '≤'], ['>=', '≥'], ['!=', '≠'], ['->', '→'], ['=>', '⇒'], ['~=', '≈'],
  ['*', '×'], ['-', '−'], ['+', '+'], ['/', '/'], ['÷', '÷'], ['×', '×'], ['·', '·'], ['−', '−'], ['=', '='], ['≈', '≈'],
  ['≤', '≤'], ['≥', '≥'], ['<', '<'], ['>', '>'], ['≠', '≠'], ['→', '→'], ['±', '±'], ['≔', '≔'], ['Σ', 'Σ'], ['∑', 'Σ'], ['^', '^'], ['%', '%'],
];

// cell refs: ActiveRoute!C16, 'Travel Time'!F15, $C$22, H4:H32, F:F
const REF_RE = /^(?:(?:'[^']+'|[A-Za-z][A-Za-z0-9_]*)!)?\$?[A-Z]{1,3}\$?(?:[1-9]\d{0,6})(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?(?![A-Za-z0-9_])/;
const SHEET_COL_RE = /^(?:'[^']+'|[A-Za-z][A-Za-z0-9_]*)![A-Z]{1,3}:[A-Z]{1,3}(?![A-Za-z0-9_])/;
const NUM_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?/;
const IDENT_RE = new RegExp(`^(?:[A-Za-z${GREEK}][A-Za-z0-9${GREEK}]*'*\\*?)`);
const SUB_RE = new RegExp(`^_(?:\\{([^}]*)\\}|([A-Za-z0-9${GREEK}.,]+))`);
const SUP_RE = /^\^(?:\{([^}]*)\}|(-?[A-Za-z0-9.]+))/;
const USUP_RE = /^[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/;
const USUP_MAP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
/** x^2 or x² → '2' */
function readSup(s: string): [string, number] | undefined {
  const sp = SUP_RE.exec(s);
  if (sp) return [sp[1] ?? sp[2], sp[0].length];
  const u = USUP_RE.exec(s);
  if (u) return [[...u[0]].map(c => USUP_MAP[c] ?? c).join(''), u[0].length];
  return undefined;
}

function isVarLike(id: string): boolean {
  // single letters, Greek, a letter + digits/primes ("v2", "x'"), or ALL-CAPS short symbols like "PT", "RR", "GVW", "MF"
  const core = id.replace(/['*]+$/, '');
  if (core.length === 1) return true;
  if ([...core].every(ch => GREEK.includes(ch))) return true;
  if (/^[A-Za-z][0-9]+$/.test(core)) return true;
  if (/^[Δδ][A-Za-z]{1,2}$/.test(core)) return true;
  if (/^[A-Z]{2,4}$/.test(core)) return true;
  return false;
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let s = src;
  const prevSignificant = () => out[out.length - 1];
  while (s.length) {
    const ws = /^\s+/.exec(s);
    if (ws) { s = s.slice(ws[0].length); continue; }

    // quoted text
    const q = /^"([^"]*)"/.exec(s);
    if (q) { out.push({ k: 'text', v: q[1] }); s = s.slice(q[0].length); continue; }

    const sc = SHEET_COL_RE.exec(s);
    if (sc) { out.push({ k: 'ref', v: sc[0] }); s = s.slice(sc[0].length); continue; }
    const ref = REF_RE.exec(s);
    if (ref && looksLikeCell(ref[0])) {
      out.push({ k: 'ref', v: ref[0] }); s = s.slice(ref[0].length); continue;
    }

    const n = NUM_RE.exec(s);
    if (n) {
      const v = n[0];
      s = s.slice(v.length);
      const tok: Tok = { k: 'num', v };
      const sp = readSup(s);
      if (sp) { tok.sup = sp[0]; s = s.slice(sp[1]); }
      out.push(tok);
      continue;
    }

    const id = IDENT_RE.exec(s);
    if (id) {
      const v = id[0];
      s = s.slice(v.length);
      const lower = v.toLowerCase();
      const next = /^\s*\(/.test(s) || /^\s*\{/.test(s);
      let tok: Tok;
      if (FUNCS.has(lower) && (next || lower === 'sin' || lower === 'cos' || lower === 'tan' || lower === 'ln' || lower === 'log')) tok = { k: 'fn', v };
      else if (isVarLike(v) || s.startsWith('_')) tok = { k: 'var', v };
      else tok = { k: 'word', v };
      const sb = SUB_RE.exec(s);
      if (sb) { tok.sub = sb[1] ?? sb[2]; s = s.slice(sb[0].length); if (tok.k === 'word') tok.k = 'var'; }
      const sp = readSup(s);
      if (sp) { tok.sup = sp[0]; s = s.slice(sp[1]); }
      out.push(tok);
      continue;
    }

    const op = OPS.find(([a]) => s.startsWith(a));
    if (op) {
      s = s.slice(op[0].length);
      const prev = prevSignificant();
      const tok: Tok = { k: 'op', v: op[1] };
      if ((op[1] === '−' || op[1] === '+' || op[1] === '±') && (!prev || prev.k === 'op' || (prev.k === 'punc' && /[([{,]/.test(prev.v)))) tok.tight = true;
      if (op[1] === '%' || op[1] === '^') tok.tight = true;
      if (op[1] === 'Σ') tok.tight = true;
      out.push(tok);
      continue;
    }

    const p = /^[()[\]{},;:|!]/.exec(s);
    if (p) {
      out.push({ k: 'punc', v: p[0] }); s = s.slice(1);
      // (a + b)² → superscript on the closing bracket
      if (p[0] === ')' || p[0] === ']') { const sp = readSup(s); if (sp) { out[out.length - 1].sup = sp[0]; s = s.slice(sp[1]); } }
      continue;
    }

    // anything else (unicode symbols such as ⌈ ⌉ √ ∞ °) passes through as text
    const ch = String.fromCodePoint(s.codePointAt(0)!);
    out.push({ k: /[⌈⌉⌊⌋√∞°′″]/.test(ch) ? 'punc' : 'text', v: ch });
    s = s.slice(ch.length);
  }
  return out;
}

function looksLikeCell(r: string): boolean {
  const bare = r.replace(/^.*!/, '').replace(/\$/g, '');
  // short ALL-CAPS symbols followed by digits are cells (C16, AD4, N14); avoid Greek / lowercase
  return /^[A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?$/.test(bare);
}

/** Join tokens back to plain text with typographic spacing (used for CSV export and aria-labels). */
export function toPlainText(toks: Tok[]): string {
  let out = '';
  toks.forEach((t, i) => {
    const prev = toks[i - 1];
    const sp = needsSpaceBefore(t, prev);
    let v = t.v;
    if (t.sub) v += `_${t.sub}`;
    if (t.sup) v += `^${t.sup}`;
    out += (sp && out ? ' ' : '') + v;
  });
  return out;
}

/** Spacing rule shared by the React renderer and toPlainText. */
export function needsSpaceBefore(t: Tok, prev: Tok | undefined): boolean {
  if (!prev) return false;
  if (t.k === 'op') return t.tight ? prev.k === 'punc' && (prev.v === ',' || prev.v === ';') : true;
  if (prev.k === 'op') return !prev.tight;
  if (t.k === 'punc') return t.v === '|' || t.v === '⌈' || t.v === '⌊';
  if (prev.k === 'punc') return prev.v === ',' || prev.v === ';' || prev.v === ':' || prev.v === '|' || prev.v === ')' || prev.v === ']';
  return true;
}
