/** Command registry (palette) + the global keyboard map. One source of truth for actions and their keys. */
import { useEffect } from 'react';
import { app, type AppState } from '@/state/store';
import { openScenario, useLibrary } from '@/features/scenarios';
import type { IconName } from '@/ui';
import { CAMERAS, MOD, SHOW_LAYERS, SPEEDS, TOOLS, VIEWS } from './defs';
import {
  cmdExportScenario, cmdExportStrings, cmdLoadDemo, cmdNew, cmdRename, cmdReport, cmdSave, cmdSaveAs, cmdStep, cmdTogglePlay,
} from './actions';
import { pickMeshes, pickScenarioFile, pickStrings } from './importer';
import { sceneFit } from './sceneBridge';
import { ui } from './uiStore';
import { isTyping } from './hooks';

export interface Command {
  id: string;
  title: string;
  group: string;
  icon?: IconName;
  shortcut?: string;
  keywords?: string[];
  /** Colour dot (circuits / strings). */
  color?: string;
  run: () => void;
  disabled?: boolean;
}

export function setCameraMode(mode: AppState['camera']) {
  const st = app();
  if (mode === 'pov' || mode === 'chase') {
    const sel = st.selection;
    const fromSel = sel.kind === 'circuit' ? sel.id : sel.kind === 'truck' ? sel.circuitId : undefined;
    const id = fromSel ?? st.povCircuitId ?? st.scenario.circuits.find(c => c.active)?.id;
    if (!id) { st.toast('info', 'Add a circuit to ride along with its trucks.'); return; }
    st.setCamera(mode, id);
    if (!st.timeline.playing) st.toast('info', 'Press Space to start the shift and ride along');
    return;
  }
  st.setCamera(mode);
}

export function buildCommands(): Command[] {
  const st = app();
  const s = st.scenario;
  const out: Command[] = [];
  for (const v of VIEWS) out.push({ id: `view.${v.id}`, title: `Go to ${v.label}`, group: 'Navigate', icon: v.icon, shortcut: v.key, keywords: [v.short, 'view', 'page'], run: () => st.setView(v.id) });
  for (const t of TOOLS) out.push({ id: `tool.${t.id}`, title: t.label, group: 'Tools', icon: t.icon, shortcut: t.key, keywords: ['tool', t.hint], run: () => { st.setView('site'); st.setTool(t.id); } });
  for (const c of CAMERAS) out.push({ id: `cam.${c.id}`, title: `Camera: ${c.label}`, group: 'Camera', icon: c.icon, shortcut: c.key, keywords: [c.hint, 'view'], run: () => { st.setView('site'); setCameraMode(c.id); } });
  out.push({ id: 'cam.fit', title: 'Fit the site in view', group: 'Camera', icon: 'fit', shortcut: 'F', keywords: ['zoom', 'extents', 'home'], run: () => { st.setView('site'); sceneFit(); } });

  out.push({ id: 'time.play', title: st.timeline.playing ? 'Pause the shift' : 'Play the shift', group: 'Shift', icon: st.timeline.playing ? 'pause' : 'play', shortcut: 'Space', keywords: ['timeline', 'animate', 'simulate'], run: cmdTogglePlay });
  out.push({ id: 'time.start', title: 'Jump to shift start', group: 'Shift', icon: 'skipBack', shortcut: 'Home', run: () => st.setTimeline({ tMin: 0 }) });
  out.push({ id: 'time.end', title: 'Jump to shift end', group: 'Shift', icon: 'skipFwd', shortcut: 'End', run: () => st.setTimeline({ tMin: s.shift.lengthH * 60, playing: false }) });
  for (const sp of SPEEDS) out.push({ id: `time.speed.${sp}`, title: `Playback speed ×${sp}`, group: 'Shift', icon: 'speed', keywords: [`${sp} minutes per second`], run: () => st.setTimeline({ speed: sp }) });
  for (const e of s.shift.events) out.push({ id: `time.ev.${e.id}`, title: `Jump to ${e.label}`, group: 'Shift', icon: e.kind === 'crib' ? 'crib' : e.kind === 'fuel' ? 'fuel' : e.kind === 'changeover' ? 'swap' : e.kind === 'blast' ? 'blast' : 'clock', keywords: [e.kind], run: () => st.setTimeline({ tMin: e.startMin }) });

  for (const l of SHOW_LAYERS) out.push({ id: `layer.${l.id}`, title: `${st.layers[l.id] ? 'Hide' : 'Show'} ${l.label.toLowerCase()}`, group: 'Show', icon: l.icon, keywords: ['layer', 'toggle', l.hint], run: () => st.toggleLayer(l.id) });
  out.push({ id: 'panel.inspector', title: `${st.panels.inspector ? 'Hide' : 'Show'} the inspector`, group: 'Panels', icon: 'panel', shortcut: ']', run: () => st.togglePanel('inspector') });
  out.push({ id: 'panel.profile', title: `${st.panels.profile ? 'Hide' : 'Show'} the profile / section panel`, group: 'Panels', icon: 'panelBottom', run: () => st.togglePanel('profile') });
  out.push({ id: 'panel.insights', title: `${st.panels.insights ? 'Hide' : 'Show'} Insights`, group: 'Panels', icon: 'sparkle', shortcut: 'I', keywords: ['ai', 'advice', 'review', 'suggestions'], run: () => st.togglePanel('insights') });

  out.push({ id: 'file.demo', title: 'Open the demo site', group: 'File', icon: 'sparkle', keywords: ['example', 'sample', 'tutorial'], run: () => { void cmdLoadDemo(); } });
  out.push({ id: 'file.new', title: 'New scenario', group: 'File', icon: 'plus', run: cmdNew });
  out.push({ id: 'file.open', title: 'Open a saved scenario…', group: 'File', icon: 'folder', shortcut: `${MOD}O`, keywords: ['library'], run: () => st.setView('scenarios') });
  out.push({ id: 'file.save', title: 'Save', group: 'File', icon: 'save', shortcut: `${MOD}S`, run: cmdSave });
  out.push({ id: 'file.saveas', title: 'Save as…', group: 'File', icon: 'copy', shortcut: `${MOD}⇧S`, keywords: ['duplicate', 'copy'], run: cmdSaveAs });
  out.push({ id: 'file.rename', title: 'Rename scenario…', group: 'File', icon: 'edit', run: cmdRename });
  out.push({ id: 'file.import00t', title: 'Import surfaces / solids (.00t)…', group: 'File', icon: 'upload', shortcut: `${MOD}I`, keywords: ['vulcan', 'triangulation', 'topo', 'dig', 'dump'], run: pickMeshes });
  out.push({ id: 'file.importstr', title: 'Import strings (.str .csv .txt)…', group: 'File', icon: 'string', keywords: ['haul road', 'polyline'], run: pickStrings });
  out.push({ id: 'file.importscn', title: 'Open a scenario file (.haiul.json)…', group: 'File', icon: 'file', run: pickScenarioFile });
  out.push({ id: 'file.export', title: 'Export scenario (.haiul.json)', group: 'File', icon: 'download', shortcut: `${MOD}E`, keywords: ['share', 'download'], run: cmdExportScenario });
  out.push({ id: 'file.csv', title: 'Export strings as CSV', group: 'File', icon: 'table', run: () => cmdExportStrings('csv') });
  out.push({ id: 'file.dxf', title: 'Export strings as DXF', group: 'File', icon: 'download', keywords: ['autocad', 'vulcan', 'deswik'], run: () => cmdExportStrings('dxf') });
  out.push({ id: 'file.report', title: 'Print a summary report', group: 'File', icon: 'report', keywords: ['pdf', 'print'], run: cmdReport });

  const lastUndo = st.past[st.past.length - 1], nextRedo = st.future[0];
  out.push({ id: 'edit.undo', title: lastUndo ? `Undo ${lastUndo.label}` : 'Undo', group: 'Edit', icon: 'undo', shortcut: `${MOD}Z`, disabled: !lastUndo, run: () => st.undo() });
  out.push({ id: 'edit.redo', title: nextRedo ? `Redo ${nextRedo.label}` : 'Redo', group: 'Edit', icon: 'redo', shortcut: `${MOD}⇧Z`, disabled: !nextRedo, run: () => st.redo() });

  out.push({ id: 'app.theme.light', title: 'Theme: Light', group: 'Appearance', icon: 'sun', run: () => ui().setTheme('light') });
  out.push({ id: 'app.theme.dark', title: 'Theme: Dark', group: 'Appearance', icon: 'moon', run: () => ui().setTheme('dark') });
  out.push({ id: 'app.theme.system', title: 'Theme: Match system', group: 'Appearance', icon: 'sliders', run: () => ui().setTheme('system') });
  out.push({ id: 'app.settings', title: 'Settings', group: 'Appearance', icon: 'gear', keywords: ['vertical exaggeration', 'contour interval', 'units', 'preferences'], run: () => ui().set({ settingsOpen: true }) });
  out.push({ id: 'app.keys', title: 'Keyboard shortcuts', group: 'Help', icon: 'keyboard', shortcut: '?', run: () => ui().set({ shortcutsOpen: true }) });

  for (const c of s.circuits) {
    out.push({ id: `sel.c.${c.id}`, title: c.name, group: 'Circuits', icon: 'excavator', color: c.color, keywords: [c.loaderUnitId, c.materialId, 'circuit'], run: () => { st.setView('site'); st.select({ kind: 'circuit', id: c.id }); } });
    out.push({ id: `pov.c.${c.id}`, title: `Ride along · ${c.name}`, group: 'Circuits', icon: 'pov', color: c.color, keywords: ['pov', 'driver', 'cab', c.loaderUnitId], run: () => { st.setView('site'); st.setCamera('pov', c.id); if (!app().timeline.playing) cmdTogglePlay(); } });
  }
  for (const hs of s.strings) out.push({ id: `sel.s.${hs.id}`, title: hs.name, group: 'Haul strings', icon: 'string', color: hs.color, keywords: ['string', 'road', 'route'], run: () => { st.setView('site'); st.select({ kind: 'string', id: hs.id }); } });
  for (const a of s.assets) out.push({ id: `sel.a.${a.id}`, title: a.name, group: 'Surfaces & solids', icon: a.kind === 'solid' ? 'solid' : 'surface', color: a.color, keywords: [a.role, a.kind, a.fileName ?? ''], run: () => { st.setView('site'); st.select({ kind: 'asset', id: a.id }); } });
  for (const m of useLibrary.getState().items.slice(0, 12)) {
    if (m.id === s.id) continue;
    out.push({ id: `open.${m.id}`, title: `Open · ${m.name}`, group: 'Saved scenarios', icon: 'folder', keywords: [m.siteName ?? ''], run: () => { void openScenario(m.id); } });
  }
  return out;
}

/** Global keyboard map. Ignored while typing in a field, and for keys a focused control or the 3D scene consumed. */
export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = app();
      const u = ui();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      // palette and save work even inside fields
      if (mod && !e.altKey && k.toLowerCase() === 'k') { e.preventDefault(); u.set({ paletteOpen: !u.paletteOpen }); return; }
      if (mod && !e.altKey && k.toLowerCase() === 's') { e.preventDefault(); if (e.shiftKey) cmdSaveAs(); else cmdSave(); return; }
      if (isTyping(e)) return;
      if (u.paletteOpen || u.prompt || u.confirm || u.importOpen) return; // dialogs own the keyboard
      if (mod && !e.altKey) {
        const lk = k.toLowerCase();
        if (lk === 'z' && !e.shiftKey) { e.preventDefault(); st.undo(); return; }
        if ((lk === 'z' && e.shiftKey) || lk === 'y') { e.preventDefault(); st.redo(); return; }
        if (lk === 'o') { e.preventDefault(); st.setView('scenarios'); return; }
        if (lk === 'i') { e.preventDefault(); pickMeshes(); return; }
        if (lk === 'e') { e.preventDefault(); cmdExportScenario(); return; }
        return;
      }
      if (e.altKey) return;
      if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); u.set({ shortcutsOpen: !u.shortcutsOpen }); return; }
      if (k === 'Escape') {
        if (u.shortcutsOpen) { u.set({ shortcutsOpen: false }); return; }
        if (u.settingsOpen) { u.set({ settingsOpen: false }); return; }
        if (st.view !== 'site' && !document.querySelector('[role="menu"],[role="dialog"]')) { st.setView('site'); }
        return;
      }
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      const onButton = !!target?.closest('button, [role="button"], a, [role="tab"], [role="switch"], [role="checkbox"]');
      if (/^[1-7]$/.test(k)) { const v = VIEWS[Number(k) - 1]; if (v) { st.setView(v.id); e.preventDefault(); } return; }
      const sheetOpen = st.view !== 'site';
      if (k === ' ' || k === 'Spacebar') { if (onButton || sheetOpen) return; e.preventDefault(); cmdTogglePlay(); return; }
      if (sheetOpen) return; // the rest only make sense over the 3D view
      const up = k.toUpperCase();
      const tool = TOOLS.find(t => t.key === up);
      if (tool && !e.shiftKey) { st.setTool(tool.id); e.preventDefault(); return; }
      const cam = CAMERAS.find(c => c.key === up);
      if (cam && !e.shiftKey) { setCameraMode(cam.id); e.preventDefault(); return; }
      if (up === 'F' && !e.shiftKey) { sceneFit(); e.preventDefault(); return; }
      if (up === 'I' && !e.shiftKey) { st.togglePanel('insights'); e.preventDefault(); return; }
      if (k === ']') { st.togglePanel('inspector'); e.preventDefault(); return; }
      if (k === 'Home') { st.setTimeline({ tMin: 0 }); e.preventDefault(); return; }
      if (k === 'End') { st.setTimeline({ tMin: st.scenario.shift.lengthH * 60, playing: false }); e.preventDefault(); return; }
      if (k === ',' || k === '<') { cmdStep(e.shiftKey ? -30 : -5); e.preventDefault(); return; }
      if (k === '.' || k === '>') { cmdStep(e.shiftKey ? 30 : 5); e.preventDefault(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  { title: 'Views', items: VIEWS.map(v => ({ keys: [v.key], label: v.label })) },
  { title: 'Tools', items: TOOLS.map(t => ({ keys: [t.key], label: t.label })) },
  {
    title: 'Camera', items: [...CAMERAS.map(c => ({ keys: [c.key], label: c.label })), { keys: ['F'], label: 'Fit the site' }],
  },
  {
    title: 'Shift', items: [
      { keys: ['Space'], label: 'Play / pause' }, { keys: [',', '.'], label: 'Step 5 min (⇧ 30 min)' },
      { keys: ['Home'], label: 'Shift start' }, { keys: ['End'], label: 'Shift end' },
    ],
  },
  {
    title: 'File & edit', items: [
      { keys: [MOD, 'S'], label: 'Save' }, { keys: [MOD, '⇧', 'S'], label: 'Save as' }, { keys: [MOD, 'O'], label: 'Open' },
      { keys: [MOD, 'I'], label: 'Import .00t' }, { keys: [MOD, 'E'], label: 'Export .haiul.json' },
      { keys: [MOD, 'Z'], label: 'Undo' }, { keys: [MOD, '⇧', 'Z'], label: 'Redo' },
    ],
  },
  {
    title: 'App', items: [
      { keys: [MOD, 'K'], label: 'Command palette' }, { keys: ['I'], label: 'Insights' }, { keys: [']'], label: 'Inspector' },
      { keys: ['?'], label: 'This sheet' }, { keys: ['Esc'], label: 'Close / back to Site' },
    ],
  },
];
