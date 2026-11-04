/**
 * Scenario library state + document actions shared by the Shell (menu, palette, keys, welcome) and ScenariosView.
 * Only this module talks to IndexedDB on behalf of the UI.
 */
import { create } from 'zustand';
import type { Scenario } from '@/core/types';
import { nowIso, uid } from '@/core/ids';
import { app, emptyScenario } from '@/state/store';
import {
  clearRecovery, deleteScenario, duplicateScenario, getRecovery, idbAvailable, listScenarios, loadScenario, putRecovery,
  renameScenario, saveScenario, type LibraryMeta, type RecoverySlot,
} from './db';
import { makeThumbnail } from './thumbnail';
import { parseScenarioFile, scenarioFileName, serializeScenario } from './serialize';

/** Compare picks - read by the Compare view (analytics agent). */
export const useScenarioPicks = create<{ ids: string[]; toggle: (id: string) => void; clear: () => void }>()(set => ({
  ids: [],
  toggle: id => set(st => ({ ids: st.ids.includes(id) ? st.ids.filter(x => x !== id) : [...st.ids, id] })),
  clear: () => set({ ids: [] }),
}));

interface LibraryState {
  items: LibraryMeta[];
  loaded: boolean;
  error?: string;
  /** When the open document was last written to the library (for the "Saved 2 min ago" readout). */
  savedRef?: { id: string; at: string };
  recovery?: RecoverySlot;
  busy: boolean;
  refresh: () => Promise<void>;
}

export const useLibrary = create<LibraryState>()(set => ({
  items: [],
  loaded: false,
  busy: false,
  refresh: async () => {
    if (!idbAvailable()) { set({ loaded: true, error: 'This browser has no IndexedDB – export scenarios to files instead.' }); return; }
    try { set({ items: await listScenarios(), loaded: true, error: undefined }); }
    catch (e) { set({ loaded: true, error: (e as Error).message }); }
  },
}));

const lib = () => useLibrary.getState();

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export { download as downloadText };

/** Save the open document to the library (Ctrl/⌘ + S). */
export async function saveCurrent(opts: { asNew?: { name: string } } = {}): Promise<LibraryMeta | undefined> {
  const st = app();
  let s: Scenario = st.scenario;
  if (opts.asNew) {
    const t = nowIso();
    s = { ...s, id: uid('scn'), name: opts.asNew.name, createdAt: t, updatedAt: t };
    st.replaceScenario(s, { markClean: true });
  }
  useLibrary.setState({ busy: true });
  try {
    const thumbnail = await makeThumbnail(s, { preferScene: st.view === 'site' });
    const meta = await saveScenario(s, { thumbnail });
    // only mark clean if nothing changed while we were writing
    if (app().scenario === s) app().markSaved();
    useLibrary.setState({ savedRef: { id: s.id, at: meta.savedAt ?? nowIso() }, recovery: undefined });
    clearRecovery().catch(() => undefined);
    await lib().refresh();
    app().toast('ok', opts.asNew ? `Saved as “${s.name}”` : `Saved “${s.name}”`);
    return meta;
  } catch (e) {
    app().toast('error', `Could not save: ${(e as Error).message}`);
    return undefined;
  } finally {
    useLibrary.setState({ busy: false });
  }
}

export async function openScenario(id: string): Promise<boolean> {
  try {
    const s = await loadScenario(id);
    if (!s) { app().toast('error', 'That scenario is no longer in the library.'); return false; }
    app().replaceScenario(s, { markClean: true });
    const meta = lib().items.find(m => m.id === id);
    useLibrary.setState({ savedRef: { id, at: meta?.savedAt ?? s.updatedAt } });
    app().setView('site');
    app().toast('info', `Opened “${s.name}”`);
    return true;
  } catch (e) {
    app().toast('error', `Could not open: ${(e as Error).message}`);
    return false;
  }
}

export function newScenario() {
  app().replaceScenario(emptyScenario(), { markClean: true });
  useLibrary.setState({ savedRef: undefined });
  app().setView('site');
}

export async function removeScenario(id: string) {
  await deleteScenario(id);
  useScenarioPicks.setState(st => ({ ids: st.ids.filter(x => x !== id) }));
  await lib().refresh();
}

export async function renameInLibrary(id: string, name: string) {
  if (app().scenario.id === id) app().commit('Rename scenario', s => ({ ...s, name }));
  await renameScenario(id, name);
  await lib().refresh();
}

export async function duplicateInLibrary(id: string) {
  const m = await duplicateScenario(id);
  await lib().refresh();
  if (m) app().toast('ok', `Duplicated as “${m.name}”`);
}

// ── files ────────────────────────────────────────────────────────────────────────────────────────
export function exportScenarioFile(s: Scenario = app().scenario) {
  download(scenarioFileName(s), serializeScenario(s));
  app().toast('ok', `Exported ${scenarioFileName(s)}`);
}

export async function exportLibraryScenario(id: string) {
  const s = await loadScenario(id);
  if (s) exportScenarioFile(s);
}

/** Read a .haiul.json file and open it (it is not written to the library until saved). */
export async function importScenarioFile(file: File): Promise<boolean> {
  try {
    const { scenario, warnings } = parseScenarioFile(await file.text());
    // keep ids unique in the library: an imported copy of a scenario that already exists gets a fresh id
    const clash = lib().items.some(m => m.id === scenario.id);
    const s = clash ? { ...scenario, id: uid('scn') } : scenario;
    app().replaceScenario(s, { markClean: false });
    useLibrary.setState({ savedRef: undefined });
    app().setView('site');
    app().toast('ok', `Opened ${file.name}${clash ? ' as a copy' : ''}`);
    for (const w of warnings) app().toast('warn', w);
    return true;
  } catch (e) {
    app().toast('error', `${file.name}: ${(e as Error).message}`);
    return false;
  }
}

// ── autosave recovery ────────────────────────────────────────────────────────────────────────────
let autosaveTimer: ReturnType<typeof setInterval> | undefined;

/** Every 30 s, write the open document to the recovery slot if it has unsaved changes. Returns a disposer. */
export function startAutosave(periodMs = 30_000): () => void {
  if (!idbAvailable()) return () => undefined;
  let lastWritten: Scenario | null = null;
  const tick = () => {
    const st = app();
    if (!st.dirty || st.scenario === lastWritten || (!st.scenario.assets.length && !st.scenario.strings.length)) return;
    lastWritten = st.scenario;
    putRecovery({ scenario: st.scenario, at: nowIso(), baseSavedAt: lib().savedRef?.at }).catch(e => console.warn('[scenarios] autosave failed', e));
  };
  autosaveTimer = setInterval(tick, periodMs);
  const onHide = () => { if (document.visibilityState === 'hidden') tick(); };
  document.addEventListener('visibilitychange', onHide);
  return () => { clearInterval(autosaveTimer); document.removeEventListener('visibilitychange', onHide); };
}

/** Look for unsaved work from a previous session (shown on the welcome card). */
export async function checkRecovery(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const slot = await getRecovery();
    if (!slot) return;
    const meta = lib().items.find(m => m.id === slot.scenario.id);
    if (meta?.savedAt && meta.savedAt >= slot.at) { await clearRecovery(); return; }
    useLibrary.setState({ recovery: slot });
  } catch { /* ignore */ }
}

export function restoreRecovery() {
  const slot = lib().recovery;
  if (!slot) return;
  app().replaceScenario(slot.scenario, { markClean: false });
  useLibrary.setState({ recovery: undefined, savedRef: undefined });
  app().toast('ok', `Recovered “${slot.scenario.name}” – save it to keep it`);
}
export async function discardRecovery() {
  useLibrary.setState({ recovery: undefined });
  await clearRecovery().catch(() => undefined);
}
