/**
 * Truck curves tab: rimpull / retarder curves with resistance lines and the circuit's operating points, the workbook
 * grade → speed table against physics, balance-speed table and a provenance-first spec sheet.
 */
import { useCallback, useId, useMemo, useState } from 'react';
import type { Circuit, CircuitResult, SpeedModel, TruckModel } from '@/core/types';
import { num, signed } from '@/core/format';
import { useApp } from '@/state/store';
import { useResults, useScenario } from '@/state/derived';
import { computeCircuit } from '@/engine';
import { Badge, Button, Card, CardHead, Empty, MenuButton, PageHeader, Range, Segmented, Select, Tip } from '@/ui';
import p from '@/features/assumptions/shared/page.module.css';
import { downloadCsv, fileSafe, type CsvCell } from '@/features/assumptions/shared/csv';
import { excelRound } from '@/features/assumptions/shared/excel';
import { curveForce, effGradeForce, range, type TruckX } from './physics';
import { balanceAt, chartPoints, chartTruck, limitShort, speedRows } from './model';
import { RimpullChart, type OpPoint, type SeriesTruck } from './RimpullChart';
import { SpeedGradePanels } from './SpeedGradeChart';
import { SpecSheet } from './SpecSheet';
import c from './curves.module.css';

/** Truck overlay colours: validated subset of the categorical tokens (all-pairs CVD ΔE ≥ 14, normal ≥ 17). */
const TRUCK_COLORS = ['var(--c1)', 'var(--c5)', 'var(--c7)'];
const GRADE_CHIPS = [-10, -8, -5, 0, 2, 5, 8, 10, 12, 15];
type PayloadMode = 'nominal' | 'site' | 'p110' | 'gmw';

interface DirPhys { massT?: number; resistanceKN?: number; gear?: number; binding?: string }
type SegX = CircuitResult['segments'][number] & { physLoaded?: DirPhys; physEmpty?: DirPhys };
type ResX = CircuitResult & { massLoadedT?: number; massEmptyT?: number; payloadT?: number };

function sitePayload(sc: ReturnType<typeof useScenario>, circ: Circuit | undefined): number | undefined {
  if (!circ) return undefined;
  const m = sc.materials.find(x => x.id === circ.materialId);
  return m ? circ.params.truckLoadBcm * m.bankDensity : undefined;
}

export function CurvesView() {
  const scenario = useScenario();
  const results = useResults();
  const sel = useApp(st => st.selection);
  const trucks = scenario.fleet.trucks;
  const selCircuit = sel.kind === 'circuit' ? scenario.circuits.find(x => x.id === sel.id) : undefined;
  const firstUsed = selCircuit?.truckModelId ?? scenario.circuits[0]?.truckModelId ?? trucks[0]?.id;
  const [primaryId, setPrimaryId] = useState<string | undefined>(firstUsed);
  const [overlays, setOverlays] = useState<string[]>([]);
  const [circuitId, setCircuitId] = useState<string>(selCircuit?.id ?? '');
  const [ptModel, setPtModel] = useState<'circuit' | SpeedModel>('circuit');
  const [effGrade, setEffGrade] = useState(10);
  const [rr, setRr] = useState<number>(selCircuit?.params.rrPct ?? scenario.circuits[0]?.params.rrPct ?? 2.5);
  const [payloadMode, setPayloadMode] = useState<PayloadMode>('nominal');

  const primary0 = trucks.find(t => t.id === primaryId) ?? trucks.find(t => t.id === firstUsed) ?? trucks[0];
  const circuitsForTruck = scenario.circuits.filter(x => x.truckModelId === primary0?.id);
  const circ = circuitsForTruck.find(x => x.id === circuitId) ?? (circuitId === 'none' ? undefined : circuitsForTruck[0]);

  const series: SeriesTruck[] = useMemo(() => {
    if (!primary0) return [];
    const list = [primary0, ...overlays.map(id => trucks.find(t => t.id === id)).filter((t): t is TruckModel => !!t && t.id !== primary0.id)].slice(0, 3);
    return list.map((t, i) => ({ t: chartTruck(t), color: TRUCK_COLORS[i] }));
  }, [primary0, overlays, trucks]);

  const payloadT = useCallback((t: TruckX) => {
    const site = sitePayload(scenario, circ);
    switch (payloadMode) {
      case 'gmw': return t.gvwT - t.emptyMassT;
      case 'p110': return t.payloadT * 1.1;
      case 'site': return t.id === circ?.truckModelId && site ? site : t.payloadT;
      default: return t.payloadT;
    }
  }, [payloadMode, scenario, circ]);

  const result: ResX | undefined = useMemo(() => {
    if (!circ) return undefined;
    const m: SpeedModel = ptModel === 'circuit' ? circ.params.speedModel : ptModel;
    const base = results[circ.id];
    return (base && base.speedModel === m ? base : computeCircuit(scenario, circ, { speedModel: m })) as ResX;
  }, [circ, ptModel, results, scenario]);

  if (!primary0 || !series.length) {
    return (
      <div className={p.page}>
        <PageHeader eyebrow="Transparency" icon="curve" title="Truck curves" />
        <Card><Empty icon="truck" title="No truck models in this scenario">Load the demo or import a fleet library to see rimpull, retarder and speed-on-grade curves.</Empty></Card>
      </div>
    );
  }
  const prim = series[0].t;
  const mL = prim.emptyMassT + payloadT(prim);
  const mE = prim.emptyMassT;

  const points: OpPoint[] = chartPoints(result);

  const toggleOverlay = (id: string) => setOverlays(o => (o.includes(id) ? o.filter(x => x !== id) : o.length >= 2 ? o : [...o, id]));
  const limit = circ?.params.speedLimitKmh;

  const exportCsv = () => {
    const rows: CsvCell[][] = [['hAIul SIM truck curves', prim.name, `RR ${rr}%`, `payload ${num(payloadT(prim), 1)} t`]];
    rows.push([], ['Rimpull envelope', 'km/h', 'kN']); prim.rimpull.forEach(q => rows.push(['', q[0], q[1]]));
    rows.push([], ['Retarder envelope', 'km/h', 'kN']); prim.retarder.forEach(q => rows.push(['', q[0], q[1]]));
    (prim.rimpullGears ?? []).forEach(g => { rows.push([], [`Rimpull gear ${g.gear} (max ${g.maxKmh} km/h)`, 'km/h', 'kN']); g.points.forEach(q => rows.push(['', q[0], q[1]])); });
    rows.push([], ['Speed vs grade', 'grade', 'workbook loaded km/h', 'physics loaded km/h', 'loaded limit', 'workbook empty km/h', 'physics empty km/h', 'empty limit']);
    const grades = range(-0.16, 0.16, 0.01);
    const rl = speedRows(prim, true, rr, payloadT(prim), grades, limit), re = speedRows(prim, false, rr, 0, grades, limit);
    rl.forEach((r, k) => rows.push(['', +r.grade.toFixed(2), r.spreadsheetKmh, r.kmh, r.binding, re[k].spreadsheetKmh, re[k].kmh, re[k].binding]));
    downloadCsv(`${fileSafe(prim.name)}-curves`, rows);
  };

  const balRows = [-15, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 15];
  const estimatedCurves = prim.dataQuality?.rimpull_curve === 'estimated' || prim.estimated.includes('rimpull');

  return (
    <div className={p.page}>
      <PageHeader
        eyebrow="Transparency"
        icon="curve"
        title="Truck curves"
        desc={<>Where every travel speed comes from: rimpull and retarder curves against the road's resistance, the workbook's grade → speed table against physics, and the provenance of every number. Drag the resistance line or use ↑ ↓ to change the grade.</>}
        actions={<>
          <Button icon="download" onClick={exportCsv}>Export CSV</Button>
          <Button icon="report" onClick={() => window.print()}>Print</Button>
        </>}
      />

      <div className={`${p.toolbar} ${p.noPrint}`}>
        <span className={p.toolGroup}>
          <span className={p.toolLabel}>Truck</span>
          <Select value={prim.id} onChange={v => { setPrimaryId(v); setOverlays(o => o.filter(x => x !== v)); setCircuitId(''); }} width={190}
            options={trucks.map(t => ({ value: t.id, label: t.name }))} />
        </span>
        <span className={p.toolGroup}>
          <span className={p.toolLabel}>Compare with</span>
          <span className={c.truckChips}>
            {trucks.filter(t => t.id !== prim.id).map(t => {
              const on = overlays.includes(t.id);
              const idx = series.findIndex(s => s.t.id === t.id);
              return (
                <button key={t.id} type="button" className={c.truckChip} aria-pressed={on} disabled={!on && overlays.length >= 2} onClick={() => toggleOverlay(t.id)}
                  title={!on && overlays.length >= 2 ? 'Up to 3 trucks at once' : undefined}>
                  <span className={c.swatchLine} style={{ background: on && idx > 0 ? series[idx].color : 'var(--hair)' }} />{t.name}
                </button>
              );
            })}
          </span>
        </span>
      </div>

      <div className={p.grid}>
        <div className={`${p.s8} ${p.stack}`}>
          <Card className={p.headSafe}>
            <CardHead title="Rimpull & retarder" sub="force at the wheels vs speed" icon="curve" actions={
              <span className={c.provenance}>
                {estimatedCurves && (
                  <Tip side="down" text={<>Curves are model estimates (engine power + OEM gear speeds, spec 04 §G.2).<br />Only gear speeds{/789c/i.test(prim.model) ? ' and stall rimpull' : ''} are OEM – calibrate with OEM charts / site GPS.</>}>
                    <Badge tone="warn" icon="warning">Estimated curves</Badge>
                  </Tip>
                )}
              </span>
            } />
            <div className={c.controls}>
              <span className={c.ctrlLabel}>Effective grade</span>
              <span className={c.chips} role="group" aria-label="Effective grade presets">
                {GRADE_CHIPS.map(g => <button key={g} type="button" className={c.chip} aria-pressed={effGrade === g} onClick={() => setEffGrade(g)}>{signed(g, 0)}%</button>)}
              </span>
              <span className={c.sliderBox}>
                <Range value={effGrade} min={-20} max={20} step={0.5} onChange={setEffGrade} title="Effective grade (grade + RR), %" />
                <span className={c.sliderVal}>{signed(effGrade, 1)}%</span>
              </span>
              <span className={c.ctrlLabel}>Points</span>
              <Select small value={circ?.id ?? 'none'} onChange={setCircuitId} title="Operating points of a circuit using this truck"
                options={[{ value: 'none', label: 'None' }, ...circuitsForTruck.map(x => ({ value: x.id, label: x.name }))]} />
              {circ && (
                <Segmented small value={ptModel} onChange={setPtModel} style={{ width: 'fit-content' }} options={[
                  { value: 'circuit', label: 'Circuit model' }, { value: 'spreadsheet', label: 'Spreadsheet' }, { value: 'rimpull', label: 'Rimpull' },
                ]} />
              )}
            </div>
            <RimpullChart series={series} effGradePct={effGrade} onGrade={setEffGrade} massLoaded={mL} massEmpty={mE} points={points}
              speedLimit={limit} circuitLabel={circ ? `${circ.name} (${result?.speedModel})` : undefined} />
          </Card>
          <Card className={p.headSafe}>
            <CardHead title="Balance speeds" sub={`by effective grade · loaded ${num(mL, 0)} t / empty ${num(mE, 0)} t · click a row to plot it`} icon="table" />
            <div style={{ overflowX: 'auto' }}>
              <table className={c.balTable}>
                <thead>
                  <tr>
                    <th className={c.l}>Effective grade</th>
                    {series.map(s => [
                      <th key={s.t.id + 'l'} className={c.sepL}>{s.t.name} loaded</th>,
                      <th key={s.t.id + 'f'}>kN</th>,
                      <th key={s.t.id + 'e'}>empty</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {balRows.map(g => (
                    <tr key={g} className={g === effGrade ? c.sel : undefined} onClick={() => setEffGrade(g)}>
                      <td className={c.l}><b>{signed(g, 0)}%</b> <span className={c.lim}>{g < 0 ? 'retarding' : g === 0 ? 'level, no RR' : 'propelling'}</span></td>
                      {series.map(s => {
                        const ml = s.t.emptyMassT + payloadT(s.t), me = s.t.emptyMassT;
                        const fl = effGradeForce(ml, g);
                        const bl = balanceAt(s.t, ml, g / 100, limit), be = balanceAt(s.t, me, g / 100, limit);
                        return [
                          <td key={s.t.id + 'l'} className={c.sepL}>{bl.kmh > 0 ? num(bl.kmh, 1) : '–'}<span className={c.lim}>{limitShort(bl)}</span></td>,
                          <td key={s.t.id + 'f'} style={{ color: 'var(--ink-3)' }}>{num(Math.abs(fl), 0)}</td>,
                          <td key={s.t.id + 'e'}>{be.kmh > 0 ? num(be.kmh, 1) : '–'}<span className={c.lim}>{limitShort(be)}</span></td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ padding: '8px 16px 12px', fontSize: 12.5, color: 'var(--ink-3)', margin: 0 }}>
              Table view of the rimpull chart. Speeds are steady-state balance speeds (no acceleration), capped by top speed{limit ? ` and the ${limit} km/h circuit limit` : ''}.
              Descents use {series[0].t.descentRule === 'discrete_gear' ? 'the highest gear the retarder sustains (Cat ARC)' : 'continuous retarder control'}. Envelope rimpull at 10 km/h: {num(curveForce(prim.rimpull, 10), 0)} kN.
            </p>
          </Card>
        </div>
        <div className={p.s4}><SpecSheet t={prim} color={series[0].color} /></div>

        <div className={p.s12}>
          <Card className={p.headSafe}>
            <CardHead title="Speed vs grade" sub="workbook table vs physics, same truck" icon="speed" actions={
              <span className={c.provenance}>
                <span className={c.ctrlLabel}>RR</span>
                <span className={c.sliderBox} style={{ minWidth: 180 }}>
                  <Range value={rr} min={0} max={8} step={0.5} onChange={setRr} title="Rolling resistance, %" />
                  <span className={c.sliderVal}>{num(rr, 1)}%</span>
                </span>
                <span className={c.ctrlLabel}>Payload</span>
                <Select small value={payloadMode} onChange={setPayloadMode} options={[
                  { value: 'nominal', label: `Nominal ${num(prim.payloadT, 0)} t` },
                  { value: 'site', label: `Site load${circ ? ` ${num(sitePayload(scenario, circ) ?? 0, 0)} t` : ' (pick a circuit)'}`, disabled: !circ },
                  { value: 'p110', label: `110% ${num(prim.payloadT * 1.1, 0)} t` },
                  { value: 'gmw', label: `To GMW ${num(prim.gvwT - prim.emptyMassT, 0)} t` },
                ]} />
              </span>
            } />
            <SpeedGradePanels series={series} rr={rr} payloadT={payloadT} limit={limit} />
            <div className={c.legend}>
              <LegendKey line="var(--ink-2)" label="Workbook table (Travel Time!P3:T35)" />
              {series.map(s => <LegendKey key={s.t.id} line={s.color} label={`${s.t.name} physics`} w={s === series[0] ? 2.5 : 1.75} />)}
              <LegendKey fill="var(--bad-100)" label="Table optimistic (too fast → too few trucks)" />
              <LegendKey hatch label="Table pessimistic (too slow → too many trucks)" />
              <LegendKey fill="var(--surface-3)" label="Outside table: workbook drops segment time" />
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
}

function LegendKey({ line, fill, hatch, label, w = 2 }: { line?: string; fill?: string; hatch?: boolean; label: string; w?: number }) {
  const id = `lk${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className={c.legItem} style={{ cursor: 'default' }}>
      <svg width="18" height="10" aria-hidden>
        {hatch && (
          <defs><pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="color-mix(in srgb, var(--na) 10%, transparent)" /><line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-3)" strokeWidth="1.2" strokeOpacity=".6" />
          </pattern></defs>
        )}
        {hatch ? <rect x="1" y="1" width="16" height="8" rx="2" fill={`url(#${id})`} stroke="var(--hair)" />
          : fill ? <rect x="1" y="1" width="16" height="8" rx="2" fill={fill} /> : <line x1="1" x2="17" y1="5" y2="5" stroke={line} strokeWidth={w} strokeLinecap="round" />}
      </svg>
      {label}
    </span>
  );
}
