/**
 * NumberField that reads like the tables around it: thousands separators and the field's decimals when not focused
 * ("36,000", not "36000"); a plain editable number while focused. Same behaviour and props as the UI kit NumberField
 * (draft, Enter / blur commits, Esc reverts, ↑ / ↓ step, Shift × 10), built on the kit's input classes.
 */
import { useEffect, useRef, useState } from 'react';
import { cx, uiStyles as s, type NumberFieldProps } from '@/ui';
import { num } from '@/core/format';

export function NumField({ value, onChange, unit, step = 1, min, max, dp = 2, fixed, small, bare, changed, placeholder, width, disabled, title, onClear }: NumberFieldProps) {
  const edit = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : String(+v.toFixed(dp)));
  const show = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return '';
    if (fixed) return num(v, dp);
    const r = +v.toFixed(dp);
    const shownDp = Math.min(dp, (String(r).split('.')[1] ?? '').length);
    return num(r, shownDp);
  };
  const [focus, setFocus] = useState(false);
  const [draft, setDraft] = useState(edit(value));
  const ref = useRef<HTMLInputElement>(null);
  const cancel = useRef(false);
  useEffect(() => { if (!focus) setDraft(edit(value)); }, [value, focus, dp]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = draft.trim() === '' ? NaN : Number(draft.replace(/,/g, '').replace(/−/g, '-'));
  const invalid = focus && draft.trim() !== '' && (!Number.isFinite(parsed) || (min != null && parsed < min) || (max != null && parsed > max));
  const commit = () => {
    if (draft.trim() === '' && onClear) { onClear(); return; }
    if (!invalid && Number.isFinite(parsed) && parsed !== value) onChange(parsed);
    else setDraft(edit(value));
  };
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <span className={cx(s.inputWrap, small && s.inputSm, bare && s.inputBare, invalid && s.invalid, changed && s.changed)} style={{ width }} title={title}>
      <input
        ref={ref}
        className={cx(s.input, s.inputNum)}
        inputMode="decimal"
        aria-label={title}
        value={focus ? draft : show(value)}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={e => { setFocus(true); setDraft(edit(value)); const el = e.currentTarget; requestAnimationFrame(() => el.select()); }}
        onBlur={() => { setFocus(false); if (cancel.current) { cancel.current = false; setDraft(edit(value)); } else commit(); }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') ref.current?.blur(); // blur commits
          else if (e.key === 'Escape') { cancel.current = true; ref.current?.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = Number.isFinite(parsed) ? parsed : value ?? 0;
            const nv = clamp(+(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(6));
            setDraft(String(nv)); onChange(nv);
          }
        }}
      />
      {unit && <span className={s.inputUnit}>{unit}</span>}
    </span>
  );
}
