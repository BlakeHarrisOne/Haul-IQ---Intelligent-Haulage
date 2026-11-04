/**
 * Dev harness: `?scene` in the app (see src/scene/index.tsx) and the standalone page
 * /src/scene/core/harness.html (no app shell; scene modules loaded lazily so a broken module elsewhere cannot blank
 * the view). Params: theme=light|dark, dev=1 (synthetic pit even if the demo exists), cam=orbit|plan|pov|chase,
 * dep=0..1 (force depletion), section=1, view=solids, mods=0 (no actor/tool modules), chrome=0.
 */
import { useApp } from '@/state/store';
import type { Scenario } from '@/core/types';
import { sceneApi } from '../api';
import type { SceneCore } from './SceneCore';

let booted = false;
export async function bootHarness() {
  if (booted) return;
  booted = true;
  const q = new URLSearchParams(location.search);
  const theme = q.get('theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
  const st = useApp.getState();
  if (!st.scenario.assets.length) {
    const { emptyScenario } = await import('@/state/store');
    let sc: Scenario | null = null;
    if (q.get('dev') !== '1') {
      try { sc = await (await import('@/state/demo')).createDemoScenario(); } catch (e) { console.warn('[scene] demo unavailable', e); }
    }
    if (!sc || !sc.assets.some(a => a.kind === 'surface')) {
      const { buildDevSite } = await import('./devSite');
      const d = buildDevSite();
      sc = { ...(sc ?? emptyScenario('Dev pit')), site: d.site, assets: d.assets };
    }
    useApp.getState().replaceScenario(sc, { markClean: true });
  }
  const dep = q.get('dep');
  if (dep !== null) sceneApi.setDepletionOverride(Math.max(0, Math.min(1, Number(dep) || 0)));
  const scn = useApp.getState().scenario;
  if (q.get('section') === '1') {
    const dig = scn.assets.find(a => a.role === 'dig'), dump = scn.assets.find(a => a.role === 'dump');
    const topo = scn.assets.find(a => a.role === 'topo') ?? scn.assets[0];
    if (dig && dump) {
      const A = dump.stats.centroid, B = dig.stats.centroid;
      const dx = B[0] - A[0], dy = B[1] - A[1];
      useApp.getState().setSection({ a: [A[0] - dx * 0.45, A[1] - dy * 0.45], b: [B[0] + dx * 0.35, B[1] + dy * 0.35], widthM: 0 });
    } else if (topo) {
      const b = topo.stats.bbox, cx = (b.min[0] + b.max[0]) / 2;
      useApp.getState().setSection({ a: [cx, b.min[1] + (b.max[1] - b.min[1]) * 0.15], b: [cx, b.max[1] - (b.max[1] - b.min[1]) * 0.15], widthM: 0 });
    }
  }
  const cam = q.get('cam');
  if (cam === 'plan' || cam === 'orbit' || cam === 'pov' || cam === 'chase') setTimeout(() => useApp.getState().setCamera(cam), 50);
  const view = q.get('view');
  if (view === 'solids') {
    await sceneApi.whenReady();
    const ids = scn.assets.filter(a => a.kind === 'solid');
    if (ids.length) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const a of ids) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.stats.bbox.min[k]); hi[k] = Math.max(hi[k], a.stats.bbox.max[k]); }
      const c = (window as unknown as { __haiulScene: { core: SceneCore } }).__haiulScene.core;
      c.focusBox(lo as [number, number, number], hi as [number, number, number], 0.05);
    }
  }
}

/** Standalone harness mount (used by harness.html). */
export async function mountStandalone(root: HTMLElement) {
  const [{ createElement, useEffect, useRef, useState }, { createRoot }, { SceneCore: Core }, { SceneChrome }, api] = await Promise.all([
    import('react'), import('react-dom/client'), import('./SceneCore'), import('./Chrome'), import('../api'),
  ]);
  const q = new URLSearchParams(location.search);
  let modules: import('../context').SceneModule[] = [];
  if (q.get('mods') !== '0') {
    try { modules = (await import('../modules')).sceneModules; } catch (e) { console.warn('[harness] scene modules failed to load', e); }
  }
  function App() {
    const host = useRef<HTMLDivElement>(null);
    const [core, setCore] = useState<SceneCore | null>(null);
    useEffect(() => {
      const c = new Core(host.current!, modules);
      api._attachCore(c);
      setCore(c);
      void bootHarness();
      return () => { api._detachCore(c); c.dispose(); };
    }, []);
    return createElement('div', { style: { position: 'fixed', inset: 0, background: 'var(--bg-app)' } },
      createElement('div', { ref: host, style: { position: 'absolute', inset: 0 } }),
      core && q.get('chrome') !== '0' ? createElement(SceneChrome, { core }) : null);
  }
  createRoot(root).render(createElement(App));
}
