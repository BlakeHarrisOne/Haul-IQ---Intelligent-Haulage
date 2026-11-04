/** Shell-local UI state (not part of the document, not in the app store). Per-viewer prefs persist in localStorage. */
import { create } from 'zustand';
import type { ImportItem, StringsImport } from './importTypes';

export type ThemePref = 'light' | 'dark' | 'system';
export type MotionPref = 'system' | 'reduced' | 'full';

interface Prompt { title: string; sub?: string; value: string; okLabel: string; onSubmit: (v: string) => void }
interface Confirm { title: string; sub?: string; okLabel: string; danger?: boolean; onOk: () => void }

interface ShellUi {
  theme: ThemePref;
  motion: MotionPref;
  keepHud: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  dockTab: 'profile' | 'section';
  importItems: ImportItem[];
  importOpen: boolean;
  stringsImport?: StringsImport;
  dragging: boolean;
  demoLoading: boolean;
  prompt?: Prompt;
  confirm?: Confirm;
  set: (p: Partial<ShellUi>) => void;
  setTheme: (t: ThemePref) => void;
  setMotion: (m: MotionPref) => void;
  setKeepHud: (v: boolean) => void;
}

const LS = 'haiul-sim.ui';
function readPrefs(): Partial<Pick<ShellUi, 'theme' | 'motion' | 'keepHud'>> {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}') ?? {}; } catch { return {}; }
}
function writePrefs(p: Partial<Pick<ShellUi, 'theme' | 'motion' | 'keepHud'>>) {
  try { localStorage.setItem(LS, JSON.stringify({ ...readPrefs(), ...p })); } catch { /* private mode */ }
}
const prefs = readPrefs();

export const useShellUi = create<ShellUi>()(set => ({
  theme: prefs.theme ?? 'light',
  motion: prefs.motion ?? 'system',
  keepHud: prefs.keepHud ?? false,
  paletteOpen: false,
  shortcutsOpen: false,
  settingsOpen: false,
  dockTab: 'profile',
  importItems: [],
  importOpen: false,
  dragging: false,
  demoLoading: false,
  set: p => set(p),
  setTheme: theme => { writePrefs({ theme }); set({ theme }); },
  setMotion: motion => { writePrefs({ motion }); set({ motion }); },
  setKeepHud: keepHud => { writePrefs({ keepHud }); set({ keepHud }); },
}));

export const ui = () => useShellUi.getState();
