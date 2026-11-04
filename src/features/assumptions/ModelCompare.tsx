/** "Spreadsheet vs Rimpull" — the same circuit solved by the workbook lookup and by the physics model, with the why. */
import { useMemo } from 'react';
import type { CircuitResult, LimitReason } from '@/core/types';
import { num } from '@/core/format';
import { Card, CardHead, Icon } from '@/ui';
import { delta, deltaTone, fmtDelta, fmtPctDelta } from './shared/delta';
import { REASON } from './SegmentTable';
import s from './assumptions.module.css';

interface Row { label: string; a: number; b: number; dp: number; unit: string; better: 'up' | 'down' | 'none'; hi?: boolean }

const BANDS: { label: string; lo: number; hi: number }[] = [
  { label: 'Down ≥ 8 %', lo: -1, hi: -0.075 },
  { label: 'Down 4–7 %', lo: -0.075, hi: -0.035 },
  { label: 'Flat ±3 %', lo: -0.035, hi: 0.035 },
  { label: 'Up 4–7 %', lo: 0.035, hi: 0.075 },
  { label: 'Up ≥ 8 %', lo: 0.075, hi: 1 },
];

/** Per-band travel-time differences (rimpull − spreadsheet), loaded and empty legs, in seconds. */
export function bandDeltas(sheet: CircuitResult, rim: CircuitResult) {
  return BANDS.map(b => {
    let dl = 0, de = 0, n = 0;
    sheet.segments.forEach((x, i) => {
      const y = rim.segments[i];
      if (!y || x.grade < b.lo || x.grade >= b.hi) return;
      dl += y.timeLoadedS - x.timeLoadedS;
      de += y.timeEmptyS - x.timeEmptyS;
      n++;
    });
    return { ...b, dl, de, n };
  });
}

function limitShare(r: CircuitResult): [LimitReason, number][] {
  const m = new Map<LimitReason, number>();
  for (const x of r.segments) {
    m.set(x.limitLoaded, (m.get(x.limitLoaded) ?? 0) + x.timeLoadedS);
    m.set(x.limitEmpty, (m.get(x.limitEmpty) ?? 0) + x.timeEmptyS);
  }
  const tot = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()].map(([k, v]) => [k, v / tot] as [LimitReason, number]).sort((a, b) => b[1] - a[1]);
}

export function ModelCompare({ sheet, rim, assigned }: { sheet: CircuitResult; rim: CircuitResult; assigned: number }) {
  const rows: Row[] = [
    { label: 'Travel loaded', a: sheet.travelLoadedS, b: rim.travelLoadedS, dp: 1, unit: 's', better: 'down' },
    { label: 'Travel empty', a: sheet.travelEmptyS, b: rim.travelEmptyS, dp: 1, unit: 's', better: 'down' },
    { label: 'Haul time (÷ η)', a: sheet.haulTimeS, b: rim.haulTimeS, dp: 1, unit: 's', better: 'down' },
    { label: 'Cycle time', a: sheet.cycleMin, b: rim.cycleMin, dp: 2, unit: 'min', better: 'down', hi: true },
    { label: 'Truck productivity', a: sheet.truckProdBcmPerPtHr, b: rim.truckProdBcmPerPtHr, dp: 1, unit: 'bcm/PT h', better: 'up' },
    { label: 'Trucks needed', a: sheet.trucksExact, b: rim.trucksExact, dp: 2, unit: '', better: 'down', hi: true },
    { label: 'Recommended', a: sheet.trucksRecommended, b: rim.trucksRecommended, dp: 0, unit: '', better: 'down' },
    { label: `Lost PT @ ${assigned} trucks`, a: sheet.assigned.lostLoaderPtHrsShift, b: rim.assigned.lostLoaderPtHrsShift, dp: 2, unit: 'h/shift', better: 'down' },
  ];
  const bands = useMemo(() => bandDeltas(sheet, rim), [sheet, rim]);
  const maxAbs = Math.max(1, ...bands.flatMap(b => [Math.abs(b.dl), Math.abs(b.de)]));
  const why = useMemo(() => {
    const out: string[] = [];
    const d = rim.cycleS - sheet.cycleS;
    if (Math.abs(d) < 0.5) out.push('Both models give the same cycle on this route.');
    const big = [...bands].map(b => ({ ...b, t: b.dl + b.de })).sort((a, b) => Math.abs(b.t) - Math.abs(a.t))[0];
    if (big && Math.abs(big.t) >= 1) out.push(`Biggest difference on ${big.label.toLowerCase()} segments (${big.n}): physics is ${big.t > 0 ? 'slower' : 'faster'} by ${num(Math.abs(big.t), 0)} s per cycle.`);
    const dropped = sheet.segments.filter(x => x.limitLoaded === 'table-out-of-range' || x.limitEmpty === 'table-out-of-range');
    if (dropped.length) out.push(`The workbook drops ${dropped.length} segment(s) steeper than ±16 % (${num(dropped.reduce((a, x) => a + x.dist3dM, 0), 1)} m) — their time counts as 0 s; physics times them.`);
    const share = limitShare(rim).filter(([k]) => k !== 'table' && k !== 'table-out-of-range').slice(0, 3);
    if (share.length) out.push(`Physics time is bound by ${share.map(([k, v]) => `${REASON[k]} ${num(v * 100, 0)} %`).join(', ')}.`);
    if (rim.speedModel === sheet.speedModel || (rim.segments.every(x => x.limitLoaded === 'table' || x.limitLoaded === 'table-out-of-range') && rim.segments.length))
      out.push('The engine returned table speeds for the rimpull run — the physics model is not active yet in this build.');
    return out;
  }, [sheet, rim, bands]);
  return (
    <Card>
      <CardHead title="Spreadsheet vs rimpull" sub="same circuit, two speed models" icon="compare" />
      <table className={s.cmpTable}>
        <thead><tr><th className={s.l}>Result</th><th>Spreadsheet</th><th>Rimpull</th><th>Δ</th></tr></thead>
        <tbody>
          {rows.map(r => {
            const d = delta(r.a, r.b);
            const tone = deltaTone(d.abs, r.better, 10 ** -(r.dp + 1));
            return (
              <tr key={r.label} className={r.hi ? s.hi : undefined}>
                <td className={s.l}>{r.label} {r.unit && <span className={s.subtle}>{r.unit}</span>}</td>
                <td>{num(r.a, r.dp)}</td>
                <td>{num(r.b, r.dp)}</td>
                <td style={{ color: tone === 'bad' ? 'var(--bad-ink)' : tone === 'ok' ? 'var(--ok-ink)' : 'var(--ink-3)' }} title={fmtPctDelta(d.rel)}>{fmtDelta(d.abs, r.dp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: '12px 0 4px' }}>
        <div className={s.bandRow} style={{ paddingBottom: 6 }}>
          <span className={s.subtle}>Δ travel s / cycle</span>
          <span className={s.subtle} style={{ display: 'flex', justifyContent: 'space-between' }}><span>◀ physics faster</span><span>physics slower ▶</span></span>
          <span />
        </div>
        {bands.map(b => (
          <div key={b.label} className={s.bandRow} title={`${b.n} segments · loaded ${fmtDelta(b.dl, 1)} s · empty ${fmtDelta(b.de, 1)} s`}>
            <span className={s.bandLabel}>{b.label} <span className={s.subtle}>({b.n})</span></span>
            <svg viewBox="0 0 200 18" width="100%" height="18" preserveAspectRatio="none" aria-hidden>
              <line x1={100} x2={100} y1={0} y2={18} stroke="var(--ink-4)" strokeWidth={1} />
              {[{ v: b.dl, y: 2, c: 'var(--c1)' }, { v: b.de, y: 10, c: 'var(--c2)' }].map((q, i) => {
                const w = (Math.abs(q.v) / maxAbs) * 96;
                return <rect key={i} x={q.v >= 0 ? 100 : 100 - w} y={q.y} width={Math.max(0, w)} height={6} rx={2} fill={q.c} />;
              })}
            </svg>
            <span className={s.bandVal}>{fmtDelta(b.dl + b.de, 0)}</span>
          </div>
        ))}
        <div className={s.bandRow}><span /><span className={s.legendInline} style={{ gap: 12 }}>
          <span className={s.legendInline}><svg width="14" height="8"><rect width="14" height="6" y="1" rx="2" fill="var(--c1)" /></svg>loaded</span>
          <span className={s.legendInline}><svg width="14" height="8"><rect width="14" height="6" y="1" rx="2" fill="var(--c2)" /></svg>empty</span>
        </span><span /></div>
      </div>
      <ul className={s.whyList}>{why.map((w, i) => <li key={i}><Icon name="info" size={15} />{w}</li>)}</ul>
    </Card>
  );
}
