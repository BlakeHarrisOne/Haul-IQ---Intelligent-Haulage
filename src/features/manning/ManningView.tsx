/** Manning & crews sheet: KPIs, crew required (gauge + roles), per-circuit breakdown, rule set, shift crews, week, equipment. */
import { useMemo } from 'react';
import { useManning, useScenario } from '@/state/derived';
import { useApp } from '@/state/store';
import { signed } from '@/core/format';
import { Badge, Button, Card, Empty, Kpi, PageHeader, Select } from '@/ui';
import { unitActive } from './roles';
import { RequiredByRole, Breakdown } from './Result';
import { RuleSet } from './RuleSet';
import { Shifts } from './Shifts';
import { WeekGrid } from './WeekGrid';
import { Equipment } from './Equipment';
import page from './page.module.css';

export function ManningView() {
  const scenario = useScenario();
  const manning = useManning();
  const commit = useApp(st => st.commit);
  const setView = useApp(st => st.setView);
  const shifts = scenario.crew.shifts;
  const shift = shifts.find(x => x.id === scenario.crew.activeShiftId);
  const active = scenario.circuits.filter(c => c.active);
  const trucksOp = active.reduce((a, c) => a + c.trucks, 0);
  const maxT = scenario.fleet.trucksAvailable;
  const enabled = scenario.crew.rules.filter(r => r.enabled).length;
  const units = useMemo(() => ({ total: scenario.fleet.units.length, active: scenario.fleet.units.filter(unitActive).length }), [scenario.fleet.units]);

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Crew" icon="crew" title="Manning & crews"
        desc="Crew rules turn the plan into seats – trucks, loaders, the coal dozer and support EX a coal circuit always needs, push dozers and fixed roles – checked against the crew on shift."
        actions={<>
          {shifts.length > 0 && (
            <Select value={scenario.crew.activeShiftId} title="Active shift crew" width={220}
              onChange={v => commit(`Active shift: ${shifts.find(x => x.id === v)?.name ?? v}`, s => ({ ...s, crew: { ...s.crew, activeShiftId: v } }))}
              options={shifts.map(x => ({ value: x.id, label: `${x.name} · ${x.available} ops` }))} />
          )}
          <Button icon="priority" onClick={() => setView('priority')}>Priority plan</Button>
        </>} />

      <Card>
        <div className={page.kpis}>
          <div className={page.kpiCell}>
            <Kpi label="Crew required" icon="crew" value={manning.total} size="lg" />
            <span className={page.kpiFoot}>{manning.lines.length} lines from {enabled} rules</span>
          </div>
          <div className={page.kpiCell}>
            <Kpi label="Available" icon="person" value={manning.available} size="lg" />
            <span className={page.kpiFoot}>{shift?.name ?? 'No active shift'}</span>
          </div>
          <div className={page.kpiCell}>
            <Kpi label={manning.surplus < 0 ? 'Shortfall' : 'Surplus'} icon={manning.surplus < 0 ? 'warning' : 'tick'} size="lg"
              value={<span style={{ color: manning.surplus < 0 ? 'var(--bad-ink)' : 'var(--ok-ink)' }}>{signed(manning.surplus, 0)}</span>} />
            <span className={page.kpiFoot}>{manning.surplus < 0 ? 'Lowest priority gives first' : 'Operators spare'}</span>
          </div>
          <div className={page.kpiCell}>
            <Kpi label="Trucks operating" icon="truck" size="lg"
              value={<span style={{ color: trucksOp > maxT ? 'var(--bad-ink)' : undefined }}>{trucksOp}<span style={{ color: 'var(--ink-3)', fontSize: 18, fontWeight: 600 }}> / {maxT}</span></span>} />
            <span className={page.kpiFoot}>{trucksOp > maxT ? <Badge tone="bad">Over the available fleet</Badge> : trucksOp < maxT ? <Badge tone="warn">Under-trucked plan</Badge> : <Badge tone="ok">Balanced to the fleet</Badge>}</span>
          </div>
          <div className={page.kpiCell}>
            <Kpi label="Circuits active" icon="route" value={active.length} size="lg" />
            <span className={page.kpiFoot}>{units.active} of {units.total} units active</span>
          </div>
        </div>
      </Card>

      {!active.length && !scenario.crew.rules.length ? (
        <Card><Empty icon="crew" title="Nothing to man yet">Add circuits on the site view, then load the workbook crew rules below.</Empty></Card>
      ) : (
        <div className={page.grid2}>
          <RequiredByRole scenario={scenario} manning={manning} />
          <Breakdown scenario={scenario} manning={manning} />
        </div>
      )}

      <RuleSet scenario={scenario} manning={manning} />

      <div className={page.grid46}>
        <Shifts scenario={scenario} />
        <WeekGrid scenario={scenario} manning={manning} />
      </div>

      <Equipment scenario={scenario} manning={manning} />
    </div>
  );
}
