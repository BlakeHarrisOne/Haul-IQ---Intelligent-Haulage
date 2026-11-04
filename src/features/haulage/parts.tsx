/** Small presentational pieces shared by the haulage panels. */
import { useState, type ReactNode } from 'react';
import type { TruckingStatus } from '@/core/types';
import { Badge, Icon, cx, gradeColor, type IconName } from '@/ui';
import { grade as fmtGrade } from '@/core/format';
import { statusLabel, statusTone } from './model';
import s from './haulage.module.css';

export function StatusBadge({ status, short }: { status: TruckingStatus; short?: boolean }) {
  const tone = statusTone(status);
  const icon: IconName = status === 'balanced' ? 'tick' : status === 'under' ? 'down' : 'up';
  return <Badge tone={tone} icon={icon}>{short ? (status === 'balanced' ? 'Balanced' : status === 'under' ? 'Under' : 'Over') : statusLabel(status)}</Badge>;
}

/** Grade chip, coloured by grade class; red with a warning when the spreadsheet would drop the segment. */
export function GradeChip({ g, dropped, title }: { g: number; dropped?: boolean; title?: string }) {
  return (
    <span className={cx(s.gradeChip, dropped && s.gradeDrop)} style={dropped ? undefined : { ['--g' as string]: gradeColor(g) }} title={title}>
      {dropped && <Icon name="warning" size={12} strokeWidth={2} />}
      {fmtGrade(g, 1)}
    </span>
  );
}

/** Small labelled figure (label over value) for dense rows. */
export function Fig({ label, value, unit, tone, children }: { label: ReactNode; value?: ReactNode; unit?: string; tone?: 'ok' | 'bad' | 'warn' | 'na'; children?: ReactNode }) {
  return (
    <div className={s.fig}>
      <span className={s.figLab}>{label}</span>
      <span className={cx(s.figVal, tone === 'bad' && s.tBad, tone === 'warn' && s.tWarn, tone === 'ok' && s.tOk, tone === 'na' && s.tNa)}>
        {value}{unit && <span className={s.figUnit}>{unit}</span>}{children}
      </span>
    </div>
  );
}

/** Assigned trucks as pips, with a tick at the exact number needed. */
export function TruckPips({ assigned, exact, max }: { assigned: number; exact: number; max?: number }) {
  const n = Math.max(max ?? 0, assigned, Math.ceil(exact || 0), 1);
  const PW = 6, GAP = 2;
  const x = Number.isFinite(exact) && exact > 0 ? exact * (PW + GAP) - GAP / 2 : -10;
  return (
    <span className={s.pips} title={`${assigned} assigned · ${exact.toFixed(2)} needed`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cx(s.pip, i < assigned && s.pipOn, i < assigned && i >= Math.ceil(exact - 1e-9) && s.pipOver)} />
      ))}
      {x > 0 && <span className={s.pipExact} style={{ left: x - 1 }} />}
    </span>
  );
}

export function Callout({ tone = 'info', icon, title, children, action }: {
  tone?: 'info' | 'ok' | 'bad' | 'warn'; icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  const ic: IconName = icon ?? (tone === 'bad' ? 'warning' : tone === 'warn' ? 'warning' : tone === 'ok' ? 'tick' : 'info');
  return (
    <div className={cx(s.callout, s[`co-${tone}`])}>
      <Icon name={ic} size={18} />
      <div className={s.coBody}>
        <div className={s.coTitle}>{title}</div>
        {children && <div className={s.coText}>{children}</div>}
        {action && <div className={s.coAct}>{action}</div>}
      </div>
    </div>
  );
}

/** Back affordance used in card heads. */
export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={s.back} onClick={onClick} aria-label={label} title={label}>
      <Icon name="left" size={18} />
    </button>
  );
}

export function downloadText(fileName: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}

export const safeFileName = (n: string) => n.replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'string';

/**
 * Compact numeric cell editor for dense tables: shows a fixed number of decimals (columns align), edits on focus,
 * commits on Enter / blur, Esc reverts, ↑/↓ step (Shift × 10). Empty + onClear removes an override.
 */
export function CellNum({ value, onChange, onClear, dp = 2, step = 1, min, max, placeholder, changed, disabled, title }: {
  value: number | null | undefined; onChange: (v: number) => void; onClear?: () => void; dp?: number; step?: number; min?: number; max?: number;
  placeholder?: string; changed?: boolean; disabled?: boolean; title?: string;
}) {
  const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(dp));
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft == null || draft.trim() === '' ? NaN : Number(draft.replace(/,/g, ''));
  const bad = draft != null && draft.trim() !== '' && (!Number.isFinite(parsed) || (min != null && parsed < min) || (max != null && parsed > max));
  const commit = () => {
    if (draft == null) return;
    if (draft.trim() === '' && onClear) onClear();
    else if (!bad && Number.isFinite(parsed) && Math.abs(parsed - (value ?? NaN)) > 10 ** -(dp + 2)) onChange(parsed);
    setDraft(null);
  };
  return (
    <input className={cx(s.cell, changed && s.cellChanged, bad && s.cellBad)} inputMode="decimal" value={draft ?? fmt(value)} placeholder={placeholder}
      disabled={disabled} title={title} aria-label={title}
      onFocus={e => { setDraft(fmt(value)); const t = e.currentTarget; requestAnimationFrame(() => t.select()); }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'Escape') { setDraft(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const base = Number.isFinite(parsed) ? parsed : value ?? 0;
          let nv = +(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)).toFixed(6);
          if (min != null) nv = Math.max(min, nv);
          if (max != null) nv = Math.min(max, nv);
          setDraft(nv.toFixed(dp)); onChange(nv);
        }
      }} />
  );
}
