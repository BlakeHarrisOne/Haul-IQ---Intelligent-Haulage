/**
 * Tiny, safe expression language for derived crew rules (no eval).
 *   numbers (12, 1.5, .5, 1e-3, 2.5E+2; malformed literals such as 1.2.3 or 1e throw) · identifiers with dots (totals.trucks, params.pushFleet, roles.pushDozer, rules.R9_ENABLING_DOZERS)
 *   + − * / · unary − and ! · comparisons > >= < <= == != · && || · parentheses
 *   functions: max(a, b, …), min(a, b, …), ceil(x), floor(x), abs(x), round(x), if(cond, a, b)
 * Booleans are numbers (true = 1). Unknown identifiers evaluate to 0 and are reported.
 */

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

/** A number literal at the sticky position: mantissa (`12`, `1.5`, `1.`, `.5`) and an optional signed exponent. */
const NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      // digits with an optional fraction, then an optional signed exponent: 12 · 1.5 · .5 · 1e-3 · 2.5E+2
      NUM.lastIndex = i;
      const m = NUM.exec(src);
      const j = m ? i + m[0].length : i;
      // the number must end cleanly: "1.2.3", "1e", "1e+", "3x" and a lone "." are malformed, not silently truncated
      if (!m || (j < src.length && /[0-9.A-Za-z_]/.test(src[j]))) {
        let k = j;
        while (k < src.length && /[0-9.A-Za-z_]/.test(src[k])) k++;
        throw new Error(`Malformed number "${src.slice(i, Math.max(k, i + 1))}" in expression "${src}"`);
      }
      out.push({ t: 'num', v: Number(m[0]) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/()<>!,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected character "${c}" in expression "${src}"`);
  }
  return out;
}

export interface ExprEnv {
  /** Resolve a dotted identifier; return undefined when unknown. */
  lookup: (name: string) => number | undefined;
}

export interface ExprResult { value: number; unknown: string[] }

/**
 * Evaluate an expression.
 * @param src expression text
 * @param env identifier resolver
 */
export function evalExpr(src: string, env: ExprEnv): ExprResult {
  const toks = tokenize(src);
  let p = 0;
  const unknown: string[] = [];
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}" in "${src}"`); p++; };
  const fns: Record<string, (a: number[]) => number> = {
    max: a => Math.max(...a), min: a => Math.min(...a), ceil: a => Math.ceil(a[0]), floor: a => Math.floor(a[0]),
    abs: a => Math.abs(a[0]), round: a => Math.round(a[0]), if: a => (a[0] ? a[1] : a[2] ?? 0),
  };
  const primary = (): number => {
    const tk = peek();
    if (!tk) throw new Error(`Unexpected end of "${src}"`);
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === 'id') {
      p++;
      if (isOp('(')) {
        p++;
        const args: number[] = [];
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()); } }
        expect(')');
        const f = fns[tk.v];
        if (!f) throw new Error(`Unknown function ${tk.v}() in "${src}"`);
        return f(args);
      }
      if (tk.v === 'true') return 1;
      if (tk.v === 'false') return 0;
      const v = env.lookup(tk.v);
      if (v == null || !Number.isFinite(v)) { unknown.push(tk.v); return 0; }
      return v;
    }
    if (isOp('(')) { p++; const v = or(); expect(')'); return v; }
    if (isOp('-')) { p++; return -primary(); }
    if (isOp('!')) { p++; return primary() ? 0 : 1; }
    throw new Error(`Unexpected "${(tk as { v: string }).v}" in "${src}"`);
  };
  const mul = (): number => {
    let v = primary();
    while (isOp('*') || isOp('/')) { const o = (toks[p++] as { v: string }).v; const r = primary(); v = o === '*' ? v * r : v / r; }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (isOp('+') || isOp('-')) { const o = (toks[p++] as { v: string }).v; const r = mul(); v = o === '+' ? v + r : v - r; }
    return v;
  };
  const cmp = (): number => {
    let v = add();
    while (['>', '>=', '<', '<=', '==', '!='].some(isOp)) {
      const o = (toks[p++] as { v: string }).v;
      const r = add();
      v = (o === '>' ? v > r : o === '>=' ? v >= r : o === '<' ? v < r : o === '<=' ? v <= r : o === '==' ? v === r : v !== r) ? 1 : 0;
    }
    return v;
  };
  const and = (): number => { let v = cmp(); while (isOp('&&')) { p++; const r = cmp(); v = v && r ? 1 : 0; } return v; };
  const or = (): number => { let v = and(); while (isOp('||')) { p++; const r = and(); v = v || r ? 1 : 0; } return v; };
  const value = or();
  if (p < toks.length) throw new Error(`Unexpected trailing input in "${src}"`);
  return { value, unknown };
}
