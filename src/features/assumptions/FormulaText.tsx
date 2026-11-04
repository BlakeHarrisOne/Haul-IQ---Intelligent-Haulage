import { memo, type ReactNode } from 'react';
import { needsSpaceBefore, tokenize, toPlainText, type Tok } from './formula';
import s from './assumptions.module.css';

function renderTok(t: Tok, i: number): ReactNode {
  const sub = t.sub ? <sub>{t.sub}</sub> : null;
  const sup = t.sup ? <sup>{t.sup}</sup> : null;
  switch (t.k) {
    case 'var': return <span key={i} className={s['m-var']}>{t.v}{sub}{sup}</span>;
    case 'word': return <span key={i} className={s['m-word']}>{t.v}{sub}{sup}</span>;
    case 'fn': return <span key={i} className={s['m-fn']}>{t.v}</span>;
    case 'num': return <span key={i} className={s['m-num']}>{t.v}{sup}</span>;
    case 'op': return <span key={i} className={t.tight ? s['m-opTight'] : s['m-op']}>{t.v}</span>;
    case 'ref': return <span key={i} className={s['m-ref']}>{t.v}</span>;
    case 'punc': return <span key={i} className={s['m-punc']}>{t.v}{sup}</span>;
    default: return <span key={i} className={s['m-text']}>{t.v}</span>;
  }
}

/** Typeset formula: variables italic with subscripts, operators spaced, refs as chips. */
export const FormulaText = memo(function FormulaText({ text, className }: { text: string; className?: string }) {
  const toks = tokenize(text);
  const out: ReactNode[] = [];
  toks.forEach((t, i) => {
    const prev = toks[i - 1];
    // non-tight operators carry their own padding; other adjacent tokens get a normal space where the rule says so
    const padded = (x: typeof t) => x.k === 'op' && !x.tight;
    if (prev && !padded(t) && !padded(prev) && needsSpaceBefore(t, prev)) out.push(' ');
    out.push(renderTok(t, i));
  });
  return <span className={`${s.math} ${className ?? ''}`} aria-label={toPlainText(toks)}>{out}</span>;
});

/** Substituted-numbers line, prefixed by "=". Shown verbatim (the engine formats it); ASCII operators prettified. */
export function Substituted({ text }: { text: string }) {
  const pretty = text.replace(/(\d)\s*\*\s*(\d)/g, '$1 × $2').replace(/<=/g, '≤').replace(/>=/g, '≥');
  return <div className={s.subst}><span className={s.eq}>=</span>{pretty}</div>;
}
