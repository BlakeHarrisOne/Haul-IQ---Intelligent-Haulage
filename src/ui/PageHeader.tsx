/**
 * The single page-header pattern for sheet views: eyebrow (icon + section), 28 px title, one-paragraph lede, actions.
 * Every sheet uses this so titles sit at the same height and read as one product.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import p from './page.module.css';

export function PageHeader({ eyebrow, icon, title, desc, actions }: {
  eyebrow?: string; icon?: IconName; title: ReactNode; desc?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header className={p.head}>
      <div className={p.headText}>
        {eyebrow && <div className={p.eyebrow}>{icon && <Icon name={icon} size={15} />}{eyebrow}</div>}
        <h1 className={p.title}>{title}</h1>
        {desc && <p className={p.desc}>{desc}</p>}
      </div>
      {actions && <div className={p.actions}>{actions}</div>}
    </header>
  );
}
