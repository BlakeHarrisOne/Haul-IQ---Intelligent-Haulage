/**
 * Long section of the selected string (or the selected circuit's / truck's string), docked full width.
 *
 *  Lanes (shared chainage axis, one y-scale each - never a dual axis):
 *   1. RL: topo surface under the string as a soft terrain area, the string coloured per segment by grade,
 *      stop signs, dig / dump end markers, selected / hovered vertex; vertical exaggeration Fit · 1× · 2× · 5× · 10×.
 *   2. Grade strip: one cell per segment, grade-class colour; segments the spreadsheet drops are hatched red.
 *   3. Speed: loaded (solid) and empty (dashed) step lines from the engine, with limit-reason labels.
 *  Hover: crosshair + readout, synced to the 3D view through store.hover. Click selects the vertex. Drag a vertex
 *  vertically to edit its RL (one undo step, "Edit RL").
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Circuit, CircuitResult, HaulString, LimitReason, Scenario, SegmentResult, StringPoint } from '@/core/types';
import type { CircuitResultExt, TravelProfile } from '@/engine';
import { useApp } from '@/state/store';
import { useCircuitResult } from '@/state/derived';
import { Icon, Segmented, chartText, gradeColor, linear, cx } from '@/ui';
import { grade as fmtGrade, num } from '@/core/format';
import {
  VE_OPTIONS, chainagesOf, clamp, nearestVertex, profileScales, resultByPoint, segmentAt, segmentsOf, withXYZ, type SegRow, type VE,
} from './model';
import { profileAlongString, type ProfileSample } from '@/geom';
import { topoIndex } from './geo';
import s from './haulage.module.css';

const LIMIT_TEXT: Record<LimitReason, string> = {
  rimpull: 'rimpull', retarder: 'retarder', 'speed-limit': 'speed limit', 'top-speed': 'top speed', table: 'table', 'table-out-of-range': 'off table',
};

export function ProfileStrip({ className }: { className?: string }) {
  const scenario = useApp(st => st.scenario);
  const sel = useApp(st => st.selection);
  const last = useRef<string | undefined>(undefined);

  let circuit: Circuit | undefined;
  let stringId: string | undefined;
  if (sel.kind === 'string') stringId = sel.id;
  else if (sel.kind === 'circuit' || sel.kind === 'truck') {
    circuit = scenario.circuits.find(c => c.id === (sel.kind === 'circuit' ? sel.id : sel.circuitId));
    stringId = circuit?.haulStringId;
  }
  if (!stringId && sel.kind !== 'circuit') {
    stringId = (last.current && scenario.strings.some(x => x.id === last.current) ? last.current : undefined)
      ?? scenario.circuits.find(c => c.active && c.haulStringId)?.haulStringId ?? scenario.strings[0]?.id;
  }
  const hs = scenario.strings.find(x => x.id === stringId);
  if (hs) last.current = hs.id;
  if (!circuit && hs) circuit = scenario.circuits.find(c => c.haulStringId === hs.id);
  const result = useCircuitResult(circuit?.haulStringId === hs?.id ? circuit?.id : undefined);

  return (
    <div className={cx(s.strip, className)}>
      {hs && hs.points.length >= 2
        ? <Profile key={hs.id} hs={hs} circuit={circuit} result={result} scenario={scenario} />
        : (
          <div className={s.stripEmpty}>
            <Icon name="section" size={20} />
            {circuit && !circuit.haulStringId ? `${circuit.name} has no haul string yet.` : 'Select a haul string or circuit to see its long section.'}
          </div>
        )}
    </div>
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const readVE = (): VE => {
  try { const v = localStorage.getItem('haulage.ve'); return v === 'fit' || v == null ? 'fit' : (Number(v) as VE); } catch { return 'fit'; }
};

interface Drag { i: number; z: number; pointerId: number }

function Profile({ hs, circuit, result, scenario }: { hs: HaulString; circuit?: Circuit; result?: CircuitResult; scenario: Scenario }) {
  const setHover = useApp(st => st.setHover);
  const select = useApp(st => st.select);
  const setStringPoints = useApp(st => st.setStringPoints);
  const extHover = useApp(st => (st.hover.kind === 'string' && st.hover.id === hs.id ? st.hover.pointIndex : undefined));
  const selIdx = useApp(st => (st.selection.kind === 'string' && st.selection.id === hs.id ? st.selection.pointIndex : undefined));
  const [ve, setVe] = useState<VE>(readVE);
  useEffect(() => { try { localStorage.setItem('haulage.ve', String(ve)); } catch { /* ignore */ } }, [ve]);
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // points (with a live RL preview while dragging)
  const pts: StringPoint[] = useMemo(() => (drag ? withXYZ(hs.points, drag.i, { z: drag.z }) : hs.points), [hs.points, drag]);
  const chain = useMemo(() => chainagesOf(pts), [pts]);
  const segs = useMemo(() => segmentsOf(pts), [pts]);
  const L = chain[chain.length - 1] || 1;
  const index = topoIndex(scenario);
  const samples = useMemo<ProfileSample[]>(() => profileAlongString(index, hs.points, Math.max(1, L / 700)), [index, hs.points, L]);
  const engSegs = useMemo(() => (result?.ok ? resultByPoint(hs.points.length, result.segments) : []), [result, hs.points.length]);
  const hasSpeed = !!result?.ok && result.segments.length > 0;

  // layout
  const ML = 58, MR = 16, MT = 14;
  const AXIS = 20;
  const showSpeed = hasSpeed && H >= 130;
  const SPEED_H = showSpeed ? clamp(Math.round(H * 0.25), 32, 60) : 0;
  const BAND = 7;
  const yAxis = H - AXIS;
  const speedTop = yAxis - SPEED_H;
  const bandBottom = showSpeed ? speedTop - 8 : yAxis - 6;
  const bandTop = bandBottom - BAND;
  const profBottom = bandTop - 6;
  const box = { left: ML, right: Math.max(ML + 10, W - MR), top: MT, bottom: Math.max(MT + 10, profBottom) };

  // RL domain: the string, plus the surface within a margin (a pre-mining topo far above an in-pit string must not squash it)
  const [zMin, zMax] = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const p of hs.points) { lo = Math.min(lo, p.z); hi = Math.max(hi, p.z); } // committed points: the scale stays put while dragging
    const room = Math.max(8, (hi - lo) * 0.6);
    let slo = lo, shi = hi;
    for (const sm of samples) if (sm.zSurface != null) { slo = Math.min(slo, sm.zSurface); shi = Math.max(shi, sm.zSurface); }
    return [Math.max(slo, lo - room), Math.min(shi, hi + room)];
  }, [hs.points, samples]);
  const sc = useMemo(() => profileScales(0, L, zMin, zMax, box, ve, 0.08), [L, zMin, zMax, box.left, box.right, box.top, box.bottom, ve]); // eslint-disable-line react-hooks/exhaustive-deps
  const { x, y } = sc;
  const vMax = useMemo(() => {
    let m = 0;
    for (const sg of result?.segments ?? []) m = Math.max(m, sg.speedLoadedKmh, sg.speedEmptyKmh);
    const pf = (result as CircuitResultExt | undefined)?.profiles;
    for (const leg of [pf?.loaded, pf?.empty]) for (const iv of leg?.intervals ?? []) m = Math.max(m, iv.v0 * 3.6, iv.v1 * 3.6);
    return Math.max(40, Math.ceil(m / 10) * 10);
  }, [result]);
  const ys = useMemo(() => linear([0, vMax], [yAxis - 2, speedTop + 4]), [vMax, yAxis, speedTop]);

  // hover state from the mouse, or from the 3D view
  const mouseCh = mouse ? clamp(x.invert(mouse.x), 0, L) : undefined;
  const hovI = mouseCh != null ? nearestVertex(chain, mouseCh) : extHover;
  const lastSent = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!mouse) return;
    if (hovI !== lastSent.current) { lastSent.current = hovI; if (hovI != null) setHover({ kind: 'string', id: hs.id, pointIndex: hovI }); }
  }, [hovI, mouse, hs.id, setHover]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const nearVertex = (m: { x: number; y: number }) => {
    const i = nearestVertex(chain, clamp(x.invert(m.x), 0, L));
    if (i < 0) return -1;
    const dx = Math.abs(x(chain[i]) - m.x), dy = Math.abs(y(pts[i].z) - m.y);
    return dx <= 12 && dy <= 12 ? i : -1;
  };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const m = local(e);
    const i = nearVertex(m);
    if (i >= 0 && !hs.locked) {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({ i, z: pts[i].z, pointerId: e.pointerId });
      select({ kind: 'string', id: hs.id, pointIndex: i });
      e.preventDefault();
    }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const m = local(e);
    setMouse(m);
    if (drag) setDrag({ ...drag, z: Math.round(y.invert(clamp(m.y, box.top, box.bottom)) * 100) / 100 });
  };
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (drag) {
      const moved = Math.abs(drag.z - hs.points[drag.i].z) > 0.005;
      if (moved) setStringPoints(hs.id, withXYZ(hs.points, drag.i, { z: drag.z }), 'Edit RL');
      setDrag(null);
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    const m = local(e);
    if (m.x >= box.left - 4 && m.x <= box.right + 4) select({ kind: 'string', id: hs.id, pointIndex: nearestVertex(chain, clamp(x.invert(m.x), 0, L)) });
  };
  const onLeave = () => {
    setMouse(null);
    lastSent.current = undefined;
    const h = useApp.getState().hover;
    if (h.kind === 'string' && h.id === hs.id) setHover({ kind: 'none' });
  };

  // ── geometry ────────────────────────────────────────────────────────────
  const terrainRuns = useMemo(() => {
    const runs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const sm of samples) {
      if (sm.zSurface == null) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
      cur.push([sm.chainage, sm.zSurface]);
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  }, [samples]);
  const pathOf = (run: [number, number][]) => run.map(([c, z], k) => `${k ? 'L' : 'M'}${x(c).toFixed(1)},${y(z).toFixed(1)}`).join('');

  // string grouped into same-colour paths
  const stringPaths = useMemo(() => {
    const out: { color: string; d: string; dropped: boolean }[] = [];
    let curKey = '', d = '';
    let color = '', dropped = false;
    const flush = () => { if (d) out.push({ color, d, dropped }); d = ''; };
    for (const sg of segs) {
      const c = sg.dropped ? 'var(--bad)' : gradeColor(sg.grade);
      const key = `${c}|${sg.dropped}`;
      const x0 = x(chain[sg.i]).toFixed(1), y0 = y(pts[sg.i].z).toFixed(1), x1 = x(chain[sg.i + 1]).toFixed(1), y1 = y(pts[sg.i + 1].z).toFixed(1);
      if (key !== curKey) { flush(); curKey = key; color = c; dropped = sg.dropped; d = `M${x0},${y0}`; }
      d += `L${x1},${y1}`;
    }
    flush();
    return out;
  }, [segs, chain, pts, x, y]);

  const pxPerPt = (box.right - box.left) / Math.max(1, pts.length - 1);
  const showVerts = pxPerPt >= 16;
  const yTicks = y.ticks(Math.max(2, Math.round((box.bottom - box.top) / 34))).filter(t => y(t) >= box.top + 9 && y(t) <= box.bottom - 2);
  const xTicks = x.ticks(Math.max(3, Math.round((box.right - box.left) / 110)));

  // speed step paths + limit labels
  const speed = useMemo(() => {
    if (!showSpeed || !result) return null;
    const segsR = result.segments;
    const step = (val: (sg: SegmentResult) => number) => {
      let d = '';
      segsR.forEach((sg, k) => {
        const x0 = x(sg.chainageM), x1 = x(sg.chainageM + sg.dist3dM), yy = ys(val(sg));
        d += `${k ? 'L' : 'M'}${x0.toFixed(1)},${yy.toFixed(1)}L${x1.toFixed(1)},${yy.toFixed(1)}`;
      });
      return d;
    };
    const labels: { x: number; y: number; text: string }[] = [];
    let k = 0;
    while (k < segsR.length) {
      const reason = segsR[k].limitLoaded;
      let j = k;
      while (j + 1 < segsR.length && segsR[j + 1].limitLoaded === reason) j++;
      const xa = x(segsR[k].chainageM), xb = x(segsR[j].chainageM + segsR[j].dist3dM);
      if ((reason === 'rimpull' || reason === 'retarder' || reason === 'speed-limit') && xb - xa >= 54) {
        let vmin = Infinity;
        for (let q = k; q <= j; q++) vmin = Math.min(vmin, segsR[q].speedLoadedKmh);
        labels.push({ x: (xa + xb) / 2, y: Math.max(speedTop + 10, ys(segsR[k].speedLoadedKmh) - 4), text: reason === 'speed-limit' ? `limit ${num(segsR[k].speedLimitKmh)}` : LIMIT_TEXT[reason] });
      }
      k = j + 1;
    }
    // kinematic / per-interval speed–distance profiles when the engine provides them (accel, decel, stop dwells)
    const pf = (result as CircuitResultExt).profiles;
    const trace = (leg: TravelProfile | undefined, fromDump: boolean) => {
      if (!leg?.intervals?.length) return null;
      const Lg = leg.lengthM || L;
      let d = '';
      for (const iv of leg.intervals) {
        const px = Math.abs(x(iv.s0 + iv.ds) - x(iv.s0));
        const n = iv.dwell || iv.v0 === iv.v1 ? 1 : Math.max(1, Math.min(10, Math.ceil(px / 5)));
        for (let k = 0; k <= n; k++) {
          const f = k / n;
          const v = iv.dwell ? 0 : Math.sqrt(Math.max(0, iv.v0 * iv.v0 + (iv.v1 * iv.v1 - iv.v0 * iv.v0) * f));
          const sx = x(fromDump ? Lg - (iv.s0 + iv.ds * f) : iv.s0 + iv.ds * f), sy = ys(v * 3.6);
          d += `${d ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`;
        }
      }
      return d;
    };
    const kin = result.speedModel === 'rimpull';
    return {
      loaded: (kin && trace(pf?.loaded, false)) || step(sg => sg.speedLoadedKmh),
      empty: (kin && trace(pf?.empty, true)) || step(sg => sg.speedEmptyKmh),
      labels,
    };
  }, [result, showSpeed, x, ys, speedTop]);

  const staticLayer = useMemo(() => (
<g clipPath={`url(#pclip-${hs.id})`}>
              {/* terrain */}
              {terrainRuns.map((run, k) => (
                <g key={k}>
                  <path d={`${pathOf(run)}L${x(run[run.length - 1][0]).toFixed(1)},${box.bottom + 8}L${x(run[0][0]).toFixed(1)},${box.bottom + 8}Z`} fill="color-mix(in srgb, var(--ink-4) 15%, transparent)" />
                  <path d={pathOf(run)} fill="none" stroke="var(--ink-4)" strokeWidth={1} />
                </g>
              ))}
              {/* string, grade-coloured */}
              {stringPaths.map((p, k) => (
                <path key={k} d={p.d} fill="none" stroke={p.color} strokeWidth={p.dropped ? 3 : 2.4} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {showVerts && pts.map((p, i) => (
                <circle key={p.id} cx={x(chain[i])} cy={y(p.z)} r={2.6} fill="var(--surface)" stroke={segs[Math.min(i, segs.length - 1)] ? (segs[Math.min(i, segs.length - 1)].dropped ? 'var(--bad)' : 'var(--ink-2)') : 'var(--ink-2)'} strokeWidth={1.4} />
              ))}
            </g>
  ), [terrainRuns, stringPaths, showVerts, pts, chain, segs, x, y, hs.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const bandLayer = useMemo(() => (
    <g>
            {segs.map(sg => sg.zero ? null : (
              <rect key={sg.i} x={x(chain[sg.i])} y={bandTop} width={Math.max(0.6, x(chain[sg.i + 1]) - x(chain[sg.i]))} height={BAND}
                fill={sg.dropped ? 'url(#hatchBad)' : gradeColor(sg.grade)} shapeRendering="crispEdges" />
            ))}
    </g>
  ), [segs, chain, x, bandTop]);

  // ── readout ─────────────────────────────────────────────────────────────
  const ro = useMemo(() => {
    const ch = drag ? chain[drag.i] : mouseCh;
    if (ch == null) return null;
    const si = segmentAt(chain, ch);
    const sg: SegRow | undefined = segs[si];
    const f = sg && sg.dist3d > 0 ? clamp((ch - sg.chainage) / sg.dist3d, 0, 1) : 0;
    const zStr = drag ? drag.z : sg ? pts[si].z + (pts[si + 1].z - pts[si].z) * f : pts[0].z;
    let zSurf: number | null = null;
    for (let q = 0; q < samples.length; q++) {
      if (samples[q].chainage >= ch) {
        const a = samples[q - 1], b = samples[q];
        if (a && a.zSurface != null && b.zSurface != null) zSurf = a.zSurface + (b.zSurface - a.zSurface) * ((ch - a.chainage) / Math.max(1e-9, b.chainage - a.chainage));
        else zSurf = b.zSurface;
        break;
      }
    }
    const er = engSegs[si];
    const vi = nearestVertex(chain, ch);
    return { ch, si, sg, zStr, zSurf, er, vi, p: pts[si] };
  }, [mouseCh, drag, chain, segs, pts, samples, engSegs]);

  const markI = drag ? drag.i : hovI;
  const roLeft = ro ? x(ro.ch) : 0;
  const flip = roLeft > W - 230;

  const st = segs.length ? { up: Math.max(...segs.map(q => q.grade)), down: Math.min(...segs.map(q => q.grade)) } : { up: 0, down: 0 };
  const dig = scenario.assets.find(a => a.id === (hs.digId ?? circuit?.digId));
  const dump = scenario.assets.find(a => a.id === (hs.dumpId ?? circuit?.dumpId));

  return (
    <>
      <div className={s.stripHead}>
        <span className={s.stripTitle}><span className={s.lineKey} style={{ background: hs.color, flex: 'none' }} /><span>{hs.name}</span></span>
        <span className={s.stripMeta}>
          {num(L)} m · RL {num(zMin, 1)}–{num(zMax, 1)} · {fmtGrade(st.up, 1)} / {fmtGrade(st.down, 1)} max
          {circuit && result?.ok ? ` · ${circuit.name} · cycle ${num(result.cycleMin, 1)} min` : ''}
        </span>
        <span className={s.gap} />
        {W > 1240 && (
          <span className={s.stripLegend}>
            <span><span className={s.lgGrade}><i style={{ background: 'var(--grade-flat)' }} /><i style={{ background: 'var(--grade-mod)' }} /><i style={{ background: 'var(--grade-steep)' }} /><i style={{ background: 'var(--grade-max)' }} /></span>Grade ≤4 / 8 / 10 / &gt;10 %</span>
            {terrainRuns.length > 0 && <span><i className={s.lgTerrain} />Surface</span>}
            {showSpeed && <span><svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke="var(--c1)" strokeWidth="2" strokeLinecap="round" /></svg>Loaded</span>}
            {showSpeed && <span><svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke="var(--c1)" strokeWidth="1.6" strokeDasharray="3 3" strokeLinecap="round" /></svg>Empty</span>}
          </span>
        )}
        <span className={s.stripMetaFixed} title={sc.capped ? `Capped: the profile only fits up to ${num(sc.veFit, 1)}× at this height` : 'Vertical exaggeration'}>
          VE {num(sc.veUsed, sc.veUsed < 10 ? 1 : 0)}×{sc.capped ? ' max' : ''}
        </span>
        <Segmented<VE> small value={ve} onChange={setVe} style={{ width: 210, flex: 'none' }}
          options={VE_OPTIONS.map(v => ({ value: v, label: v === 'fit' ? 'Fit' : `${v}×`, title: v === 'fit' ? 'Fill the height' : v > sc.veFit ? `Needs more height (fits ${num(sc.veFit, 1)}×)` : `${v}× vertical exaggeration` }))} />
      </div>
      <div ref={ref} className={s.stripChart}>
        {W > 0 && H > 60 && (
          <svg width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onLeave}
            className={cx(s.chartHit, mouse && nearVertex(mouse) >= 0 && !hs.locked && s.vertex)} style={drag ? { cursor: 'ns-resize' } : undefined}>
            <defs>
              <clipPath id={`pclip-${hs.id}`}><rect x={box.left} y={box.top - 6} width={box.right - box.left} height={box.bottom - box.top + 6} /></clipPath>
              <pattern id="hatchBad" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" fill="var(--bad-50)" /><line x1="0" y1="0" x2="0" y2="4" stroke="var(--bad)" strokeWidth="2" />
              </pattern>
            </defs>

            {/* RL grid */}
            {yTicks.map(t => (
              <g key={t}>
                <line x1={box.left} x2={box.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} stroke="var(--hair)" />
                <text x={box.left - 8} y={y(t)} dy="0.32em" textAnchor="end" style={chartText}>{num(t)}</text>
              </g>
            ))}
            <text x={box.left - 8} y={box.top - 4} textAnchor="end" style={{ ...chartText, fontWeight: 650 }}>RL m</text>

            {staticLayer}
            {/* stop signs */}
            {pts.map((p, i) => p.stop ? <StopGlyph key={`st${p.id}`} x={x(chain[i])} y={Math.max(box.top + 7, y(p.z) - 14)} /> : null)}

            {/* dig / dump ends */}
            <EndMark x={x(0)} y={y(pts[0].z)} label={`Dig${dig ? ` · ${dig.name}` : ''}`} anchor="start" top={box.top} />
            <EndMark x={x(L)} y={y(pts[pts.length - 1].z)} label={`Dump${dump ? ` · ${dump.name}` : ''}`} anchor="end" top={box.top} />

            {/* selected vertex */}
            {selIdx != null && selIdx < pts.length && (
              <g pointerEvents="none">
                <line x1={x(chain[selIdx])} x2={x(chain[selIdx])} y1={box.top} y2={yAxis} stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 3" />
                <circle cx={x(chain[selIdx])} cy={y(pts[selIdx].z)} r={5.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}

            {/* grade strip */}
            <text x={box.left - 8} y={(bandTop + bandBottom) / 2} dy="0.32em" textAnchor="end" style={{ ...chartText, fontSize: 10.5 }}>grade</text>
            {bandLayer}

            {/* speed lane */}
            {showSpeed && speed && (
              <g>
                <line x1={box.left} x2={box.right} y1={Math.round(ys(vMax / 2)) + 0.5} y2={Math.round(ys(vMax / 2)) + 0.5} stroke="var(--hair-2)" />
                <text x={box.left - 8} y={ys(vMax)} dy="0.6em" textAnchor="end" style={{ ...chartText, fontSize: 10.5 }}>{num(vMax)}</text>
                <text x={box.left - 8} y={yAxis - 3} textAnchor="end" style={{ ...chartText, fontSize: 10.5, fontWeight: 650 }}>km/h</text>
                <path d={speed.empty} fill="none" stroke="var(--c1)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.85} />
                <path d={speed.loaded} fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round" />
                {speed.labels.map((l, k) => (
                  <text key={k} x={l.x} y={l.y} textAnchor="middle" style={{ ...chartText, fontSize: 10.5, fill: 'var(--ink-2)' }}>{l.text}</text>
                ))}
                {result?.segments.map(sg => sg.limitLoaded === 'table-out-of-range' ? (
                  <rect key={`d${sg.i}`} x={x(sg.chainageM)} y={speedTop + 2} width={Math.max(2, x(sg.chainageM + sg.dist3dM) - x(sg.chainageM))} height={yAxis - speedTop - 2} fill="url(#hatchBad)" opacity={0.8} />
                ) : null)}
              </g>
            )}

            {/* chainage axis */}
            <line x1={box.left} x2={box.right} y1={yAxis + 0.5} y2={yAxis + 0.5} stroke="var(--ink-4)" />
            {xTicks.map(t => (
              <g key={t}>
                <line x1={Math.round(x(t)) + 0.5} x2={Math.round(x(t)) + 0.5} y1={yAxis} y2={yAxis + 4} stroke="var(--ink-4)" />
                <text x={x(t)} y={yAxis + 15} textAnchor={t === 0 ? 'start' : 'middle'} style={chartText}>{num(t)}</text>
              </g>
            ))}
            <text x={box.left - 8} y={yAxis + 15} textAnchor="end" style={{ ...chartText, fontWeight: 650 }}>Ch m</text>

            {/* hover crosshair */}
            {ro && (mouse || drag) && (
              <g pointerEvents="none">
                <line x1={x(ro.ch)} x2={x(ro.ch)} y1={box.top} y2={yAxis} stroke="var(--ink-3)" strokeWidth={1} />
                <circle cx={x(ro.ch)} cy={y(ro.zStr)} r={4} fill={ro.sg ? (ro.sg.dropped ? 'var(--bad)' : gradeColor(ro.sg.grade)) : 'var(--ink)'} stroke="var(--surface)" strokeWidth={2} />
                {showSpeed && ro.er && (
                  <>
                    <circle cx={x(ro.ch)} cy={ys(ro.er.speedEmptyKmh)} r={3.2} fill="var(--surface)" stroke="var(--c1)" strokeWidth={1.6} />
                    <circle cx={x(ro.ch)} cy={ys(ro.er.speedLoadedKmh)} r={4} fill="var(--c1)" stroke="var(--surface)" strokeWidth={2} />
                  </>
                )}
              </g>
            )}
            {/* vertex handle (hover / drag / 3D hover) */}
            {markI != null && markI < pts.length && (
              <circle cx={x(chain[markI])} cy={y(pts[markI].z)} r={drag ? 6 : 5} fill={drag ? 'var(--accent)' : 'var(--surface)'} stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
            )}
          </svg>
        )}
        {ro && (mouse || drag) && W > 0 && (
          <div className={s.readout} style={{ top: 6, ...(flip ? { right: W - roLeft + 14 } : { left: roLeft + 14 }) }}>
            <div className={s.roHead}>
              Ch {num(ro.ch, 1)} m <span className={s.muted} style={{ fontWeight: 500 }}>· point {ro.vi + 1}{drag ? ' · editing RL' : ''}</span>
            </div>
            <div className={s.roRow}><span>RL</span><b>{num(ro.zStr, 2)} m</b></div>
            {ro.zSurf != null && <div className={s.roRow}><span>Surface</span><b>{num(ro.zSurf, 2)} m <span className={s.muted} style={{ fontWeight: 500 }}>({ro.zStr - ro.zSurf >= 0 ? '+' : '−'}{num(Math.abs(ro.zStr - ro.zSurf), 2)})</span></b></div>}
            {ro.sg && <div className={s.roRow}><span>Grade</span><b className={ro.sg.dropped ? s.tBad : undefined}>{fmtGrade(ro.sg.grade, 1)}{ro.sg.dropped ? ' · dropped by sheet' : ''}</b></div>}
            {ro.er && <div className={s.roRow}><span className={s.roKey}>Speed L / E</span><b>{num(ro.er.speedLoadedKmh)} / {num(ro.er.speedEmptyKmh)} km/h</b></div>}
            {ro.er && <div className={s.roRow}><span>Limit</span><b style={{ fontWeight: 500 }}>{LIMIT_TEXT[ro.er.limitLoaded]} / {LIMIT_TEXT[ro.er.limitEmpty]}</b></div>}
            {ro.p?.seg && (ro.p.seg.speedLimitKmh != null || ro.p.seg.rrPct != null || ro.p.seg.zone) && (
              <div className={s.roRow}><span>Override</span><b style={{ fontWeight: 500 }}>{[ro.p.seg.speedLimitKmh != null && `${ro.p.seg.speedLimitKmh} km/h`, ro.p.seg.rrPct != null && `RR ${ro.p.seg.rrPct}%`, ro.p.seg.zone].filter(Boolean).join(' · ')}</b></div>
            )}
            {pts[ro.vi]?.stop && <div className={s.roRow}><span>Stop sign</span><b>at point {ro.vi + 1}</b></div>}
          </div>
        )}
      </div>
    </>
  );
}

function StopGlyph({ x, y }: { x: number; y: number }) {
  const r = 5.6, k = r * 0.4142;
  const d = `M${x - k},${y - r}L${x + k},${y - r}L${x + r},${y - k}L${x + r},${y + k}L${x + k},${y + r}L${x - k},${y + r}L${x - r},${y + k}L${x - r},${y - k}Z`;
  return (
    <g pointerEvents="none">
      <path d={d} fill="var(--bad)" stroke="var(--surface)" strokeWidth={1.5} />
      <line x1={x - 2.6} x2={x + 2.6} y1={y} y2={y} stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

function EndMark({ x, y, label, anchor, top }: { x: number; y: number; label: string; anchor: 'start' | 'end'; top: number }) {
  const ly = Math.max(top + 2, y - 22);
  const tx = anchor === 'start' ? x + 6 : x - 6;
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={ly + 3} y2={y - 5} stroke="var(--ink-3)" strokeWidth={1} />
      <circle cx={x} cy={y} r={4.5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
      <text x={tx} y={ly + 4} textAnchor={anchor} paintOrder="stroke" stroke="var(--surface)" strokeWidth={3} strokeLinejoin="round"
        style={{ ...chartText, fill: 'var(--ink)', fontWeight: 650, fontSize: 11.5 }}>{label}</text>
    </g>
  );
}
