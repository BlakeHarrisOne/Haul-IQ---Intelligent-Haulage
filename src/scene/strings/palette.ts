/**
 * Colours and scenario lookups shared by the actors / strings / tools / cockpit modules.
 * Literal hex (WebGL / canvas cannot read CSS variables cheaply); mirrors src/styles/tokens.css and ui/chart.tsx.
 */
import type { Circuit, HaulString, Id, Scenario } from '@/core/types';
import { CAT_HEX, GRADE_HEX } from '@/ui/chart';
import { gradeClassOf } from './path';

export const ACCENT = '#0A6FE6';
export const ACCENT_GLOW = 'rgba(10,111,230,0.22)';
export const INK = '#1F2329';
export const STOP_RED = '#C8102E';

export function gradeHex(g: number): string {
  return GRADE_HEX[gradeClassOf(g)];
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith('var(')) h = '#5B6B7F';
  if (h.startsWith('rgb')) {
    const m = h.match(/[\d.]+/g);
    if (m && m.length >= 3) return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
  }
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const v = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(v)) return [0.36, 0.42, 0.5];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function rgbaOf(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/** Literal colour for a CSS colour that may be a var(--cN). */
export function literalColor(c: string | undefined, fallbackIndex = 0): string {
  if (!c) return CAT_HEX[fallbackIndex % CAT_HEX.length];
  const m = c.match(/var\(--c(\d)\)/);
  if (m) return CAT_HEX[(+m[1] - 1) % CAT_HEX.length];
  return c;
}

/** The circuit hauling on a string (primary route first). */
export function circuitOfString(s: Scenario, stringId: Id): Circuit | undefined {
  return s.circuits.find(c => c.haulStringId === stringId) ?? s.circuits.find(c => c.altHaulStringIds?.includes(stringId));
}

export function stringColor(s: Scenario, hs: HaulString, index: number): string {
  const c = circuitOfString(s, hs.id);
  return literalColor(c?.color ?? hs.color, index);
}

export function materialColor(s: Scenario, materialId: string | undefined): string {
  const m = s.materials.find(x => x.id === materialId);
  if (m?.color && !m.color.startsWith('var(')) return m.color;
  const id = (materialId ?? '').toUpperCase();
  if (id === 'CL' || id.includes('COAL')) return '#2E3238';
  if (id === 'IB') return '#9C8C7A';
  if (id === 'PT') return '#6B5A48';
  return '#B89270';
}

/** Short names for the string's ends: "EX09 · Dig", "S51 · Dump". */
export function endNames(s: Scenario, hs: HaulString): { start: [string, string]; end: [string, string] } {
  const c = circuitOfString(s, hs.id);
  const dig = s.assets.find(a => a.id === (hs.digId ?? c?.digId));
  const dump = s.assets.find(a => a.id === (hs.dumpId ?? c?.dumpId));
  const startName = c?.loaderUnitId ?? shortName(dig?.name) ?? hs.name;
  const endName = shortName(dump?.name) ?? (c ? c.name.split(/→|->/)[1]?.trim() : undefined) ?? hs.name;
  return { start: [startName, 'Dig'], end: [endName, 'Dump'] };
}

function shortName(n: string | undefined): string | undefined {
  if (!n) return undefined;
  return n.replace(/\.(00t|dxf|csv)$/i, '').slice(0, 22);
}
