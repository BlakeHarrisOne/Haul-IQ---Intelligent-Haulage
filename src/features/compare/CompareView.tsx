/**
 * Compare tab: every circuit's haulage, trucks, PT hours/day and lost PT side by side; live truck what-ifs; and the
 * live scenario against saved scenarios.
 */
import { useCallback, useRef, useState } from 'react';
import type { Id } from '@/core/types';
import { useApp } from '@/state/store';
import { useResults, useScenario } from '@/state/derived';
import { Button, Card, Empty, MenuButton, PageHeader } from '@/ui';
import p from '@/features/assumptions/shared/page.module.css';
import { downloadCsv, fileSafe, type CsvCell } from '@/features/assumptions/shared/csv';
import { circuitRows, totals, MIN_PT_HRS_DAY, type CircuitRow, type Totals } from './compareData';
import { CircuitCharts, CircuitsTable, FleetKpis } from './CircuitsCompare';
import { WhatIf } from './WhatIf';
import { ScenarioCompare, scenarioCsv } from './ScenarioCompare';

function circuitsCsv(name: string, rows: CircuitRow[], t: Totals): CsvCell[][] {
  return [
    ['hAIul SIM circuit comparison', name],
    ['Circuit', 'Loader', 'Truck', 'Material', 'Route', 'Active', 'Haul km', 'Rise m', 'Fall m', 'Cycle min', 'Trucks assigned', 'Trucks exact', 'Trucks recommended',
      'Truck PT h/day', 'Loader PT target h/day', 'Loader PT achieved h/day', `Meets ${MIN_PT_HRS_DAY} h rule`, 'Lost PT h/shift', 'Queue h/shift', 'Match factor', 'bcm/day', 'Target bcm/day', 'Status'],
    ...rows.map(r => [r.name, r.loader, r.truck, r.material, r.route ?? '', r.active, r.haulKm, r.riseM, r.fallM, r.cycleMin, r.assigned, r.exact, r.recommended,
      r.truckPtHrsDay, r.loaderPtTarget, r.loaderPtHrsDay, r.loaderPtHrsDay >= MIN_PT_HRS_DAY - 1e-9, r.lostPtShift, r.queueHrsShift, r.matchFactor, r.bcmDay, r.targetBcmDay, r.status]),
    ['Total (active)', '', '', '', '', '', t.haulKm, '', '', t.avgCycleMin, t.trucksAssigned, t.trucksExact, t.trucksRecommended, '', '', '', `${t.belowMinPt} below`, t.lostPtShift, t.queueHrsShift, '', t.bcmDay, t.targetBcmDay, ''],
    ['Trucks available', t.trucksAvailable],
  ];
}

export function CompareView() {
  const scenario = useScenario();
  const results = useResults();
  const select = useApp(st => st.select);
  const sel = useApp(st => st.selection);
  const [focus, setFocus] = useState<Id | undefined>(sel.kind === 'circuit' ? sel.id : undefined);
  const scnCols = useRef<Parameters<typeof scenarioCsv>[0]>([]);
  const onCols = useCallback((c: Parameters<typeof scenarioCsv>[0]) => { scnCols.current = c; }, []);
  const rows = circuitRows(scenario, results);
  const t = totals(rows, scenario.fleet.trucksAvailable);
  const pick = (id: Id) => { setFocus(id); select({ kind: 'circuit', id }); };

  if (!scenario.circuits.length) {
    return (
      <div className={p.page}>
        <PageHeader eyebrow="Fleet & scenarios" icon="compare" title="Compare" />
        <Card><Empty icon="compare" title="No circuits to compare">Create circuits on the Site view, or load the demo scenario.</Empty></Card>
      </div>
    );
  }

  return (
    <div className={p.page}>
      <PageHeader
        eyebrow="Fleet & scenarios"
        icon="compare"
        title="Compare"
        desc={<>Every circuit's haulage, number of trucks, PT hours per day and lost PT side by side – with the {MIN_PT_HRS_DAY} h/day loader rule checked – then try truck what-ifs live and compare this scenario against saved ones.</>}
        actions={<>
          <MenuButton align="right" items={[
            { label: 'Circuits table', icon: 'table', hint: 'CSV', onSelect: () => downloadCsv(`${fileSafe(scenario.name)}-circuits`, circuitsCsv(scenario.name, rows, t)) },
            { label: 'Scenario comparison', icon: 'compare', hint: 'CSV', onSelect: () => downloadCsv(`${fileSafe(scenario.name)}-scenario-compare`, scenarioCsv(scnCols.current)) },
          ]}>
            {(open, toggle) => <Button icon="download" iconRight="down" onClick={toggle} aria-expanded={open}>Export CSV</Button>}
          </MenuButton>
          <Button icon="report" onClick={() => window.print()}>Print</Button>
        </>}
      />
      <FleetKpis t={t} />
      <div className={p.grid}>
        <div className={p.s12}><CircuitsTable rows={rows} t={t} selected={focus} onSelect={pick} /></div>
        <CircuitCharts rows={rows} />
        <div className={p.s12}><WhatIf scenario={scenario} results={results} rows={rows} focus={focus} onFocus={pick} /></div>
        <div className={p.s12}><ScenarioCompare live={scenario} liveResults={results} onCols={onCols} /></div>
      </div>
    </div>
  );
}
