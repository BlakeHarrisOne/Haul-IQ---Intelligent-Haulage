/**
 * Day / night for the scene modules (headlights, lamp glows, reflectors): read from the scene core's clock-driven
 * environment when it publishes one on the context (`SceneEnv`: night 0..1, headlights), never from the UI theme.
 * Until the core does, the same shift-clock sun is estimated here (Bowen Basin, November: up ≈ 05:34 – 18:26).
 */
import type { SceneContext } from '../context';
import { useApp } from '@/state/store';

/** The fields of the core's SceneEnv the modules use. */
export interface EnvLike { night: number; headlights?: boolean; lightDir?: [number, number, number] }

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The core's environment if it has one (accepts a getter or a plain object under the names it may use). */
export function coreEnv(ctx: SceneContext): EnvLike | null {
  const c = ctx as unknown as Record<string, unknown>;
  for (const k of ['env', 'environment', 'sceneEnv']) {
    let v = c[k];
    if (typeof v === 'function') { try { v = (v as () => unknown).call(ctx); } catch { v = undefined; } }
    if (v && typeof v === 'object' && typeof (v as EnvLike).night === 'number') return v as EnvLike;
  }
  return null;
}

/** Sun elevation (deg) for a clock hour at −23° latitude with a −15° declination (matches the core's model). */
export function sunElevationDeg(hour: number): number {
  const D2R = Math.PI / 180, LAT = -23 * D2R, DEC = -15 * D2R;
  const H = ((((hour % 24) + 24) % 24) - 12) * 15 * D2R;
  const up = Math.sin(DEC) * Math.sin(LAT) + Math.cos(DEC) * Math.cos(H) * Math.cos(LAT);
  return Math.asin(Math.max(-1, Math.min(1, up))) / D2R;
}

/** 0 = day … 1 = night, from the core's environment (or the shift clock until it has one). */
export function nightOf(ctx: SceneContext): number {
  const e = coreEnv(ctx);
  if (e) return clamp01(e.night);
  const s = useApp.getState();
  const hour = s.scenario.shift.startHour + s.timeline.tMin / 60;
  return 1 - smooth(-7, 4, sunElevationDeg(hour));
}

/** Vehicles run their headlights (the core's flag, else night > 0.4). */
export function headlightsOn(ctx: SceneContext): boolean {
  const e = coreEnv(ctx);
  if (e && typeof e.headlights === 'boolean') return e.headlights;
  return nightOf(ctx) > 0.4;
}
