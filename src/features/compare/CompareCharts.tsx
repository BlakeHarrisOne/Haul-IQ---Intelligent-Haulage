/** Compare-tab charts: trucks needed vs assigned (dot plot), horizontal bars with reference lines, truck-count curve. */
import { useState, type ReactNode } from 'react';
import type { FleetOption } from '@/core/types';
import { num } from '@/core/format';
import { AxisX, GridY, chartText, linear, linePath, niceDomain } from '@/ui';
import { useWidth } from '@/features/assumptions/shared/useWidth';
import type { CircuitRow } from './compareData';
import s from './compare.module.css';

const ROW_H = 34;
const LABEL_W = 150;
const truncate = (t: string, n = 20) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function RowLabels({ rows, y0 }: { rows: { id: string; name: string; color: string }[]; y0: number }) {
  return (
    <g>
      {rows.map((r, i) => (
        <g key={r.id} transform={`translate(0,${y0 + i * ROW_H + ROW_H / 2})`}>
          <circle cx={6} cy={0} r={4} fill={r.color} />
          <text x={16} y={0} dy="0.32em" style={{ ...chartText, fill: 'var(--ink)', fontWeight: 600 }}>{truncate(r.name)}</text>
        </g>
      ))}
    </g>
  );
}

/** Trucks needed (exact, hollow), recommended (tick) and assigned (filled) per circuit. */
export function TrucksDotPlot({ rows }: { rows: CircuitRow[] }) {
  const [box, W] = useWidth<HTMLDivElement>(440, 300);
  const [hover, setHover] = useState<number | null>(null);
  const T = 8, B = 40, R = 16;
  const H = T + rows.length * ROW_H + B;
  const max = Math.max(4, ...rows.flatMap(r => [r.assigned, r.exact, r.recommended].filter(Number.isFinite)));
  const x = linear([0, Math.ceil(max + 0.5)], [LABEL_W, W - R]);
  const tone = (r: CircuitRow) => (r.status === 'under' ? 'var(--bad)' : r.status === 'over' ? 'var(--warn)' : 'var(--ok)');
  return (
    <div ref={box} className={s.chartBox}>
      <svg width={W} height={H} className={s.svg} role="img" aria-label="Trucks needed versus assigned per circuit" onPointerLeave={() => setHover(null)}>
        {x.ticks(Math.min(10, Math.ceil(max + 0.5))).map(t => <line key={t} x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="var(--hair)" shapeRendering="crispEdges" />)}
        <AxisX x={x} y0={H - B} n={Math.min(10, Math.ceil(max + 0.5))} label="trucks" />
        <RowLabels rows={rows} y0={T} />
        {rows.map((r, i) => {
          const cy = T + i * ROW_H + ROW_H / 2;
          if (!r.ok) return <text key={r.id} x={LABEL_W} y={cy} dy="0.32em" style={{ ...chartText, fill: 'var(--bad-ink)' }}>not calculated</text>;
          const lo = Math.min(r.assigned, r.exact), hi = Math.max(r.assigned, r.exact);
          return (
            <g key={r.id} onPointerEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.55}>
              <rect x={LABEL_W - 4} y={cy - ROW_H / 2} width={W - R - LABEL_W + 8} height={ROW_H} fill="transparent" />
              <line x1={x(lo)} x2={x(hi)} y1={cy} y2={cy} stroke={tone(r)} strokeWidth={3} strokeLinecap="round" opacity={0.55} />
              <line x1={x(r.recommended)} x2={x(r.recommended)} y1={cy - 8} y2={cy + 8} stroke="var(--ink-3)" strokeWidth={2} strokeLinecap="round" />
              <circle cx={x(r.exact)} cy={cy} r={5.5} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={2} />
              <circle cx={x(r.assigned)} cy={cy} r={6} fill="var(--c1)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      {hover != null && rows[hover]?.ok && (
        <div className={s.tip} style={{ left: Math.min(W - 200, LABEL_W + 20), top: T + hover * ROW_H + ROW_H }}>
          <div className={s.tipHead}>{rows[hover].name}</div>
          <div className={s.tipRow}><span>Assigned</span><b>{rows[hover].assigned}</b></div>
          <div className={s.tipRow}><span>Needed (exact)</span><b>{num(rows[hover].exact, 2)}</b></div>
          <div className={s.tipRow}><span>Recommended</span><b>{rows[hover].recommended}</b></div>
          <div className={s.tipRow}><span>Status</span><b>{rows[hover].status}</b></div>
        </div>
      )}
      <div className={s.legend}>
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="var(--c1)" /></svg>assigned</span>
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--ink-2)" strokeWidth="2" /></svg>needed (exact)</span>
        <span><svg width="10" height="14"><line x1="5" x2="5" y1="2" y2="12" stroke="var(--ink-3)" strokeWidth="2" /></svg>recommended</span>
        <span><svg width="16" height="8"><line x1="1" x2="15" y1="4" y2="4" stroke="var(--bad)" strokeWidth="3" opacity=".55" /></svg>gap: under</span>
        <span><svg width="16" height="8"><line x1="1" x2="15" y1="4" y2="4" stroke="var(--warn)" strokeWidth="3" opacity=".55" /></svg>over</span>
      </div>
    </div>
  );
}

export interface BarDatum { id: string; name: string; color: string; value: number; tone: 'ok' | 'bad' | 'warn' | 'na'; tick?: number; tip?: ReactNode }

/** Horizontal bars (≤ 24 px, rounded data end) with optional reference line and per-row tick. */
export function HBarChart({ data, domain, fmt, refLine, unit, ariaLabel, tickLabel }: {
  data: BarDatum[]; domain?: [number, number]; fmt: (v: number) => string; refLine?: { value: number; label: string }; unit: string; ariaLabel: string; tickLabel?: string;
}) {
  const [box, W] = useWidth<HTMLDivElement>(440, 300);
  const [hover, setHover] = useState<number | null>(null);
  const T = 18, B = 40, R = 64;
  const H = T + data.length * ROW_H + B;
  const vmax = Math.max(...data.map(d => d.value).filter(Number.isFinite), refLine?.value ?? 0, ...data.map(d => d.tick ?? 0));
  const dom = domain ?? niceDomain(0, Math.max(vmax * 1.1, 0.5), 5);
  const x = linear(dom, [LABEL_W, W - R]);
  const col = (t: BarDatum['tone']) => (t === 'ok' ? 'var(--ok)' : t === 'bad' ? 'var(--bad)' : t === 'warn' ? 'var(--warn)' : 'var(--na)');
  const bh = Math.min(18, ROW_H - 12);
  return (
    <div ref={box} className={s.chartBox}>
      <svg width={W} height={H} className={s.svg} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {x.ticks(5).map(t => <line key={t} x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="var(--hair)" shapeRendering="crispEdges" />)}
        <AxisX x={x} y0={H - B} n={5} fmt={v => num(v, v < 10 && dom[1] <= 5 ? 1 : 0)} label={unit} />
        <RowLabels rows={data} y0={T} />
        {data.map((d, i) => {
          const cy = T + i * ROW_H + ROW_H / 2;
          const v = Number.isFinite(d.value) ? Math.max(dom[0], Math.min(dom[1], d.value)) : dom[0];
          const x0 = x(dom[0]), x1 = x(v), w = Math.max(0, x1 - x0);
          const rr = Math.min(4, w / 2);
          // rounded data end only: square at the baseline
          const path = w <= 0 ? '' : `M${x0},${cy - bh / 2}H${x1 - rr}Q${x1},${cy - bh / 2} ${x1},${cy - bh / 2 + rr}V${cy + bh / 2 - rr}Q${x1},${cy + bh / 2} ${x1 - rr},${cy + bh / 2}H${x0}Z`;
          return (
            <g key={d.id} onPointerEnter={() => setHover(i)} opacity={hover == null || hover === i ? 1 : 0.6}>
              <rect x={LABEL_W - 4} y={cy - ROW_H / 2} width={W - LABEL_W} height={ROW_H} fill="transparent" />
              {path && <path d={path} fill={col(d.tone)} />}
              {d.tick != null && Number.isFinite(d.tick) && <line x1={x(d.tick)} x2={x(d.tick)} y1={cy - bh / 2 - 3} y2={cy + bh / 2 + 3} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />}
              <text x={W - 4} y={cy} dy="0.32em" textAnchor="end" style={{ ...chartText, fill: 'var(--ink)', fontWeight: 650 }}>{Number.isFinite(d.value) ? fmt(d.value) : '–'}</text>
            </g>
          );
        })}
        {refLine && (
          <g>
            <line x1={x(refLine.value)} x2={x(refLine.value)} y1={T - 8} y2={H - B} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={x(refLine.value)} y={T - 10} textAnchor="middle" style={{ ...chartText, fill: 'var(--ink)', fontWeight: 650 }}>{refLine.label}</text>
          </g>
        )}
      </svg>
      {hover != null && data[hover]?.tip && (
        <div className={s.tip} style={{ left: Math.min(W - 200, LABEL_W + 20), top: T + hover * ROW_H + ROW_H }}>{data[hover].tip}</div>
      )}
      {tickLabel && (
        <div className={s.legend}>
          <span><svg width="10" height="14"><line x1="5" x2="5" y1="1" y2="13" stroke="var(--ink)" strokeWidth="2" /></svg>{tickLabel}</span>
          {refLine && <span><svg width="16" height="10"><line x1="8" x2="8" y1="0" y2="10" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="3 2" /></svg>{refLine.label}</span>}
        </div>
      )}
    </div>
  );
}

/** Production and losses vs number of trucks for one circuit: two aligned panels sharing the x axis (no dual axis). */
export function TruckCountChart({ options: all, current, whatIf, target, ideal, recommended = 0 }: { options: FleetOption[]; current: number; whatIf: number; target: number; ideal?: number; recommended?: number }) {
  const [box, W] = useWidth<HTMLDivElement>(560, 320);
  // show the decision range: up to 3 trucks past the larger of current / what-if / recommended
  const options = all.slice(0, Math.max(4, Math.min(all.length, Math.max(current, whatIf, recommended) + 3)));
  const [hover, setHover] = useState<number | null>(null);
  const L = 58, R = 16, H1 = 170, H2 = 120, gap = 26, T = 18, B = 36;
  const n = options.length;
  if (!n) return null;
  const x = linear([0.5, n + 0.5], [L, W - R]);
  const ymax = niceDomain(0, Math.max(target, ideal ?? 0, ...options.map(o => o.truckCapacityBcmDay)) * 1.05, 4)[1];
  const y1 = linear([0, ymax], [T + H1, T]);
  const lmax = niceDomain(0, Math.max(0.5, ...options.flatMap(o => [o.lostLoaderPtHrsShift, o.truckQueueHrsShift])), 4)[1];
  const top2 = T + H1 + gap;
  const y2 = linear([0, lmax], [top2 + H2, top2]);
  const bw = Math.min(10, (x(2) - x(1)) / 2 - 3);
  const H = top2 + H2 + B;
  const band = (k: number, fill: string) => <rect x={x(k) - (x(2) - x(1)) / 2} width={x(2) - x(1)} y={T} height={top2 + H2 - T} fill={fill} />;
  return (
    <div ref={box} className={s.chartBox}>
      <svg width={W} height={H} className={s.svg} role="img" aria-label="Production and lost hours versus number of trucks"
        onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); const k = Math.round(x.invert(e.clientX - r.left)); setHover(k >= 1 && k <= n ? k : null); }}
        onPointerLeave={() => setHover(null)}>
        {band(current, 'var(--surface-3)')}
        {whatIf !== current && band(whatIf, 'var(--accent-50)')}
        <GridY y={y1} x0={L} x1={W - R} n={4} fmt={v => (v >= 1000 ? `${num(v / 1000, 0)}k` : num(v, 0))} label="bcm/day" />
        <line x1={L} x2={W - R} y1={y1(target)} y2={y1(target)} stroke="var(--ink)" strokeDasharray="4 3" strokeWidth={1.2} />
        <text x={W - R} y={y1(target) - 5} textAnchor="end" style={{ ...chartText, fill: 'var(--ink)' }}>target {num(target, 0)}</text>
        <path d={linePath(options.map(o => [o.trucks, o.truckCapacityBcmDay]), x, y1)} fill="none" stroke="var(--ink-4)" strokeWidth={1.5} strokeDasharray="2 3" />
        <path d={linePath(options.map(o => [o.trucks, o.bcmPerDay]), x, y1)} fill="none" stroke="var(--c1)" strokeWidth={2} />
        {options.map(o => <circle key={o.trucks} cx={x(o.trucks)} cy={y1(o.bcmPerDay)} r={o.trucks === whatIf ? 5.5 : 3.5} fill="var(--c1)" stroke="var(--surface)" strokeWidth={2} />)}
        <GridY y={y2} x0={L} x1={W - R} n={3} fmt={v => num(v, lmax >= 10 ? 0 : 1)} label="h/shift" />
        {options.map(o => (
          <g key={o.trucks}>
            {o.lostLoaderPtHrsShift > 0 && <rect x={x(o.trucks) - bw - 1} width={bw} y={y2(o.lostLoaderPtHrsShift)} height={y2(0) - y2(o.lostLoaderPtHrsShift)} rx={2} fill="var(--bad)" />}
            {o.truckQueueHrsShift > 0 && <rect x={x(o.trucks) + 1} width={bw} y={y2(o.truckQueueHrsShift)} height={y2(0) - y2(o.truckQueueHrsShift)} rx={2} fill="var(--warn)" />}
          </g>
        ))}
        <AxisX x={x} y0={top2 + H2} n={Math.min(n, 12)} fmt={v => (Number.isInteger(v) ? String(v) : '')} label="trucks" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={top2 + H2} stroke="var(--ink-3)" pointerEvents="none" />}
      </svg>
      {hover != null && (() => {
        const o = options[hover - 1];
        return (
          <div className={s.tip} style={{ left: x(hover) > W - 220 ? x(hover) - 210 : x(hover) + 12, top: T }}>
            <div className={s.tipHead}>{hover} trucks{hover === current ? ' · current' : ''}{hover === whatIf && whatIf !== current ? ' · what-if' : ''}</div>
            <div className={s.tipRow}><span>Production</span><b>{num(o.bcmPerDay, 0)} bcm/day</b></div>
            <div className={s.tipRow}><span>Truck capacity</span><b>{num(o.truckCapacityBcmDay, 0)}</b></div>
            <div className={s.tipRow}><span>Loader PT</span><b>{num(o.loaderPtHrsDay, 1)} h/day</b></div>
            <div className={s.tipRow}><span>Lost PT</span><b>{num(o.lostLoaderPtHrsShift, 2)} h/shift</b></div>
            <div className={s.tipRow}><span>Truck queue</span><b>{num(o.truckQueueHrsShift, 2)} h/shift</b></div>
            <div className={s.tipRow}><span>Match factor</span><b>{num(o.matchFactor, 2)}</b></div>
          </div>
        );
      })()}
      <div className={s.legend}>
        <span><svg width="16" height="8"><line x1="1" x2="15" y1="4" y2="4" stroke="var(--c1)" strokeWidth="2" /></svg>production achieved</span>
        <span><svg width="16" height="8"><line x1="1" x2="15" y1="4" y2="4" stroke="var(--ink-4)" strokeWidth="1.5" strokeDasharray="2 3" /></svg>truck capacity</span>
        <span><svg width="12" height="10"><rect width="12" height="10" rx="2" fill="var(--bad)" /></svg>lost loader PT (under-trucked)</span>
        <span><svg width="12" height="10"><rect width="12" height="10" rx="2" fill="var(--warn)" /></svg>truck queue (over-trucked)</span>
        <span><svg width="12" height="10"><rect width="12" height="10" rx="2" fill="var(--surface-3)" stroke="var(--hair)" /></svg>current</span>
        {whatIf !== current && <span><svg width="12" height="10"><rect width="12" height="10" rx="2" fill="var(--accent-50)" stroke="var(--accent-200)" /></svg>what-if</span>}
      </div>
    </div>
  );
}
