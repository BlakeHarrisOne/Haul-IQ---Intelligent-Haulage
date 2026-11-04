/**
 * hAIul SIM UI primitives. Compose these instead of inventing new chrome so the whole app reads as one system.
 * Anatomy (HRL v6): Chrome 44 px surface → Ctl 36 px controls; Card → CardHead 52 px → Section → Row 36 px.
 */
import {
  forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';
import s from './ui.module.css';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ── chrome ────────────────────────────────────────────────────────────────────
export function Chrome({ children, vertical, className, style }: { children: ReactNode; vertical?: boolean; className?: string; style?: CSSProperties }) {
  return <div className={cx(s.chrome, vertical && s.chromeV, className)} style={style}>{children}</div>;
}
export const ChromeSep = () => <span className={s.sep} aria-hidden />;
export const ChromeGap = () => <span className={s.gap} aria-hidden />;
export const ChromeLabel = ({ children }: { children: ReactNode }) => <span className={s.chromeLabel}>{children}</span>;

export interface CtlProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  on?: boolean;
  accent?: boolean;
  small?: boolean;
  /** Tooltip text; shortcut shown as a key cap. */
  tip?: string;
  shortcut?: string;
  tipSide?: 'down' | 'up' | 'right';
}
/** A 36 px control living inside a Chrome surface (icon-only when it has no children). */
export const Ctl = forwardRef<HTMLButtonElement, CtlProps>(function Ctl(
  { icon, on, accent, small, tip, shortcut, tipSide = 'down', children, className, ...rest }, ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-pressed={on === undefined ? undefined : on}
      aria-label={!children ? tip : undefined}
      className={cx(s.ctl, !children && s.iconOnly, on && s.on, accent && s.accent, small && s.sm, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={small ? 18 : 20} />}
      {children}
    </button>
  );
  return tip ? <Tip text={tip} shortcut={shortcut} side={tipSide}>{btn}</Tip> : btn;
});

// ── buttons ───────────────────────────────────────────────────────────────────
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'secondary' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, children, className, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(s.btn, variant === 'primary' && s.primary, variant === 'ghost' && s.ghost, variant === 'danger' && s.danger,
        size === 'sm' && s.btnSm, size === 'lg' && s.btnLg, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 16 : 18} />}
    </button>
  );
});

// ── card ──────────────────────────────────────────────────────────────────────
export function Card({ children, glass, flat, className, style }: { children: ReactNode; glass?: boolean; flat?: boolean; className?: string; style?: CSSProperties }) {
  return <section className={cx(s.card, glass && s.cardGlass, flat && s.cardFlat, className)} style={style}>{children}</section>;
}
export function CardHead({ title, sub, icon, actions, children }: { title: ReactNode; sub?: ReactNode; icon?: IconName; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className={s.cardHead}>
      <div className={s.cardTitle}>
        {icon && <Icon name={icon} />}
        <span>{title}</span>
        {sub && <span className={s.cardSub}>{sub}</span>}
      </div>
      {children}
      <span className={s.gap} />
      {actions}
    </header>
  );
}
export function CardBody({ children, pad, className, style }: { children: ReactNode; pad?: boolean; className?: string; style?: CSSProperties }) {
  return <div className={cx(s.cardBody, pad && s.cardPad, className)} style={style}>{children}</div>;
}

export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.sec}>
      {title && <div className={s.secHead}><span>{title}</span><span className={s.gap} />{actions}</div>}
      {children}
    </div>
  );
}

// ── row ───────────────────────────────────────────────────────────────────────
export interface RowProps {
  icon?: IconName | ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  unit?: string;
  tone?: 'ok' | 'bad' | 'warn' | 'na';
  on?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  title?: string;
}
export function Row({ icon, label, hint, value, unit, tone, on, trailing, onClick, title }: RowProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={cx(s.row, onClick && s.rowBtn, on && s.on)} onClick={onClick} title={title} type={onClick ? 'button' : undefined}>
      <span className={s.rowIco}>{typeof icon === 'string' ? <Icon name={icon} /> : icon}</span>
      <span className={s.rowLab}>{label}{hint && <span className={s.rowHint}>{hint}</span>}</span>
      <span className={cx(s.rowVal, tone === 'ok' && s.ok, tone === 'bad' && s.bad, tone === 'warn' && s.warnTxt, tone === 'na' && s.na)}>
        {value}{unit && <span className={s.unit}>{unit}</span>}
      </span>
      <span>{trailing}</span>
    </Tag>
  );
}

// ── segmented ─────────────────────────────────────────────────────────────────
export function Segmented<T extends string | number>({ value, options, onChange, small, className, style }: {
  value: T; options: { value: T; label: ReactNode; icon?: IconName; title?: string }[]; onChange: (v: T) => void; small?: boolean; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={cx(s.seg, small && s.segSm, className)} role="tablist" style={style}>
      {options.map(o => (
        <button key={String(o.value)} type="button" role="tab" aria-selected={o.value === value} title={o.title}
          className={cx(s.segItem, o.value === value && s.segOn)} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}{o.label}
        </button>
      ))}
    </div>
  );
}

// ── badges ────────────────────────────────────────────────────────────────────
export type Tone = 'ok' | 'bad' | 'warn' | 'na' | 'info' | 'solid';
export function Badge({ tone = 'na', icon, children, title }: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return <span className={cx(s.badge, s[`b-${tone}`])} title={title}>{icon && <Icon name={icon} size={14} strokeWidth={2} />}{children}</span>;
}
export const Dot = ({ color, style }: { color: string; style?: CSSProperties }) => <span className={s.dot} style={{ background: color, ...style }} />;
export const Swatch = ({ color, style }: { color: string; style?: CSSProperties }) => <span className={s.swatch} style={{ background: color, ...style }} />;

// ── KPI ───────────────────────────────────────────────────────────────────────
export function Kpi({ label, value, unit, delta, deltaTone, icon, size = 'md', title }: {
  label: ReactNode; value: ReactNode; unit?: string; delta?: ReactNode; deltaTone?: 'ok' | 'bad' | 'warn' | 'na'; icon?: IconName; size?: 'sm' | 'md' | 'lg'; title?: string;
}) {
  return (
    <div className={cx(s.kpi, size === 'lg' && s.kpiLg, size === 'sm' && s.kpiSm)} title={title}>
      <div className={s.kpiLabel}>{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className={s.kpiValue}>{value}{unit && <span className={s.unit}>{unit}</span>}</div>
      {delta != null && <div className={cx(s.kpiDelta, deltaTone && s[deltaTone === 'warn' ? 'warnTxt' : deltaTone])}>{delta}</div>}
    </div>
  );
}

// ── tooltip ───────────────────────────────────────────────────────────────────
export function Tip({ text, shortcut, side = 'down', children }: { text: ReactNode; shortcut?: string; side?: 'down' | 'up' | 'right'; children: ReactNode }) {
  return (
    <span className={s.tipHost}>
      {children}
      <span role="tooltip" className={cx(s.tip, side === 'up' && s.tipUp, side === 'right' && s.tipRight)}>
        {text}{shortcut && <span className={s.kbd}>{shortcut}</span>}
      </span>
    </span>
  );
}

// ── modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, title, sub, onClose, children, footer, width }: {
  open: boolean; title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={s.scrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modal} role="dialog" aria-modal style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className={s.modalHead}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className={s.modalTitle}>{title}</div>
              {sub && <div className={s.modalSub}>{sub}</div>}
            </div>
            <Ctl icon="x" tip="Close" onClick={onClose} small />
          </div>
        </div>
        <div className={s.modalBody}>{children}</div>
        {footer && <div className={s.modalFoot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── menu (anchored popover) ───────────────────────────────────────────────────
export interface MenuItem { label: ReactNode; icon?: IconName; onSelect?: () => void; hint?: ReactNode; separator?: boolean; header?: boolean; danger?: boolean; disabled?: boolean }
export function MenuButton({ items, children, align = 'left', up }: { items: MenuItem[]; children: (open: boolean, toggle: () => void) => ReactNode; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {children(open, () => setOpen(o => !o))}
      {open && (
        <div className={s.menu} role="menu" style={{ [align]: 0, ...(up ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }) }}>
          {items.map((it, i) => it.separator ? <div key={i} className={s.menuSep} /> : it.header ? <div key={i} className={s.menuLabel}>{it.label}</div> : (
            <button key={i} type="button" role="menuitem" className={s.menuItem} disabled={it.disabled}
              style={it.danger ? { color: 'var(--bad-ink)' } : it.disabled ? { opacity: .45 } : undefined}
              onClick={() => { setOpen(false); it.onSelect?.(); }}>
              {it.icon && <Icon name={it.icon} size={18} />}<span>{it.label}</span><span className={s.gap} />
              {it.hint && <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── empty state ───────────────────────────────────────────────────────────────
export function Empty({ icon = 'info', title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIco}><Icon name={icon} size={26} /></div>
      <div className={s.emptyTitle}>{title}</div>
      {children && <div style={{ maxWidth: 420 }}>{children}</div>}
      {action}
    </div>
  );
}

export { s as uiStyles };
