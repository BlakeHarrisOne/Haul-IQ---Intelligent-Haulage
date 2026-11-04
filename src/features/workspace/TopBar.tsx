import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/state/store';
import { ago, useLibrary } from '@/features/scenarios';
import { Brand, Chrome, ChromeLabel, ChromeSep, Ctl, Icon, MenuButton, Segmented, Toggle, cx, type MenuItem } from '@/ui';
import { MOD, SHOW_LAYERS, VIEWS } from './defs';
import {
  cmdExportScenario, cmdExportStrings, cmdLoadDemo, cmdNew, cmdReport, cmdSave, cmdSaveAs,
} from './actions';
import { pickMeshes, pickScenarioFile, pickStrings } from './importer';
import { useNow } from './hooks';
import { useShellUi, ui, type MotionPref, type ThemePref } from './uiStore';
import s from './shell.module.css';

// ── top-left: brand · document · undo/redo · menu ────────────────────────────────────────────────
function SaveState() {
  const dirty = useApp(st => st.dirty);
  const lastSavedAt = useApp(st => st.lastSavedAt);
  const id = useApp(st => st.scenario.id);
  const savedRef = useLibrary(st => st.savedRef);
  const busy = useLibrary(st => st.busy);
  const now = useNow();
  const at = lastSavedAt ?? (savedRef?.id === id ? savedRef.at : undefined);
  const [color, text] = busy ? ['var(--accent)', 'Saving…']
    : dirty ? ['var(--warn)', at ? `Unsaved changes · saved ${ago(at, now)}` : 'Unsaved changes']
      : at ? ['var(--ok)', `Saved ${ago(at, now)}`] : ['var(--na)', 'Not saved'];
  return <span className={s.docState}><span className={s.stateDot} style={{ background: color }} />{text}</span>;
}

function DocTitle() {
  const name = useApp(st => st.scenario.name);
  const commit = useApp(st => st.commit);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (edit) { setDraft(name); requestAnimationFrame(() => ref.current?.select()); } }, [edit, name]);
  const done = (save: boolean) => {
    setEdit(false);
    const v = draft.trim();
    if (save && v && v !== name) commit('Rename scenario', d => ({ ...d, name: v }));
  };
  if (edit) {
    return (
      <div className={s.doc} style={{ cursor: 'default' }}>
        <input ref={ref} className={s.docInput} value={draft} aria-label="Scenario name" onChange={e => setDraft(e.target.value)}
          onBlur={() => done(true)} onKeyDown={e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); }} />
      </div>
    );
  }
  return (
    <button type="button" className={s.doc} onClick={() => setEdit(true)} title={`${name} - click to rename`}>
      <span className={s.docName}>{name}</span>
      <SaveState />
    </button>
  );
}

export function DocChrome() {
  const past = useApp(st => st.past);
  const future = useApp(st => st.future);
  const undo = useApp(st => st.undo);
  const redo = useApp(st => st.redo);
  const setView = useApp(st => st.setView);
  const last = past[past.length - 1], next = future[0];
  const items: MenuItem[] = [
    { label: 'New scenario', icon: 'plus', onSelect: cmdNew },
    { label: 'Open…', icon: 'folder', hint: `${MOD}O`, onSelect: () => setView('scenarios') },
    { label: 'Open the demo site', icon: 'sparkle', onSelect: () => { void cmdLoadDemo(); } },
    { separator: true, label: '' },
    { label: 'Save', icon: 'save', hint: `${MOD}S`, onSelect: cmdSave },
    { label: 'Save as…', icon: 'copy', hint: `${MOD}⇧S`, onSelect: cmdSaveAs },
    { separator: true, label: '' },
    { label: 'Import surfaces / solids…', icon: 'upload', hint: '.00t', onSelect: pickMeshes },
    { label: 'Import strings…', icon: 'string', hint: '.str .csv', onSelect: pickStrings },
    { label: 'Open a scenario file…', icon: 'file', hint: '.haiul.json', onSelect: pickScenarioFile },
    { separator: true, label: '' },
    { label: 'Export scenario', icon: 'download', hint: '.haiul.json', onSelect: cmdExportScenario },
    { label: 'Export strings as CSV', icon: 'table', onSelect: () => cmdExportStrings('csv') },
    { label: 'Export strings as DXF', icon: 'download', onSelect: () => cmdExportStrings('dxf') },
    { label: 'Print a summary report', icon: 'report', onSelect: cmdReport },
  ];
  return (
    <Chrome className={cx(s.topLeft, s.fadeT)}>
      <span className={s.brandBox}><Brand size={15} /></span>
      <ChromeSep />
      <DocTitle />
      <Ctl icon="undo" disabled={!last} onClick={undo} tip={last ? `Undo ${last.label}` : 'Nothing to undo'} shortcut={`${MOD}Z`} />
      <Ctl icon="redo" disabled={!next} onClick={redo} tip={next ? `Redo ${next.label}` : 'Nothing to redo'} shortcut={`${MOD}⇧Z`} />
      <MenuButton items={items} align="right">
        {(open, toggle) => <Ctl icon="more" on={open} onClick={toggle} tip="File" aria-haspopup="menu" aria-expanded={open} />}
      </MenuButton>
    </Chrome>
  );
}

// ── top-centre: the view switcher (primary navigation) ───────────────────────────────────────────
export function ViewSwitcher() {
  const view = useApp(st => st.view);
  const setView = useApp(st => st.setView);
  return (
    <Chrome className={cx(s.switcher, s.fadeT)}>
      {VIEWS.map(v => (
        <Ctl key={v.id} icon={v.icon} on={view === v.id} className={s.navItem} onClick={() => setView(v.id)} tip={v.label} shortcut={v.key}
          aria-label={v.label}>
          <span className={s.navLabel}>{v.label}</span>
        </Ctl>
      ))}
    </Chrome>
  );
}

// ── top-right: show toggles · app controls ───────────────────────────────────────────────────────
function Popover({ open, onClose, anchor, title, children, footer }: { open: boolean; onClose: () => void; anchor: ReactNode; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open, onClose]);
  return (
    <div ref={ref} className={s.popAnchor}>
      {anchor}
      {open && (
        <div className={s.popover} role="dialog" aria-label={title} data-hud-hold>
          <div className={s.popHead}>{title}<span style={{ flex: 1 }} /><Ctl icon="x" small tip="Close" onClick={onClose} /></div>
          <div className={s.popBody}>{children}</div>
          {footer && <div className={s.popFoot}>{footer}</div>}
        </div>
      )}
    </div>
  );
}

function SettingsPanel() {
  const settings = useApp(st => st.scenario.settings);
  const commit = useApp(st => st.commit);
  const motion = useShellUi(st => st.motion);
  const keepHud = useShellUi(st => st.keepHud);
  const setS = (label: string, patch: Partial<typeof settings>) => commit(label, d => ({ ...d, settings: { ...d.settings, ...patch } }));
  const ve = settings.verticalExaggeration;
  const ci = settings.contourIntervalM;
  return (
    <>
      <div className={s.setRow}>
        <span className={s.setLabel}><Icon name="scale" size={18} />Vertical exaggeration</span>
        <Segmented<number> small value={ve} onChange={v => setS('Vertical exaggeration', { verticalExaggeration: v })}
          options={[1, 1.5, 2, 3, 5].map(v => ({ value: v, label: `${v}×` }))} />
        <span className={s.setHint}>Stretches heights in the 3D view only – grades and lengths are always true.</span>
      </div>
      <div className={s.setRow}>
        <span className={s.setLabel}><Icon name="rings" size={18} />Contour interval</span>
        <Segmented<number> small value={ci} onChange={v => setS('Contour interval', { contourIntervalM: v })}
          options={[1, 2, 5, 10, 20].map(v => ({ value: v, label: `${v} m` }))} />
      </div>
      <div className={s.setRowInline}>
        <span className={s.setLabel} style={{ flex: 1 }}><Icon name="grade" size={18} />Colour strings by grade</span>
        <Toggle on={settings.showGradeColours} onChange={v => setS('Grade colours', { showGradeColours: v })} />
      </div>
      <div className={s.setRowInline}>
        <span className={s.setLabel} style={{ flex: 1 }}><Icon name="sliders" size={18} />Units</span>
        <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 500 }}>Metric · m · km/h · t · bcm</span>
      </div>
      <div style={{ height: 1, background: 'var(--hair-2)', margin: '6px 0' }} />
      <div className={s.setRow}>
        <span className={s.setLabel}><Icon name="spin" size={18} />Motion</span>
        <Segmented<MotionPref> small value={motion} onChange={v => ui().setMotion(v)}
          options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }, { value: 'full', label: 'Full' }]} />
      </div>
      <div className={s.setRowInline}>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className={s.setLabel}><Icon name="eye" size={18} />Keep controls visible</span>
          <span className={s.setHint} style={{ paddingLeft: 26 }}>Otherwise they fade during playback and rides after 2.5 s.</span>
        </span>
        <Toggle on={keepHud} onChange={v => ui().setKeepHud(v)} />
      </div>
    </>
  );
}

const THEME_ICON: Record<ThemePref, 'sun' | 'moon' | 'sliders'> = { light: 'sun', dark: 'moon', system: 'sliders' };

export function RightChrome() {
  const layers = useApp(st => st.layers);
  const toggleLayer = useApp(st => st.toggleLayer);
  const panels = useApp(st => st.panels);
  const togglePanel = useApp(st => st.togglePanel);
  const view = useApp(st => st.view);
  const hasAssets = useApp(st => st.scenario.assets.length > 0);
  const theme = useShellUi(st => st.theme);
  const settingsOpen = useShellUi(st => st.settingsOpen);
  const themeItems: MenuItem[] = (['light', 'dark', 'system'] as ThemePref[]).map(t => ({
    label: t === 'system' ? 'Match system' : t[0].toUpperCase() + t.slice(1), icon: THEME_ICON[t],
    hint: theme === t ? <Icon name="tick" size={16} style={{ color: 'var(--accent)' }} /> : undefined, onSelect: () => ui().setTheme(t),
  }));
  return (
    <div className={cx(s.topRight, s.fadeT)}>
      {view === 'site' && hasAssets && (
        <Chrome>
          <ChromeLabel>Show</ChromeLabel>
          {SHOW_LAYERS.map(l => (
            <Ctl key={l.id} icon={l.icon} on={!!layers[l.id]} onClick={() => toggleLayer(l.id)} tip={`${l.label} – ${l.hint}`}>
              <span className={s.showLabel}>{l.label}</span>
            </Ctl>
          ))}
        </Chrome>
      )}
      <Chrome>
        {view === 'site' && hasAssets && (
          <Ctl icon="panel" on={panels.inspector} onClick={() => togglePanel('inspector')} tip={panels.inspector ? 'Hide inspector' : 'Show inspector'} shortcut="]" />
        )}
        <Ctl icon="sparkle" on={panels.insights} accent={!panels.insights} onClick={() => togglePanel('insights')} tip="Insights – AI review of this scenario" shortcut="I" />
        <ChromeSep />
        <MenuButton items={themeItems} align="right">
          {(open, t) => <Ctl icon={THEME_ICON[theme]} on={open} onClick={t} tip="Theme" aria-haspopup="menu" />}
        </MenuButton>
        <Popover open={settingsOpen} onClose={() => ui().set({ settingsOpen: false })} title="Settings"
          footer="Scene settings are saved with the scenario; motion and controls are saved for you on this computer."
          anchor={<Ctl icon="gear" on={settingsOpen} onClick={() => ui().set({ settingsOpen: !settingsOpen })} tip="Settings" />}>
          <SettingsPanel />
        </Popover>
        <Ctl icon="help" onClick={() => ui().set({ shortcutsOpen: true })} tip="Help &amp; keyboard shortcuts" shortcut="?" />
      </Chrome>
    </div>
  );
}
