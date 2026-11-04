/** Every input of the selected circuit, editable, with its workbook cell and changed-from-default highlight. */
import type { ReactNode } from 'react';
import type { Circuit, CircuitParams, Scenario } from '@/core/types';
import { num } from '@/core/format';
import { useApp } from '@/state/store';
import { KINEMATIC_DEFAULTS } from '@/engine';
import { Card, CardHead, Icon, Segmented, Tip } from '@/ui';
import { NumField } from './shared/NumField';
import { defaultCircuitParams } from '@/data';
import { same } from './defaults';
import pg from './shared/page.module.css';
import s from './assumptions.module.css';

type NumKey = { [K in keyof CircuitParams]-?: CircuitParams[K] extends number | undefined ? K : never }[keyof CircuitParams];

interface F { k: NumKey; label: string; unit?: string; dp: number; step: number; min?: number; max?: number; cell?: string; def?: number; hint?: string }

export function CircuitParamsCard({ scenario, circuit }: { scenario: Scenario; circuit: Circuit }) {
  const update = useApp(st => st.updateCircuitParams);
  const p = circuit.params;
  const la = scenario.fleet.loaderAssumptions.find(a => a.unitId === circuit.loaderUnitId);
  const truck = scenario.fleet.trucks.find(t => t.id === circuit.truckModelId);
  const d = defaultCircuitParams(la, truck, circuit.materialId);
  const set = (patch: Partial<CircuitParams>) => update(circuit.id, patch);
  const rim = p.speedModel === 'rimpull';
  const kin = rim && (p.motion ?? 'kinematic') === 'kinematic';

  const workbook: F[] = [
    { k: 'haulEff', label: 'Haul efficiency η', dp: 2, step: 0.01, min: 0.3, max: 1, cell: 'ActiveRoute!C6', def: d.haulEff, hint: 'Divides travel time only. 0.90–0.95 efficient · 0.80–0.90 moderate · 0.70–0.80 challenging' },
    { k: 'stopSigns', label: 'Stop signs (incl. return)', dp: 0, step: 1, min: 0, cell: 'ActiveRoute!C11', def: d.stopSigns },
    { k: 'stopPenaltyS', label: 'Penalty per stop', unit: 's', dp: 0, step: 5, min: 0, cell: 'ActiveRoute!C12', def: d.stopPenaltyS, hint: 'Workbook hard-codes 60 s: decelerate, stop, accelerate back to speed' },
    { k: 'dumpS', label: 'Dump time', unit: 's', dp: 0, step: 5, min: 0, cell: 'ActiveRoute!C8', def: la?.dumpS ?? d.dumpS },
    { k: 'spotS', label: 'Spot time', unit: 's', dp: 0, step: 5, min: 0, cell: 'ActiveRoute!C9', def: la?.spotS ?? d.spotS },
    { k: 'loadS', label: 'Loading time', unit: 's', dp: 0, step: 5, min: 0, cell: 'ActiveRoute!C10', def: la?.loadS ?? d.loadS },
    { k: 'truckLoadBcm', label: 'Truck load', unit: 'bcm', dp: 0, step: 1, min: 1, cell: 'ActiveRoute!C21', def: d.truckLoadBcm },
    { k: 'plannedRateBcmPerPtHr', label: 'Loader planned rate', unit: 'bcm/PT h', dp: 0, step: 50, min: 1, cell: 'ActiveRoute!I32', def: la?.plannedRateBcmPerPtHr ?? d.plannedRateBcmPerPtHr },
    { k: 'truckPtHrsPerDay', label: 'Truck PT', unit: 'h/day', dp: 1, step: 0.5, min: 0, max: 24, cell: 'ActiveRoute!C22', def: d.truckPtHrsPerDay },
    { k: 'desiredDailyBcm', label: 'Desired daily volume', unit: 'bcm', dp: 0, step: 500, min: 0, cell: 'ActiveRoute!C20', def: d.desiredDailyBcm, hint: 'The workbook macro overwrites C20 when a # trucks button is pressed' },
    { k: 'shiftsPerDay', label: 'Shifts per day', dp: 0, step: 1, min: 1, max: 4, cell: 'ActiveRoute!C28 (÷ 2)', def: d.shiftsPerDay },
    { k: 'loaderPtHrsPerDay', label: 'Loader PT target', unit: 'h/day', dp: 1, step: 0.5, min: 0, max: 24, cell: 'ActiveRoute!C19 (× I34)', def: p.truckPtHrsPerDay, hint: 'Defaults to truck PT – the workbook\'s I34 feeds both C19 and C22' },
  ];
  const physics: F[] = [
    { k: 'rrPct', label: 'Rolling resistance', unit: '%', dp: 1, step: 0.5, min: 0, max: 15, def: d.rrPct, hint: '2.0 main haul road · 2.5 ramp / bench · 3.0 around the loader (spec 04 §B.10)' },
    { k: 'speedLimitKmh', label: 'Speed limit', unit: 'km/h', dp: 0, step: 5, min: 5, max: 80, def: d.speedLimitKmh },
    { k: 'accelMaxMs2', label: 'Max acceleration', unit: 'm/s²', dp: 2, step: 0.05, min: 0.05, max: 2, def: KINEMATIC_DEFAULTS.accelMaxMs2 },
    { k: 'decelLoadedMs2', label: 'Deceleration loaded', unit: 'm/s²', dp: 2, step: 0.05, min: 0.05, max: 2, def: KINEMATIC_DEFAULTS.decelLoadedMs2 },
    { k: 'decelEmptyMs2', label: 'Deceleration empty', unit: 'm/s²', dp: 2, step: 0.05, min: 0.05, max: 2, def: KINEMATIC_DEFAULTS.decelEmptyMs2 },
    { k: 'tractionCoeff', label: 'Traction μ', dp: 2, step: 0.05, min: 0.1, max: 1, def: KINEMATIC_DEFAULTS.tractionCoeff, hint: 'Dry clay loam ≈ 0.55 · wet ≈ 0.45 (spec 04 §B.10)' },
    { k: 'stopDwellS', label: 'Dwell at modelled stop', unit: 's', dp: 0, step: 1, min: 0, def: KINEMATIC_DEFAULTS.stopDwellS },
  ];
  const field = (f: F, disabled = false) => {
    const v = p[f.k] as number | undefined;
    const val = v ?? f.def;
    const changed = v != null && f.def != null && !same(v, f.def);
    return (
      <div key={f.k} className={s.pField} style={disabled ? { opacity: 0.5 } : undefined}>
        <div className={s.pLabel}>
          <span>{f.label}</span>
          {f.hint && <Tip text={f.hint} side="up"><span className={s.pInfo} tabIndex={0} aria-label={f.hint}><Icon name="info" size={13} /></span></Tip>}
        </div>
        <div className={s.pInput}>
          <NumField small value={val} onChange={x => set({ [f.k]: x } as Partial<CircuitParams>)} unit={f.unit} dp={f.dp} step={f.step} min={f.min} max={f.max} changed={changed} disabled={disabled} width="100%"
            title={changed ? `Changed from default ${num(f.def!, f.dp)}` : undefined} />
          {changed
            ? <button type="button" className={s.resetBtn} onClick={() => set({ [f.k]: f.k === 'loaderPtHrsPerDay' || f.k.endsWith('Ms2') || f.k === 'tractionCoeff' || f.k === 'stopDwellS' ? undefined : f.def } as Partial<CircuitParams>)} aria-label={`Reset ${f.label}`} title={`Reset to ${num(f.def!, f.dp)}`}><Icon name="reset" size={14} /></button>
            : <span className={s.resetGhost} />}
        </div>
        {f.cell && <div className={s.pCell}>{f.cell}</div>}
      </div>
    );
  };
  const choice = (label: string, node: ReactNode, note?: string) => (
    <div className={s.pField}><div className={s.pLabel}><span>{label}</span></div>{node}{note && <div className={s.pCell}>{note}</div>}</div>
  );
  return (
    <Card className={pg.headSafe}>
      <CardHead title="Circuit assumptions" sub={`${circuit.name} · every input the calculation uses`} icon="sliders" />
      <div className={s.pSection}>Workbook inputs</div>
      <div className={s.pGrid}>{workbook.map(f => field(f))}</div>
      <div className={s.pSection}>Model options</div>
      <div className={s.pGrid}>
        {choice('Out-of-range grades (spreadsheet)', <Segmented small value={p.outOfRange ?? 'drop'} onChange={v => set({ outOfRange: v })} options={[
          { value: 'drop', label: 'Drop (Excel)', title: 'Excel behaviour: |ROUND(grade,2)| > 16% → segment time 0' },
          { value: 'clamp', label: '12/14 km/h', title: 'Time steep segments at the steepest table row' },
        ]} />, 'Travel Time!C:C VLOOKUP → ""')}
        {choice('Motion (rimpull)', <Segmented small value={p.motion ?? 'kinematic'} onChange={v => set({ motion: v })} options={[
          { value: 'kinematic', label: 'Accel / decel', title: 'Forward–backward pass with acceleration, braking and real stops' },
          { value: 'steady', label: 'Steady speed', title: 'Balance speed per segment (no acceleration) – closest to the lookup table' },
        ]} />)}
        {choice('Production model', <Segmented small value={p.queueModel ?? 'deterministic'} onChange={v => set({ queueModel: v })} options={[
          { value: 'deterministic', label: 'Workbook', title: 'n × PT × productivity, capped by the plan (no bunching)' },
          { value: 'mm1n', label: 'M/M/1//N', title: 'Finite-source queue: pessimistic bunching bound' },
          { value: 'binomial', label: 'Binomial', title: 'Independent truck positions: crude lower bound' },
        ]} />, 'spec 04 §C.3')}
      </div>
      <div className={s.pSection}>Physics {rim ? '' : <span className={s.subtle}>(used in rimpull mode)</span>}</div>
      <div className={s.pGrid}>{physics.map(f => field(f, !rim || (!kin && f.k !== 'rrPct' && f.k !== 'speedLimitKmh')))}</div>
    </Card>
  );
}
