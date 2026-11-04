/** (c) Scenario vs scenario: the live scenario against up to three saved ones – KPIs with deltas and a per-circuit diff. */
import { useEffect, useMemo, useState } from 'react';
import type { CircuitResult, Id, Scenario, ScenarioMeta } from '@/core/types';
import { num } from '@/core/format';
import { computeAllCircuits } from '@/engine';
import { Badge, Button, Card, CardHead, Dot, Empty, Icon, Segmented } from '@/ui';
import { delta, deltaTone, fmtDelta, type Better } from '@/features/assumptions/shared/delta';
import type { CsvCell } from '@/features/assumptions/shared/csv';
import { alignCircuits, circuitRows, totals, MIN_PT_HRS_DAY, type CircuitRow, type Totals } from './compareData';
import { listSaved, loadSaved, usePicks } from './scenarioSource';
import s from './compare.module.css';

const MAX_PICKS = 3;

interface Col { id: string; name: string; sub: string; scenario: Scenario; rows: CircuitRow[]; t: Totals }

const KPI: { key: keyof Totals | 'pct'; label: string; dp: number; better: Better; unit?: string }[] = [
  { key: 'activeCircuits', label: 'Active circuits', dp: 0, better: 'none' },
  { key: 'trucksAssigned', label: 'Trucks used', dp: 0, better: 'none' },
  { key: 'trucksAvailable', label: 'Trucks available', dp: 0, better: 'up' },
  { key: 'trucksRecommended', label: 'Trucks recommended', dp: 0, better: 'down' },
  { key: 'bcmDay', label: 'Production', dp: 0, better: 'up', unit: 'bcm/day' },
  { key: 'pct', label: 'Production vs target', dp: 0, better: 'up', unit: '%' },
  { key: 'lostPtShift', label: 'Lost loader PT', dp: 2, better: 'down', unit: 'h/shift' },
  { key: 'queueHrsShift', label: 'Truck queue', dp: 2, better: 'down', unit: 'h/shift' },
  { key: 'belowMinPt', label: `Loaders below ${MIN_PT_HRS_DAY} PT h/day`, dp: 0, better: 'down' },
  { key: 'avgCycleMin', label: 'Mean cycle (truck-weighted)', dp: 2, better: 'down', unit: 'min' },
  { key: 'haulKm', label: 'Total haul length', dp: 2, better: 'none', unit: 'km' },
];
const kpiVal = (t: Totals, k: (typeof KPI)[number]['key']) => (k === 'pct' ? (t.bcmDay / (t.targetBcmDay || 1)) * 100 : t[k]);

type MetricKey = 'haulKm' | 'cycleMin' | 'assigned' | 'loaderPtHrsDay' | 'bcmDay' | 'lostPtShift';
const METRICS: { key: MetricKey; label: string; dp: number; better: Better; unit: string }[] = [
  { key: 'haulKm', label: 'Route length', dp: 2, better: 'down', unit: 'km' },
  { key: 'cycleMin', label: 'Cycle', dp: 2, better: 'down', unit: 'min' },
  { key: 'assigned', label: 'Trucks', dp: 0, better: 'none', unit: 'trucks' },
  { key: 'loaderPtHrsDay', label: 'Loader PT', dp: 1, better: 'up', unit: 'h/day' },
  { key: 'bcmDay', label: 'bcm/day', dp: 0, better: 'up', unit: 'bcm/day' },
  { key: 'lostPtShift', label: 'Lost PT', dp: 2, better: 'down', unit: 'h/shift' },
];

function D({ a, b, dp, better, unit }: { a: number; b: number; dp: number; better: Better; unit?: string }) {
  const d = delta(a, b).abs;
  if (!Number.isFinite(d)) return null;
  if (Math.abs(d) < 0.5 * 10 ** -dp) return <span className={s.delta} style={{ color: 'var(--ink-4)' }}>=</span>;
  const tone = deltaTone(d, better);
  return <span className={s.delta} style={{ color: tone === 'ok' ? 'var(--ok-ink)' : tone === 'bad' ? 'var(--bad-ink)' : 'var(--ink-3)' }}>{fmtDelta(d, dp, unit)}</span>;
}

export function useScenarioColumns(live: Scenario, liveResults: Record<Id, CircuitResult>) {
  const ids = usePicks(st => st.ids);
  const [metas, setMetas] = useState<ScenarioMeta[]>([]);
  const [loaded, setLoaded] = useState<Record<string, Scenario | null>>({});
  const [busy, setBusy] = useState(false);
  const refresh = () => { setBusy(true); listSaved().then(m => { setMetas(m); setBusy(false); }); };
  useEffect(refresh, []);
  useEffect(() => {
    for (const id of ids) if (!(id in loaded)) loadSaved(id).then(sc => setLoaded(l => ({ ...l, [id]: sc ?? null })));
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols: Col[] = useMemo(() => {
    const liveRows = circuitRows(live, liveResults);
    const out: Col[] = [{ id: 'live', name: live.name, sub: 'current (live)', scenario: live, rows: liveRows, t: totals(liveRows, live.fleet.trucksAvailable) }];
    for (const id of ids.slice(0, MAX_PICKS)) {
      const sc = loaded[id];
      if (!sc) continue;
      const res = computeAllCircuits(sc);
      const rows = circuitRows(sc, res);
      const meta = metas.find(m => m.id === id);
      out.push({ id, name: sc.name, sub: `saved ${new Date(meta?.updatedAt ?? sc.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`, scenario: sc, rows, t: totals(rows, sc.fleet.trucksAvailable) });
    }
    return out;
  }, [live, liveResults, ids, loaded, metas]);
  return { cols, metas, ids, busy, refresh };
}

export function scenarioCsv(cols: Col[]): CsvCell[][] {
  const out: CsvCell[][] = [['hAIul SIM scenario comparison'], ['KPI', 'Unit', ...cols.map(c => `${c.name} (${c.sub})`)]];
  for (const k of KPI) out.push([k.label, k.unit ?? '', ...cols.map(c => kpiVal(c.t, k.key))]);
  const aligned = alignCircuits(cols.map(c => c.scenario));
  for (const m of METRICS) {
    out.push([], [`Per circuit: ${m.label}`, m.unit, ...cols.map(c => c.name)]);
    for (const row of aligned) out.push([row.name, '', ...cols.map((c, j) => { const ci = row.per[j]; const r = ci ? c.rows.find(x => x.id === ci.id) : undefined; return r ? r[m.key] : ''; })]);
  }
  return out;
}

export function ScenarioCompare({ live, liveResults, onCols }: { live: Scenario; liveResults: Record<Id, CircuitResult>; onCols?: (c: Col[]) => void }) {
  const { cols, metas, ids, busy, refresh } = useScenarioColumns(live, liveResults);
  const toggle = usePicks(st => st.toggle);
  const clear = usePicks(st => st.clear);
  const [metric, setMetric] = useState<MetricKey>('cycleMin');
  useEffect(() => { onCols?.(cols); }, [cols, onCols]);
  const aligned = useMemo(() => alignCircuits(cols.map(c => c.scenario)), [cols]);
  const m = METRICS.find(x => x.key === metric)!;
  const base = cols[0];
  return (
    <Card>
      <CardHead title="Scenario vs scenario" sub={`live scenario + up to ${MAX_PICKS} saved`} icon="compare" actions={<>
        <Button size="sm" variant="ghost" icon="reset" onClick={refresh} disabled={busy}>Refresh list</Button>
        {ids.length > 0 && <Button size="sm" icon="x" onClick={clear}>Clear picks</Button>}
      </>} />
      <div className={s.pickRow}>
        <Badge tone="info" icon="pin">{live.name} · live</Badge>
        {metas.map(x => {
          const on = ids.includes(x.id);
          return (
            <button key={x.id} type="button" className={s.pick} aria-pressed={on} disabled={!on && ids.length >= MAX_PICKS} onClick={() => toggle(x.id)} title={x.description ?? x.name}>
              <Icon name={on ? 'tick' : 'plus'} size={14} /><span>{x.name}{x.id === live.id ? ' (saved copy)' : ''}</span>
            </button>
          );
        })}
        {!metas.length && <span className={s.muted} style={{ fontSize: 13 }}>{busy ? 'Loading saved scenarios…' : 'No saved scenarios yet – save one from the Scenarios page (or tick scenarios there to compare).'}</span>}
      </div>
      {cols.length < 2 ? (
        <Empty icon="compare" title="Pick saved scenarios to compare">Tick up to {MAX_PICKS} saved scenarios above. Every KPI and circuit is shown against the live scenario with its delta.</Empty>
      ) : (
        <>
          <div className={s.tableScroll} style={{ paddingTop: 8 }}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th className={s.l}>KPI</th>
                  {cols.map((c, j) => <th key={c.id} className={j ? s.sepL : undefined}><div className={s.colHead}><span className={s.colName} title={c.name}>{c.name}</span><span className={s.colSub}>{c.sub}{j ? ' · Δ vs live' : ''}</span></div></th>)}
                </tr>
              </thead>
              <tbody>
                {KPI.map(k => (
                  <tr key={k.key} style={{ cursor: 'default' }}>
                    <td className={s.l}>{k.label}{k.unit && <span className={s.small}>{k.unit}</span>}</td>
                    {cols.map((c, j) => {
                      const v = kpiVal(c.t, k.key), b = kpiVal(base.t, k.key);
                      return <td key={c.id} className={j ? s.sepL : undefined}><b>{num(v, k.dp)}</b>{j > 0 && <D a={b} b={v} dp={k.dp} better={k.better} />}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 650 }}>Per circuit</span>
            <Segmented small value={metric} onChange={setMetric} style={{ width: 'fit-content' }} options={METRICS.map(x => ({ value: x.key, label: x.label }))} />
            <span className={s.muted} style={{ fontSize: 12.5 }}>{m.unit} · matched by circuit id, then loader + material</span>
          </div>
          <div className={s.tableScroll}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th className={s.l}>Circuit</th>
                  {cols.map((c, j) => <th key={c.id} className={j ? s.sepL : undefined}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {aligned.map(row => {
                  const vals = cols.map((c, j) => { const ci = row.per[j]; return ci ? c.rows.find(x => x.id === ci.id) : undefined; });
                  const b = vals[0];
                  return (
                    <tr key={row.key} style={{ cursor: 'default' }}>
                      <td className={s.l}><div className={s.name}><Dot color={row.color} />{row.name}</div></td>
                      {vals.map((r, j) => (
                        <td key={cols[j].id} className={j ? s.sepL : undefined}>
                          {r ? <>
                            <b>{num(r[m.key], m.dp)}</b>
                            {j > 0 && b && <D a={b[m.key]} b={r[m.key]} dp={m.dp} better={m.better} />}
                            {(metric === 'haulKm' || metric === 'cycleMin') && r.route && <span className={s.cellSub} title={r.route}>{r.route}</span>}
                            {metric === 'assigned' && <span className={s.cellSub}>needs {num(r.exact, 2)}</span>}
                            {!r.active && <span className={s.cellSub}>inactive</span>}
                          </> : <span className={s.muted}>not in scenario</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
