/**
 * Minimal SVG chart toolkit shared by every chart in the app (truck curves, profiles, sections, compare, shift).
 * Keeps axes, gridlines, type and colours identical everywhere. Charts are plain React SVG - no chart library.
 */
import type { ReactNode } from 'react';

export interface Scale { (v: number): number; domain: [number, number]; range: [number, number]; ticks: (n?: number) => number[]; invert: (px: number) => number }

/** Linear scale with "nice" ticks. */
export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain, [r0, r1] = range;
  const k = (r1 - r0) / ((d1 - d0) || 1);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.domain = domain; f.range = range;
  f.invert = px => d0 + (px - r0) / k;
  f.ticks = (n = 5) => niceTicks(d0, d1, n);
  return f;
}

export function niceStep(span: number, n: number) {
  const raw = span / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const err = raw / mag;
  return (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
}
export function niceTicks(a: number, b: number, n = 5): number[] {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const st = niceStep(hi - lo, n);
  const out: number[] = [];
  for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + st * 1e-9; v += st) out.push(+v.toFixed(10));
  return out;
}
/** Expand [min,max] outward to nice step boundaries. */
export function niceDomain(min: number, max: number, n = 5): [number, number] {
  if (!(max > min)) { max = min + 1; }
  const st = niceStep(max - min, n);
  return [Math.floor(min / st) * st, Math.ceil(max / st) * st];
}

export const chartText = { fontSize: 11.5, fontWeight: 500, fill: 'var(--ink-3)', fontFamily: 'var(--font)', fontVariantNumeric: 'tabular-nums' } as const;

export function GridY({ y, x0, x1, fmt = String, n = 5, label }: { y: Scale; x0: number; x1: number; fmt?: (v: number) => string; n?: number; label?: string }) {
  return (
    <g>
      {y.ticks(n).map(t => (
        <g key={t}>
          <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke="var(--hair)" strokeWidth={1} shapeRendering="crispEdges" />
          <text x={x0 - 8} y={y(t)} dy="0.32em" textAnchor="end" style={chartText}>{fmt(t)}</text>
        </g>
      ))}
      {label && <text x={x0 - 8} y={Math.min(...y.range) - 10} textAnchor="end" style={{ ...chartText, fontWeight: 650 }}>{label}</text>}
    </g>
  );
}

export function AxisX({ x, y0, fmt = String, n = 6, label, x1 }: { x: Scale; y0: number; fmt?: (v: number) => string; n?: number; label?: string; x1?: number }) {
  return (
    <g>
      <line x1={x.range[0]} x2={x.range[1]} y1={y0} y2={y0} stroke="var(--ink-4)" strokeWidth={1} shapeRendering="crispEdges" />
      {x.ticks(n).map(t => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y0} y2={y0 + 4} stroke="var(--ink-4)" shapeRendering="crispEdges" />
          <text x={x(t)} y={y0 + 16} textAnchor="middle" style={chartText}>{fmt(t)}</text>
        </g>
      ))}
      {label && <text x={x1 ?? x.range[1]} y={y0 + 32} textAnchor="end" style={{ ...chartText, fontWeight: 650 }}>{label}</text>}
    </g>
  );
}

export function linePath(pts: [number, number][], x: Scale, y: Scale): string {
  let d = '';
  let pen = false;
  for (const [a, b] of pts) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function areaPath(pts: [number, number][], x: Scale, y: Scale, base: number): string {
  if (!pts.length) return '';
  return `${linePath(pts, x, y)}L${x(pts[pts.length - 1][0]).toFixed(1)},${y(base).toFixed(1)}L${x(pts[0][0]).toFixed(1)},${y(base).toFixed(1)}Z`;
}

/** Legend item row for charts. */
export function Legend({ items }: { items: { label: ReactNode; color: string; dash?: boolean }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12.5, color: 'var(--ink-2)' }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke={it.color} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={it.dash ? '3 3' : undefined} /></svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** Categorical colours for circuits, as CSS variables (theme-aware). */
export const CAT = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
/** Same, as literal light-theme hex for WebGL / canvas use. */
export const CAT_HEX = ['#0A6FE6', '#B8692E', '#3E8A5A', '#7B5EA7', '#1F8A8A', '#B5564C', '#A88A1E', '#5B6B7F'];

/** Grade → colour (road / string colouring), thresholds match geom gradeClass. */
export function gradeColor(g: number): string {
  const a = Math.abs(g);
  return a <= 0.04 ? 'var(--grade-flat)' : a <= 0.08 ? 'var(--grade-mod)' : a <= 0.10 ? 'var(--grade-steep)' : 'var(--grade-max)';
}
export const GRADE_HEX = { flat: '#3E8A5A', mod: '#1F8A8A', steep: '#B8692E', max: '#B5564C' };
