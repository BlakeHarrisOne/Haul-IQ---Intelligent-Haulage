/**
 * hAIul SIM application store.
 *
 * - `scenario` is an immutable document: every edit goes through `commit(label, fn)`, which produces a new
 *   object (structural sharing - meshes are never copied) and records undo history.
 * - Derived calculation results are NOT stored here; use the hooks in state/derived.ts (memoised by scenario identity).
 * - UI state (view, tool, selection, timeline, camera) lives beside the document and is not saved with it.
 */
import { create } from 'zustand';
import type { Circuit, HaulString, Id, MeshAsset, Scenario, StringPoint } from '@/core/types';
import { nowIso, uid } from '@/core/ids';

export type ViewId = 'site' | 'assumptions' | 'curves' | 'compare' | 'manning' | 'priority' | 'scenarios';

export type ToolId =
  | 'select'      // pick assets / strings / points
  | 'draw'        // digitise a new haul string (click to add snapped points, double-click / Enter to finish)
  | 'edit'        // drag / insert / delete points of the selected string
  | 'route'       // auto-route: click dig then dump, least-cost path over the surface
  | 'section'     // click A then B for a vertical cross-section
  | 'measure';    // click points for distance / grade

export type CameraMode = 'orbit' | 'plan' | 'pov' | 'chase';

export type Selection =
  | { kind: 'none' }
  | { kind: 'asset'; id: Id }
  | { kind: 'string'; id: Id; pointIndex?: number }
  | { kind: 'circuit'; id: Id }
  | { kind: 'truck'; circuitId: Id; truckIndex: number };

export interface SectionLine { a: [number, number]; b: [number, number]; widthM: number }

export interface Timeline {
  /** Minutes since shift start. */
  tMin: number;
  playing: boolean;
  /** Simulated minutes per real second. */
  speed: number;
}

export interface Toast { id: Id; kind: 'info' | 'ok' | 'warn' | 'error'; text: string; at: number }

interface HistoryEntry { label: string; scenario: Scenario }

export interface AppState {
  scenario: Scenario;
  /** Bumped on every commit - cheap change detection for the 3D scene. */
  revision: number;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean;
  lastSavedAt?: string;
  /** The scenario object last saved / opened clean; `dirty` = scenario !== cleanRef (undo back to it reads as saved). */
  cleanRef: Scenario | null;

  view: ViewId;
  tool: ToolId;
  camera: CameraMode;
  /** Circuit whose truck the POV / chase camera rides. */
  povCircuitId?: Id;
  selection: Selection;
  hover: Selection;
  section?: SectionLine;
  timeline: Timeline;
  /** Layer visibility toggles (keys: 'contours' | 'grade' | 'solids' | 'strings' | 'trucks' | 'labels' | 'sky' …). */
  layers: Record<string, boolean>;
  panels: { inspector: boolean; profile: boolean; insights: boolean };
  toasts: Toast[];

  // document edits
  commit: (label: string, fn: (s: Scenario) => Scenario) => void;
  replaceScenario: (s: Scenario, opts?: { markClean?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;

  // convenience edits (all go through commit)
  addAsset: (a: MeshAsset) => void;
  updateAsset: (id: Id, patch: Partial<MeshAsset>) => void;
  removeAsset: (id: Id) => void;
  addString: (s: HaulString) => void;
  updateString: (id: Id, patch: Partial<HaulString>) => void;
  setStringPoints: (id: Id, points: StringPoint[], label?: string) => void;
  removeString: (id: Id) => void;
  addCircuit: (c: Circuit) => void;
  updateCircuit: (id: Id, patch: Partial<Circuit>) => void;
  updateCircuitParams: (id: Id, patch: Partial<Circuit['params']>) => void;
  removeCircuit: (id: Id) => void;

  // UI
  setView: (v: ViewId) => void;
  setTool: (t: ToolId) => void;
  setCamera: (c: CameraMode, povCircuitId?: Id) => void;
  select: (s: Selection) => void;
  setHover: (s: Selection) => void;
  setSection: (s?: SectionLine) => void;
  setTimeline: (patch: Partial<Timeline>) => void;
  toggleLayer: (k: string, on?: boolean) => void;
  togglePanel: (k: keyof AppState['panels'], on?: boolean) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: Id) => void;
}

const HISTORY_CAP = 120;

const touch = (s: Scenario): Scenario => ({ ...s, updatedAt: nowIso() });
const mapById = <T extends { id: Id }>(arr: T[], id: Id, f: (x: T) => T) => arr.map(x => (x.id === id ? f(x) : x));

export function emptyScenario(name = 'Untitled scenario'): Scenario {
  const t = nowIso();
  return {
    schema: 'haiul-sim/scenario@1',
    id: uid('scn'),
    name,
    createdAt: t,
    updatedAt: t,
    site: { name: 'Site', origin: [0, 0, 0], crs: 'GDA2020 / MGA zone 56' },
    assets: [],
    strings: [],
    circuits: [],
    materials: [],
    fleet: { trucks: [], loaders: [], units: [], loaderAssumptions: [], trucksAvailable: 12 },
    crew: { rules: [], shifts: [], activeShiftId: '' },
    shift: { name: 'Day shift', startHour: 6, lengthH: 12, events: [] },
    settings: { verticalExaggeration: 1, contourIntervalM: 5, theme: 'light', showGradeColours: true },
  };
}

export const useApp = create<AppState>()((set, get) => ({
  scenario: emptyScenario(),
  revision: 0,
  past: [],
  future: [],
  dirty: false,
  cleanRef: null,

  view: 'site',
  tool: 'select',
  camera: 'orbit',
  selection: { kind: 'none' },
  hover: { kind: 'none' },
  timeline: { tMin: 0, playing: false, speed: 12 },
  layers: { contours: true, grade: true, solids: true, strings: true, trucks: true, labels: true, sky: true, topo: true },
  panels: { inspector: true, profile: true, insights: false },
  toasts: [],

  commit: (label, fn) => {
    const prev = get().scenario;
    const changed = fn(prev);
    // No-op edits (fn returned the same object) must not wipe redo history or mark the document dirty.
    if (changed === prev) return;
    const next = touch(changed);
    set(st => ({
      scenario: next,
      revision: st.revision + 1,
      past: [...st.past, { label, scenario: prev }].slice(-HISTORY_CAP),
      future: [],
      dirty: next !== st.cleanRef,
    }));
  },
  replaceScenario: (s, opts) =>
    set(st => ({
      scenario: s,
      revision: st.revision + 1,
      past: [],
      future: [],
      dirty: !opts?.markClean,
      cleanRef: opts?.markClean ? s : null,
      selection: { kind: 'none' },
      hover: { kind: 'none' },
      timeline: { ...st.timeline, tMin: 0, playing: false },
    })),
  undo: () => {
    const { past, scenario, future } = get();
    const last = past[past.length - 1];
    if (!last) return;
    set(st => ({ scenario: last.scenario, past: past.slice(0, -1), future: [{ label: last.label, scenario }, ...future], revision: st.revision + 1, dirty: last.scenario !== st.cleanRef }));
    get().toast('info', `Undid: ${last.label}`);
  },
  redo: () => {
    const { past, scenario, future } = get();
    const nxt = future[0];
    if (!nxt) return;
    set(st => ({ scenario: nxt.scenario, past: [...past, { label: nxt.label, scenario }], future: future.slice(1), revision: st.revision + 1, dirty: nxt.scenario !== st.cleanRef }));
    get().toast('info', `Redid: ${nxt.label}`);
  },
  markSaved: () => set(st => ({ dirty: false, lastSavedAt: nowIso(), cleanRef: st.scenario })),

  addAsset: a => get().commit(`Import ${a.name}`, s => ({ ...s, assets: [...s.assets, a] })),
  updateAsset: (id, patch) => get().commit('Edit surface', s => ({ ...s, assets: mapById(s.assets, id, a => ({ ...a, ...patch })) })),
  removeAsset: id => get().commit('Remove surface', s => ({ ...s, assets: s.assets.filter(a => a.id !== id) })),
  addString: hs => get().commit(`Add string ${hs.name}`, s => ({ ...s, strings: [...s.strings, hs] })),
  updateString: (id, patch) =>
    get().commit('Edit string', s => ({ ...s, strings: mapById(s.strings, id, x => ({ ...x, ...patch, updatedAt: nowIso() })) })),
  setStringPoints: (id, points, label = 'Edit points') =>
    get().commit(label, s => ({ ...s, strings: mapById(s.strings, id, x => ({ ...x, points, updatedAt: nowIso() })) })),
  removeString: id =>
    get().commit('Delete string', s => ({
      ...s,
      strings: s.strings.filter(x => x.id !== id),
      circuits: s.circuits.map(c => (c.haulStringId === id ? { ...c, haulStringId: undefined } : c)),
    })),
  addCircuit: c => get().commit(`Add circuit ${c.name}`, s => ({ ...s, circuits: [...s.circuits, c] })),
  updateCircuit: (id, patch) => get().commit('Edit circuit', s => ({ ...s, circuits: mapById(s.circuits, id, c => ({ ...c, ...patch })) })),
  updateCircuitParams: (id, patch) =>
    get().commit('Edit assumptions', s => ({ ...s, circuits: mapById(s.circuits, id, c => ({ ...c, params: { ...c.params, ...patch } })) })),
  removeCircuit: id => get().commit('Delete circuit', s => ({ ...s, circuits: s.circuits.filter(c => c.id !== id) })),

  setView: view => set({ view }),
  setTool: tool => set({ tool }),
  setCamera: (camera, povCircuitId) => set(st => ({ camera, povCircuitId: povCircuitId ?? st.povCircuitId })),
  select: selection => set({ selection }),
  setHover: hover => set({ hover }),
  setSection: section => set({ section }),
  setTimeline: patch => set(st => ({ timeline: { ...st.timeline, ...patch } })),
  toggleLayer: (k, on) => set(st => ({ layers: { ...st.layers, [k]: on ?? !st.layers[k] } })),
  togglePanel: (k, on) => set(st => ({ panels: { ...st.panels, [k]: on ?? !st.panels[k] } })),
  toast: (kind, text) => {
    const t: Toast = { id: uid('t'), kind, text, at: Date.now() };
    set(st => ({ toasts: [...st.toasts.slice(-3), t] }));
    setTimeout(() => get().dismissToast(t.id), kind === 'error' ? 7000 : 3800);
  },
  dismissToast: id => set(st => ({ toasts: st.toasts.filter(t => t.id !== id) })),
}));

/** Non-React access (scene code, keyboard handlers). */
export const app = () => useApp.getState();
