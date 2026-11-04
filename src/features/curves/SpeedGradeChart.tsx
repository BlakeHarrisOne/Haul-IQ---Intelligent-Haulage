/**
 * Speed vs grade, small multiples (Loaded | Empty): the workbook's grade → max-speed table (step line) against the
 * physics balance speed (smooth) for the same truck, payload and rolling resistance. Shaded where the spreadsheet is
 * optimistic (faster than physics → too few trucks: solid rust tint) or pessimistic (slower → too many trucks: neutral
 * hatch), so the two read apart in both themes and in greyscale print.
 */
import { useMemo, useState, type PointerEvent } from 'react';
import type { GradeSpeedPoint } from '@/core/types';
import { num, signed } from '@/core/format';
import { AxisX, GridY, chartText, linePath, linear } from '@/ui';
import { useWidth } from '@/features/assumptions/shared/useWidth';
import { excelRound } from '@/features/assumptions/shared/excel';
import { range, tableSpeed, type TruckX } from './physics';
import { speedRows, limitShort } from './model';
import type { DerivedSpeedRow } from '@/engine';
import { speedAxisMax } from './domains';
import type { SeriesTruck } from './RimpullChart';
import c from './curves.module.css';

const GMAX = 20; // % shown either side (table covers ±16%)
const GRADES = range(-GMAX / 100, GMAX / 100, 0.0025);

interface Panel { dir: 'loaded' | 'empty'; mass: (t: TruckX) => number; payload: (t: TruckX) => number; table?: GradeSpeedPoint[] }

export interface Verdict { optimistic: [number, number][]; pessimistic: [number, number][] }

/** Contiguous grade ranges (in %) where the table is faster / slower than physics by more than tol km/h. */
export function verdictRanges(rows: { g: number; sheet?: number; phys: number }[], tol = 0.5): Verdict {
  const out: Verdict = { optimistic: [], pessimistic: [] };
  let prevK: keyof Verdict | null = null;
  for (const r of rows) {
    const k: keyof Verdict | null = r.sheet == null ? null : r.sheet - r.phys > tol ? 'optimistic' : r.phys - r.sheet > tol ? 'pessimistic' : null;
    if (k) {
      const list = out[k];
      if (prevK === k) list[list.length - 1][1] = r.g;
      else list.push([r.g, r.g]);
    }
    prevK = k;
  }
  return out;
}

const fmtRange = ([a, b]: [number, number]) => {
  const f = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), 0)}`;
  return a === b ? `${f(a)}%` : `${f(a)} to ${f(b)}%`;
};

function PanelChart({ p, series, rr, limit, W, hoverG, setHoverG }: {
  p: Panel; series: SeriesTruck[]; rr: number; limit?: number; W: number; hoverG: number | null; setHoverG: (g: number | null) => void;
}) {
  const H = 300, L = 46, R = 14, T = 16, B = 46;
  const prim = series[0];
  const data = useMemo(() => series.map(s => speedRows(s.t, p.dir === 'loaded', rr, p.payload(s.t), GRADES, limit).map(row => ({ g: row.grade, b: row }))), [series, p, rr, limit]);
  const sheetAt = (g: number) => tableSpeed(p.table, excelRound(g, 2));
  const ymax = speedAxisMax([...data.flat().map(d => d.b.kmh), ...(p.table ?? []).map(q => q[1])]);
  const x = linear([-GMAX, GMAX], [L, W - R]);
  const y = linear([0, ymax], [H - B, T]);
  const phys = data[0];
  // step line of the table: each row holds over its rounding window [g − 0.5%, g + 0.5%)
  const steps: [number, number][] = (p.table ? [...p.table].sort((a, b) => a[0] - b[0]) : []).flatMap(([g, v]) => [[g * 100 - 0.5, v], [g * 100 + 0.5, v]] as [number, number][]);
  // shaded difference runs
  const runs = useMemo(() => {
    const out: { k: 'o' | 'p'; pts: [number, number, number][] }[] = [];
    let prevK: 'o' | 'p' | null = null;
    for (const d of phys) {
      const sv = sheetAt(d.g);
      const k: 'o' | 'p' | null = sv == null ? null : sv > d.b.kmh + 0.05 ? 'o' : sv < d.b.kmh - 0.05 ? 'p' : null;
      if (k && sv != null) {
        if (prevK === k) out[out.length - 1].pts.push([d.g * 100, sv, d.b.kmh]);
        else out.push({ k, pts: [[d.g * 100, sv, d.b.kmh]] });
      }
      prevK = k;
    }
    return out;
  }, [phys, p.table]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = (pts: [number, number, number][]) =>
    `M${pts.map(q => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('L')}L${[...pts].reverse().map(q => `${x(q[0]).toFixed(1)},${y(q[2]).toFixed(1)}`).join('L')}Z`;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const g = x.invert(e.clientX - r.left);
    setHoverG(g < -GMAX || g > GMAX ? null : Math.round(g * 4) / 4);
  };
  const hv = hoverG != null ? phys.reduce((b, d) => (Math.abs(d.g * 100 - hoverG) < Math.abs(b.g * 100 - hoverG) ? d : b), phys[0]) : null;
  const hs = hv ? sheetAt(hv.g) : undefined;
  return (
    <div style={{ position: 'relative' }}>
      <svg width={W} height={H} className={c.svg} onPointerMove={onMove} onPointerLeave={() => setHoverG(null)} role="img"
        aria-label={`${p.dir} speed versus grade: workbook table against physics for ${prim.t.name}`}>
        <defs>
          <pattern id={`pess-${p.dir}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="color-mix(in srgb, var(--na) 10%, transparent)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-3)" strokeWidth="1.3" strokeOpacity=".55" />
          </pattern>
        </defs>
        <rect x={L} y={T} width={x(-16.5) - L} height={H - B - T} fill="var(--surface-3)" />
        <rect x={x(16.5)} y={T} width={W - R - x(16.5)} height={H - B - T} fill="var(--surface-3)" />
        <text x={(L + x(-16.5)) / 2} y={T + 14} textAnchor="middle" style={{ ...chartText, fontSize: 10.5 }}>no row</text>
        <text x={(x(16.5) + W - R) / 2} y={T + 14} textAnchor="middle" style={{ ...chartText, fontSize: 10.5 }}>no row</text>
        <GridY y={y} x0={L} x1={W - R} n={5} label="km/h" />
        <AxisX x={x} y0={H - B} n={8} fmt={v => signed(v, 0)} label="grade %, direction of travel" x1={W - R} />
        <line x1={x(0)} x2={x(0)} y1={T} y2={H - B} stroke="var(--hair)" />
        {runs.map((r, i) => <path key={i} d={area(r.pts)} fill={r.k === 'o' ? 'var(--bad-100)' : `url(#pess-${p.dir})`} opacity={r.k === 'o' ? 0.9 : 1} />)}
        <path d={linePath(steps, x, y)} fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => (
          <path key={series[i].t.id} d={linePath(d.map(q => [q.g * 100, q.b.kmh]), x, y)} fill="none" stroke={series[i].color} strokeWidth={i === 0 ? 2.5 : 1.75} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hv && (
          <g pointerEvents="none">
            <line x1={x(hv.g * 100)} x2={x(hv.g * 100)} y1={T} y2={H - B} stroke="var(--ink-3)" />
            {hs != null && <circle cx={x(hv.g * 100)} cy={y(hs)} r={4} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={2} />}
            {data.map((d, i) => { const q = d.find(z => z.g === hv.g)!; return <circle key={i} cx={x(q.g * 100)} cy={y(q.b.kmh)} r={4} fill={series[i].color} stroke="var(--surface)" strokeWidth={2} />; })}
          </g>
        )}
      </svg>
      {hv && (
        <div className={c.tip} style={{ left: x(hv.g * 100) > W - 240 ? x(hv.g * 100) - 236 : x(hv.g * 100) + 14, top: T + 4 }}>
          <div className={c.tipHead}>{hv.g >= 0 ? '+' : '−'}{num(Math.abs(hv.g) * 100, 2)}% · {p.dir}</div>
          <TipRow k={`Workbook (ROUND → ${num(excelRound(hv.g, 2) * 100, 0)}%)`} v={hs != null ? `${hs} km/h` : 'no row → time dropped'} color="var(--ink-2)" />
          {data.map((d, i) => { const q = d.find(z => z.g === hv.g)!; return <TipRow key={i} k={`${series[i].t.name}`} v={`${num(q.b.kmh, 1)} km/h · ${limTxt(q.b)}`} color={series[i].color} />; })}
          {hs != null && (() => {
            const q = hv.b.kmh;
            const dt = q > 0 ? 360 / q - 360 / hs : NaN;
            return <div className={c.tipNote}>{hs > q ? <span className={c.optim}>Table {num(hs - q, 1)} km/h faster</span> : hs < q ? <span className={c.pessim}>Table {num(q - hs, 1)} km/h slower</span> : 'Same speed'}{Number.isFinite(dt) && Math.abs(dt) > 0.05 ? ` · ${dt > 0 ? '+' : '−'}${num(Math.abs(dt), 1)} s per 100 m in physics` : ''}</div>;
          })()}
        </div>
      )}
    </div>
  );
}

const limTxt = (b: DerivedSpeedRow) => limitShort(b);

function TipRow({ k, v, color }: { k: string; v: string; color: string }) {
  return <div className={c.tipRow}><span className={c.tipKey} style={{ background: color }} /><span>{k}</span><b>{v}</b></div>;
}

export function SpeedGradePanels({ series, rr, payloadT, limit }: { series: SeriesTruck[]; rr: number; payloadT: (t: TruckX) => number; limit?: number }) {
  const [box, W0] = useWidth<HTMLDivElement>(1200, 360);
  const [hoverG, setHoverG] = useState<number | null>(null);
  const two = W0 >= 860;
  const W = two ? Math.floor((W0 - 20) / 2) : W0;
  const prim = series[0].t;
  const panels: Panel[] = useMemo(() => [
    { dir: 'loaded', mass: t => t.emptyMassT + payloadT(t), payload: t => payloadT(t), table: prim.spreadsheetSpeeds?.loaded },
    { dir: 'empty', mass: t => t.emptyMassT, payload: () => 0, table: prim.spreadsheetSpeeds?.empty },
  ], [prim, payloadT]);
  const verdicts = useMemo(() => panels.map(p => {
    const rows = speedRows(prim, p.dir === 'loaded', rr, p.payload(prim), range(-0.16, 0.16, 0.01), limit)
      .map(r => ({ g: Math.round(r.grade * 100), sheet: tableSpeed(p.table, excelRound(r.grade, 2)), phys: r.kmh }));
    return verdictRanges(rows);
  }), [panels, prim, rr, limit]);
  return (
    <div ref={box} className={c.panels} style={{ gridTemplateColumns: two ? '1fr 1fr' : '1fr' }}>
      {panels.map((p, i) => (
        <div key={p.dir}>
          <div className={c.panelTitle}>{p.dir === 'loaded' ? `Loaded · ${num(p.mass(prim), 0)} t` : `Empty · ${num(p.mass(prim), 0)} t`}</div>
          <div className={c.verdict}>
            {verdicts[i].optimistic.length > 0 && <>Workbook <span className={c.optim}>optimistic</span> on <b>{verdicts[i].optimistic.map(fmtRange).join(', ')}</b>. </>}
            {verdicts[i].pessimistic.length > 0 && <>Workbook <span className={c.pessim}>pessimistic</span> on <b>{verdicts[i].pessimistic.map(fmtRange).join(', ')}</b>.</>}
            {!verdicts[i].optimistic.length && !verdicts[i].pessimistic.length && 'Workbook table matches physics within 0.5 km/h.'}
          </div>
          <PanelChart p={p} series={series} rr={rr} limit={limit} W={W} hoverG={hoverG} setHoverG={setHoverG} />
        </div>
      ))}
    </div>
  );
}
