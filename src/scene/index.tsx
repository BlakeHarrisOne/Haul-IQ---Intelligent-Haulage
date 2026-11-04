/**
 * OWNER: scene core. Public entry of the 3D scene: <Viewport/> fills its parent; `sceneApi` drives it imperatively.
 *
 * `?scene` (dev): the Viewport renders full-window above the app shell and loads the demo (or the synthetic dev pit
 * when the demo isn't available yet). Extra params: theme=light|dark, cam=orbit|plan|pov|chase, dep=0..1 (force
 * depletion), section=1 (A–B section across the solids), view=solids (close-up on the solids), chrome=0.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/ui';
import { sceneModules } from './modules';
import { SceneCore } from './core/SceneCore';
import { SceneChrome } from './core/Chrome';
import { bootHarness } from './core/harness';
import { _attachCore, _detachCore } from './api';
import css from './core/core.module.css';

export { sceneApi } from './api';
export type { SceneApi } from './api';
export type { SceneContext, SceneModule, ScenePointer, FollowTarget } from './context';

export interface ViewportProps {
  className?: string;
  style?: CSSProperties;
  /** Show the built-in compass / fit / scale bar chrome (bottom-right). Default true. */
  chrome?: boolean;
}

const sceneMode = () => typeof location !== 'undefined' && /[?&]scene\b/.test(location.search);

export function Viewport(props: ViewportProps): ReactElement {
  if (sceneMode() && typeof document !== 'undefined') {
    const q = new URLSearchParams(location.search);
    return createPortal(<div className={css.portal}><ViewportInner {...props} chrome={q.get('chrome') !== '0' && props.chrome !== false} harness /></div>, document.body);
  }
  return <ViewportInner {...props} />;
}

function ViewportInner({ className, style, chrome = true, harness = false }: ViewportProps & { harness?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<SceneCore | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const c = new SceneCore(el, sceneModules);
    if (harness) c.setInsets({ top: 16, right: 16, bottom: 72, left: 16 });
    _attachCore(c);
    setCore(c);
    return () => { _detachCore(c); c.dispose(); setCore(null); };
  }, []);
  useEffect(() => { if (harness) void bootHarness(); }, [harness]);
  return (
    <div className={cx(css.viewport, className)} style={style}>
      <div ref={host} className={css.canvas} />
      {chrome && core && <SceneChrome core={core} />}
    </div>
  );
}

