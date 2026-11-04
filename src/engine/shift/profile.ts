/**
 * Shift profile helpers (spec 04 §D): productive minutes, clock text, active event, per-truck pause windows.
 */
import type { ShiftEvent, ShiftProfile } from '@/core/types';

/**
 * Fleet productive minutes = shift length − Σ event duration × fleetStopFraction.
 * @param profile shift profile
 */
export function productiveMinutes(profile: ShiftProfile): number {
  return profile.lengthH * 60 - profile.events.reduce((a, e) => a + clampDur(profile, e) * clamp01(e.fleetStopFraction), 0);
}

/** Productive minutes elapsed by tMin (piecewise linear, exact). */
export function productiveMinutesAt(profile: ShiftProfile, tMin: number): number {
  const t = Math.max(0, Math.min(tMin, profile.lengthH * 60));
  let lost = 0;
  for (const e of profile.events) {
    const a = e.startMin, b = e.startMin + e.durMin;
    const o = Math.max(0, Math.min(t, b) - Math.max(0, a));
    lost += o * clamp01(e.fleetStopFraction);
  }
  return t - lost;
}

/** Wall-clock text 'HH:MM' for minutes after shift start. */
export function clockAt(profile: ShiftProfile, tMin: number): string {
  const m = Math.round(profile.startHour * 60 + tMin);
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
}

/** The event in progress at tMin (the first one listed when they overlap). */
export function activeEventAt(profile: ShiftProfile, tMin: number): ShiftEvent | undefined {
  return profile.events.find(e => tMin >= e.startMin && tMin < e.startMin + e.durMin);
}

/**
 * Pause windows (s) of truck k of n for each event with fleetStopFraction f > 0:
 * every truck stops for f × duration, staggered evenly across the window (f = 1 → everyone, the whole window), so the
 * fleet-average stopped fraction over the window is exactly f.
 */
export function truckPauses(profile: ShiftProfile, k: number, n: number): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const e of profile.events) {
    const f = clamp01(e.fleetStopFraction);
    if (f <= 0 || e.durMin <= 0) continue;
    const dur = e.durMin * f;
    const off = n > 1 ? (k * (e.durMin - dur)) / (n - 1) : 0;
    const a = (e.startMin + off) * 60;
    out.push([a, a + dur * 60, e.label]);
  }
  return mergeWindows(out);
}

/** Loader down windows (s): events that stop the whole fleet (fleetStopFraction ≥ 0.999). */
export function loaderDownWindows(profile: ShiftProfile): [number, number, string][] {
  return mergeWindows(profile.events.filter(e => e.fleetStopFraction >= 0.999 && e.durMin > 0)
    .map(e => [e.startMin * 60, (e.startMin + e.durMin) * 60, e.label] as [number, number, string]));
}

/** Sort and merge overlapping windows (labels joined). */
export function mergeWindows(w: [number, number, string][]): [number, number, string][] {
  const s = [...w].filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out: [number, number, string][] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1] + 1e-9) { last[1] = Math.max(last[1], x[1]); if (!last[2].includes(x[2])) last[2] = `${last[2]} + ${x[2]}`; }
    else out.push([x[0], x[1], x[2]]);
  }
  return out;
}

/**
 * Advance an activity needing `dur` seconds of active time from t, skipping pause windows (sorted, merged).
 * @returns end time, s
 */
export function advance(t: number, dur: number, pauses: [number, number, string][]): number {
  let cur = t, rem = dur;
  for (const [a, b] of pauses) {
    if (b <= cur) continue;
    if (a >= cur + rem) break;
    if (a > cur) { rem -= a - cur; cur = a; }
    cur = Math.max(cur, b);
  }
  return cur + rem;
}

/** First time ≥ t outside every pause window. */
export function nextActive(t: number, pauses: [number, number, string][]): number {
  let cur = t;
  for (const [a, b] of pauses) if (a <= cur && cur < b) cur = b;
  return cur;
}

/** Active (unpaused) seconds between t0 and t1. */
export function activeBetween(t0: number, t1: number, pauses: [number, number, string][]): number {
  let act = Math.max(0, t1 - t0);
  for (const [a, b] of pauses) act -= Math.max(0, Math.min(b, t1) - Math.max(a, t0));
  return Math.max(0, act);
}

/** The pause window containing t, if any. */
export function pauseAt(t: number, pauses: [number, number, string][]): [number, number, string] | undefined {
  for (const w of pauses) if (w[0] <= t && t < w[1]) return w;
  return undefined;
}

function clampDur(p: ShiftProfile, e: ShiftEvent): number {
  const end = Math.min(p.lengthH * 60, e.startMin + e.durMin);
  return Math.max(0, end - Math.max(0, e.startMin));
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
