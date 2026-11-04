/** Guarded access to '@/scene/api' (the file may not exist yet): fit, screenshot, … degrade gracefully. */
export interface SceneApiLike {
  fit?: (target?: unknown) => void;
  fitAll?: () => void;
  zoomToFit?: () => void;
  screenshot?: (opts?: { width?: number; height?: number }) => unknown;
  [k: string]: unknown;
}
const sceneMods = import.meta.glob<{ sceneApi?: SceneApiLike }>('/src/scene/api.ts', { eager: true });
export const sceneApi = (): SceneApiLike | undefined => Object.values(sceneMods)[0]?.sceneApi;

export function sceneFit(): boolean {
  const api = sceneApi();
  const f = api?.fit ?? api?.fitAll ?? api?.zoomToFit;
  if (typeof f === 'function') { try { f.call(api); return true; } catch (e) { console.warn('[shell] fit failed', e); } }
  return false;
}
