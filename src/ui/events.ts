/**
 * Shift-event visual language, shared by the timeline and the Assumptions shift profile so the same event always looks
 * the same. Events are stoppages: neutral tints (hatched where the fleet stops), rust only for blasting. Never the
 * accent (selection) or the circuit palette (identity).
 */
import type { ShiftEventKind } from '@/core/types';
import type { IconName } from './icons';

export interface EventStyle { label: string; icon: IconName; /** fill (CSS colour) */ fill: string; /** edge / icon ink */ ink: string; hatched: boolean }

export const EVENT_STYLE: Record<ShiftEventKind, EventStyle> = {
  prestart:   { label: 'Prestart',   icon: 'flagStart', fill: 'var(--na-50)',   ink: 'var(--ink-2)',   hatched: true },
  changeover: { label: 'Changeover', icon: 'swap',      fill: 'var(--na-50)',   ink: 'var(--ink-2)',   hatched: true },
  crib:       { label: 'Crib',       icon: 'crib',      fill: 'var(--warn-50)', ink: 'var(--warn-ink)', hatched: false },
  fuel:       { label: 'Fuel',       icon: 'fuel',      fill: 'var(--surface-3)', ink: 'var(--ink-2)', hatched: false },
  blast:      { label: 'Blast',      icon: 'blast',     fill: 'var(--bad-50)',  ink: 'var(--bad-ink)', hatched: true },
  other:      { label: 'Other',      icon: 'clock',     fill: 'var(--surface-3)', ink: 'var(--ink-2)', hatched: false },
};

/** CSS background for an event block: tint, plus 45° hatching when the event stops the fleet. */
export function eventBackground(kind: ShiftEventKind): string {
  const st = EVENT_STYLE[kind];
  return st.hatched
    ? `repeating-linear-gradient(135deg, ${st.fill} 0 5px, color-mix(in srgb, ${st.ink} 14%, ${st.fill}) 5px 7px)`
    : st.fill;
}
