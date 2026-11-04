/**
 * Vertical section A→B (store.section) through the topo surface and every visible solid. True scale by default
 * (metres square on both axes), or exaggerated to fill the panel.
 *
 * Where the line crosses a haul string (HRL §11.1, steal #11):
 *  - the carriageway (HaulString.roadWidthM, as cut obliquely by the line) and its bunds are drawn on the section;
 *  - a true-scale road detail across the road shows the bunds, the selected circuit's truck in rear view from
 *    TruckModel.dims, an oncoming ghost, and the "width needed" band (3.5 × the widest vehicle, two-way) in its
 *    pass / fail colour with the shortfall in rust;
 *  - the header leads with the verdict sentence; the evidence (figures, drawing, legend, meta) follows.
 * String labels are placed greedily (candidate positions, collision-checked against labels, markers and the A/B pills).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HaulString, MeshAsset, Scenario, TruckModel } from '@/core/types';
import { useApp } from '@/state/store';
import { Ctl, Icon, Segmented, Select, chartText, circuitColor, cx } from '@/ui';
import { grade as fmtGrade, num, pct } from '@/core/format';
import {
  GRADE_LIMIT, GRADE_WINDOW_M, apparentWidth, bundBase, bundHeightOf, gradePlace, maxFittedGrade, roadCheck, roadWidthOf, sectionScales,
  trucksOnString, tyreSize, type RoadCheck,
} from './model';
import type { SectionPath } from '@/geom';
import { sectionCut } from './geo';
import s from './haulage.module.css';

interface Cut { asset: MeshAsset; paths: SectionPath[] }
interface Crossing { hs: HaulString; s: number; z: number; sin: number; seg: number; grade: number }

/** Road detail column width at full size. */
const DETAIL_W = 372;

export function SectionPanel({ className }: { className?: string }) {
  const section = useApp(st => st.section);
  const scenario = useApp(st => st.scenario);
  const selection = useApp(st => st.selection);
  const setSection = useApp(st => st.setSection);
  const { assets, strings } = scenario;
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
  const [pickId, setPickId] = useState<string | undefined>();

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
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          const plan = Math.hypot(ex, ey), d3 = Math.hypot(plan, q.z - p.z);
          out.push({ hs, s: t * L, z: p.z + (q.z - p.z) * u, sin: den / (L * plan || 1), seg: i, grade: d3 > 0 ? (q.z - p.z) / d3 : 0 });
        }
      }
    }
    return out.sort((m, n) => m.s - n.s);
  }, [strings, a?.[0], a?.[1], b?.[0], b?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!section || !a || !b) return null;

  // the road the detail describes: the picked one, else the selected string / circuit's, else the first crossed
  const selCircuit = selection.kind === 'circuit' ? scenario.circuits.find(c => c.id === selection.id)
    : selection.kind === 'truck' ? scenario.circuits.find(c => c.id === selection.circuitId) : undefined;
  const focusId = selection.kind === 'string' ? selection.id : selCircuit?.haulStringId;
  const crossedIds = [...new Set(crossings.map(c => c.hs.id))];
  const cross = crossings.find(c => c.hs.id === pickId) ?? crossings.find(c => c.hs.id === focusId) ?? crossings[0];
  const road = cross ? roadFor(scenario, cross.hs, selCircuit?.truckModelId) : undefined;

  const topo = cuts.find(c => c.asset.role === 'topo' && c.asset.kind === 'surface');
  let zMin = Infinity, zMax = -Infinity;
  for (const c of cuts) for (const p of c.paths) for (const [, z] of p.points) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
  for (const c of crossings) { zMin = Math.min(zMin, c.z); zMax = Math.max(zMax, c.z); }
  if (!Number.isFinite(zMin)) { zMin = 0; zMax = 10; }

  const { w: BW, h: H } = size;
  const showDetail = !!cross && !!road && BW >= 720 && H >= 96;
  const W = showDetail ? BW - DETAIL_W : BW;
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
  const labels = W > 0 ? placeStringLabels(crossings, x, y, box, [x(0), x(L)], focusId ?? cross?.hs.id) : [];
  const meta = `${num(L)} m · azimuth ${num(az)}° · RL ${num(zMin, 1)}–${num(zMax, 1)}${section.widthM ? ` · band ${num(section.widthM)} m` : ''}`;
  const verdict = cross && road ? roadVerdict(cross.hs, road) : null;

  return (
    <div className={cx(s.strip, className)}>
      <div className={s.stripHead}>
        <span className={s.stripName}><Icon name="section" size={18} /><span>Section A–B</span></span>
        {verdict
          ? <span className={cx(s.verdict, road!.check.ok ? s.tOk : s.tBad)} title={`${verdict.text}. ${verdict.detail}`}><Icon name={road!.check.ok ? 'tick' : 'warning'} size={15} strokeWidth={2.2} /><span>{verdict.text}</span></span>
          : <span className={cx(s.verdict, s.verdictNa)}><span>{crossings.length ? '' : 'No haul road crosses this line'}</span></span>}
        <span className={s.gap} />
        <span className={s.stripMetaFixed}>{trueScale ? '1:1' : `VE ${num(sc.ve, 1)}×`}</span>
        <Segmented<'true' | 'fit'> small value={trueScale ? 'true' : 'fit'} onChange={v => setTrueScale(v === 'true')} style={{ width: 196, flex: 'none' }}
          options={[{ value: 'true', label: 'True scale' }, { value: 'fit', label: 'Exaggerated' }]} />
        <Ctl icon="x" small tip="Close section" onClick={() => setSection(undefined)} />
      </div>
      <div ref={ref} className={s.secBody}>
        <div className={s.stripChart} style={{ flex: 'none', width: W }}>
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
                {/* carriageways where the line crosses a string: running surface + bunds, at the oblique width */}
                {crossings.map((c, k) => <Carriageway key={k} c={c} x={x} y={y} active={c === cross} />)}
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
              {/* string crossings + greedily placed labels */}
              {labels.map((l, k) => l.leader && (
                <line key={`ld${k}`} x1={l.px} y1={l.py + (l.ly < l.py ? -6 : 6)} x2={l.lx} y2={l.ly < l.py ? l.ly + 3 : l.ly - 11} stroke="var(--ink-4)" strokeWidth={1} />
              ))}
              {crossings.map((c, k) => (
                <circle key={k} cx={x(c.s)} cy={y(c.z)} r={c === cross ? 5.5 : 4.5} fill={circuitColor(c.hs.color)} stroke="var(--surface)" strokeWidth={2} />
              ))}
              {labels.map((l, k) => (
                <text key={`lb${k}`} x={l.lx} y={l.ly} textAnchor={l.anchor} paintOrder="stroke" stroke="var(--surface)" strokeWidth={3.5} strokeLinejoin="round"
                  style={{ ...chartText, fill: 'var(--ink)', fontWeight: 600 }}>{l.text}</text>
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
                  <span className={s.roKey}><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill={circuitColor(c.hs.color)} /></svg>{c.hs.name}</span>
                  <b>RL {num(c.z, 1)} · {num(roadWidthOf(c.hs), 1)} m road</b>
                </div>
              ))}
              {cuts.length === 0 && <div className={s.roRow}><span className={s.muted}>No surfaces cut</span></div>}
            </div>
          )}
        </div>
        {showDetail && cross && road && (
          <RoadDetail cross={cross} road={road} H={H} options={crossedIds.map(id => strings.find(q => q.id === id)!)} onPick={setPickId} />
        )}
      </div>
      <div className={s.stripFoot} style={{ paddingLeft: 16 }}>
        <span className={s.secLegend}>
          {topo && <span><i className={s.lgTerrain} />Topo</span>}
          {solids.slice(0, 4).map(c => <span key={c.asset.id}><i className={s.swatchBig} style={{ background: c.asset.color, opacity: 0.8, width: 12, height: 12 }} />{c.asset.name}</span>)}
          {crossings.length > 0 && <span><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill="var(--ink-3)" /></svg>Haul string</span>}
          {crossings.length > 0 && <span><svg width="18" height="8" aria-hidden><rect x="1" y="3" width="16" height="3" rx="1" fill="var(--ink-3)" opacity=".6" /><path d="M1 6L3 2.5L4 6M14 6L15 2.5L17 6" fill="var(--ink-3)" /></svg>Carriageway + bunds</span>}
        </span>
        <span className={s.gap} />
        <span className={s.stripMeta} title={meta}>{meta}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── road at the crossing

interface Road { truck?: TruckModel; widest?: TruckModel; widthM: number; bundM: number; check: RoadCheck }

/** The truck drawn (the selected circuit's, else the widest on this road, else the widest in the fleet) and the check. */
function roadFor(sc: Scenario, hs: HaulString, selTruckId?: string): Road | undefined {
  const on = trucksOnString(sc, hs.id);
  const fleetWidest = [...sc.fleet.trucks].sort((m, n) => (n.dims?.width ?? 0) - (m.dims?.width ?? 0))[0];
  const truck = sc.fleet.trucks.find(t => t.id === selTruckId) ?? on[0] ?? fleetWidest;
  const widest = [on[0], truck].filter((t): t is TruckModel => !!t?.dims?.width).sort((m, n) => n.dims.width - m.dims.width)[0];
  if (!widest) return undefined;
  const widthM = roadWidthOf(hs);
  return { truck, widest, widthM, bundM: bundHeightOf(hs), check: roadCheck(widthM, widest.dims.width) };
}

function roadVerdict(hs: HaulString, r: Road) {
  const who = `two-way ${r.widest!.name}`;
  const text = r.check.ok
    ? `Road wide enough for ${who}: ${num(r.widthM, 1)} m, needs ${num(r.check.neededM, 1)} m`
    : `Road ${num(-r.check.marginM, 1)} m too narrow for ${who}: ${num(r.widthM, 1)} m, needs ${num(r.check.neededM, 1)} m`;
  return { text, detail: `${hs.name}. Rule: ${num(3.5, 1)} × the widest vehicle (${num(r.widest!.dims.width, 2)} m) for two-way traffic.` };
}

/** Carriageway on the A–B section: running surface at the string's RL, bunds either side, at the crossing's oblique width. */
function Carriageway({ c, x, y, active }: { c: Crossing; x: (v: number) => number; y: (v: number) => number; active: boolean }) {
  const w = apparentWidth(roadWidthOf(c.hs), c.sin), h = bundHeightOf(c.hs), bb = apparentWidth(bundBase(h), c.sin);
  const l = c.s - w / 2, r = c.s + w / 2;
  const col = circuitColor(c.hs.color);
  const bund = (toe: number, dir: -1 | 1) => `M${x(toe)},${y(c.z)}L${x(toe + dir * bb * 0.45)},${y(c.z + h)}L${x(toe + dir * bb * 0.55)},${y(c.z + h)}L${x(toe + dir * bb)},${y(c.z)}Z`;
  return (
    <g pointerEvents="none" opacity={active ? 1 : 0.7}>
      <rect x={x(l)} y={y(c.z) - 1} width={Math.max(2, x(r) - x(l))} height={3} rx={1} fill={col} opacity={0.55} />
      <path d={bund(l, -1)} fill="var(--ink-3)" opacity={0.75} />
      <path d={bund(r, 1)} fill="var(--ink-3)" opacity={0.75} />
      <line x1={x(l)} x2={x(l)} y1={y(c.z) - 5} y2={y(c.z) + 3} stroke={col} strokeWidth={1.5} />
      <line x1={x(r)} x2={x(r)} y1={y(c.z) - 5} y2={y(c.z) + 3} stroke={col} strokeWidth={1.5} />
    </g>
  );
}

/**
 * True-scale cross-section of the road at the crossing (perpendicular to the road; level formation at the string's RL):
 * ground, bunds, the width-needed band from the left edge (pass sage / fail rust + shortfall), its dimension line, the
 * selected truck in rear view in the left lane and an oncoming ghost in the right lane, and the carriageway dimension.
 */
function RoadDetail({ cross, road, H, options, onPick }: { cross: Crossing; road: Road; H: number; options: HaulString[]; onPick: (id: string) => void }) {
  const hs = cross.hs;
  const { widthM: Wr, bundM: hb, check } = road;
  const truck = road.truck ?? road.widest!;
  const tw = truck.dims.width, th = truck.dims.height;
  const need = check.neededM;
  const bb = bundBase(hb);
  const half = Wr / 2;
  const lo = -half - bb - 2.5, hi = Math.max(half + bb + 2.5, -half + need + 2.5);
  const BAND_H = Math.max(7, th + 0.6);
  // short docks (laptop heights, with the Profile / Section tabs) drop the caption row so the drawing keeps its room
  const compact = H < 132;
  const HEAD = compact ? 30 : 34, FOOT = compact ? 0 : 20, TOP = 18, BOT = 18;
  const svgW = DETAIL_W - 24, svgH = Math.max(40, H - HEAD - FOOT);
  const GROUND = 1.6; // m of ground shown under the formation
  const k = Math.min(svgW / (hi - lo), (svgH - TOP - BOT) / (BAND_H + GROUND));
  const ox = (svgW - (hi - lo) * k) / 2 - lo * k;
  const X = (m: number) => ox + m * k;
  const roadY = TOP + BAND_H * k;
  const Y = (m: number) => roadY - m * k;
  const ok = check.ok;
  const vInk = ok ? 'var(--ok-ink)' : 'var(--bad-ink)';
  const left = -half;
  const bund = (toe: number, dir: -1 | 1) => `M${X(toe)},${Y(0)}L${X(toe + dir * 1.5 * hb)},${Y(hb)}L${X(toe + dir * (1.5 * hb + 0.6))},${Y(hb)}L${X(toe + dir * bb)},${Y(0)}Z`;
  const fit = useMemo(() => maxFittedGrade(hs.points), [hs.points]);
  const place = fit ? gradePlace(hs.points, fit) : '';
  return (
    <div className={s.roadDetail} style={{ width: DETAIL_W }}>
      <div className={s.rdHead} style={compact ? { height: HEAD } : undefined}>
        {options.length > 1
          ? <span className={s.rdPick}><Select small value={hs.id} onChange={onPick} width="100%" title="Road at this crossing" options={options.map(o => ({ value: o.id, label: o.name }))} /></span>
          : <span className={s.rdName}><i className={s.lineKey} style={{ background: circuitColor(hs.color) }} /><span>{hs.name}</span></span>}
        <span className={s.rdFig} title={`Carriageway ${num(Wr, 1)} m; two-way needs ${TWO_WAY_TXT} × ${num(road.widest!.dims.width, 2)} m (${road.widest!.name}) = ${num(need, 1)} m`}>
          <b style={{ color: vInk }}>{num(Wr, 1)} m</b> needs {num(need, 1)} m
        </span>
      </div>
      <svg width={svgW} height={svgH} className={s.rdSvg} role="img"
        aria-label={`Road cross-section at the crossing, true scale: ${num(Wr, 1)} m carriageway, ${num(need, 1)} m needed for two-way ${road.widest!.name}`}>
        <defs>
          <pattern id="rdShort" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="color-mix(in srgb, var(--bad) 30%, transparent)" /><line x1="0" y1="0" x2="0" y2="5" stroke="var(--bad)" strokeWidth="1.6" />
          </pattern>
        </defs>
        {/* need band (behind), shortfall, dimension line */}
        <rect x={X(left)} y={Y(BAND_H)} width={need * k} height={BAND_H * k} fill={ok ? 'var(--ok-50)' : 'var(--bad-50)'} stroke={ok ? 'var(--ok)' : 'var(--bad)'} strokeOpacity={0.35} />
        {!ok && <rect x={X(half)} y={Y(BAND_H)} width={(need - Wr) * k} height={BAND_H * k} fill="url(#rdShort)" />}
        <g stroke={vInk} strokeWidth={1.5}>
          <line x1={X(left)} x2={X(left + need)} y1={Y(BAND_H) - 6} y2={Y(BAND_H) - 6} />
          <line x1={X(left)} x2={X(left)} y1={Y(BAND_H) - 10} y2={Y(BAND_H) - 2} />
          <line x1={X(left + need)} x2={X(left + need)} y1={Y(BAND_H) - 10} y2={Y(BAND_H) - 2} />
        </g>
        <text x={X(left + need / 2)} y={Y(BAND_H) - 10} textAnchor="middle" paintOrder="stroke" stroke="var(--surface)" strokeWidth={3} strokeLinejoin="round"
          style={{ ...chartText, fontSize: 11, fontWeight: 700, fill: vInk }}>{ok ? `two-way ${TWO_WAY_TXT} × ${num(road.widest!.dims.width, 1)} m = ${num(need, 1)} m` : `needs ${num(need, 1)} m · ${num(need - Wr, 1)} m short`}</text>
        {/* ground, formation, bunds */}
        <rect x={0} y={Y(0)} width={svgW} height={svgH - BOT - Y(0) + 4} fill="color-mix(in srgb, var(--ink-4) 22%, transparent)" />
        <line x1={0} x2={svgW} y1={Y(0)} y2={Y(0)} stroke="var(--ink-2)" strokeWidth={1.5} />
        <path d={bund(left, -1)} fill="color-mix(in srgb, var(--ink-3) 55%, var(--surface))" stroke="var(--ink-2)" strokeWidth={1} strokeLinejoin="round" />
        <path d={bund(half, 1)} fill="color-mix(in srgb, var(--ink-3) 55%, var(--surface))" stroke="var(--ink-2)" strokeWidth={1} strokeLinejoin="round" />
        <text x={X(left - bb / 2)} y={Y(hb) - 4} textAnchor="middle" style={{ ...chartText, fontSize: 10.5 }}>{num(hb, 1)} m</text>
        {/* trucks: selected (left lane, keep left) + oncoming ghost */}
        <TruckRear t={truck} cx={X(left + tw)} base={Y(0)} k={k} />
        <TruckRear t={truck} cx={X(left + 2.5 * tw)} base={Y(0)} k={k} ghost />
        {/* carriageway dimension under the ground line */}
        <g stroke="var(--ink-2)" strokeWidth={1}>
          <line x1={X(left)} x2={X(half)} y1={Y(0) + 8} y2={Y(0) + 8} />
          <line x1={X(left)} x2={X(left)} y1={Y(0) + 4} y2={Y(0) + 12} />
          <line x1={X(half)} x2={X(half)} y1={Y(0) + 4} y2={Y(0) + 12} />
        </g>
        <text x={X(0)} y={Y(0) + 20} dy="0.2em" textAnchor="middle" style={{ ...chartText, fontSize: 11, fill: 'var(--ink-2)', fontWeight: 600 }}>{num(Wr, 1)} m carriageway</text>
      </svg>
      {!compact && <div className={s.rdFoot} title={fit ? `Steepest ${GRADE_WINDOW_M} m on ${hs.name}: ${fmtGrade(fit.grade, 1)} ${place}` : undefined}>
        <span>{truck.name} {num(tw, 1)} m · here {fmtGrade(cross.grade, 1)}</span>
        {fit && <span className={fit.ok ? s.tOk : s.tBad}>· max {pct(Math.abs(fit.grade))} per {GRADE_WINDOW_M} m {fit.ok ? '✓' : `> ${pct(GRADE_LIMIT, 0)}`}</span>}
      </div>}
    </div>
  );
}
const TWO_WAY_TXT = '3.5';

/** Rear view of a rigid haul truck from its dims: duals, axle housing, body tail, top rail, tail lights. */
function TruckRear({ t, cx, base, k, ghost }: { t: TruckModel; cx: number; base: number; k: number; ghost?: boolean }) {
  const w = t.dims.width, h = t.dims.height;
  const ty = tyreSize(t.dims.tyre, t.dims);
  const X = (m: number) => cx + m * k, Y = (m: number) => base - m * k;
  const tyreW = ty.widthM, D = Math.min(ty.diaM, h * 0.62);
  const outer = 0.43 * w, gap = 0.14;
  const tyres = [outer - tyreW, outer - 2 * tyreW - gap].flatMap(x0 => [x0, -x0 - tyreW]);
  const bodyBot = Math.max(D * 0.92, h * 0.5);
  const body = [[-0.40 * w, bodyBot], [0.40 * w, bodyBot], [0.5 * w, h * 0.8], [0.5 * w, h], [-0.5 * w, h], [-0.5 * w, h * 0.8]] as const;
  const tail = [[-0.34 * w, bodyBot + 0.25], [0.34 * w, bodyBot + 0.25], [0.43 * w, h * 0.78], [-0.43 * w, h * 0.78]] as const;
  const poly = (pts: readonly (readonly [number, number])[]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${X(px).toFixed(1)},${Y(py).toFixed(1)}`).join('') + 'Z';
  if (ghost) {
    return (
      <g fill="none" stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 2" opacity={0.8} pointerEvents="none">
        {[-1, 1].map(sd => { const x1 = sd > 0 ? outer : -outer + 2 * tyreW + gap; return <rect key={sd} x={X(x1 - 2 * tyreW - gap)} y={Y(D)} width={(2 * tyreW + gap) * k} height={D * k} rx={tyreW * k * 0.3} />; })}
        <path d={poly(body)} />
      </g>
    );
  }
  const trim = 'color-mix(in srgb, #000 35%, ' + (t.color || '#E3A91B') + ')';
  return (
    <g pointerEvents="none">
      <rect x={X(-0.3 * w)} y={Y(D * 0.6)} width={0.6 * w * k} height={D * 0.18 * k} rx={2} fill="#4A5059" />
      <rect x={X(-0.16 * w)} y={Y(bodyBot + 0.05)} width={0.32 * w * k} height={(bodyBot - D * 0.55) * k} fill="#5B616B" />
      {tyres.map((x0, i) => <rect key={i} x={X(x0)} y={Y(D)} width={tyreW * k} height={D * k} rx={tyreW * k * 0.3} fill="#2F343B" />)}
      <path d={poly(body)} fill={t.color || '#E3A91B'} stroke={trim} strokeWidth={1} strokeLinejoin="round" />
      <path d={poly(tail)} fill={trim} opacity={0.35} />
      <line x1={X(-0.5 * w)} x2={X(0.5 * w)} y1={Y(h)} y2={Y(h)} stroke={trim} strokeWidth={2} />
      <rect x={X(-0.36 * w)} y={Y(bodyBot - 0.05)} width={0.07 * w * k} height={Math.max(2, 0.18 * k)} fill="#C2362B" />
      <rect x={X(0.29 * w)} y={Y(bodyBot - 0.05)} width={0.07 * w * k} height={Math.max(2, 0.18 * k)} fill="#C2362B" />
    </g>
  );
}

// ─────────────────────────────────────────────────────────────── labels

interface PlacedLabel { text: string; px: number; py: number; lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; leader: boolean }

/**
 * Greedy, collision-free labels for string crossings: the focused string first, then left to right; one label per
 * string unless its crossings are far apart. Candidates above / below / beside / further out (with a leader); each is
 * kept inside the plot and must not touch a placed label, a crossing marker or the A / B pills. No room → no label
 * (the hover readout lists every crossing).
 */
function placeStringLabels(cs: Crossing[], x: (v: number) => number, y: (v: number) => number, box: { left: number; right: number; top: number; bottom: number }, pills: number[], focusId?: string): PlacedLabel[] {
  type R = { x0: number; x1: number; y0: number; y1: number };
  const hit = (p: R, q: R) => p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0;
  const obstacles: R[] = [
    ...cs.map(c => ({ x0: x(c.s) - 6, x1: x(c.s) + 6, y0: y(c.z) - 6, y1: y(c.z) + 6 })),
    ...pills.map(px => ({ x0: px - 12, x1: px + 12, y0: box.top - 22, y1: box.top - 2 })),
  ];
  const placed: R[] = [];
  const out: PlacedLabel[] = [];
  const order = [...cs].sort((m, n) => (m.hs.id === focusId ? -1 : 0) - (n.hs.id === focusId ? -1 : 0) || m.s - n.s);
  const lastX = new Map<string, number[]>();
  for (const c of order) {
    const px = x(c.s), py = y(c.z);
    const prev = lastX.get(c.hs.id) ?? [];
    if (prev.some(p => Math.abs(p - px) < 160)) continue;
    const text = c.hs.name.length > 42 ? `${c.hs.name.slice(0, 41)}…` : c.hs.name;
    const w = text.length * 6.5 + 6, h = 14;
    const cands: [number, number, 'start' | 'middle' | 'end'][] = [
      [0, -11, 'middle'], [0, 19, 'middle'], [9, -9, 'start'], [-9, -9, 'end'], [9, 17, 'start'], [-9, 17, 'end'], [0, -28, 'middle'], [0, 36, 'middle'], [0, -44, 'middle'],
    ];
    for (const [dx, dy, anchor] of cands) {
      let lx = px + dx;
      let x0 = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
      const shift = Math.max(0, box.left + 2 - x0) - Math.max(0, x0 + w - (box.right + 14));
      x0 += shift; lx += shift;
      const ly = py + dy;
      const r: R = { x0, x1: x0 + w, y0: ly - h + 3, y1: ly + 3 };
      if (r.y0 < box.top - 16 || r.y1 > box.bottom - 2) continue;
      if (placed.some(q => hit(q, r)) || obstacles.some(q => hit(q, r))) continue;
      placed.push(r);
      prev.push(px); lastX.set(c.hs.id, prev);
      out.push({ text, px, py, lx, ly, anchor, leader: Math.abs(dy) > 20 });
      break;
    }
  }
  return out;
}

function EndPill({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g pointerEvents="none">
      <rect x={x - 10} y={y - 9} width={20} height={18} rx={9} fill="var(--ink)" />
      <text x={x} y={y} dy="0.34em" textAnchor="middle" style={{ ...chartText, fill: 'var(--ink-inv)', fontWeight: 700, fontSize: 11.5 }}>{label}</text>
    </g>
  );
}
