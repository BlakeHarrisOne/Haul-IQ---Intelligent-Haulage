/**
 * Rimpull / retarder chart (speed km/h × force kN): thin per-gear rimpull curves, bold envelope, dashed retarder,
 * horizontal resistance lines for the loaded and empty truck at the selected effective grade (draggable), balance-speed
 * intersections, and the selected circuit's segment operating points coloured by grade class.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { LimitReason, SegmentResult } from '@/core/types';
import { num, signed } from '@/core/format';
import { AxisX, GridY, chartText, gradeColor, linePath, linear } from '@/ui';
import { useWidth } from '@/features/assumptions/shared/useWidth';
import { curveForce, effGradeForce, gearAt, gradeability, type TruckX } from './physics';
import { balanceAt, limitShort, type Balance } from './model';
import { forceDomain, speedDomain, clampTo } from './domains';
import c from './curves.module.css';

export interface OpPoint {
  key: string; seg: SegmentResult; dir: 'loaded' | 'empty'; v: number; f: number; mode: 'propel' | 'retard';
  grade: number; limit: LimitReason; time: number; massT: number; gear?: number; binding?: string;
}
export interface SeriesTruck { t: TruckX; color: string }

const LIMIT_TXT: Record<string, string> = {
  rimpull: 'rimpull', retarder: 'retarder', 'speed-limit': 'speed limit', 'top-speed': 'top speed', table: 'table lookup', 'table-out-of-range': 'dropped (out of table)', stall: 'stall',
};

function sample(curve: [number, number][], step = 0.25, clampLow = true): [number, number][] {
  if (!curve.length) return [];
  const a = curve[0][0], b = curve[curve.length - 1][0];
  const out: [number, number][] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push([v, curveForce(curve, v, clampLow)]);
  if (out[out.length - 1][0] < b) out.push([b, curveForce(curve, b, clampLow)]);
  return out;
}

export function RimpullChart({ series, effGradePct, onGrade, massLoaded, massEmpty, points, speedLimit, circuitLabel }: {
  series: SeriesTruck[]; effGradePct: number; onGrade: (g: number) => void; massLoaded: number; massEmpty: number;
  points: OpPoint[]; speedLimit?: number; circuitLabel?: string;
}) {
  const [box, W] = useWidth<HTMLDivElement>(900, 360);
  const H = 470, L = 62, R = 168, T = 28, B = 50;
  const prim = series[0];
  const [show, setShow] = useState({ gears: true, env: true, ret: true, res: true, pts: true });
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hoverV, setHoverV] = useState<number | null>(null);
  const [hoverPt, setHoverPt] = useState<OpPoint | null>(null);
  const [kbd, setKbd] = useState(false);
  const drag = useRef(false);

  const fL = effGradeForce(massLoaded, Math.abs(effGradePct));
  const fE = effGradeForce(massEmpty, Math.abs(effGradePct));
  const sdom = speedDomain(series.map(s => s.t));
  const fdom = forceDomain(series.map(s => s.t), [fL * 1.02, ...points.map(p => p.f)]);
  const x = linear(sdom, [L, W - R]);
  const y = linear(fdom, [H - B, T]);
  const down = effGradePct < 0;
  const balL: Balance = balanceAt(prim.t, massLoaded, effGradePct / 100, speedLimit);
  const balE: Balance = balanceAt(prim.t, massEmpty, effGradePct / 100, speedLimit);

  const paths = useMemo(() => series.map(s => ({
    env: linePath(sample(s.t.rimpull), x, y),
    ret: linePath(sample(s.t.retarder, 0.25, false).filter(p => p[1] > 0), x, y),
    gears: (s.t.rimpullGears ?? []).map(g => ({ g, d: linePath(sample(g.points.filter(q => q[1] > 0), 0.2, false), x, y) })),
  })), [series, x, y]); // eslint-disable-line react-hooks/exhaustive-deps

  const pxToV = (px: number) => clampTo(x.invert(px), sdom);
  const nearest = (px: number, py: number) => {
    let best: OpPoint | null = null, bd = 16 * 16;
    if (!show.pts) return null;
    for (const p of points) {
      const dx = x(p.v) - px, dy = y(p.f) - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (drag.current) {
      const f = Math.max(0, y.invert(py));
      const g = Math.round(gradeability(f, massLoaded) * 2) / 2;
      onGrade(Math.max(0, Math.min(25, g)) * (down ? -1 : 1));
      return;
    }
    setKbd(false);
    if (px < L || px > W - R + 4 || py < T - 6 || py > H - B + 4) { setHoverV(null); setHoverPt(null); return; }
    setHoverPt(nearest(px, py));
    setHoverV(pxToV(px));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key, step = e.shiftKey ? 5 : 0.5;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault(); setKbd(true); setHoverPt(null);
      setHoverV(v => clampTo((v ?? balL.kmh) + (k === 'ArrowRight' ? step : -step), sdom));
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault(); onGrade(Math.round((effGradePct + (k === 'ArrowUp' ? 0.5 : -0.5)) * 2) / 2);
    } else if (k === 'Escape') { setHoverV(null); setHoverPt(null); }
  };

  const yL = y(fL), yE = y(fE);
  const labelGap = Math.abs(yL - yE) < 30 ? 30 - Math.abs(yL - yE) : 0;
  const vis = (id: string) => !hidden[id];
  const hv = hoverV;
  const tipLeft = (px: number) => (px > W - R - 230 ? px - 250 : px + 18);

  return (
    <div ref={box} className={c.chartWrap} tabIndex={0} onKeyDown={onKey} onBlur={() => kbd && setHoverV(null)}
      aria-label={`Rimpull and retarder chart. Effective grade ${effGradePct} percent. Loaded balance speed ${num(balL.kmh, 1)} km/h, empty ${num(balE.kmh, 1)} km/h. Arrow keys move the speed readout; up and down change the grade.`}>
      <svg className={c.svg} width={W} height={H} role="img" aria-hidden
        onPointerMove={onMove}
        onPointerLeave={() => { if (!drag.current) { setHoverV(null); setHoverPt(null); } }}
        onPointerUp={e => { drag.current = false; (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId); }}>
        <GridY y={y} x0={L} x1={W - R} n={6} fmt={v => num(v, 0)} label="kN" />
        <AxisX x={x} y0={H - B} n={8} fmt={v => num(v, 0)} label="Speed, km/h" x1={W - R} />
        {speedLimit != null && Number.isFinite(speedLimit) && speedLimit < sdom[1] && (
          <g>
            <line x1={x(speedLimit)} x2={x(speedLimit)} y1={T} y2={H - B} stroke="var(--ink-4)" strokeDasharray="2 4" />
            <text x={x(speedLimit) + 4} y={T + 10} style={{ ...chartText, fontSize: 11 }}>limit {speedLimit} km/h</text>
          </g>
        )}

        {/* overlays first (under the primary) */}
        {series.map((s, si) => vis(s.t.id) && (
          <g key={s.t.id} opacity={si === 0 ? 1 : 0.95}>
            {si === 0 && show.gears && paths[si].gears.map(({ g, d }) => (
              <g key={g.gear}>
                <path d={d} fill="none" stroke="var(--ink-4)" strokeWidth={1} opacity={0.75} />
                <text x={x(g.maxKmh)} y={y(curveForce(g.points, g.maxKmh * 0.985, false)) - 7} textAnchor="middle" style={{ ...chartText, fontSize: 10.5, fill: 'var(--ink-3)' }}>{g.gear}</text>
              </g>
            ))}
            {show.ret && <path d={paths[si].ret} fill="none" stroke={s.color} strokeWidth={si === 0 ? 2 : 1.5} strokeDasharray="6 4" strokeLinecap="round" opacity={0.9} />}
            {show.env && <path d={paths[si].env} fill="none" stroke={s.color} strokeWidth={si === 0 ? 2.75 : 2} strokeLinejoin="round" strokeLinecap="round" />}
            {show.env && (() => {
              const last = s.t.rimpull.filter(p => p[1] > 0).at(-1);
              if (!last) return null;
              return <text x={x(last[0]) + 6} y={y(last[1]) - (si * 14)} dy="0.32em" style={{ ...chartText, fill: 'var(--ink-2)', fontWeight: 650 }}>{s.t.name}</text>;
            })()}
          </g>
        ))}

        {/* resistance lines */}
        {show.res && [{ f: fL, yy: yL, bal: balL, m: massLoaded, lab: 'Loaded', col: 'var(--ink)', dash: undefined as string | undefined, off: 0 },
          { f: fE, yy: yE, bal: balE, m: massEmpty, lab: 'Empty', col: 'var(--ink-3)', dash: '1 0', off: yE >= yL ? labelGap : -labelGap }].map((r, i) => (
          <g key={r.lab}>
            <line x1={L} x2={W - R} y1={r.yy} y2={r.yy} stroke={r.col} strokeWidth={1.5} strokeDasharray={r.dash} opacity={i === 0 ? 0.85 : 0.75} />
            <text x={W - R + 10} y={r.yy + r.off - 6} style={{ ...chartText, fill: 'var(--ink)', fontWeight: 650 }}>{r.lab} {num(r.m, 0)} t</text>
            <text x={W - R + 10} y={r.yy + r.off + 9} style={{ ...chartText, fontSize: 11 }}>{num(r.f, 0)} kN {down ? 'braking' : 'resistance'}</text>
            {r.bal.kmh > 0 && (
              <g>
                <line x1={x(r.bal.kmh)} x2={x(r.bal.kmh)} y1={r.yy} y2={H - B} stroke={r.col} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                <circle cx={x(r.bal.kmh)} cy={r.yy} r={5.5} fill={prim.color} stroke="var(--surface)" strokeWidth={2} />
                <text x={x(r.bal.kmh) + 8} y={r.yy - 8} style={{ ...chartText, fill: 'var(--ink)', fontWeight: 700, fontSize: 12 }}>
                  {num(r.bal.kmh, 1)} km/h · {limitShort(r.bal)}
                </text>
              </g>
            )}
            {i === 0 && (
              <g className={c.dragHandle} onPointerDown={e => { drag.current = true; (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture?.(e.pointerId); }}>
                <line x1={L} x2={W - R} y1={r.yy} y2={r.yy} stroke="transparent" strokeWidth={16} />
                <rect x={W - R - 14} y={r.yy - 9} width={12} height={18} rx={4} fill="var(--surface)" stroke="var(--ink-3)" />
                <line x1={W - R - 10} x2={W - R - 6} y1={r.yy - 2} y2={r.yy - 2} stroke="var(--ink-3)" />
                <line x1={W - R - 10} x2={W - R - 6} y1={r.yy + 2} y2={r.yy + 2} stroke="var(--ink-3)" />
              </g>
            )}
          </g>
        ))}

        {/* operating points */}
        {show.pts && points.map(p => {
          const px = x(p.v), py = y(p.f), col = gradeColor(p.grade);
          const on = hoverPt?.key === p.key;
          // filled = propelling (read against rimpull) · hollow = braking (read against the retarder)
          const fill = p.mode === 'propel' ? col : 'var(--surface)';
          const sw = p.mode === 'propel' ? 2 : 2.2;
          const stroke = p.mode === 'propel' ? 'var(--surface)' : col;
          return p.dir === 'loaded'
            ? <circle key={p.key} cx={px} cy={py} r={on ? 6.5 : 4.5} fill={fill} stroke={stroke} strokeWidth={sw} />
            : <rect key={p.key} x={px - (on ? 6 : 4)} y={py - (on ? 6 : 4)} width={on ? 12 : 8} height={on ? 12 : 8} transform={`rotate(45 ${px} ${py})`} fill={fill} stroke={stroke} strokeWidth={sw} />;
        })}

        {/* crosshair */}
        {hv != null && !hoverPt && (
          <g pointerEvents="none">
            <line x1={x(hv)} x2={x(hv)} y1={T} y2={H - B} stroke="var(--ink-3)" strokeWidth={1} />
            {series.filter(s => vis(s.t.id)).map(s => {
              const f = curveForce(s.t.rimpull, hv);
              return f > 0 ? <circle key={s.t.id} cx={x(hv)} cy={y(f)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
            })}
          </g>
        )}
      </svg>

      {hoverPt && (
        <div className={c.tip} style={{ left: tipLeft(x(hoverPt.v)), top: Math.max(4, y(hoverPt.f) - 40) }}>
          <div className={c.tipHead}>Segment {hoverPt.seg.i + 1} · {hoverPt.dir}</div>
          <Row k="Chainage" v={`${num(hoverPt.seg.chainageM, 0)} m · ${num(hoverPt.seg.dist3dM, 1)} m long`} />
          <Row k="Grade" v={`${hoverPt.grade >= 0 ? '+' : '−'}${num(Math.abs(hoverPt.grade) * 100, 2)}%  (RR ${num(hoverPt.seg.rrPct, 1)}%)`} color={gradeColor(hoverPt.grade)} />
          <Row k={hoverPt.mode === 'propel' ? 'Resistance' : 'Braking needed'} v={`${num(hoverPt.f, 0)} kN @ ${num(hoverPt.massT, 0)} t`} />
          <Row k="Speed" v={`${num(hoverPt.v, 1)} km/h`} />
          <Row k="Limited by" v={`${LIMIT_TXT[hoverPt.binding ?? hoverPt.limit] ?? hoverPt.binding ?? hoverPt.limit}${hoverPt.gear ? ` · gear ${hoverPt.gear}` : ''}`} />
          <Row k="Time" v={`${num(hoverPt.time, 1)} s`} />
          {hoverPt.limit === 'table' && curveForce(prim.t.rimpull, hoverPt.v) < hoverPt.f && hoverPt.mode === 'propel' && (
            <div className={c.tipNote} style={{ color: 'var(--bad-ink)' }}>Above the rimpull envelope – the table speed is not physically reachable.</div>
          )}
        </div>
      )}
      {hv != null && !hoverPt && (
        <div className={c.tip} style={{ left: tipLeft(x(hv)), top: T + 8 }}>
          <div className={c.tipHead}>{num(hv, 1)} km/h</div>
          {series.filter(s => vis(s.t.id)).map((s, i) => {
            const f = curveForce(s.t.rimpull, hv), g = gearAt(s.t.rimpullGears, hv), rf = curveForce(s.t.retarder, hv, false);
            return (
              <div key={s.t.id} style={{ marginTop: i ? 6 : 0 }}>
                <Row k={`${s.t.name} rimpull`} v={f > 0 ? `${num(f, 0)} kN${g ? ` · G${g}` : ''}` : 'beyond top speed'} color={s.color} />
                {i === 0 && f > 0 && <Row k="climbs loaded / empty" v={`${num(gradeability(f, massLoaded), 1)} / ${num(gradeability(f, massEmpty), 1)}%`} />}
                {rf > 0 && <Row k="retarder" v={`${num(rf, 0)} kN${i === 0 ? ` · holds −${num(gradeability(rf, massLoaded), 1)}% loaded` : ''}`} color={s.color} dashed />}
              </div>
            );
          })}
          <div className={c.tipNote}>Effective grade = grade + rolling resistance.</div>
        </div>
      )}

      <div className={c.legend} role="group" aria-label="Chart layers">
        <LegBtn on={show.env} onClick={() => setShow(s => ({ ...s, env: !s.env }))} label="Rimpull envelope" stroke={prim.color} w={2.75} />
        {!!prim.t.rimpullGears?.length && <LegBtn on={show.gears} onClick={() => setShow(s => ({ ...s, gears: !s.gears }))} label="Per-gear rimpull" stroke="var(--ink-4)" w={1.2} />}
        <LegBtn on={show.ret} onClick={() => setShow(s => ({ ...s, ret: !s.ret }))} label="Retarder (continuous)" stroke={prim.color} w={2} dash="5 3" />
        <LegBtn on={show.res} onClick={() => setShow(s => ({ ...s, res: !s.res }))} label={`Resistance @ ${signed(effGradePct, Number.isInteger(effGradePct) ? 0 : 1)}% eff.`} stroke="var(--ink)" w={1.5} />
        {points.length > 0 && <LegBtn on={show.pts} onClick={() => setShow(s => ({ ...s, pts: !s.pts }))} label={<>Operating points{circuitLabel ? ` · ${circuitLabel}` : ''} <span style={{ color: 'var(--ink-3)' }}>● loaded ◆ empty · filled = propelling, hollow = braking</span></>} dot />}
        {series.length > 1 && series.map(s => (
          <LegBtn key={s.t.id} on={vis(s.t.id)} onClick={() => setHidden(h => ({ ...h, [s.t.id]: !h[s.t.id] }))} label={s.t.name} stroke={s.color} w={2.5} />
        ))}
      </div>
    </div>
  );
}

function Row({ k, v, color, dashed }: { k: string; v: string; color?: string; dashed?: boolean }) {
  return (
    <div className={c.tipRow}>
      <span className={c.tipKey} style={color ? { background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color } : undefined} />
      <span>{k}</span><b>{v}</b>
    </div>
  );
}

function LegBtn({ on, onClick, label, stroke, w = 2, dash, dot }: { on: boolean; onClick: () => void; label: ReactNode; stroke?: string; w?: number; dash?: string; dot?: boolean }) {
  return (
    <button type="button" className={c.legItem} aria-pressed={on} onClick={onClick}>
      <svg width="20" height="10" aria-hidden>
        {dot
          ? <>{['var(--grade-flat)', 'var(--grade-mod)', 'var(--grade-steep)', 'var(--grade-max)'].map((col, i) => <circle key={i} cx={3 + i * 4.6} cy={5} r={2.6} fill={col} />)}</>
          : <line x1="1" x2="19" y1="5" y2="5" stroke={stroke} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" />}
      </svg>
      {label}
    </button>
  );
}
