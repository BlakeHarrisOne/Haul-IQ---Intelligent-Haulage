/**
 * OWNER: scene core. Public entry of the 3D scene: <Viewport/> fills its parent; `sceneApi` drives it imperatively.
 *
 * `?scene` (dev): mounts the standalone scene harness full-window over the app (independent of the shell) and loads the
 * demo; params as in core/harness.tsx (theme, cam, dep, section, view, mods, chrome). The same harness is served at
 * /src/scene/core/harness.html without the app around it.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { cx } from '@/ui';
import { sceneModules } from './modules';
import { SceneCore } from './core/SceneCore';
import { SceneChrome } from './core/Chrome';
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

let standaloneMounted = false;
/** `?scene`: mount the standalone harness on document.body once (works whether or not the shell renders a Viewport). */
function ensureStandalone() {
  if (standaloneMounted || typeof document === 'undefined') return;
  standaloneMounted = true;
  const host = document.createElement('div');
  host.className = css.portal;
  document.body.appendChild(host);
  void import('./core/harness').then(m => m.mountStandalone(host));
}
if (sceneMode()) queueMicrotask(ensureStandalone);

export function Viewport(props: ViewportProps): ReactElement | null {
  // in ?scene mode the standalone harness owns the (single) WebGL view
  if (sceneMode()) return null;
  return <ViewportInner {...props} />;
}

function ViewportInner({ className, style, chrome = true }: ViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const [core, setCore] = useState<SceneCore | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const c = new SceneCore(el, sceneModules);
    _attachCore(c);
    setCore(c);
    return () => { _detachCore(c); c.dispose(); setCore(null); };
  }, []);
  return (
    <div className={cx(css.viewport, className)} style={style}>
      <div ref={host} className={css.canvas} />
      {chrome && core && <SceneChrome core={core} />}
    </div>
  );
}

