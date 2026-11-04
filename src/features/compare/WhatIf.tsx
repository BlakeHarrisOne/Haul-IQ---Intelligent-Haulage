/** (b) What-if trucks: per-circuit steppers evaluated live with computeCircuit(…, { trucks }); Apply commits. */
import { useMemo, useState } from 'react';
import type { CircuitResult, Id, Scenario } from '@/core/types';
import { num } from '@/core/format';
import { useApp } from '@/state/store';
import { computeCircuit } from '@/engine';
import { Button, Card, CardHead, Dot, Icon, Select } from '@/ui';
import { delta, deltaTone, fmtDelta, type Better } from '@/features/assumptions/shared/delta';
import { circuitRow, totals, MIN_PT_HRS_DAY, type CircuitRow } from './compareData';
import { StatusBadge } from './CircuitsCompare';
import { TruckCountChart } from './CompareCharts';
import s from './compare.module.css';

function Delta({ a, b, dp, better, unit }: { a: number; b: number; dp: number; better: Better; unit?: string }) {
  const d = delta(a, b).abs;
  if (!Number.isFinite(d) || Math.abs(d) < 0.5 * 10 ** -dp) return null;
  const tone = deltaTone(d, better);
  return <span className={s.delta} style={{ color: tone === 'ok' ? 'var(--ok-ink)' : tone === 'bad' ? 'var(--bad-ink)' : 'var(--ink-3)' }}>{fmtDelta(d, dp, unit)}</span>;
}

function Stepper({ value, onChange, changed, min = 0, max = 30, label }: { value: number; onChange: (v: number) => void; changed: boolean; min?: number; max?: number; label: string }) {
  return (
    <span className={`${s.stepper} ${changed ? s.changed : ''}`} role="group" aria-label={label}>
      <button type="button" aria-label={`One fewer truck for ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" size={16} /></button>
      <span className={s.stepVal} aria-live="polite">{value}</span>
      <button type="button" aria-label={`One more truck for ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" size={16} /></button>
    </span>
  );
}

export function WhatIf({ scenario, results, rows, focus, onFocus }: {
  scenario: Scenario; results: Record<Id, CircuitResult>; rows: CircuitRow[]; focus?: Id; onFocus: (id: Id) => void;
}) {
  const commit = useApp(st => st.commit);
  const [trucks, setTrucks] = useState<Record<Id, number>>({});
  const active = scenario.circuits.filter(c => c.active);
  const nOf = (id: Id) => trucks[id] ?? scenario.circuits.find(c => c.id === id)?.trucks ?? 0;

  const whatIfRows = useMemo(() => active.map(c => {
    const n = trucks[c.id];
    if (n == null || n === c.trucks) return rows.find(r => r.id === c.id)!;
    const r = computeCircuit(scenario, c, { trucks: n });
    return circuitRow(scenario, c, r, r.assigned);
  }), [scenario, trucks, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = totals(rows, scenario.fleet.trucksAvailable);
  const next = totals(whatIfRows, scenario.fleet.trucksAvailable);
  const changed = active.filter(c => trucks[c.id] != null && trucks[c.id] !== c.trucks);
  const fc = scenario.circuits.find(c => c.id === focus && c.active) ?? active[0];
  const fr = fc ? results[fc.id] : undefined;

  const apply = () => {
    if (!changed.length) return;
    commit(`What-if: ${changed.map(c => `${c.name} → ${trucks[c.id]}`).join(', ')}`, sc => ({
      ...sc, circuits: sc.circuits.map(c => (trucks[c.id] != null ? { ...c, trucks: trucks[c.id] } : c)),
    }));
    setTrucks({});
  };
  const autoBalance = () => {
    // fill each circuit to its recommended count (the workbook's "press the button until 0 h lost")
    const t: Record<Id, number> = {};
    for (const r of rows) if (r.ok && r.active) t[r.id] = r.recommended;
    setTrucks(t);
  };

  return (
    <Card>
      <CardHead title="What-if: trucks per circuit" sub="nothing is saved until you apply" icon="sliders" actions={<>
        <Button size="sm" variant="ghost" icon="sparkle" onClick={autoBalance} title="Set every circuit to its recommended truck count">Recommended</Button>
        <Button size="sm" icon="reset" onClick={() => setTrucks({})} disabled={!Object.keys(trucks).length}>Reset</Button>
        <Button size="sm" variant="primary" icon="tick" onClick={apply} disabled={!changed.length}>Apply {changed.length ? `(${changed.length})` : ''}</Button>
      </>} />
      <div className={s.tableScroll}>
        <table className={s.tbl}>
          <thead>
            <tr>
              <th className={s.l}>Circuit</th><th>Needed</th><th style={{ textAlign: 'center' }}>Trucks</th>
              <th className={s.sepL}>bcm/day</th><th>Loader PT h/day</th><th>Lost PT h/shift</th><th>Queue h/shift</th><th className={s.l}>Status</th>
            </tr>
          </thead>
          <tbody>
            {active.map((c, i) => {
              const a = rows.find(r => r.id === c.id)!, b = whatIfRows[i];
              const n = nOf(c.id);
              return (
                <tr key={c.id} className={fc?.id === c.id ? s.sel : undefined} onClick={() => onFocus(c.id)}>
                  <td className={s.l}><div className={s.name}><Dot color={c.color} />{c.name}</div><div className={s.meta}>currently {c.trucks} trucks</div></td>
                  <td>{num(a.exact, 2)}<span className={s.small}>rec. {num(a.recommended, 0)}</span></td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <Stepper value={n} onChange={v => setTrucks(t => ({ ...t, [c.id]: v }))} changed={n !== c.trucks} label={c.name} min={0} max={Math.max(20, a.recommended + 6)} />
                  </td>
                  <td className={s.sepL}>{num(b.bcmDay, 0)}<Delta a={a.bcmDay} b={b.bcmDay} dp={0} better="up" /></td>
                  <td className={b.loaderPtHrsDay < MIN_PT_HRS_DAY - 1e-9 ? s.bad : undefined}>{num(b.loaderPtHrsDay, 1)}<Delta a={a.loaderPtHrsDay} b={b.loaderPtHrsDay} dp={1} better="up" /></td>
                  <td className={b.lostPtShift > 0.005 ? s.bad : s.muted}>{num(b.lostPtShift, 2)}<Delta a={a.lostPtShift} b={b.lostPtShift} dp={2} better="down" /></td>
                  <td className={b.queueHrsShift > 0.005 ? s.warn : s.muted}>{num(b.queueHrsShift, 2)}<Delta a={a.queueHrsShift} b={b.queueHrsShift} dp={2} better="down" /></td>
                  <td className={s.l}>{b.ok ? <StatusBadge st={b.status} /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.whatIfFoot}>
        <Foot label="Trucks used" a={base.trucksAssigned} b={next.trucksAssigned} dp={0} better="none" suffix={` / ${num(next.trucksAvailable, 0)}`} bad={next.trucksAssigned > next.trucksAvailable} />
        <Foot label="Production bcm/day" a={base.bcmDay} b={next.bcmDay} dp={0} better="up" />
        <Foot label="Lost PT h/shift" a={base.lostPtShift} b={next.lostPtShift} dp={2} better="down" />
        <Foot label="Queue h/shift" a={base.queueHrsShift} b={next.queueHrsShift} dp={2} better="down" />
        <Foot label={`Loaders < ${MIN_PT_HRS_DAY} h`} a={base.belowMinPt} b={next.belowMinPt} dp={0} better="down" />
        {next.trucksAssigned > next.trucksAvailable && <span className={s.bad}><Icon name="warning" size={15} /> {next.trucksAssigned - next.trucksAvailable} more truck{next.trucksAssigned - next.trucksAvailable === 1 ? '' : 's'} than available</span>}
      </div>
      {fc && fr?.ok && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0', borderTop: '1px solid var(--hair-2)' }}>
            <span style={{ fontWeight: 650 }}>Truck-count curve</span>
            <Select small value={fc.id} onChange={onFocus} options={active.map(c => ({ value: c.id, label: c.name }))} />
            <span className={s.muted} style={{ fontSize: 12.5 }}>production and losses by number of trucks — the workbook's row-28 buttons, all at once</span>
          </div>
          <TruckCountChart options={fr.options} current={fc.trucks} whatIf={nOf(fc.id)} target={fc.params.desiredDailyBcm} recommended={fr.trucksRecommended} />
        </>
      )}
    </Card>
  );
}

function Foot({ label, a, b, dp, better, suffix, bad }: { label: string; a: number; b: number; dp: number; better: Better; suffix?: string; bad?: boolean }) {
  return (
    <div className={s.footKpi}>
      <span className={s.footLabel}>{label}</span>
      <span className={s.footVal} style={bad ? { color: 'var(--bad-ink)' } : undefined}>
        {a !== b && <><span className={s.muted} style={{ fontWeight: 600 }}>{num(a, dp)}</span><span className={s.arrow}>→</span></>}
        {num(b, dp)}{suffix && <span className={s.small}>{suffix}</span>}<Delta a={a} b={b} dp={dp} better={better} />
      </span>
    </div>
  );
}
