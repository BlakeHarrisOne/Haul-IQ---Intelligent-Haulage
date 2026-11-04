/**
 * Editable site assumptions. Every edit goes through store.commit (undoable) and is highlighted when it differs
 * from the default (data module defaults, else the Haulage Calculator workbook values), with a per-cell reset.
 */
import { useMemo, useState } from 'react';
import type { GradeSpeedPoint, LoaderAssumptions, Material, Scenario, ShiftEvent, ShiftEventKind, TruckModel } from '@/core/types';
import { clock, num, signed } from '@/core/format';
import { useApp } from '@/state/store';
import { productiveMinutes } from '@/engine';
import {
  Badge, Button, Card, CardHead, Dot, EVENT_STYLE, Icon, Select, TextField, Toggle, AxisX, GridY, Legend, circuitColor, eventBackground, linePath, linear,
} from '@/ui';
import { NumField } from './shared/NumField';
import { uid } from '@/core/ids';
import { defaultLoader, defaultMaterial, defaultShift, defaultSpeeds, defaultTruckLoad, defaultsSource, same, sheetLoadCell } from './defaults';
import { RefChip } from './Ledger';
import { useWidth } from './shared/useWidth';
import p from './shared/page.module.css';
import s from './assumptions.module.css';

type Commit = (label: string, fn: (s: Scenario) => Scenario) => void;
const useCommit = (): Commit => useApp(st => st.commit);

export function EditCell({ value, def, onChange, step = 1, dp = 1, unit, width = 84, min, max, label }: {
  value: number | undefined; def?: number; onChange: (v: number) => void; step?: number; dp?: number; unit?: string; width?: number; min?: number; max?: number; label: string;
}) {
  const changed = def != null && value != null && !same(value, def);
  return (
    <span className={s.cell}>
      <NumField small value={value} onChange={onChange} step={step} dp={dp} unit={unit} width={width} changed={changed} min={min} max={max}
        title={changed ? `${label}: changed from default ${num(def!, dp)}` : label} />
      {changed
        ? <button type="button" className={s.resetBtn} onClick={() => onChange(def!)} title={`Reset ${label} to ${num(def!, dp)}`} aria-label={`Reset ${label} to default`}><Icon name="reset" size={14} /></button>
        : <span className={s.resetGhost} />}
    </span>
  );
}

export function ChangedKey() {
  return (
    <span className={s.legendInline} title={defaultsSource() === 'data' ? 'Defaults: site data library' : 'Defaults: Haulage Calculator workbook values'}>
      <span className={s.changedSwatch} />changed from {defaultsSource() === 'data' ? 'default' : 'workbook'}
    </span>
  );
}

// ── loader assumptions ───────────────────────────────────────────────────────
export function LoaderAssumptionsCard({ scenario }: { scenario: Scenario }) {
  const commit = useCommit();
  const set = (unitId: string, patch: Partial<LoaderAssumptions>) =>
    commit(`Edit ${unitId} loader assumptions`, sc => ({
      ...sc,
      fleet: { ...sc.fleet, loaderAssumptions: sc.fleet.loaderAssumptions.map(a => (a.unitId === unitId ? { ...a, ...patch } : a)) },
      // the workbook's EX block feeds C8–C10 and the planned rate of every circuit on that loader
      circuits: sc.circuits.map(c => {
        if (c.loaderUnitId !== unitId) return c;
        const pp = { ...c.params };
        if (patch.dumpS != null) pp.dumpS = patch.dumpS;
        if (patch.spotS != null) pp.spotS = patch.spotS;
        if (patch.loadS != null) pp.loadS = patch.loadS;
        if (patch.plannedRateBcmPerPtHr != null) pp.plannedRateBcmPerPtHr = patch.plannedRateBcmPerPtHr;
        if (patch.ptHrsPerDay != null) pp.loaderPtHrsPerDay = patch.ptHrsPerDay;
        return { ...c, params: pp };
      }),
    }));
  const rows = scenario.fleet.loaderAssumptions;
  const modelOf = (unitId: string) => {
    const u = scenario.fleet.units.find(x => x.id === unitId);
    return scenario.fleet.loaders.find(l => l.id === u?.modelId)?.name ?? scenario.fleet.loaders.find(l => l.id === `ldr-${unitId}`)?.name;
  };
  return (
    <Card className={p.headSafe}>
      <CardHead title="Loader assumptions" sub="per unit" icon="excavator" actions={<RefChip cell="ActiveRoute!H2:J34" />} />
      <div style={{ overflowX: 'auto' }}>
        <table className={s.editTable}>
          <thead><tr>
            <th className={s.l}>Unit</th><th className={s.l}>Circuits</th><th>Dump s</th><th>Spot s</th><th>Load s</th><th>Planned rate bcm/PT h</th><th>PT h/day</th><th>Ideal bcm/day</th>
          </tr></thead>
          <tbody>
            {rows.map(a => {
              const d = defaultLoader(a.unitId);
              const circuits = scenario.circuits.filter(c => c.loaderUnitId === a.unitId);
              return (
                <tr key={a.unitId}>
                  <td className={s.l}><div className={s.unitName}>{a.unitId}</div><div className={s.subtle}>{modelOf(a.unitId) ?? '–'}</div></td>
                  <td className={s.l}>
                    {circuits.length ? circuits.map(c => <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><Dot color={circuitColor(c.color)} />{c.name}</div>) : <span className={s.subtle}>not used</span>}
                  </td>
                  <td><EditCell label={`${a.unitId} dump time`} value={a.dumpS} def={d?.dumpS} onChange={v => set(a.unitId, { dumpS: v })} dp={0} width={70} min={0} /></td>
                  <td><EditCell label={`${a.unitId} spot time`} value={a.spotS} def={d?.spotS} onChange={v => set(a.unitId, { spotS: v })} dp={0} width={70} min={0} /></td>
                  <td><EditCell label={`${a.unitId} loading time`} value={a.loadS} def={d?.loadS} onChange={v => set(a.unitId, { loadS: v })} dp={0} width={70} min={0} /></td>
                  <td><EditCell label={`${a.unitId} planned rate`} value={a.plannedRateBcmPerPtHr} def={d?.plannedRateBcmPerPtHr} onChange={v => set(a.unitId, { plannedRateBcmPerPtHr: v })} dp={0} step={50} width={86} min={0} /></td>
                  <td><EditCell label={`${a.unitId} PT hours/day`} value={a.ptHrsPerDay} def={d?.ptHrsPerDay} onChange={v => set(a.unitId, { ptHrsPerDay: v })} dp={1} step={0.5} width={70} min={0} max={24} /></td>
                  <td><span className={s.subtle}>{num(a.plannedRateBcmPerPtHr * a.ptHrsPerDay, 0)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={s.cardNote}>Edits flow to every circuit on that loader: dump / spot / load and the planned rate (the workbook's INDEX/MATCH into the EX block, C8–C10, I32) and PT h/day as the circuit's loader PT target. Ideal = rate × PT (ActiveRoute!C19).</p>
    </Card>
  );
}

// ── truck loads ──────────────────────────────────────────────────────────────
export function TruckLoadsCard({ scenario }: { scenario: Scenario }) {
  const commit = useCommit();
  const [all, setAll] = useState(false);
  const used = useMemo(() => new Set([...scenario.circuits.map(c => c.truckModelId), ...scenario.fleet.units.filter(u => u.kind === 'truck').map(u => u.modelId)]), [scenario]);
  const trucks = scenario.fleet.trucks.filter(t => all || used.has(t.id));
  const mats = scenario.materials;
  const set = (truckId: string, matId: string, v: number) =>
    commit('Edit truck load', sc => ({
      ...sc,
      fleet: { ...sc.fleet, trucks: sc.fleet.trucks.map(t => (t.id === truckId ? { ...t, loadBcmByMaterial: { ...t.loadBcmByMaterial, [matId]: v } } : t)) },
      circuits: sc.circuits.map(c => (c.truckModelId === truckId && c.materialId === matId ? { ...c, params: { ...c.params, truckLoadBcm: v } } : c)),
    }));
  return (
    <Card className={p.headSafe}>
      <CardHead title="Truck load" sub="bcm per load" icon="truck" actions={<><Toggle on={all} onChange={setAll} label={<span className={s.subtle}>All&nbsp;models</span>} /><RefChip cell="ActiveRoute!N12:N18" /></>} />
      <div style={{ overflowX: 'auto' }}>
        <table className={s.editTable}>
          <thead><tr><th className={s.l}>Truck</th>{mats.map(m => <th key={m.id}>{m.name} <span className={s.subtle}>bcm</span></th>)}</tr></thead>
          <tbody>
            {trucks.map(t => (
              <tr key={t.id}>
                <td className={s.l}><div className={s.unitName}>{t.name}</div><div className={s.subtle}>rated {num(t.payloadT, 0)} t</div></td>
                {mats.map(m => {
                  const v = t.loadBcmByMaterial?.[m.id];
                  const tonnes = v != null ? v * m.bankDensity : undefined;
                  const ratio = tonnes != null && t.payloadT ? tonnes / t.payloadT : undefined;
                  const cell = sheetLoadCell(t, m.id);
                  return (
                    <td key={m.id}>
                      <EditCell label={`${t.name} ${m.name} load`} value={v} def={defaultTruckLoad(t, m.id)} onChange={x => set(t.id, m.id, x)} dp={0} width={72} min={0} />
                      <div className={s.subtle} title={`${num(v ?? 0, 0)} bcm × ${m.bankDensity} t/bcm bank density${cell ? ` · workbook ${cell}` : ''}`}>
                        {tonnes != null ? <>≈ {num(tonnes, 0)} t {ratio != null && <Badge tone={ratio > 1.1 ? 'bad' : ratio > 1.0 ? 'warn' : 'na'}>{num(ratio * 100, 0)}%</Badge>}</> : '–'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.cardNote}>Tonnes = bcm × bank density, as a share of rated payload (Cat 10/10/20 policy: mean ≤ 100%, no load &gt; 120%). Edits flow to circuits using that truck and material (workbook C21).</p>
    </Card>
  );
}

// ── materials ────────────────────────────────────────────────────────────────
export function MaterialsCard({ scenario }: { scenario: Scenario }) {
  const commit = useCommit();
  const set = (id: string, patch: Partial<Material>) => commit(`Edit material ${id}`, sc => ({ ...sc, materials: sc.materials.map(m => (m.id === id ? { ...m, ...patch } : m)) }));
  return (
    <Card className={p.headSafe}>
      <CardHead title="Materials" sub="bank density · swell" icon="solid" />
      <table className={s.editTable}>
        <thead><tr><th className={s.l}>Material</th><th>Bank t/bcm</th><th>Swell lcm/bcm</th><th>Loose t/lcm</th></tr></thead>
        <tbody>
          {scenario.materials.map(m => {
            const d = defaultMaterial(m.id);
            return (
              <tr key={m.id}>
                <td className={s.l}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Dot color={m.color} /><span className={s.unitName}>{m.name}</span><span className={s.subtle}>{m.id}</span></span></td>
                <td><EditCell label={`${m.name} bank density`} value={m.bankDensity} def={d?.bankDensity} onChange={v => set(m.id, { bankDensity: v })} dp={3} step={0.01} width={78} min={0.1} /></td>
                <td><EditCell label={`${m.name} swell`} value={m.swell} def={d?.swell} onChange={v => set(m.id, { swell: v })} dp={2} step={0.01} width={70} min={1} /></td>
                <td className={s.subtle}>{num(m.bankDensity / (m.swell || 1), 3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={s.cardNote}>Workbook reference: OB 1.53 / coal 1.05 t/cbm (unreferenced, M22:O23) and LCM → BCM ×1.2 (AD4, Transcale).</p>
    </Card>
  );
}

// ── spreadsheet grade → speed tables ─────────────────────────────────────────
function StepChart({ loaded, empty, hl }: { loaded: GradeSpeedPoint[]; empty: GradeSpeedPoint[]; hl?: number }) {
  const [box, W] = useWidth<HTMLDivElement>(560);
  const H = 250, L = 44, R = 12, T = 22, B = 44;
  const [hover, setHover] = useState<number | null>(null);
  const gmax = Math.max(0.16, ...loaded.map(p => Math.abs(p[0])));
  const vmax = Math.max(10, ...loaded.map(p => p[1]), ...empty.map(p => p[1]));
  const x = linear([-gmax * 100 - 0.5, gmax * 100 + 0.5], [L, W - R]);
  const y = linear([0, Math.ceil(vmax / 10) * 10], [H - B, T]);
  const steps = (tbl: GradeSpeedPoint[]): [number, number][] => {
    const sorted = [...tbl].sort((a, b) => a[0] - b[0]);
    return sorted.flatMap(([g, v]) => [[g * 100 - 0.5, v], [g * 100 + 0.5, v]] as [number, number][]);
  };
  const near = hover == null ? null : loaded.reduce((b, p) => (Math.abs(p[0] * 100 - hover) < Math.abs(b[0] * 100 - hover) ? p : b), loaded[0]);
  const ev = near ? empty.find(p => Math.abs(p[0] - near[0]) < 1e-9) : undefined;
  return (
    <div ref={box}>
      <svg width={W} height={H} style={{ display: 'block' }} role="img" aria-label="Workbook grade to max speed lookup, loaded and empty"
        onPointerMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(x.invert(e.clientX - r.left)); }}
        onPointerLeave={() => setHover(null)}>
        <GridY y={y} x0={L} x1={W - R} n={4} label="km/h" />
        <AxisX x={x} y0={H - B} n={8} fmt={v => `${signed(v, 0)}%`} label="grade in direction of travel" />
        <line x1={x(0)} x2={x(0)} y1={T} y2={H - B} stroke="var(--hair)" />
        {hl != null && <rect x={x(hl * 100 - 0.5)} width={x(1) - x(0)} y={T} height={H - B - T} fill="var(--accent-50)" />}
        <path d={linePath(steps(empty), x, y)} fill="none" stroke="var(--c2)" strokeWidth={2} strokeLinejoin="round" />
        <path d={linePath(steps(loaded), x, y)} fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round" />
        {near && (
          <g pointerEvents="none">
            <line x1={x(near[0] * 100)} x2={x(near[0] * 100)} y1={T} y2={H - B} stroke="var(--ink-4)" strokeWidth={1} />
            <circle cx={x(near[0] * 100)} cy={y(near[1])} r={4} fill="var(--c1)" stroke="var(--surface)" strokeWidth={2} />
            {ev && <circle cx={x(near[0] * 100)} cy={y(ev[1])} r={4} fill="var(--c2)" stroke="var(--surface)" strokeWidth={2} />}
            <g transform={`translate(${Math.min(W - R - 132, Math.max(L + 4, x(near[0] * 100) + 8))},${T + 4})`}>
              <rect width={128} height={52} rx={8} fill="var(--surface)" stroke="var(--hair)" />
              <text x={10} y={18} style={{ fontSize: 12, fontWeight: 650, fill: 'var(--ink)' }}>{`${signed(near[0] * 100, 0)}% grade`}</text>
              <text x={10} y={34} style={{ fontSize: 12, fill: 'var(--ink-2)' }}>{`Loaded ${near[1]} km/h`}</text>
              <text x={10} y={47} style={{ fontSize: 12, fill: 'var(--ink-2)' }}>{`Empty ${ev?.[1] ?? '–'} km/h`}</text>
            </g>
          </g>
        )}
      </svg>
      <Legend items={[{ label: 'Loaded (P3:Q35)', color: 'var(--c1)' }, { label: 'Empty / return (S3:T35)', color: 'var(--c2)' }]} />
    </div>
  );
}

export function SpeedTablesCard({ scenario, truckId }: { scenario: Scenario; truckId?: string }) {
  const commit = useCommit();
  const [tid, setTid] = useState<string | undefined>(truckId);
  const [allTrucks, setAllTrucks] = useState(true);
  const [focus, setFocus] = useState<number | undefined>();
  const truck: TruckModel | undefined = scenario.fleet.trucks.find(t => t.id === (tid ?? truckId)) ?? scenario.fleet.trucks[0];
  if (!truck) return null;
  const sp = truck.spreadsheetSpeeds;
  const def = defaultSpeeds(truck);
  const set = (which: 'loaded' | 'empty', grade: number, v: number) =>
    commit(`Edit ${which} speed @ ${num(grade * 100, 0)}%`, sc => ({
      ...sc,
      fleet: {
        ...sc.fleet,
        trucks: sc.fleet.trucks.map(t => {
          if (!(allTrucks || t.id === truck.id) || !t.spreadsheetSpeeds) return t;
          const tbl = t.spreadsheetSpeeds[which].map(p => (Math.abs(p[0] - grade) < 1e-9 ? [p[0], v] as GradeSpeedPoint : p));
          return { ...t, spreadsheetSpeeds: { ...t.spreadsheetSpeeds, [which]: tbl } };
        }),
      },
    }));
  const grades = sp ? [...sp.loaded].sort((a, b) => b[0] - a[0]).map(p => p[0]) : [];
  return (
    <Card className={p.headSafe}>
      <CardHead title="Grade → max speed tables" sub="workbook speed model" icon="speed" actions={<>
        <Select small value={truck.id} onChange={setTid} options={scenario.fleet.trucks.map(t => ({ value: t.id, label: t.name }))} />
        <Toggle on={allTrucks} onChange={setAllTrucks} label={<span className={s.subtle}>Edit all trucks</span>} title="The workbook has ONE loaded and ONE empty table for every truck type" />
      </>} />
      {!sp ? <p className={s.cardNote}>{truck.name} has no spreadsheet speed table.</p> : (
        <div className={s.speedWrap}>
          <div className={s.speedScroll}>
            <table className={s.editTable}>
              <thead><tr><th className={s.l}>Grade</th><th>Loaded km/h</th><th>Empty km/h</th></tr></thead>
              <tbody>
                {grades.map(g => {
                  const lv = sp.loaded.find(p => Math.abs(p[0] - g) < 1e-9)?.[1];
                  const evv = sp.empty.find(p => Math.abs(p[0] - g) < 1e-9)?.[1];
                  const dl = def?.loaded.find(p => Math.abs(p[0] - g) < 1e-9)?.[1];
                  const de = def?.empty.find(p => Math.abs(p[0] - g) < 1e-9)?.[1];
                  return (
                    <tr key={g} onFocus={() => setFocus(g)} onMouseEnter={() => setFocus(g)}>
                      <td className={s.l}><span className={s.unitName}>{g > 0 ? '+' : g < 0 ? '−' : ''}{num(Math.abs(g) * 100, 0)}%</span></td>
                      <td><EditCell label={`loaded speed at ${num(g * 100, 0)}%`} value={lv} def={dl} onChange={v => set('loaded', g, v)} dp={0} width={64} min={1} max={80} /></td>
                      <td><EditCell label={`empty speed at ${num(g * 100, 0)}%`} value={evv} def={de} onChange={v => set('empty', g, v)} dp={0} width={64} min={1} max={80} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <StepChart loaded={sp.loaded} empty={sp.empty} hl={focus} />
            <p className={s.cardNote} style={{ padding: '8px 0 0' }}>
              Lookup is an exact match on ROUND(grade, 2) (Excel half-away-from-zero). Grades beyond ±16% find no row: the workbook drops
              that segment's time. The truck selected in ActiveRoute!C3 does <b>not</b> change these speeds – compare with the physics curves on the Truck curves tab.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── shift profile ────────────────────────────────────────────────────────────
const KINDS: ShiftEventKind[] = ['prestart', 'crib', 'fuel', 'changeover', 'blast', 'other'];

export function ShiftProfileCard({ scenario }: { scenario: Scenario }) {
  const commit = useCommit();
  const sh = scenario.shift;
  const def = defaultShift();
  const total = sh.lengthH * 60;
  const prodMin = productiveMinutes(sh);
  const shifts = scenario.circuits[0]?.params.shiftsPerDay ?? 2;
  const setEv = (id: string, patch: Partial<ShiftEvent>) => commit('Edit shift event', sc => ({ ...sc, shift: { ...sc.shift, events: sc.shift.events.map(e => (e.id === id ? { ...e, ...patch } : e)) } }));
  const add = () => commit('Add shift event', sc => ({ ...sc, shift: { ...sc.shift, events: [...sc.shift.events, { id: uid('ev'), label: 'New event', kind: 'other', startMin: 360, durMin: 15, fleetStopFraction: 1 }] } }));
  const del = (id: string) => commit('Delete shift event', sc => ({ ...sc, shift: { ...sc.shift, events: sc.shift.events.filter(e => e.id !== id) } }));
  const events = [...sh.events].sort((a, b) => a.startMin - b.startMin);
  const ptDay = (prodMin / 60) * shifts;
  return (
    <Card className={p.headSafe}>
      <CardHead title="Shift profile" sub={`${sh.name} · ${clock(sh.startHour, 0)}–${clock(sh.startHour, total)} · ${sh.lengthH} h`} icon="calendar" actions={<>
        <Badge tone={ptDay >= 18 ? 'ok' : 'bad'} icon={ptDay >= 18 ? 'tick' : 'warning'} title="Fleet productive time per day from this profile; user rule: at least 18 PT h/day">
          {num(prodMin / 60, 2)} PT h/shift · {num(ptDay, 1)} h/day
        </Badge>
        <Button size="sm" icon="plus" onClick={add}>Event</Button>
      </>} />
      <div className={s.timeline} aria-hidden>
        <div className={s.tlTrack}>
          {events.map(e => {
            const es = EVENT_STYLE[e.kind];
            const frac = e.durMin / total;
            return (
              <div key={e.id} className={s.tlEvent} title={`${e.label} · ${clock(sh.startHour, e.startMin)} · ${e.durMin} min · ${num(e.fleetStopFraction * 100, 0)}% of fleet stopped`}
                style={{ left: `${(e.startMin / total) * 100}%`, width: `${frac * 100}%`, background: eventBackground(e.kind), color: es.ink, opacity: 0.55 + 0.45 * e.fleetStopFraction }}>
                {frac > 0.025 && <Icon name={es.icon} size={14} />}{frac > 0.07 ? es.label : ''}
              </div>
            );
          })}
        </div>
        <div className={s.tlTicks}>
          {Array.from({ length: sh.lengthH / 2 + 1 }, (_, i) => i * 120).map(m => <span key={m} style={{ left: `${(m / total) * 100}%` }}>{clock(sh.startHour, m)}</span>)}
        </div>
      </div>
      <div className={s.tlLegend}>
        {[...new Set(events.map(e => e.kind))].map(k => (
          <span key={k}><i className={s.tlSw} style={{ background: eventBackground(k), color: EVENT_STYLE[k].ink }} />{EVENT_STYLE[k].label}</span>
        ))}
        <span><i className={s.tlSw} style={{ background: 'color-mix(in srgb, var(--ok-50) 70%, var(--surface))' }} />Productive</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className={s.editTable}>
          <thead><tr><th className={s.l}>Event</th><th className={s.l}>Kind</th><th>Start</th><th>Duration</th><th>Fleet stopped</th><th>Lost fleet-min</th><th /></tr></thead>
          <tbody>
            {events.map(e => {
              const d = def?.events.find(x => x.id === e.id);
              return (
                <tr key={e.id}>
                  <td className={s.l}><TextField small value={e.label} onChange={v => setEv(e.id, { label: v })} width={200} /></td>
                  <td className={s.l}>
                    <span className={s.kindCell}>
                      <span className={s.kindIco} style={{ background: eventBackground(e.kind), color: EVENT_STYLE[e.kind].ink }}><Icon name={EVENT_STYLE[e.kind].icon} size={14} /></span>
                      <Select small value={e.kind} onChange={v => setEv(e.id, { kind: v })} options={KINDS.map(k => ({ value: k, label: EVENT_STYLE[k].label }))} />
                    </span>
                  </td>
                  <td><EditCell label={`${e.label} start (min after shift start)`} value={e.startMin} def={d?.startMin} onChange={v => setEv(e.id, { startMin: v })} dp={0} step={5} unit="min" width={88} min={0} max={total} />
                    <div className={s.subtle}>{clock(sh.startHour, e.startMin)}</div></td>
                  <td><EditCell label={`${e.label} duration`} value={e.durMin} def={d?.durMin} onChange={v => setEv(e.id, { durMin: v })} dp={0} step={5} unit="min" width={88} min={0} max={total} /></td>
                  <td><EditCell label={`${e.label} fleet-stop fraction`} value={e.fleetStopFraction} def={d?.fleetStopFraction} onChange={v => setEv(e.id, { fleetStopFraction: v })} dp={2} step={0.05} width={70} min={0} max={1} /></td>
                  <td className={s.subtle}>{num(e.durMin * e.fleetStopFraction, 0)}</td>
                  <td><Button size="sm" variant="ghost" icon="trash" aria-label={`Delete ${e.label}`} onClick={() => del(e.id)} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={s.sumRow}>
              <td className={s.l} colSpan={5}>
                <b>{num(total, 0)} − Σ(duration × fleet stopped)</b> <span className={s.sumVal}>= {num(prodMin, 0)} productive min</span> <span className={s.subtle}>({num(total - prodMin, 0)} lost)</span>
              </td>
              <td><b title="Lost fleet-minutes">{num(total - prodMin, 0)}</b></td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={s.cardNote}>
        Shift PT = {num(prodMin, 0)} min = {num(prodMin / 60, 2)} h; × {shifts} shifts = {num(ptDay, 1)} PT h/day. The workbook instead types PT/day directly (I34 = 20 h; loaders 18 h).
      </p>
    </Card>
  );
}
