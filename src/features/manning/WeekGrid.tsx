/** 7-day crew grid mirroring the workbook's crew block (Targets rows 65-88): lines × days, totals with the CF colours. */
import { Fragment, type ReactNode } from 'react';
import type { ManningResult, Scenario } from '@/core/types';
import { Card, CardBody, CardHead, Icon, circuitColor, cx } from '@/ui';
import { ROLE_META } from './roles';
import { groupLines, lineLabel } from './model';
import css from './manning.module.css';
import page from './page.module.css';

function weekDays(today = new Date()) {
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = (d0.getDay() + 6) % 7; // Monday = 0
  d0.setDate(d0.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(d0); d.setDate(d0.getDate() + i);
    return { d, isToday: i === dow, dow: d.toLocaleDateString('en-AU', { weekday: 'short' }), dm: d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) };
  });
}

export function WeekGrid({ scenario, manning }: { scenario: Scenario; manning: ManningResult }) {
  const days = weekDays();
  const groups = groupLines(scenario, manning);
  const shift = scenario.crew.shifts.find(x => x.id === scenario.crew.activeShiftId);
  const trucksOp = scenario.circuits.filter(c => c.active).reduce((a, c) => a + c.trucks, 0);
  const maxT = scenario.fleet.trucksAvailable;
  const cell = (v: number | string, i: number, cls?: string) => (
    <td key={i} className={cx(days[i].isToday ? css.today : css.dim, cls)}>{v}</td>
  );
  const row = (label: ReactNode, v: number | string, cls?: (i: number) => string | undefined, trCls?: string) => (
    <tr className={trCls}>
      <td className={css.rowLab}>{label}</td>
      {days.map((_, i) => cell(v, i, cls?.(i)))}
    </tr>
  );
  return (
    <Card>
      <CardHead icon="calendar" title="Week" sub={`Crew by day · ${days[0].dm} – ${days[6].dm}`} />
      <CardBody style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className={css.week}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Line</th>
                {days.map((d, i) => <th key={i} className={d.isToday ? css.today : undefined}>{d.dow}<div style={{ fontWeight: 500 }}>{d.dm}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <Fragment key={g.key}>
                  {row(<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{g.circuit && <span style={{ width: 8, height: 8, borderRadius: 4, background: circuitColor(g.circuit.color) }} />}{g.circuit?.loaderUnitId ?? g.title}</span>, g.total, undefined, css.grp)}
                  {g.lines.map((l, k) => (
                    <tr key={k}>
                      <td className={css.rowLab} title={l.reason}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: 14 }}><Icon name={ROLE_META[l.role].icon} size={14} />{lineLabel(scenario, l).name}</span>
                      </td>
                      {days.map((_, i) => cell(l.count, i))}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {row('Total crew required', manning.total, () => (manning.total <= manning.available ? css.cfOk : css.cfBad), css.tot)}
              {row(`Available${shift ? ` · ${shift.name}` : ''}`, manning.available)}
              {row('Trucks operating', `${trucksOp} / ${maxT}`, () => (trucksOp > maxT ? css.cfBad : trucksOp < maxT ? css.cfWarn : css.cfOk))}
            </tbody>
          </table>
        </div>
        <div className={page.footNote}><Icon name="info" size={16} />
          <span>Per-day plans aren't modelled yet: every day repeats today's plan (the workbook's linked block repeats the plan week the same way). Trucks operating uses the workbook colours: red above the available fleet (E57 &gt; 12), green at it, amber under-trucked (note AJ5).</span>
        </div>
      </CardBody>
    </Card>
  );
}

