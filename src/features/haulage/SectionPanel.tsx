/**
 * Vertical section A→B (store.section) through the topo surface and every visible solid. True scale by default
 * (metres square on both axes), or exaggerated to fill the panel. Strings crossing the plane are marked.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HaulString, MeshAsset } from '@/core/types';
import { useApp } from '@/state/store';
import { Ctl, Icon, Segmented, chartText, cx } from '@/ui';
import { num } from '@/core/format';
import { sectionScales } from './model';
import type { SectionPath } from '@/geom';
import { sectionCut } from './geo';
import s from './haulage.module.css';

interface Cut { asset: MeshAsset; paths: SectionPath[] }
interface Crossing { hs: HaulString; s: number; z: number }

export function SectionPanel({ className }: { className?: string }) {
  const section = useApp(st => st.section);
  const assets = useApp(st => st.scenario.assets);
  const strings = useApp(st => st.scenario.strings);
  const setSection = useApp(st => st.setSection);
  const [trueScale, setTrueScale] = useState(() => { try { return localStorage.getItem('haulage.secTrue') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('haulage.secTrue', trueScale ? '1' : '0'); } catch { /* ignore */ } }, [trueScale]);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!section]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mx, setMx] = useState<number | null>(null);

  const a = section?.a, b = section?.b;
  const L = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
  const cuts = useMemo<Cut[]>(() => {
    if (!a || !b || !(L > 0)) return [];
    return assets.filter(x => x.visible || x.role === 'topo').map(asset => ({ asset, paths: sectionCut(asset.mesh, a, b).paths })).filter(c => c.paths.length);
  }, [assets, a?.[0], a?.[1], b?.[0], b?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const crossings = useMemo<Crossing[]>(() => {
    if (!a || !b || !(L > 0)) return [];
    const out: Crossing[] = [];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const hs of strings) {
      if (!hs.visible) continue;
      for (let i = 0; i + 1 < hs.points.length; i++) {
        const p = hs.points[i], q = hs.points[i + 1];
        const ex = q.e - p.e, ey = q.n - p.n;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p.e - a[0]) * ey - (p.n - a[1]) * ex) / den;
        const u = ((p.e - a[0]) * dy - (p.n - a[1]) * dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ hs, s: t * L, z: p.z + (q.z - p.z) * u });
      }
    }
    return out;
  }, [strings, a?.[0], a?.[1], b?.[0], b?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!section || !a || !b) return null;

  const topo = cuts.find(c => c.asset.role === 'topo' && c.asset.kind === 'surface');
  let zMin = Infinity, zMax = -Infinity;
  for (const c of cuts) for (const p of c.paths) for (const [, z] of p.points) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
  for (const c of crossings) { zMin = Math.min(zMin, c.z); zMax = Math.max(zMax, c.z); }
  if (!Number.isFinite(zMin)) { zMin = 0; zMax = 10; }

  const { w: W, h: H } = size;
  const box = { left: 56, right: Math.max(70, W - 18), top: 22, bottom: Math.max(40, H - 24) };
  const sc = sectionScales(0, L, zMin, zMax, box, trueScale, 0.1);
  const { x, y } = sc;
  const az = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  const pathD = (pts: [number, number][], close: boolean) => pts.map(([ss, z], k) => `${k ? 'L' : 'M'}${x(ss).toFixed(1)},${y(z).toFixed(1)}`).join('') + (close ? 'Z' : '');

  // readout at the cursor distance
  const sAt = mx != null ? Math.max(0, Math.min(L, x.invert(mx))) : null;
  const surfAt = (ss: number): number | null => {
    if (!topo) return null;
    for (const p of topo.paths) {
      if (p.closed) continue;
      for (let k = 1; k < p.points.length; k++) {
        const [s0, z0] = p.points[k - 1], [s1, z1] = p.points[k];
        if ((ss - s0) * (ss - s1) <= 0 && s1 !== s0) return z0 + (z1 - z0) * ((ss - s0) / (s1 - s0));
      }
    }
    return null;
  };
  const solidsAt = (ss: number) => {
    const out: { asset: MeshAsset; top: number; bottom: number }[] = [];
    for (const c of cuts) {
      if (c.asset.kind !== 'solid') continue;
      const zs: number[] = [];
      for (const p of c.paths) {
        if (!p.closed) continue;
        const n = p.points.length;
        for (let k = 0; k < n; k++) {
          const [s0, z0] = p.points[k], [s1, z1] = p.points[(k + 1) % n];
          if ((ss - s0) * (ss - s1) < 0 || (ss === s0 && s1 !== s0)) zs.push(z0 + (z1 - z0) * ((ss - s0) / (s1 - s0)));
        }
      }
      if (zs.length >= 2) out.push({ asset: c.asset, top: Math.max(...zs), bottom: Math.min(...zs) });
    }
    return out;
  };

  const xTicks = x.ticks(Math.max(3, Math.round((x.range[1] - x.range[0]) / 100)));
  const yTicks = y.ticks(Math.max(2, Math.round((box.bottom - box.top) / 36)));
  const solids = cuts.filter(c => c.asset.kind === 'solid');
  const surfaces = cuts.filter(c => c.asset.kind === 'surface' && c !== topo);

  return (
    <div className={cx(s.strip, className)}>
      <div className={s.stripHead}>
        <span className={s.stripTitle}><Icon name="section" size={18} /><span>Section A–B</span></span>
        <span className={s.stripMeta}>{num(L)} m · azimuth {num(az)}° · RL {num(zMin, 1)}–{num(zMax, 1)}{section.widthM ? ` · band ${num(section.widthM)} m` : ''}</span>
        <span className={s.gap} />
        {W > 760 && (
          <span className={s.secLegend}>
            {topo && <span><i className={s.lgTerrain} />Topo</span>}
            {solids.slice(0, 5).map(c => <span key={c.asset.id}><i className={s.swatchBig} style={{ background: c.asset.color, opacity: 0.8 }} />{c.asset.name}</span>)}
            {crossings.length > 0 && <span><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill="var(--accent)" /></svg>Strings</span>}
          </span>
        )}
        <span className={s.stripMeta}>{trueScale ? '1:1' : `VE ${num(sc.ve, 1)}×`}</span>
        <Segmented<'true' | 'fit'> small value={trueScale ? 'true' : 'fit'} onChange={v => setTrueScale(v === 'true')} style={{ width: 196 }}
          options={[{ value: 'true', label: 'True scale' }, { value: 'fit', label: 'Exaggerated' }]} />
        <Ctl icon="x" small tip="Close section" onClick={() => setSection(undefined)} />
      </div>
      <div ref={ref} className={s.stripChart}>
        {W > 0 && H > 50 && (
          <svg width={W} height={H} className={s.chartHit} onPointerMove={e => setMx(e.clientX - e.currentTarget.getBoundingClientRect().left)} onPointerLeave={() => setMx(null)}>
            <defs>
              <clipPath id="secclip"><rect x={box.left} y={box.top - 10} width={box.right - box.left} height={box.bottom - box.top + 10} /></clipPath>
            </defs>
            {yTicks.map(t => (
              <g key={t}>
                <line x1={box.left} x2={box.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} stroke="var(--hair)" />
                <text x={box.left - 8} y={y(t)} dy="0.32em" textAnchor="end" style={chartText}>{num(t)}</text>
              </g>
            ))}
            <text x={6} y={box.top - 8} textAnchor="start" style={{ ...chartText, fontWeight: 650 }}>RL m</text>
            <g clipPath="url(#secclip)">
              {topo?.paths.filter(p => !p.closed).map((p, k) => (
                <g key={k}>
                  <path d={`${pathD(p.points, false)}L${x(p.points[p.points.length - 1][0]).toFixed(1)},${box.bottom + 2}L${x(p.points[0][0]).toFixed(1)},${box.bottom + 2}Z`} fill="color-mix(in srgb, var(--ink-4) 18%, transparent)" />
                  <path d={pathD(p.points, false)} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeLinejoin="round" />
                </g>
              ))}
              {surfaces.map(c => c.paths.map((p, k) => <path key={`${c.asset.id}${k}`} d={pathD(p.points, p.closed)} fill="none" stroke={c.asset.color} strokeWidth={1.5} strokeDasharray="5 3" />))}
              {solids.map(c => c.paths.map((p, k) => (
                <path key={`${c.asset.id}${k}`} d={pathD(p.points, p.closed)} fill={p.closed ? c.asset.color : 'none'} fillOpacity={0.32} stroke={c.asset.color} strokeWidth={1.6} strokeLinejoin="round" />
              )))}
            </g>
            {/* x axis */}
            <line x1={x.range[0]} x2={x.range[1]} y1={box.bottom + 0.5} y2={box.bottom + 0.5} stroke="var(--ink-4)" />
            {xTicks.map(t => (
              <g key={t}>
                <line x1={Math.round(x(t)) + 0.5} x2={Math.round(x(t)) + 0.5} y1={box.bottom} y2={box.bottom + 4} stroke="var(--ink-4)" />
                <text x={x(t)} y={box.bottom + 16} textAnchor="middle" style={chartText}>{num(t)}</text>
              </g>
            ))}
            {/* A / B */}
            <EndPill x={x(0)} y={box.top - 12} label="A" />
            <EndPill x={x(L)} y={box.top - 12} label="B" />
            <line x1={x(0) + 0.5} x2={x(0) + 0.5} y1={box.top - 4} y2={box.bottom} stroke="var(--ink-4)" strokeDasharray="2 3" />
            <line x1={x(L) - 0.5} x2={x(L) - 0.5} y1={box.top - 4} y2={box.bottom} stroke="var(--ink-4)" strokeDasharray="2 3" />
            {/* string crossings */}
            {placeLabels(crossings, x, y).map(({ c, label, dy }, k) => (
              <g key={k}>
                <circle cx={x(c.s)} cy={y(c.z)} r={5} fill={c.hs.color} stroke="var(--surface)" strokeWidth={2} />
                {label && (
                  <>
                    <text x={x(c.s)} y={y(c.z) + dy} textAnchor="middle" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3} strokeLinejoin="round"
                      style={{ ...chartText, fill: 'var(--ink)', fontWeight: 600 }}>{label}</text>
                  </>
                )}
              </g>
            ))}
            {sAt != null && (
              <g pointerEvents="none">
                <line x1={x(sAt)} x2={x(sAt)} y1={box.top} y2={box.bottom} stroke="var(--ink-3)" />
                {surfAt(sAt) != null && <circle cx={x(sAt)} cy={y(surfAt(sAt)!)} r={4} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />}
              </g>
            )}
          </svg>
        )}
        {sAt != null && mx != null && (
          <div className={s.readout} style={{ top: 8, ...(mx > W - 240 ? { right: W - mx + 14 } : { left: mx + 14 }) }}>
            <div className={s.roHead}>{num(sAt, 1)} m from A</div>
            {surfAt(sAt) != null && <div className={s.roRow}><span>Topo</span><b>RL {num(surfAt(sAt)!, 2)}</b></div>}
            {solidsAt(sAt).map(o => (
              <div key={o.asset.id} className={s.roRow}>
                <span className={s.roKey}><i className={s.swatchBig} style={{ background: o.asset.color, width: 10, height: 10 }} />{o.asset.name}</span>
                <b>{num(o.bottom, 1)}–{num(o.top, 1)} <span className={s.muted} style={{ fontWeight: 500 }}>({num(o.top - o.bottom, 1)} m)</span></b>
              </div>
            ))}
            {crossings.filter(c => Math.abs(x(c.s) - mx) < 16).map((c, k) => (
              <div key={`x${k}`} className={s.roRow}>
                <span className={s.roKey}><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill={c.hs.color} /></svg>{c.hs.name}</span>
                <b>RL {num(c.z, 1)}</b>
              </div>
            ))}
            {cuts.length === 0 && <div className={s.roRow}><span className={s.muted}>No surfaces cut</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Greedy label placement for string crossings: one label per string cluster, stacked when neighbours collide. */
function placeLabels(cs: Crossing[], x: (v: number) => number, y: (v: number) => number) {
  const sorted = [...cs].sort((a, b) => a.s - b.s);
  const placed: { x0: number; x1: number; y: number }[] = [];
  const lastByString = new Map<string, number>();
  return sorted.map(c => {
    const px = x(c.s), py = y(c.z);
    const prev = lastByString.get(c.hs.id);
    if (prev != null && Math.abs(px - prev) < 140) return { c, label: '', dy: 0 };
    lastByString.set(c.hs.id, px);
    const label = c.hs.name.length > 24 ? `${c.hs.name.slice(0, 23)}…` : c.hs.name;
    const w = label.length * 6.4 + 8;
    const hit = (dy: number) => placed.some(p => px - w / 2 < p.x1 && px + w / 2 > p.x0 && Math.abs(p.y - (py + dy)) < 14);
    const dy = !hit(-10) ? -10 : !hit(20) ? 20 : null;
    if (dy == null) return { c, label: '', dy: 0 }; // no room: the hover readout lists it
    placed.push({ x0: px - w / 2, x1: px + w / 2, y: py + dy });
    return { c, label, dy };
  });
}

function EndPill({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g pointerEvents="none">
      <rect x={x - 10} y={y - 9} width={20} height={18} rx={9} fill="var(--ink)" />
      <text x={x} y={y} dy="0.34em" textAnchor="middle" style={{ ...chartText, fill: 'var(--ink-inv)', fontWeight: 700, fontSize: 11.5 }}>{label}</text>
    </g>
  );
}
