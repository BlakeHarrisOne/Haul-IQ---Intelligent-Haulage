/**
 * DEV HARNESS (manning agent): /src/features/manning/harness.html?view=manning|priority&insights=1&theme=dark&src=demo
 * Mounts ManningView / PriorityView in a shell-like scrolling sheet and the InsightsPanel in a floating glass card.
 * Not part of the app bundle.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { useApp } from '@/state/store';
import { Chrome, ChromeSep, Ctl, Icon, Segmented } from '@/ui';
import { ManningView } from '@/features/manning';
import { PriorityView } from '@/features/priority';
import { InsightsPanel } from '@/features/insights';
import { syntheticScenario } from '@/features/insights/synthetic';

type V = 'manning' | 'priority';
const q = new URLSearchParams(location.search);

async function loadInitial() {
  if (q.get('src') === 'demo') {
    try {
      const { createDemoScenario } = await import('@/state/demo');
      const s = await createDemoScenario();
      if (s.circuits.length) return s;
    } catch (e) { console.warn('demo scenario unavailable', e); }
  }
  return syntheticScenario();
}

function Harness() {
  const view = useApp(st => st.view);
  const setView = useApp(st => st.setView);
  const insights = useApp(st => st.panels.insights);
  const toggle = useApp(st => st.togglePanel);
  const [theme, setTheme] = useState<'light' | 'dark'>(q.get('theme') === 'dark' ? 'dark' : 'light');
  const [ready, setReady] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    setView(((q.get('view') as V) || 'manning'));
    if (q.get('insights')) toggle('insights', true);
    loadInitial().then(s => { useApp.getState().replaceScenario(s, { markClean: true }); setReady(true); });
  }, []);
  if (!ready) return null;
  const v: V = view === 'priority' ? 'priority' : 'manning';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-app)' }}>
      <Chrome style={{ position: 'absolute', top: 14, left: 14, zIndex: 5 }}>
        <Segmented value={v} onChange={x => setView(x)} options={[{ value: 'manning', label: 'Manning', icon: 'crew' }, { value: 'priority', label: 'Priority', icon: 'priority' }]} />
        <ChromeSep />
        <Ctl icon="sparkle" on={insights} onClick={() => toggle('insights')}>Insights</Ctl>
        <Ctl icon={theme === 'light' ? 'moon' : 'sun'} tip="Theme" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        <Ctl icon="undo" tip="Undo" onClick={() => useApp.getState().undo()} />
      </Chrome>
      <div id="sheet" style={{ position: 'absolute', inset: '72px 0 0 0', overflow: 'auto', paddingRight: insights ? 404 : 0 }}>
        <div style={{ maxWidth: 1480, margin: '0 auto', padding: '0 24px' }}>
          {v === 'manning' ? <ManningView /> : <PriorityView />}
        </div>
      </div>
      {insights && (
        <aside style={{ position: 'absolute', top: 72, right: 14, bottom: 14, width: 400, display: 'flex', flexDirection: 'column', background: 'var(--chrome-strong)',
          backdropFilter: 'var(--chrome-blur)', border: '1px solid var(--hair)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', zIndex: 4 }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '0 8px 0 16px', borderBottom: '1px solid var(--hair-2)', flex: 'none' }}>
            <span style={{ font: '600 16px/22px var(--font)', display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: 'var(--accent)', display: 'flex' }}><Icon name="sparkle" /></span>Insights</span>
            <span style={{ font: '700 10.5px/1 var(--font)', letterSpacing: '.08em', padding: '4px 6px', borderRadius: 6, color: 'var(--accent-ink)', background: 'var(--accent-50)' }}>AI</span>
            <span style={{ flex: 1 }} />
            <Ctl icon="x" small tip="Close" onClick={() => toggle('insights', false)} />
          </header>
          <div id="ins" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}><InsightsPanel /></div>
        </aside>
      )}
    </div>
  );
}

(window as unknown as { __app: typeof useApp }).__app = useApp;
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
