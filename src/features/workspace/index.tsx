/**
 * OWNER: shell agent. The application shell: full-bleed 3D stage with floating chrome (HRL v6 anatomy), sheets for the
 * analysis views over the still-mounted viewport, import flow, command palette, toasts and global keys.
 */
import { useEffect, useRef } from 'react';
import { Viewport } from '@/scene';
import { useApp } from '@/state/store';
import { loadDemo } from '@/state/demo';
import { clock } from '@/core/format';
import { checkRecovery, startAutosave, useLibrary } from '@/features/scenarios';
import { cx, ErrorBoundary } from '@/ui';
import { DocChrome, RightChrome, ViewSwitcher } from './TopBar';
import { ToolHint, ToolRail } from './ToolRail';
import { Timeline } from './Timeline';
import { DockPanel, InsightsCard, InspectorCard, Sheet, Toasts } from './Panels';
import { Welcome } from './Welcome';
import { ImportModal } from './ImportModal';
import { CommandPalette, Dialogs, DropOverlay, ShortcutsSheet, useDropTarget } from './Overlays';
import { useGlobalKeys } from './commands';
import { useHudRest, useThemeEffect } from './hooks';
import { useTopRowFit } from './layout';
import { ui } from './uiStore';
import s from './shell.module.css';

let booted = false;
function useBoot() {
  useEffect(() => {
    const stop = startAutosave();
    if (!booted) {
      booted = true;
      void useLibrary.getState().refresh().then(() => checkRecovery());
      if (/[?&]demo\b/.test(location.search)) {
        ui().set({ demoLoading: true });
        loadDemo().catch(e => useApp.getState().toast('error', `Could not load the demo: ${(e as Error).message}`)).finally(() => ui().set({ demoLoading: false }));
      }
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const st = useApp.getState();
      if (st.dirty && (st.scenario.assets.length || st.scenario.strings.length)) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { stop(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
}

const TOP_ROW = [s.topLeft, s.switcher, s.topRight].map(c => `.${c}`).join(', ');

function RestPill() {
  const tMin = useApp(st => st.timeline.tMin);
  const startHour = useApp(st => st.scenario.shift.startHour);
  const speed = useApp(st => st.timeline.speed);
  const playing = useApp(st => st.timeline.playing);
  const camera = useApp(st => st.camera);
  return (
    <div className={s.restPill} aria-hidden>
      {clock(startHour, tMin)}
      <span>{playing ? `×${speed}` : 'paused'}{camera === 'pov' ? ' · driver view' : camera === 'chase' ? ' · chase' : ''}</span>
    </div>
  );
}

export function Shell() {
  useBoot();
  useThemeEffect();
  useGlobalKeys();
  useDropTarget();
  const view = useApp(st => st.view);
  const hasAssets = useApp(st => st.scenario.assets.length > 0);
  const hasCircuits = useApp(st => st.scenario.circuits.length > 0);
  const inspectorOn = useApp(st => st.panels.inspector);
  const profileOn = useApp(st => st.panels.profile);
  const insightsOn = useApp(st => st.panels.insights);
  const camera = useApp(st => st.camera);
  const rested = useHudRest();
  const site = view === 'site';
  const showTimeline = hasAssets && hasCircuits;
  const showInspector = hasAssets && inspectorOn && !insightsOn;
  const ride = site && (camera === 'pov' || camera === 'chase');
  // the top row re-fits whenever what it holds changes (view → active label, assets → Show bar)
  const appRef = useRef<HTMLDivElement>(null);
  const density = useTopRowFit(appRef, TOP_ROW, [view, hasAssets]);

  return (
    <div ref={appRef} data-top-density={density}
      className={cx(s.app, !site && s.sheetUp, rested && s.rested, ride && s.ride, !showTimeline && s.noTimeline,
        !showInspector && !insightsOn && s.noInspector, insightsOn && !site && s.insightsOpen,
        density >= 1 && s.dShowIcons, density >= 2 && s.dNavIcons, density >= 3 && s.dNarrowDoc, density >= 4 && s.dNavBare, density >= 5 && s.dStack)}>
      <div className={s.stage}><ErrorBoundary region="The 3D view"><Viewport /></ErrorBoundary></div>

      {site && !hasAssets && <Welcome />}

      <div className={s.hud} data-hud>
        <DocChrome />
        <ViewSwitcher />
        <RightChrome foldShow={density >= 3} />
        {hasAssets && <ToolRail />}
        {hasAssets && <ToolHint />}
        {showInspector && <InspectorCard />}
        {hasAssets && profileOn && <DockPanel />}
        {showTimeline && <div className={cx(s.timelineSlot, s.fadeB, s.siteOnly)}><Timeline /></div>}
        {showTimeline && <RestPill />}
      </div>

      <Sheet />
      {insightsOn && <InsightsCard overSheet={!site || !showTimeline} />}

      <Toasts />
      <ImportModal />
      <CommandPalette />
      <ShortcutsSheet />
      <Dialogs />
      <DropOverlay />
    </div>
  );
}
