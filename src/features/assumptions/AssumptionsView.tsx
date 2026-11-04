/**
 * Assumptions & calculations tab: every number behind a circuit, typeset as a ledger with the equivalent
 * Haulage Calculator cell, the Travel Time sheet reborn, editable site assumptions and the spreadsheet-vs-physics check.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Circuit, CircuitResult, Id, Scenario, SpeedModel } from '@/core/types';
import { num } from '@/core/format';
import { useApp } from '@/state/store';
import { useResults, useScenario } from '@/state/derived';
import { computeCircuit } from '@/engine';
import { Badge, Button, Card, CardHead, Empty, Kpi, MenuButton, PageHeader, Segmented } from '@/ui';
import { CircuitPicker } from './shared/CircuitPicker';
import { downloadCsv, fileSafe } from './shared/csv';
import p from './shared/page.module.css';
import { Ledger, GROUP_META, RefChip } from './Ledger';
import { reconstructSteps } from './fallbackSteps';
import { SegmentTable, REASON } from './SegmentTable';
import { ModelCompare } from './ModelCompare';
import { ChangedKey, LoaderAssumptionsCard, MaterialsCard, ShiftProfileCard, SpeedTablesCard, TruckLoadsCard } from './SiteAssumptions';
import { excelRound } from './shared/excel';
import { CircuitParamsCard } from './CircuitParams';
import s from './assumptions.module.css';

const CIRCUIT_GROUPS = new Set(['route', 'travel', 'cycle', 'productivity', 'fleet', 'loader']);
const STATUS = { under: { tone: 'bad', label: 'Under-trucked' }, balanced: { tone: 'ok', label: 'Balanced' }, over: { tone: 'warn', label: 'Over-trucked' } } as const;

function useCircuitSelection(circuits: Circuit[]): [Id | undefined, (id: Id) => void] {
  const sel = useApp(st => st.selection);
  const select = useApp(st => st.select);
  const fromStore = sel.kind === 'circuit' ? sel.id : undefined;
  const [id, setId] = useState<Id | undefined>(fromStore ?? circuits[0]?.id);
  useEffect(() => { if (fromStore && fromStore !== id) setId(fromStore); }, [fromStore]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = circuits.some(c => c.id === id) ? id : circuits[0]?.id;
  return [valid, (v: Id) => { setId(v); select({ kind: 'circuit', id: v }); }];
}

export function ledgerCsv(c: Circuit, r: CircuitResult, steps = r.steps) {
  return [
    ['hAIul SIM calculation ledger', c.name, `speed model: ${r.speedModel}`],
    ['Group', 'Step', 'Formula', 'Substituted', 'Value', 'Unit', 'Workbook cell', 'Inputs', 'Note'],
    ...steps.map(st => [
      GROUP_META[st.group]?.title ?? st.group, st.label, st.formula, st.substituted ?? '', st.value, st.unit, st.sheetRef ?? '',
      (st.inputs ?? []).map(i => `${i.label}=${i.value}${i.unit ? ' ' + i.unit : ''}${i.source ? ' [' + i.source + ']' : ''}`).join('; '), st.note ?? '',
    ]),
  ];
}

export function segmentsCsv(c: Circuit, r: CircuitResult) {
  return [
    ['hAIul SIM segment travel times', c.name, `speed model: ${r.speedModel}`],
    ['#', 'Chainage m', 'Dist 3D m (A)', 'Dist plan m', 'Grade (B)', 'ROUND(grade,2)', 'RR %', 'Loaded km/h (C)', 'Loaded limit', 'Loaded s (D)', 'Empty km/h (L)', 'Empty limit', 'Empty s (M)', 'Zone'],
    ...r.segments.map(x => [x.i + 1, x.chainageM, x.dist3dM, x.distPlanM, x.grade, excelRound(x.grade, 2), x.rrPct, x.speedLoadedKmh, REASON[x.limitLoaded], x.timeLoadedS, x.speedEmptyKmh, REASON[x.limitEmpty], x.timeEmptyS, x.zone ?? '']),
    ['Σ', '', r.segments.reduce((a, x) => a + x.dist3dM, 0), '', '', '', '', '', '', r.travelLoadedS, '', '', r.travelEmptyS, ''],
  ];
}

function Lineage({ scenario, circuit, result }: { scenario: Scenario; circuit: Circuit; result: CircuitResult }) {
  const hs = scenario.strings.find(x => x.id === circuit.haulStringId);
  const n = hs?.points.length ?? 0;
  const rows: [string, string, string][] = [
    ['Haul string', `${n} points (dig → dump)`, `Data Dump!A2:C${n + 1}`],
    ['Segment table', `${result.segments.length} segments`, `Travel Time!A4:M${result.segments.length + 3}`],
    ['Grade → speed lookup', 'loaded / empty', 'Travel Time!P3:T35'],
    ['Loader assumptions', circuit.loaderUnitId, 'ActiveRoute!H2:J34'],
    ['Truck load', `${num(circuit.params.truckLoadBcm, 0)} bcm`, 'ActiveRoute!C21'],
    ['Cycle → trucks', `${num(result.trucksExact, 2)} trucks`, 'ActiveRoute!C4:C28'],
    ['# trucks options', `${result.options.length} rows`, 'ActiveRoute row 28 (Macro_1…9)'],
  ];
  return (
    <Card className={p.headSafe}>
      <CardHead title="Workbook lineage" sub="where each input lives in calc.xlsm" icon="link" />
      <table className={s.cmpTable}>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a}><td className={s.l}>{a}<div className={s.subtle}>{b}</div></td><td><RefChip cell={c} /></td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function AssumptionsView() {
  const scenario = useScenario();
  const results = useResults();
  const updateParams = useApp(st => st.updateCircuitParams);
  const circuits = scenario.circuits;
  const [cid, setCid] = useCircuitSelection(circuits);
  const circuit = circuits.find(c => c.id === cid);
  const [modelView, setModelView] = useState<SpeedModel | undefined>();
  const model: SpeedModel = modelView ?? circuit?.params.speedModel ?? 'spreadsheet';

  const both = useMemo(() => {
    if (!circuit) return undefined;
    const base = results[circuit.id];
    const get = (m: SpeedModel) => (base && base.speedModel === m ? base : computeCircuit(scenario, circuit, { speedModel: m }));
    return { spreadsheet: get('spreadsheet'), rimpull: get('rimpull') };
  }, [scenario, circuit, results]);

  if (!circuit || !both) {
    return (
      <div className={p.page}>
        <PageHeader eyebrow="Transparency" icon="assumptions" title="Assumptions & calculations" desc="Every number behind each circuit, step by step." />
        <Card><Empty icon="assumptions" title="No circuits yet">Create a circuit (loader → haul string → dump) on the Site view to see its full calculation ledger here.</Empty></Card>
      </div>
    );
  }
  const r = both[model];
  const ownSteps = r.steps.filter(x => CIRCUIT_GROUPS.has(x.group));
  const reconstructed = ownSteps.length === 0 && r.ok;
  const steps = reconstructed ? reconstructSteps(scenario, circuit, r) : ownSteps;
  const truck = scenario.fleet.trucks.find(t => t.id === circuit.truckModelId);
  const st = STATUS[r.assigned.status];
  const exportLedger = () => downloadCsv(`${fileSafe(circuit.name)}-ledger-${model}`, ledgerCsv(circuit, r, steps));
  const exportSegs = () => downloadCsv(`${fileSafe(circuit.name)}-segments-${model}`, segmentsCsv(circuit, r));

  return (
    <div className={p.page}>
      <PageHeader
        eyebrow="Transparency"
        icon="assumptions"
        title="Assumptions & calculations"
        desc={<>Every number behind <b>{circuit.name}</b>, step by step – formula, numbers substituted, result, and the equivalent cell in the Haulage Calculator workbook. Nothing is hidden: no implicit efficiency factors, every input has a source.</>}
        actions={<>
          <MenuButton align="right" items={[
            { label: 'Calculation ledger', icon: 'formula', onSelect: exportLedger, hint: 'CSV' },
            { label: 'Segment travel times', icon: 'table', onSelect: exportSegs, hint: 'CSV' },
          ]}>
            {(open, toggle) => <Button icon="download" iconRight="down" onClick={toggle} aria-expanded={open}>Export CSV</Button>}
          </MenuButton>
          <Button icon="report" onClick={() => window.print()}>Print</Button>
        </>}
      />

      <div className={`${p.toolbar} ${p.noPrint}`}>
        <CircuitPicker circuits={circuits} value={circuit.id} onChange={id => { setCid(id); setModelView(undefined); }} />
        <span className={p.toolGroup}>
          <span className={p.toolLabel}>Speed model</span>
          <Segmented small value={model} onChange={setModelView} style={{ width: 'fit-content' }} options={[
            { value: 'spreadsheet', label: 'Spreadsheet', icon: 'table', title: 'Workbook grade → max-speed lookup' },
            { value: 'rimpull', label: 'Rimpull', icon: 'curve', title: 'Physics: rimpull / retarder curves vs resistance' },
          ]} />
          {model !== circuit.params.speedModel
            ? <Button size="sm" variant="ghost" onClick={() => { updateParams(circuit.id, { speedModel: model }); setModelView(undefined); }}>Use {model} for this circuit</Button>
            : <Badge tone="na">circuit setting</Badge>}
        </span>
      </div>

      <Card>
        <div className={p.kpis}>
          <Kpi label="Cycle time" value={num(r.cycleMin, 2)} unit="min" delta={`haul ${num(r.haulTimeS / 60, 2)} min ÷ η ${circuit.params.haulEff}`} />
          <Kpi label="Truck productivity" value={num(r.truckProdBcmPerPtHr, 0)} unit="bcm/PT h" delta={`${num(circuit.params.truckLoadBcm, 0)} bcm × ${num(60 / r.cycleMin, 2)} loads/h`} />
          <Kpi label="Trucks needed" value={num(r.trucksExact, 2)} delta={`recommend ${r.trucksRecommended} · assigned ${circuit.trucks}`} deltaTone={circuit.trucks >= r.trucksRecommended ? 'ok' : 'bad'} />
          <Kpi label="Loader PT achieved" value={num(r.assigned.loaderPtHrsDay, 1)} unit="h/day" delta={`target ${num(r.loaderPtHrs, 1)} h · min 18 h`} deltaTone={r.assigned.loaderPtHrsDay >= 18 - 1e-9 ? 'ok' : 'bad'} />
          <Kpi label="Lost PT" value={num(r.assigned.lostLoaderPtHrsShift, 2)} unit="h/shift" delta={st.label} deltaTone={st.tone === 'warn' ? 'warn' : st.tone} icon={r.assigned.status === 'under' ? 'warning' : undefined} />
          <Kpi label="Production" value={num(r.assigned.bcmPerDay, 0)} unit="bcm/day" delta={`target ${num(circuit.params.desiredDailyBcm, 0)}`} deltaTone={r.assigned.bcmPerDay >= circuit.params.desiredDailyBcm - 1 ? 'ok' : 'warn'} />
        </div>
      </Card>

      {!r.ok && <Card><Empty icon="warning" title="This circuit cannot be calculated">{r.error ?? 'Unknown engine error.'}</Empty></Card>}

      {r.ok && (
        <div className={p.grid}>
          <div className={p.s8}>
            <Ledger
              steps={steps}
              reconstructed={reconstructed}
              warnings={r.warnings}
              title="Calculation ledger"
              sub={`${steps.length} steps · ${model === 'spreadsheet' ? 'spreadsheet' : 'rimpull'} model · ${truck?.name ?? circuit.truckModelId}`}
              onExport={exportLedger}
            />
          </div>
          <div className={`${p.s4} ${p.stack} ${p.sticky}`}>
            <ModelCompare sheet={both.spreadsheet} rim={both.rimpull} assigned={circuit.trucks} />
            <Lineage scenario={scenario} circuit={circuit} result={r} />
          </div>
        </div>
      )}
      {r.ok && <div className={p.grid}><div className={p.s12}><SegmentTable result={r} onExport={exportSegs} /></div></div>}
      <div className={p.grid}><div className={p.s12}><CircuitParamsCard scenario={scenario} circuit={circuit} /></div></div>

      <div className={s.subHead}>
        <div className={s.subHeadText}>
          <h2 className={s.subTitle}>Site assumptions</h2>
          <p className={s.subDesc}>Edit any input – every change is undoable and recalculates all circuits. Highlighted cells differ from the default; the reset arrow restores it.</p>
        </div>
        <ChangedKey />
      </div>
      <div className={p.grid}>
        <div className={p.s12}><LoaderAssumptionsCard scenario={scenario} /></div>
        <div className={p.s7}><TruckLoadsCard scenario={scenario} /></div>
        <div className={p.s5}><MaterialsCard scenario={scenario} /></div>
        <div className={p.s12}><SpeedTablesCard scenario={scenario} truckId={circuit.truckModelId} /></div>
        <div className={p.s12}><ShiftProfileCard scenario={scenario} /></div>
      </div>
    </div>
  );
}
