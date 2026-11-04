/** Inspector for a selected circuit: status, KPIs, fleet chooser (row-28 buttons reimagined), setup, assumptions. */
import { useMemo, type ReactNode } from 'react';
import type { Circuit, CircuitParams, CircuitResult, Scenario, SpeedModel } from '@/core/types';
import { useApp } from '@/state/store';
import { useCircuitResult } from '@/state/derived';
import { computeCircuit, type CircuitParamsExt, type MotionModel, type OutOfRangeMode, type QueueModel } from '@/engine';
import {
  Badge, Button, CardBody, CardHead, Ctl, Empty, Field, Icon, Kpi, MenuButton, Section, Segmented, Select, circuitColor, cx,
} from '@/ui';
import { NumField } from '@/features/assumptions/shared/NumField';
import { num } from '@/core/format';
import { uid } from '@/core/ids';
import {
  changedParams, fleetRows, loaderDefaults, recommendedTrucks, stopsPerCycle, truckingCall, type FleetRow,
} from './model';
import { BackButton, Callout, StatusBadge } from './parts';
import s from './haulage.module.css';

export function CircuitCard({ id }: { id: string }) {
  const scenario = useApp(st => st.scenario);
  const c = scenario.circuits.find(x => x.id === id);
  const r = useCircuitResult(id);
  const select = useApp(st => st.select);
  const updateCircuit = useApp(st => st.updateCircuit);
  const removeCircuit = useApp(st => st.removeCircuit);
  const addCircuit = useApp(st => st.addCircuit);
  const setView = useApp(st => st.setView);

  if (!c) {
    return (
      <>
        <CardHead title={<span className={s.headTitle}><BackButton onClick={() => select({ kind: 'none' })} /><span>Circuit</span></span>} />
        <CardBody><Empty icon="route" title="Circuit not found">It may have been deleted.</Empty></CardBody>
      </>
    );
  }
  const truck = scenario.fleet.trucks.find(t => t.id === c.truckModelId);
  const mat = scenario.materials.find(m => m.id === c.materialId);
  const menu = [
    { label: 'Show full calculation', icon: 'formula' as const, onSelect: () => setView('assumptions') },
    { label: 'Duplicate', icon: 'copy' as const, onSelect: () => { const d = { ...c, id: uid('cir'), name: `${c.name} (copy)`, priority: scenario.circuits.length + 1 }; addCircuit(d); select({ kind: 'circuit', id: d.id }); } },
    { label: c.active ? 'Park circuit' : 'Activate circuit', icon: (c.active ? 'pause' : 'play') as 'pause' | 'play', onSelect: () => updateCircuit(c.id, { active: !c.active }) },
    { separator: true, label: '' },
    { label: 'Delete circuit', icon: 'trash' as const, danger: true, onSelect: () => { removeCircuit(c.id); select({ kind: 'none' }); } },
  ];

  return (
    <>
      <CardHead
        title={<span className={s.headTitle}><BackButton label="All circuits" onClick={() => select({ kind: 'none' })} /><span className={s.cDot} style={{ background: circuitColor(c.color), width: 10, height: 10, flex: 'none' }} /><span>{c.name}</span></span>}
        actions={
          <>
            {r?.ok ? <StatusBadge status={r.assigned.status} short /> : <Badge tone="na">{c.active ? 'Incomplete' : 'Parked'}</Badge>}
            <MenuButton items={menu} align="right">{(open, toggle) => <Ctl icon="more" small tip="More" on={open} onClick={toggle} />}</MenuButton>
          </>
        }
      />
      <CardBody>
        <div className={s.sub}>
          <b>{c.loaderUnitId}</b><span className={s.dotSep}>{truck?.name ?? 'No truck model'}</span><span className={s.dotSep}>{mat?.name ?? c.materialId}</span>
          <span className={s.dotSep}>Priority {c.priority}</span>
        </div>
        {r?.ok ? <CircuitBody c={c} r={r} scenario={scenario} /> : (
          <Callout tone="warn" title={r?.error ?? 'Not calculated yet'}>
            {!c.haulStringId ? 'Pick a haul string below (or draw one on the surface) to calculate the cycle.' : 'Check the haul string has at least two points.'}
          </Callout>
        )}
        <Setup c={c} scenario={scenario} />
        <Assumptions c={c} scenario={scenario} />
        <div className={s.foot}>
          <button type="button" className={s.link} onClick={() => setView('assumptions')}>Show full calculation <Icon name="right" size={14} /></button>
        </div>
      </CardBody>
    </>
  );
}

function CircuitBody({ c, r, scenario }: { c: Circuit; r: CircuitResult; scenario: Scenario }) {
  const rec = recommendedTrucks(r);
  const a = r.assigned;
  return (
    <>
      <div className={s.kpis}>
        <Kpi size="sm" label="Cycle time" value={num(r.cycleMin, 1)} unit="min" title={`${num(r.cycleS, 0)} s per cycle`} />
        <Kpi size="sm" label="Trucks needed" value={num(r.trucksExact, 2)} delta={`${rec} recommended`} deltaTone="na" />
        <Kpi size="sm" label="Loader PT" value={num(a.loaderPtHrsDay, 1)} unit="h/day" delta={`target ${num(r.loaderPtHrs, 1)} h`} deltaTone="na" />
        <Kpi size="sm" label="Lost PT" value={num(a.lostLoaderPtHrsShift, 2)} unit="h/shift" delta={a.lostLoaderPtHrsShift > 0.005 ? 'Loader hang' : 'None'} deltaTone={a.lostLoaderPtHrsShift > 0.005 ? 'bad' : 'ok'} />
        <Kpi size="sm" label="Production" value={num(a.bcmPerDay)} unit="bcm/d" delta={a.bcmPerDay + 1 < c.params.desiredDailyBcm ? `${num(c.params.desiredDailyBcm - a.bcmPerDay)} short` : 'On target'} deltaTone={a.bcmPerDay + 1 < c.params.desiredDailyBcm ? 'bad' : 'ok'} />
        <Kpi size="sm" label="Match factor" value={num(a.matchFactor, 2)} delta={a.truckQueueHrsShift > 0.005 ? `${num(a.truckQueueHrsShift, 2)} h queue` : 'No queue'} deltaTone={a.truckQueueHrsShift > 0.005 ? 'warn' : 'na'} />
      </div>
      <FleetChooser c={c} r={r} />
      {r.warnings.length > 0 && (
        <Callout tone="warn" title={`${r.warnings.length} calculation note${r.warnings.length > 1 ? 's' : ''}`}>
          {r.warnings.slice(0, 3).map((w, i) => <div key={i}>{w}</div>)}
        </Callout>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────── fleet chooser

function FleetChooser({ c, r }: { c: Circuit; r: CircuitResult }) {
  const updateCircuit = useApp(st => st.updateCircuit);
  const rows = fleetRows(r, c.trucks, c.params.desiredDailyBcm);
  const rec = recommendedTrucks(r);
  const assignedOpt = r.options.find(o => o.trucks === c.trucks) ?? r.assigned;
  const call = truckingCall(c.trucks, rec, assignedOpt);
  const assign = (n: number) => { if (n !== c.trucks) updateCircuit(c.id, { trucks: n }); };
  return (
    <Section title="Trucks" actions={<span className={s.figLab} style={{ letterSpacing: 0, textTransform: 'none' }}>target {num(c.params.desiredDailyBcm)} bcm/d</span>}>
      <div className={s.fleet} role="listbox" aria-label="Number of trucks" style={{ ['--cc' as string]: circuitColor(c.color) }}>
        <div className={s.fHead}>
          <span>n</span><span>Production vs target</span><span>bcm/d</span><span title="Loader PT lost per shift (hang time)">Lost h</span><span title="Truck hours per shift queuing at the loader">Queue h</span><span title="Match factor">MF</span>
        </div>
        {rows.map(row => <FleetRowView key={row.opt.trucks} row={row} targetBcm={c.params.desiredDailyBcm} onClick={() => assign(row.opt.trucks)} />)}
      </div>
      <div className={s.fLegend}>
        <span><i className={s.lgRec} />Recommended</span>
        <span><i className={s.lgSw} style={{ background: circuitColor(c.color) }} />Achieved</span>
        <span><i className={s.lgSw} style={{ background: 'repeating-linear-gradient(135deg, var(--bad) 0 1.5px, transparent 1.5px 4px)', opacity: .7 }} />Shortfall</span>
        <span><i className={s.lgSw} style={{ background: 'repeating-linear-gradient(135deg, var(--warn) 0 1.5px, transparent 1.5px 4px)', opacity: .7 }} />Idle capacity</span>
      </div>
      <Callout tone={call.tone} title={call.title}
        action={c.trucks !== rec ? <Button size="sm" onClick={() => assign(rec)}>Use recommended · {rec}</Button> : undefined}>
        {c.trucks} assigned, {rec} recommended. {call.detail}
      </Callout>
    </Section>
  );
}

function FleetRowView({ row, targetBcm, onClick }: { row: FleetRow; targetBcm: number; onClick: () => void }) {
  const o = row.opt;
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  const short = row.target - row.achieved;
  const idle = row.capacity - row.achieved;
  const k = Math.abs(row.delta);
  const title = row.kind === 'recommended'
    ? `${o.trucks} trucks – recommended: fewest trucks with no loader PT lost`
    : row.kind === 'under'
      ? `${o.trucks} trucks – deliberately under-truck by ${k}: ${num(o.lostLoaderPtHrsShift, 2)} h/shift loader hang, ${num(Math.max(0, targetBcm - o.bcmPerDay))} bcm/d short`
      : `${o.trucks} trucks – deliberately over-truck by ${k}: ${num(o.truckQueueHrsShift, 2)} truck-h/shift queuing`;
  return (
    <button type="button" role="option" aria-selected={row.assigned} title={title}
      className={cx(s.fRow, row.assigned && s.fAssigned, row.kind === 'recommended' && s.fRec)} onClick={onClick}>
      <span className={s.fN}>{o.trucks}</span>
      <span className={s.fBar}>
        {short > 0.002 && <span className={s.fShort} style={{ left: pct(row.achieved), width: pct(short) }} />}
        {idle > 0.002 && <span className={s.fIdle} style={{ left: pct(row.achieved), width: pct(idle) }} />}
        <span className={s.fFill} style={{ width: pct(row.achieved) }} />
        <span className={s.fTarget} style={{ left: pct(row.target) }} />
      </span>
      <span>{o.bcmPerDay >= 100000 ? `${num(o.bcmPerDay / 1000, 0)}k` : num(o.bcmPerDay)}</span>
      <span className={o.lostLoaderPtHrsShift > 0.005 ? s.tBad : s.fZero} style={{ fontWeight: o.lostLoaderPtHrsShift > 0.005 ? 650 : 500 }}>
        {o.lostLoaderPtHrsShift > 0.005 ? num(o.lostLoaderPtHrsShift, 2) : '–'}
      </span>
      <span className={o.truckQueueHrsShift > 0.005 ? s.tWarn : s.fZero} style={{ fontWeight: o.truckQueueHrsShift > 0.005 ? 650 : 500 }}>
        {o.truckQueueHrsShift > 0.005 ? num(o.truckQueueHrsShift, 2) : '–'}
      </span>
      <span>{num(o.matchFactor, 2)}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────── setup

const NONE = '__none';

function Setup({ c, scenario }: { c: Circuit; scenario: Scenario }) {
  const updateCircuit = useApp(st => st.updateCircuit);
  const updateParams = useApp(st => st.updateCircuitParams);
  const select = useApp(st => st.select);
  const loaders = useMemo(() => {
    const ids = new Set<string>([c.loaderUnitId]);
    scenario.fleet.units.filter(u => u.kind === 'loader').forEach(u => ids.add(u.id));
    scenario.fleet.loaderAssumptions.forEach(a => ids.add(a.unitId));
    return [...ids];
  }, [scenario, c.loaderUnitId]);
  const strings = scenario.strings;
  const alts = (c.altHaulStringIds ?? []).filter(id => strings.some(x => x.id === id));
  const altResults = useMemo(() => alts.map(id => {
    let res: CircuitResult | undefined;
    try { res = computeCircuit(scenario, c, { haulStringId: id }); } catch { res = undefined; }
    return { id, res };
  }), [scenario, c, alts.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const addable = strings.filter(x => x.id !== c.haulStringId && !alts.includes(x.id));
  const opt = (xs: { id: string; name: string }[], none?: string) => [...(none ? [{ value: NONE, label: none }] : []), ...xs.map(x => ({ value: x.id, label: x.name }))];

  return (
    <Section title="Setup">
      <div className={s.setup}>
        <Field label="Loader unit">
          <Select value={c.loaderUnitId} onChange={v => {
            const unit = scenario.fleet.units.find(u => u.id === v);
            updateCircuit(c.id, { loaderUnitId: v, ...(unit ? { loaderModelId: unit.modelId } : {}) });
          }} options={loaders.map(l => ({ value: l, label: l }))} />
        </Field>
        <Field label="Truck model">
          <Select value={c.truckModelId} onChange={v => updateCircuit(c.id, { truckModelId: v })} options={opt(scenario.fleet.trucks)} />
        </Field>
        <Field label="Material">
          <Select value={c.materialId} onChange={v => updateCircuit(c.id, { materialId: v })}
            options={scenario.materials.length ? scenario.materials.map(m => ({ value: m.id, label: m.name })) : [{ value: c.materialId, label: c.materialId }]} />
        </Field>
        <Field label="Speed model">
          <Segmented<SpeedModel> value={c.params.speedModel} onChange={v => updateParams(c.id, { speedModel: v })}
            options={[{ value: 'spreadsheet', label: 'Spreadsheet', title: 'Grade → speed table (calc.xlsm)' }, { value: 'rimpull', label: 'Rimpull', title: 'OEM rimpull / retarder curves' }]} />
        </Field>
        <div className={s.full}>
          <Field label={<>Haul string {c.haulStringId && <button type="button" className={s.link} style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => select({ kind: 'string', id: c.haulStringId! })}>Edit string <Icon name="right" size={12} /></button>}</>}>
            <Select value={c.haulStringId ?? NONE} onChange={v => updateCircuit(c.id, { haulStringId: v === NONE ? undefined : v })} options={opt(strings, 'None')} />
          </Field>
        </div>
        <div className={s.full}>
          <Field label="Alternative hauls" hint={alts.length ? 'Long / short haul options the priority planner can switch to.' : undefined}>
            <div className={s.chips}>
              {altResults.map(({ id, res }) => {
                const h = strings.find(x => x.id === id)!;
                return (
                  <span key={id} className={s.chip} title={res?.ok ? `${num(res.lengthM)} m · cycle ${num(res.cycleMin, 1)} min · ${num(res.trucksExact, 2)} trucks` : undefined}>
                    <span>{h.name}</span>
                    {res?.ok && <span className={s.chipFig}>{num(res.trucksExact, 1)} trucks</span>}
                    <button type="button" className={s.chipX} title="Make this the main haul"
                      onClick={() => updateCircuit(c.id, { haulStringId: id, altHaulStringIds: [...alts.filter(x => x !== id), ...(c.haulStringId ? [c.haulStringId] : [])] })}>
                      <Icon name="swap" size={14} />
                    </button>
                    <button type="button" className={s.chipX} title="Remove" onClick={() => updateCircuit(c.id, { altHaulStringIds: alts.filter(x => x !== id) })}>
                      <Icon name="x" size={14} />
                    </button>
                  </span>
                );
              })}
              {addable.length > 0 && (
                <Select small value={NONE} width={alts.length ? 120 : '100%'} onChange={v => { if (v !== NONE) updateCircuit(c.id, { altHaulStringIds: [...alts, v] }); }}
                  options={[{ value: NONE, label: '+ Add option' }, ...addable.map(x => ({ value: x.id, label: x.name }))]} />
              )}
              {!addable.length && !alts.length && <span className={s.muted} style={{ fontSize: 12.5 }}>No other strings yet.</span>}
            </div>
          </Field>
        </div>
        <Field label="Dig block">
          <Select value={c.digId ?? NONE} onChange={v => updateCircuit(c.id, { digId: v === NONE ? undefined : v })} options={opt(scenario.assets.filter(a => a.role === 'dig'), 'None')} />
        </Field>
        <Field label="Dump">
          <Select value={c.dumpId ?? NONE} onChange={v => updateCircuit(c.id, { dumpId: v === NONE ? undefined : v })} options={opt(scenario.assets.filter(a => a.role === 'dump'), 'None')} />
        </Field>
        <ModelOptions c={c} />
      </div>
    </Section>
  );
}

/** Engine model switches (CircuitParamsExt): steep-grade rule, motion model, production/queue model. */
function ModelOptions({ c }: { c: Circuit }) {
  const updateParams = useApp(st => st.updateCircuitParams);
  const pe = c.params as CircuitParamsExt;
  const set = (p: Partial<CircuitParamsExt>) => updateParams(c.id, p as Partial<CircuitParams>);
  return (
    <>
      {c.params.speedModel === 'spreadsheet' ? (
        <div className={s.full}>
          <Field label="Grades steeper than ±16%" hint={(pe.outOfRange ?? 'drop') === 'drop' ? 'As calc.xlsm: the segment\'s time counts as 0 s.' : 'Timed at the steepest table row (12 / 14 km/h).'}>
            <Segmented<OutOfRangeMode> small value={pe.outOfRange ?? 'drop'} onChange={v => set({ outOfRange: v })}
              options={[{ value: 'drop', label: 'Drop (workbook)' }, { value: 'clamp', label: 'Clamp 12 / 14 km/h' }]} />
          </Field>
        </div>
      ) : (
        <div className={s.full}>
          <Field label="Motion" hint={(pe.motion ?? 'kinematic') === 'kinematic' ? 'Accelerates, brakes and stops at stop signs.' : 'Balance speed per segment, stop penalty added.'}>
            <Segmented<MotionModel> small value={pe.motion ?? 'kinematic'} onChange={v => set({ motion: v })}
              options={[{ value: 'kinematic', label: 'Kinematic' }, { value: 'steady', label: 'Steady speed' }]} />
          </Field>
        </div>
      )}
      <div className={s.full}>
        <Field label="Production model">
          <Select<QueueModel> value={pe.queueModel ?? 'deterministic'} onChange={v => set({ queueModel: v })}
            options={[{ value: 'deterministic', label: 'Deterministic – n × PT × productivity (workbook)' }, { value: 'mm1n', label: 'Finite queue M/M/1//N – bunching' }, { value: 'binomial', label: 'Binomial truck-loader match' }]} />
        </Field>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────── assumptions

interface ParamDef { key: keyof CircuitParams; label: string; unit?: string; step: number; dp: number; min?: number; max?: number; hint?: (c: Circuit, sc: Scenario) => ReactNode }

const GROUPS: { title: string; defs: ParamDef[] }[] = [
  {
    title: 'Haul',
    defs: [
      { key: 'haulEff', label: 'Haul efficiency η', step: 0.01, dp: 2, min: 0.3, max: 1, hint: () => 'Travel time ÷ η · typical 0.83–0.85' },
      { key: 'stopSigns', label: 'Stop signs', unit: '/cycle', step: 1, dp: 0, min: 0, hint: () => 'Full cycle, incl. return' },
      { key: 'stopPenaltyS', label: 'Stop penalty', unit: 's', step: 5, dp: 0, min: 0, hint: () => 'Per stop, incl. decel / accel' },
      { key: 'rrPct', label: 'Rolling resistance', unit: '%', step: 0.5, dp: 1, min: 0, max: 20, hint: c => c.params.speedModel === 'spreadsheet' ? 'Rimpull model only' : 'Default; per-segment overrides on the string' },
      { key: 'speedLimitKmh', label: 'Speed limit', unit: 'km/h', step: 5, dp: 0, min: 5, max: 90, hint: c => c.params.speedModel === 'spreadsheet' ? 'Rimpull model only' : 'Global cap; per-segment overrides' },
    ],
  },
  {
    title: 'Loader cycle',
    defs: [
      { key: 'spotS', label: 'Spot time', unit: 's', step: 5, dp: 0, min: 0 },
      { key: 'loadS', label: 'Load time', unit: 's', step: 5, dp: 0, min: 0 },
      { key: 'dumpS', label: 'Dump time', unit: 's', step: 5, dp: 0, min: 0 },
      { key: 'plannedRateBcmPerPtHr', label: 'Planned dig rate', unit: 'bcm/PT h', step: 50, dp: 0, min: 1 },
    ],
  },
  {
    title: 'Production',
    defs: [
      { key: 'truckLoadBcm', label: 'Truck load', unit: 'bcm', step: 1, dp: 1, min: 1 },
      { key: 'truckPtHrsPerDay', label: 'Truck PT', unit: 'h/day', step: 0.5, dp: 1, min: 1, max: 24, hint: () => '"Perfect day" dry target' },
      { key: 'desiredDailyBcm', label: 'Desired volume', unit: 'bcm/d', step: 500, dp: 0, min: 0, hint: c => `Loader ideal ${num(c.params.plannedRateBcmPerPtHr * c.params.truckPtHrsPerDay)} bcm/d` },
      { key: 'shiftsPerDay', label: 'Shifts', unit: '/day', step: 1, dp: 0, min: 1, max: 4 },
    ],
  },
];

function Assumptions({ c, scenario }: { c: Circuit; scenario: Scenario }) {
  const updateParams = useApp(st => st.updateCircuitParams);
  const defaults = loaderDefaults(scenario, c.loaderUnitId, c.truckModelId, c.materialId);
  const changed = changedParams(c.params, defaults);
  const hs = scenario.strings.find(x => x.id === c.haulStringId);
  const stringStops = hs ? stopsPerCycle(hs.points) : 0;
  const reset = () => {
    const { speedModel: _m, ...d } = defaults;
    updateParams(c.id, d);
  };
  return (
    <Section title="Assumptions" actions={changed.size > 0 ? <Button size="sm" variant="ghost" icon="reset" onClick={reset}>Reset to {c.loaderUnitId} defaults</Button> : <span className={s.figLab} style={{ textTransform: 'none', letterSpacing: 0 }}>{c.loaderUnitId} defaults</span>}>
      {GROUPS.map(gp => (
        <div key={gp.title}>
          <div className={s.pGroup}>{gp.title}</div>
          {gp.defs.map(d => {
            const ch = changed.has(d.key);
            const v = c.params[d.key] as number;
            const dv = defaults[d.key] as number;
            let hint = d.hint?.(c, scenario);
            if (d.key === 'stopSigns' && hs && stringStops > 0 && stringStops !== v) {
              hint = <>String has {stringStops} · <button type="button" className={s.link} style={{ fontSize: 12 }} onClick={() => updateParams(c.id, { stopSigns: stringStops })}>use {stringStops}</button></>;
            }
            return (
              <div key={d.key} className={s.pRow}>
                <span className={s.pLab}>
                  <span className={cx(ch && s.pChanged)}>{d.label}</span>
                  {(hint || ch) && <span className={s.pHint}>{ch ? `Default ${num(dv, d.dp)}${d.unit ? ` ${d.unit}` : ''}` : hint}</span>}
                </span>
                <NumField small value={v} onChange={nv => updateParams(c.id, { [d.key]: nv } as Partial<CircuitParams>)} unit={d.unit} step={d.step} dp={d.dp} min={d.min} max={d.max} changed={ch} />
              </div>
            );
          })}
        </div>
      ))}
    </Section>
  );
}
