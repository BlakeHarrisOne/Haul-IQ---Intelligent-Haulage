import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/ui';
import p from './page.module.css';

/** Page header row for the analytics sheets: eyebrow, title, short description, actions (Export / Print). */
export function PageHeader({ eyebrow, icon, title, desc, actions }: { eyebrow?: string; icon?: IconName; title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={p.head}>
      <div className={p.headText}>
        {eyebrow && <div className={p.eyebrow}>{icon && <Icon name={icon} size={15} />}{eyebrow}</div>}
        <h1 className={p.title}>{title}</h1>
        {desc && <p className={p.desc}>{desc}</p>}
      </div>
      {actions && <div className={`${p.actions} ${p.noPrint}`}>{actions}</div>}
    </header>
  );
}

export function Callout({ tone = 'info', icon, children }: { tone?: 'warn' | 'info' | 'bad'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`${p.callout} ${tone === 'warn' ? p.calloutWarn : tone === 'bad' ? p.calloutBad : p.calloutInfo}`} role={tone === 'info' ? 'note' : 'alert'}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'warning')} size={17} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export { p as pageStyles };
