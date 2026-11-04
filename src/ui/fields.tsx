/** Form fields. NumberField keeps a local draft and commits on Enter / blur (Esc reverts, ↑/↓ steps, Shift ×10). */
import { isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx, Segmented, uiStyles as s } from './primitives';
import { Icon } from './icons';

export function Field({ label, hint, children, style }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  const id = useId();
  // Multi-button controls (segmented) are a labelled GROUP: a <label> would name only their first button with the
  // caption ("Speed model Spreadsheet") and forward caption clicks to it (e2e D3).
  if (isValidElement(children) && children.type === Segmented) {
    return (
      <div className={s.field} style={style} role="group" aria-labelledby={label ? id : undefined}>
        {label && <span id={id} className={s.fieldLabel}>{label}</span>}
        {children}
        {hint && <span className={s.fieldHint}>{hint}</span>}
      </div>
    );
  }
  // Single controls keep a real <label> (accessible name), but a click on the caption itself is swallowed so it can't
  // activate the control.
  return (
    <label className={s.field} style={style}
      onClick={e => { if (!(e.target as HTMLElement).closest('input, select, textarea, button, a, [role="switch"], [role="checkbox"]')) e.preventDefault(); }}>
      {label && <span className={s.fieldLabel}>{label}</span>}
      {children}
      {hint && <span className={s.fieldHint}>{hint}</span>}
    </label>
  );
}

export interface NumberFieldProps {
  value: number | null | undefined;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Decimal places shown when not editing. */
  dp?: number;
  /** Always show exactly `dp` decimals when not editing (keeps table columns aligned). */
  fixed?: boolean;
  small?: boolean;
  bare?: boolean;
  /** Highlight as user-changed vs default. */
  changed?: boolean;
  placeholder?: string;
  width?: number | string;
  disabled?: boolean;
  title?: string;
  /** Allow empty → onClear (e.g. remove a per-segment override). */
  onClear?: () => void;
}

export function NumberField({ value, onChange, unit, step = 1, min, max, dp = 2, fixed, small, bare, changed, placeholder, width, disabled, title, onClear }: NumberFieldProps) {
  // editing text: plain digits (no grouping) so the caret and arrow-key stepping behave
  const raw = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : fixed ? v.toFixed(dp) : String(+v.toFixed(dp)));
  // at rest: en-AU thousands separators so inputs read like the tables beside them (36,000 not 36000)
  const show = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? ''
    : new Intl.NumberFormat('en-AU', { minimumFractionDigits: fixed ? dp : 0, maximumFractionDigits: dp }).format(v));
  const [draft, setDraft] = useState(show(value));
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!focus) setDraft(show(value)); }, [value, focus, dp, fixed]);
  const parsed = draft.trim() === '' ? NaN : Number(draft.replace(/,/g, ''));
  const invalid = draft.trim() !== '' && (!Number.isFinite(parsed) || (min != null && parsed < min) || (max != null && parsed > max));
  const commit = () => {
    if (draft.trim() === '' && onClear) { onClear(); return; }
    if (!invalid && Number.isFinite(parsed) && parsed !== value) onChange(parsed);
    else setDraft(show(value));
  };
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <span className={cx(s.inputWrap, small && s.inputSm, bare && s.inputBare, invalid && s.invalid, changed && s.changed)} style={{ width }} title={title}>
      <input
        ref={ref}
        className={cx(s.input, s.inputNum)}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={e => { setFocus(true); setDraft(raw(value)); const el = e.currentTarget; requestAnimationFrame(() => el.select()); }}
        onBlur={() => { setFocus(false); commit(); }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(); ref.current?.blur(); }
          else if (e.key === 'Escape') { setDraft(show(value)); ref.current?.blur(); }
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

export function TextField({ value, onChange, placeholder, small, bare, width, autoFocus, onEnter }: {
  value: string; onChange: (v: string) => void; placeholder?: string; small?: boolean; bare?: boolean; width?: number | string; autoFocus?: boolean; onEnter?: () => void;
}) {
  return (
    <span className={cx(s.inputWrap, small && s.inputSm, bare && s.inputBare)} style={{ width }}>
      <input className={s.input} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter?.(); }} />
    </span>
  );
}

export function Select<T extends string>({ value, options, onChange, small, width, title }: {
  value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; small?: boolean; width?: number | string; title?: string;
}) {
  return (
    <select className={cx(s.select, small && s.selectSm)} value={value} title={title} style={{ width }} onChange={e => onChange(e.target.value as T)}>
      {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ on, onChange, label, title }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string }) {
  const id = useId();
  const btn = <button id={id} type="button" role="switch" aria-checked={on} title={title} className={cx(s.toggle, on && s.on)} onClick={() => onChange(!on)} />;
  if (!label) return btn;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{btn}<label htmlFor={id} style={{ cursor: 'pointer' }}>{label}</label></span>;
}

export function Check({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} title={title} className={cx(s.check, on && s.on)} onClick={() => onChange(!on)}>
      {on && <Icon name="tick" size={14} strokeWidth={2.4} />}
    </button>
  );
}

export function Range({ value, min, max, step = 1, onChange, style, title }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; style?: CSSProperties; title?: string }) {
  const fill = `${((value - min) / (max - min || 1)) * 100}%`;
  return (
    <input type="range" className={s.range} min={min} max={max} step={step} value={value} title={title}
      style={{ ['--fill' as string]: fill, ...style }} onChange={e => onChange(Number(e.target.value))} />
  );
}
