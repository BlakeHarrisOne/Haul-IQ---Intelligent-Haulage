/**
 * DEV HARNESS ONLY (not part of the app bundle): /src/features/haulage/harness/index.html
 * Mounts HaulageInspector, ProfileStrip and SectionPanel in a shell-like layout over a placeholder viewport.
 * URL: ?sel=circuit:0 | string:0[:pt] | asset:0 | truck:0:1 · &section=1 · &theme=dark · &t=<min> · &w=<inspector px>
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/tokens.css';
import '@/styles/base.css';
import { useApp, type Selection } from '@/state/store';
import { Card, Chrome, ChromeSep, Ctl, Segmented } from '@/ui';
import { HaulageInspector, ProfileStrip, SectionPanel } from '../index';
import { buildHarnessScenario } from './data';

const q = new URLSearchParams(location.search);
document.documentElement.dataset.theme = q.get('theme') === 'dark' ? 'dark' : 'light';
(window as unknown as { __app: typeof useApp }).__app = useApp;
try { if (q.get('view')) localStorage.setItem('haulage.tableView', q.get('view')!); if (q.get('ve')) localStorage.setItem('haulage.ve', q.get('ve')!); } catch { /* ignore */ }

function parseSel(v: string | null): Selection {
  const s = useApp.getState().scenario;
  if (!v) return { kind: 'none' };
  const [k, a, b] = v.split(':');
  const i = Number(a) || 0;
  if (k === 'circuit' && s.circuits[i]) return { kind: 'circuit', id: s.circuits[i].id };
  if (k === 'string') {
    const hs = a && Number.isNaN(Number(a)) ? s.strings.find(x => x.id === a) : s.strings[i];
    if (hs) return { kind: 'string', id: hs.id, pointIndex: b != null ? Number(b) : undefined };
  }
  if (k === 'asset') { const as = a && Number.isNaN(Number(a)) ? s.assets.find(x => x.id === a) : s.assets[i]; if (as) return { kind: 'asset', id: as.id }; }
  if (k === 'truck' && s.circuits[i]) return { kind: 'truck', circuitId: s.circuits[i].id, truckIndex: Number(b) || 0 };
  return { kind: 'none' };
}

function Harness() {
  const [ready, setReady] = useState(false);
  const sel = useApp(st => st.selection);
  const section = useApp(st => st.section);
  const select = useApp(st => st.select);
  const setSection = useApp(st => st.setSection);
  const toasts = useApp(st => st.toasts);
  useEffect(() => {
    buildHarnessScenario().then(s => {
      useApp.getState().replaceScenario(s, { markClean: true });
      useApp.getState().select(parseSel(q.get('sel')));
      if (q.get('t')) useApp.getState().setTimeline({ tMin: Number(q.get('t')) });
      if (q.get('section')) {
        const topo = s.assets.find(a => a.role === 'topo');
        const bb = topo?.stats.bbox;
        if (bb) {
          const cx = (bb.min[0] + bb.max[0]) / 2;
          setSection({ a: [cx - 300, bb.min[1] + 120], b: [cx - 180, bb.max[1] - 120], widthM: 10 });
        }
      }
      setReady(true);
      if (q.get('scroll')) setTimeout(() => { const el = document.querySelector('[class*=cardBody]'); if (el) el.scrollTop = Number(q.get('scroll')); }, 300);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useApp(st => st.scenario);
  const W = Number(q.get('w')) || 400;
  const kinds: Selection['kind'][] = ['none', 'circuit', 'string', 'asset', 'truck'];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-app)', display: 'grid', gridTemplateColumns: `1fr ${W}px`, gridTemplateRows: `1fr ${section ? 230 : 0}px 210px`, gap: 12, padding: 14 }}>
      <div style={{ gridColumn: 1, gridRow: 1, borderRadius: 14, background: 'repeating-linear-gradient(45deg, var(--surface-3) 0 12px, var(--surface-2) 12px 24px)', position: 'relative', overflow: 'hidden' }}>
        <Chrome style={{ position: 'absolute', left: 14, top: 14 }}>
          <span style={{ padding: '0 10px', fontWeight: 650 }}>Haulage harness</span>
          <ChromeSep />
          <Segmented small value={sel.kind} onChange={k => {
            const st = useApp.getState().scenario;
            select(k === 'circuit' ? { kind: 'circuit', id: st.circuits[0]?.id } : k === 'string' ? { kind: 'string', id: st.strings[0]?.id } : k === 'asset' ? { kind: 'asset', id: st.assets[1]?.id ?? st.assets[0]?.id } : k === 'truck' ? { kind: 'truck', circuitId: st.circuits[0]?.id, truckIndex: 0 } : { kind: 'none' });
          }} options={kinds.map(k => ({ value: k, label: k }))} />
          <ChromeSep />
          <Ctl icon="section" small on={!!section} tip="Toggle section" onClick={() => {
            if (section) { setSection(undefined); return; }
            const bb = s.assets.find(a => a.role === 'topo')?.stats.bbox;
            if (bb) { const cx = (bb.min[0] + bb.max[0]) / 2; setSection({ a: [cx - 300, bb.min[1] + 120], b: [cx - 180, bb.max[1] - 120], widthM: 10 }); }
          }} />
          <Ctl icon="undo" small tip="Undo" onClick={() => useApp.getState().undo()} />
          <Ctl icon="redo" small tip="Redo" onClick={() => useApp.getState().redo()} />
        </Chrome>
        <div style={{ position: 'absolute', left: 14, bottom: 14, display: 'grid', gap: 6 }}>
          {toasts.map(t => <div key={t.id} style={{ background: 'var(--ink)', color: 'var(--ink-inv)', padding: '8px 12px', borderRadius: 10, fontSize: 13 }}>{t.text}</div>)}
        </div>
        {!ready && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>Building demo…</div>}
      </div>
      <Card glass style={{ gridColumn: 2, gridRow: '1 / 4', minHeight: 0 }}>{ready && <HaulageInspector />}</Card>
      {section && <Card glass style={{ gridColumn: 1, gridRow: 2, minHeight: 0 }}><SectionPanel /></Card>}
      <Card glass style={{ gridColumn: 1, gridRow: 3, minHeight: 0 }}>{ready && <ProfileStrip />}</Card>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
