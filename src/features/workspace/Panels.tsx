import { useEffect, useState, type ReactElement } from 'react';
import { useApp, type ViewId } from '@/state/store';
import { HaulageInspector, ProfileStrip, SectionPanel } from '@/features/haulage';
import { InsightsPanel } from '@/features/insights';
import { AssumptionsView } from '@/features/assumptions';
import { CurvesView } from '@/features/curves';
import { CompareView } from '@/features/compare';
import { ManningView } from '@/features/manning';
import { PriorityView } from '@/features/priority';
import { ScenariosView } from '@/features/scenarios';
import { Ctl, Icon, Segmented, StatusGlyph, cx } from '@/ui';
import { VIEWS } from './defs';
import { useShellUi, ui } from './uiStore';
import s from './shell.module.css';

// ── right inspector ──────────────────────────────────────────────────────────────────────────────
export function InspectorCard() {
  return (
    <aside className={cx(s.inspector, s.fadeT, s.siteOnly)} aria-label="Inspector" data-hud>
      <div className={s.host}><HaulageInspector /></div>
    </aside>
  );
}

// ── insights drawer ──────────────────────────────────────────────────────────────────────────────
export function InsightsCard({ overSheet }: { overSheet: boolean }) {
  const toggle = useApp(st => st.togglePanel);
  return (
    <aside className={cx(s.insights, overSheet && s.insightsSheet, !overSheet && s.fadeT)} aria-label="Insights" data-hud>
      <header className={s.insightsHead}>
        <span className={s.insightsTitle}><Icon name="sparkle" />Insights</span>
        <span className={s.aiTag}>AI</span>
        <span style={{ flex: 1 }} />
        <Ctl icon="x" small tip="Close" shortcut="I" onClick={() => toggle('insights', false)} />
      </header>
      <div className={cx(s.host, s.hostPlaceholder)} data-empty="Insights review the open scenario – bottlenecks, over- and under-trucked circuits, crew shortfalls – and explain each one with the numbers behind it.">
        <InsightsPanel />
      </div>
    </aside>
  );
}

// ── profile / section dock above the timeline ────────────────────────────────────────────────────
export function DockPanel() {
  const selection = useApp(st => st.selection);
  const section = useApp(st => st.section);
  const scenario = useApp(st => st.scenario);
  const tab = useShellUi(st => st.dockTab);
  const stringId = selection.kind === 'string' ? selection.id
    : selection.kind === 'circuit' ? scenario.circuits.find(c => c.id === selection.id)?.haulStringId : undefined;
  const hs = stringId ? scenario.strings.find(x => x.id === stringId) : undefined;

  // follow what the user just did: a new section → Section tab; a new string selection → Profile tab
  useEffect(() => { if (section) ui().set({ dockTab: 'section' }); }, [section]);
  useEffect(() => { if (stringId) ui().set({ dockTab: 'profile' }); }, [stringId]);

  const active = tab === 'section' && section ? 'section' : hs ? 'profile' : section ? 'section' : null;
  if (!active) return null;
  return (
    <section className={cx(s.dockPanel, s.fadeB, s.siteOnly)} aria-label={active === 'profile' ? 'Long section' : 'Cross-section'} data-hud>
      {hs && section && (
        // both available: a slim tab row; each panel brings its own header and close
        <div className={s.dockTabs}>
          <Segmented<'profile' | 'section'> small value={active} onChange={v => ui().set({ dockTab: v })} options={[
            { value: 'profile', label: 'Profile', icon: 'string', title: `Long section of ${hs.name}` },
            { value: 'section', label: 'Section A–B', icon: 'section', title: 'Cross-section A–B' },
          ]} />
        </div>
      )}
      <div className={cx(s.dockBody, s.hostPlaceholder)} data-empty={active === 'profile' ? 'The long section of the selected haul string appears here.' : 'The A–B cross-section appears here.'}>
        {active === 'profile' ? <ProfileStrip /> : <SectionPanel />}
      </div>
    </section>
  );
}

// ── sheets: the other views over the still-mounted viewport ──────────────────────────────────────
const VIEW_COMPONENTS: Record<Exclude<ViewId, 'site'>, () => ReactElement | null> = {
  assumptions: AssumptionsView, curves: CurvesView, compare: CompareView, manning: ManningView, priority: PriorityView, scenarios: ScenariosView,
};

export function Sheet() {
  const view = useApp(st => st.view);
  const [shown, setShown] = useState<ViewId>(view);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (view !== 'site') { setShown(view); setClosing(false); return; }
    if (shown === 'site') return;
    setClosing(true);
    const t = setTimeout(() => { setShown('site'); setClosing(false); }, 220);
    return () => clearTimeout(t);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  if (shown === 'site') return null;
  const def = VIEWS.find(v => v.id === shown)!;
  const View = VIEW_COMPONENTS[shown as Exclude<ViewId, 'site'>];
  return (
    <div className={cx(s.sheet, closing && s.closing)} role="region" aria-label={def.title}>
      <div className={s.page} key={shown}>
        <div className={s.viewHost} data-empty={`The ${def.title} view is being built.`}><View /></div>
      </div>
    </div>
  );
}

// ── toasts ───────────────────────────────────────────────────────────────────────────────────────
export function Toasts() {
  const toasts = useApp(st => st.toasts);
  const dismiss = useApp(st => st.dismissToast);
  return (
    <div className={s.toasts} role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={s.toast}>
          {t.kind === 'info'
            ? <Icon name="info" size={20} style={{ color: 'var(--accent)' }} />
            : <StatusGlyph kind={t.kind === 'ok' ? 'ok' : t.kind === 'error' ? 'fail' : 'warn'} />}
          <span>{t.text}</span>
          <Ctl icon="x" small tip="Dismiss" tipSide="up" onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
