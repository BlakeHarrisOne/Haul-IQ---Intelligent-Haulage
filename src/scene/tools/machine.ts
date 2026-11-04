/**
 * Pure state machines and readouts for the click-points tools (draw, measure, section, route) - no DOM, unit tested.
 */
import type { XYZ } from '../strings/path';

export interface ClickLine { pts: XYZ[]; done: boolean }

export type LineEvent =
  | { type: 'click'; p: XYZ }
  | { type: 'dblclick' }
  | { type: 'backspace' }
  | { type: 'enter' }
  | { type: 'escape' };

export type LineAction = 'finish' | 'cancel' | 'exit' | null;

/** Points closer than this (plan m) to the previous one are treated as the same click (double-click). */
export const SAME_POINT_M = 0.75;

/**
 * Draw / measure click-points line.
 * - click adds a point (a second click on the same spot is ignored), after `done` a click starts a new line
 * - double-click or Enter finishes when there are ≥ minPts points
 * - Backspace drops the last point
 * - Esc cancels the line in progress; Esc with nothing in progress asks to exit the tool
 */
export function lineReduce(s: ClickLine, ev: LineEvent, minPts = 2): { state: ClickLine; action: LineAction } {
  switch (ev.type) {
    case 'click': {
      if (s.done) return { state: { pts: [ev.p], done: false }, action: null };
      const last = s.pts[s.pts.length - 1];
      if (last && Math.hypot(ev.p.e - last.e, ev.p.n - last.n) < SAME_POINT_M) return { state: s, action: null };
      return { state: { pts: [...s.pts, ev.p], done: false }, action: null };
    }
    case 'dblclick':
    case 'enter':
      if (!s.done && s.pts.length >= minPts) return { state: { pts: s.pts, done: true }, action: 'finish' };
      return { state: s, action: null };
    case 'backspace':
      if (s.done || !s.pts.length) return { state: s, action: null };
      return { state: { pts: s.pts.slice(0, -1), done: false }, action: null };
    case 'escape':
      if (s.pts.length) return { state: { pts: [], done: false }, action: 'cancel' };
      return { state: s, action: 'exit' };
  }
}

/** Readout of the leg from `a` to `b` (rubber band): 3D and plan length, grade (dZ / plan, %), end RL. */
export function legReadout(a: XYZ, b: XYZ): { d3: number; plan: number; dz: number; grade: number; rl: number } {
  const plan = Math.hypot(b.e - a.e, b.n - a.n), dz = b.z - a.z;
  return { d3: Math.hypot(plan, dz), plan, dz, grade: plan > 1e-9 ? dz / plan : 0, rl: b.z };
}

/** Nearest candidate within `radius` (plan m) of p, else null. */
export function snapTo<T extends { e: number; n: number }>(p: { e: number; n: number }, cands: readonly T[], radius: number): T | null {
  let best: T | null = null, bd = radius;
  for (const c of cands) {
    const d = Math.hypot(c.e - p.e, c.n - p.n);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}

/** Next free "String N" name. */
export function nextName(existing: readonly string[], base = 'String'): string {
  let n = 1;
  const re = new RegExp(`^${base} (\\d+)$`);
  for (const s of existing) { const m = s.match(re); if (m) n = Math.max(n, +m[1] + 1); }
  n = Math.max(n, existing.length + 1);
  while (existing.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function fmtLen(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${m.toFixed(m < 10 ? 1 : 0)} m`;
}

export function fmtGrade(g: number): string {
  return `${g > 0.00049 ? '+' : g < -0.00049 ? '−' : ''}${(Math.abs(g) * 100).toFixed(1)} %`;
}
