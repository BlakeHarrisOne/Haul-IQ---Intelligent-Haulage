/**
 * OWNER: scene core. Imperative scene API for the rest of the app (camera moves, screenshots, tests).
 * Works against the mounted Viewport; calls made before it mounts are no-ops (or resolve once ready where noted).
 */
import type { Vec3 } from '@/core/types';
import { useApp, type CameraMode } from '@/state/store';
import type { SceneContext } from './context';
import type { SceneCore, SceneStats } from './core/SceneCore';

let core: SceneCore | null = null;
const waiters: ((c: SceneCore) => void)[] = [];

/** @internal Viewport registers its core here. */
export function _attachCore(c: SceneCore) {
  core = c;
  c.readyPromise.then(() => { if (core === c) for (const w of waiters.splice(0)) w(c); });
}
/** @internal */
export function _detachCore(c: SceneCore) { if (core === c) core = null; }

function bboxOfPoints(pts: { e: number; n: number; z: number }[]): { min: Vec3; max: Vec3 } | null {
  if (!pts.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    min[0] = Math.min(min[0], p.e); min[1] = Math.min(min[1], p.n); min[2] = Math.min(min[2], p.z);
    max[0] = Math.max(max[0], p.e); max[1] = Math.max(max[1], p.n); max[2] = Math.max(max[2], p.z);
  }
  return { min, max };
}

export const sceneApi = {
  /** True once the viewport has built the scenario's terrain and rendered. */
  get ready(): boolean { return !!core?.ready; },
  /** Resolves when a viewport is mounted and ready. */
  whenReady(): Promise<void> {
    if (core?.ready) return Promise.resolve();
    return new Promise(res => waiters.push(() => res()));
  },
  /** Frame the whole site (animated). */
  fitAll(): void { core?.fitAll(); },
  /** Frame one asset (surface or solid) by id. */
  focusAsset(id: string): void {
    const a = useApp.getState().scenario.assets.find(x => x.id === id);
    if (a && core) core.focusBox(a.stats.bbox.min, a.stats.bbox.max);
  },
  /** Frame one haul string by id. */
  focusString(id: string): void {
    const s = useApp.getState().scenario.strings.find(x => x.id === id);
    const b = s && bboxOfPoints(s.points);
    if (b && core) core.focusBox(b.min, b.max, 0.15);
  },
  /** Fly to a camera mode (also updates the store so the UI stays in sync). */
  setCameraMode(mode: CameraMode, povCircuitId?: string): void { useApp.getState().setCamera(mode, povCircuitId); },
  /** Face north keeping the tilt. */
  faceNorth(): void { core?.rig.faceNorth(); core?.requestRender(); },
  /** PNG (default) data URL of the current view, optionally resized (e.g. { width: 480 } for thumbnails). */
  async screenshot(opts?: { width?: number; height?: number; type?: string; quality?: number }): Promise<string> {
    if (!core) throw new Error('No viewport mounted');
    return core.screenshot(opts);
  },
  /** The live SceneContext (tests, debugging). */
  getContext(): SceneContext | null { return core?.ctx ?? null; },
  /** Force every dig/dump solid to a depletion fraction (null = follow the timeline). For thumbnails/tests. */
  setDepletionOverride(f: number | null): void { core?.setDepletionOverride(f); },
  stats(): SceneStats | null { return core ? { ...core.stats } : null; },
  /** Ask for a redraw (e.g. after external DOM changes). */
  requestRender(): void { core?.requestRender(true); },
};

export type SceneApi = typeof sceneApi;
