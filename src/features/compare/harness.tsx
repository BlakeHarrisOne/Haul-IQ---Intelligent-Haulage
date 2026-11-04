/**
 * DEV HARNESS (analytics agent): /src/features/compare/harness.html?view=assumptions|curves|compare&theme=dark&src=demo
 * Mounts the three analytics views inside a shell-like scrolling sheet so they can be built and screenshotted before
 * the real Shell lands. Not part of the app bundle.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { useApp } from '@/state/store';
import { Segmented, Ctl, Chrome, ChromeSep } from '@/ui';
import { AssumptionsView } from '@/features/assumptions';
import { CurvesView } from '@/features/curves';
import { CompareView } from '@/features/compare';
import { buildDevScenario } from './devScenario';
import { registerDevScenarios } from './scenarioSource';

type V = 'assumptions' | 'curves' | 'compare';
const q = new URLSearchParams(location.search);

async function loadInitial() {
  if (q.get('src') === 'demo') {
    try {
      const { createDemoScenario } = await import('@/state/demo');
      const s = await createDemoScenario();
      if (s.circuits.length) return s;
    } catch (e) { console.warn('demo scenario unavailable', e); }
  }
  return buildDevScenario(0);
}

function Harness() {
  const [view, setView] = useState<V>((q.get('view') as V) || 'assumptions');
  const [theme, setTheme] = useState<'light' | 'dark'>(q.get('theme') === 'dark' ? 'dark' : 'light');
  const [ready, setReady] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    registerDevScenarios([buildDevScenario(0), buildDevScenario(1), buildDevScenario(2)]);
    loadInitial().then(s => { useApp.getState().replaceScenario(s, { markClean: true }); setReady(true); });
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <div style={{ padding: 10, display: 'flex', justifyContent: 'center' }} className="no-print">
        <Chrome>
          <Segmented value={view} onChange={setView} options={[
            { value: 'assumptions', label: 'Assumptions', icon: 'assumptions' },
            { value: 'curves', label: 'Truck curves', icon: 'curve' },
            { value: 'compare', label: 'Compare', icon: 'compare' },
          ]} />
          <ChromeSep />
          <Ctl icon={theme === 'light' ? 'moon' : 'sun'} tip="Theme" onClick={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))} />
        </Chrome>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} id="sheet">
        <div style={{ maxWidth: 1480, margin: '0 auto', padding: '10px 24px 64px' }}>
          {ready && (view === 'assumptions' ? <AssumptionsView /> : view === 'curves' ? <CurvesView /> : <CompareView />)}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
