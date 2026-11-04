import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/ui';
import p from './page.module.css';

/** The page header is shared by every sheet: see src/ui/PageHeader.tsx. */
export { PageHeader } from '@/ui';

export function Callout({ tone = 'info', icon, children }: { tone?: 'warn' | 'info' | 'bad'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`${p.callout} ${tone === 'warn' ? p.calloutWarn : tone === 'bad' ? p.calloutBad : p.calloutInfo}`} role={tone === 'info' ? 'note' : 'alert'}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'warning')} size={17} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export { p as pageStyles };
