/** Equipment & crew table: fleet units grouped by kind with model, ownership, availability, notional task and active toggle. */
import { Fragment, useMemo, useState } from 'react';
import type { FleetUnit, ManningResult, Scenario } from '@/core/types';
import { num } from '@/core/format';
import { useApp } from '@/state/store';
import { Badge, Button, Card, CardBody, CardHead, Dot, Icon, NumberField, Segmented, Toggle, circuitColor, type IconName } from '@/ui';
import { assignUnits, type Machine } from './model';
import { unitActive, unitMachine, unitModelName, type UnitWithActive } from './roles';
import css from './manning.module.css';

const GROUPS: { key: Machine | 'other'; label: string; icon: IconName }[] = [
  { key: 'truck', label: 'Trucks', icon: 'truck' },
  { key: 'excavator', label: 'Excavators', icon: 'excavator' },
  { key: 'loader', label: 'Loaders', icon: 'loader' },
  { key: 'dozer', label: 'Dozers', icon: 'dozer' },
  { key: 'wheelDozer', label: 'Wheel dozers', icon: 'dozer' },
  { key: 'grader', label: 'Graders', icon: 'grader' },
  { key: 'waterCart', label: 'Water carts', icon: 'watercart' },
  { key: 'other', label: 'Other', icon: 'lv' },
];

export function Equipment({ scenario, manning }: { scenario: Scenario; manning: ManningResult }) {
  const commit = useApp(st => st.commit);
  const select = useApp(st => st.select);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { tasks, coverage } = useMemo(() => assignUnits(scenario, manning), [scenario, manning]);
  const units = scenario.fleet.units;
  const grouped = useMemo(() => {
    const g = new Map<string, FleetUnit[]>();
    for (const u of units) {
      const m = unitMachine(u, scenario.fleet.loaders);
      const k = GROUPS.some(x => x.key === m) ? (m as string) : 'other';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(u);
    }
    return g;
  }, [units, scenario.fleet.loaders]);
  const circuitOf = (id?: string) => scenario.circuits.find(c => c.id === id);
  const patchUnit = (id: string, p: Partial<UnitWithActive>, label: string) =>
    commit(label, s => ({ ...s, fleet: { ...s.fleet, units: s.fleet.units.map(u => (u.id === id ? ({ ...u, ...p } as FleetUnit) : u)) } }));
  const toggleUnit = (u: FleetUnit, on: boolean) => {
    // a loading unit's toggle also (de)activates the circuits it loads
    commit(`${on ? 'Activate' : 'Park'} ${u.id}`, s => ({
      ...s,
      fleet: { ...s.fleet, units: s.fleet.units.map(x => (x.id === u.id ? ({ ...x, active: on } as FleetUnit) : x)) },
      circuits: u.kind === 'loader' ? s.circuits.map(c => (c.loaderUnitId === u.id ? { ...c, active: on } : c)) : s.circuits,
    }));
  };
  const truckCov = coverage.find(c => c.machine === 'truck');
  const effTrucks = Math.floor((truckCov?.expected ?? 0) + 1e-6);

  return (
    <Card>
      <CardHead icon="table" title="Equipment & crew" sub={`${units.length} units · ${units.filter(unitActive).length} active · tasks are a notional allocation of the plan`}
        actions={truckCov && effTrucks !== scenario.fleet.trucksAvailable ? (
          <Button size="sm" icon="truck" onClick={() => commit(`Trucks available → ${effTrucks}`, s => ({ ...s, fleet: { ...s.fleet, trucksAvailable: effTrucks } }))}
            title={`Σ availability of active trucks = ${num(truckCov.expected, 2)}`}>Set trucks available to {effTrucks}</Button>
        ) : undefined} />
      <CardBody style={{ padding: 0 }}>
        <div className={css.coverage}>
          {coverage.map(c => {
            const g = GROUPS.find(x => x.key === c.machine);
            const short = c.demand > c.active;
            return (
              <div key={c.machine} className={css.cov} title={`${c.demand} needed by the plan · ${c.active} of ${c.total} active · ≈${num(c.expected, 1)} expected at availability`}>
                <Icon name={g?.icon ?? 'lv'} size={18} />
                <span className={css.covTop}>{c.demand}<span style={{ color: 'var(--ink-4)', fontWeight: 500 }}>/</span>{c.active}
                  {short ? <Icon name="warning" size={14} style={{ color: 'var(--bad)' }} /> : <Icon name="tick" size={14} style={{ color: 'var(--ok)' }} />}</span>
                <span className={css.covSub}>{c.label} needed / active</span>
              </div>
            );
          })}
        </div>
        <div className={css.scroll}>
          <table className={css.eq}>
            <thead>
              <tr><th style={{ width: 110 }}>Unit</th><th style={{ width: 170 }}>Model</th><th style={{ width: 140 }}>Ownership</th><th style={{ width: 170 }}>Availability</th><th>Task in this plan</th><th style={{ width: 80 }}>Active</th></tr>
            </thead>
            <tbody>
              {GROUPS.filter(g => grouped.get(g.key)?.length).map(g => {
                const list = grouped.get(g.key)!;
                const isCol = collapsed[g.key];
                const working = list.filter(u => tasks[u.id]?.state === 'working').length;
                return (
                  <Fragment key={g.key}>
                    <tr className={css.eqGroup} onClick={() => setCollapsed({ ...collapsed, [g.key]: !isCol })} style={{ cursor: 'pointer' }}>
                      <td colSpan={5}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name={isCol ? 'right' : 'down'} size={16} /><Icon name={g.icon} size={18} />{g.label}
                        <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{list.length} units · {working} working · {list.filter(u => !unitActive(u)).length} parked</span></span></td>
                      <td />
                    </tr>
                    {!isCol && list.map(u => {
                      const t = tasks[u.id];
                      const c = circuitOf(t?.circuitId);
                      const on = unitActive(u);
                      return (
                        <tr key={u.id} className={!on ? css.eqParked : undefined}>
                          <td><span className={css.eqId}>{u.id}</span></td>
                          <td>{unitModelName(scenario, u)}</td>
                          <td>
                            <Segmented small value={u.ownership} style={{ width: 110 }}
                              onChange={v => patchUnit(u.id, { ownership: v }, `${u.id} → ${v}`)}
                              options={[{ value: 'own', label: 'Own' }, { value: 'hire', label: 'Hire' }]} />
                          </td>
                          <td>
                            <span className={css.availCell}>
                              <NumberField small value={u.availability * 100} dp={0} step={1} min={0} max={100} unit="%" width={84}
                                onChange={v => patchUnit(u.id, { availability: Math.min(1, Math.max(0, v / 100)) }, `${u.id} availability`)} />
                              <span className={css.availBar}><span style={{ width: `${u.availability * 100}%` }} /></span>
                            </span>
                          </td>
                          <td>
                            {t?.state === 'working' ? (
                              <button type="button" className={css.task} style={{ border: 0, background: 'none', padding: 0, cursor: c ? 'pointer' : 'default', color: 'var(--ink)' }}
                                onClick={() => c && select({ kind: 'circuit', id: c.id })} title={c ? `Select ${c.name}` : undefined}>
                                {c && <Dot color={circuitColor(c.color)} />}{t.task}
                              </button>
                            ) : t?.state === 'parked' ? <Badge tone="na" icon="pause">Parked</Badge> : <Badge tone="na">{t?.task ?? 'Spare'}</Badge>}
                            {u.notes && <span style={{ color: 'var(--ink-3)', marginLeft: 8, fontSize: 12.5 }}>{u.notes}</span>}
                          </td>
                          <td className={css.quiet}><Toggle on={on} onChange={v => toggleUnit(u, v)} title={on ? 'Active – click to park' : 'Parked – click to activate'} /></td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
