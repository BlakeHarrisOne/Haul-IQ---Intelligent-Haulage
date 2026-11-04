/** (a) Circuits in this scenario: KPI strip, full comparison table with totals and three charts. */
import { useEffect, useRef, useState } from 'react';
import type { CircuitRow, Totals } from './compareData';
import { MIN_PT_HRS_DAY } from './compareData';
import { num } from '@/core/format';
import { Badge, Card, CardHead, Dot, Kpi } from '@/ui';
import p from '@/features/assumptions/shared/page.module.css';
import { HBarChart, TrucksDotPlot } from './CompareCharts';
import s from './compare.module.css';

const STATUS = {
  under: { tone: 'bad', label: 'Under-trucked', icon: 'warning' },
  balanced: { tone: 'ok', label: 'Balanced', icon: 'tick' },
  over: { tone: 'warn', label: 'Over-trucked', icon: 'info' },
  error: { tone: 'na', label: 'Not calculated', icon: 'warning' },
} as const;

export function StatusBadge({ st }: { st: CircuitRow['status'] }) {
  const m = STATUS[st];
  return <Badge tone={m.tone} icon={m.icon}>{m.label}</Badge>;
}

export function FleetKpis({ t }: { t: Totals }) {
  const over = t.trucksAssigned - t.trucksAvailable;
  return (
    <Card>
      <div className={p.kpis}>
        <Kpi label="Trucks used / available" value={<>{t.trucksAssigned}<span style={{ color: 'var(--ink-3)', fontWeight: 600 }}> / {num(t.trucksAvailable, 0)}</span></>}
          delta={over > 0 ? `${over} more than available` : over < 0 ? `${-over} spare` : 'all trucks working'} deltaTone={over > 0 ? 'bad' : over < 0 ? 'warn' : 'ok'} icon="truck" />
        <Kpi label="Trucks needed (exact / rec.)" value={num(t.trucksExact, 1)} delta={`${t.trucksRecommended} recommended`} deltaTone={t.trucksRecommended > t.trucksAvailable ? 'bad' : 'na'} />
        <Kpi label="Production" value={num(t.bcmDay, 0)} unit="bcm/day" delta={`${num((t.bcmDay / (t.targetBcmDay || 1)) * 100, 0)}% of ${num(t.targetBcmDay, 0)} target`} deltaTone={t.bcmDay >= t.targetBcmDay - 1 ? 'ok' : 'warn'} />
        <Kpi label="Lost loader PT" value={num(t.lostPtShift, 2)} unit="h/shift" delta={t.lostPtShift > 0.01 ? 'hang time from under-trucking' : 'no hang time'} deltaTone={t.lostPtShift > 0.01 ? 'bad' : 'ok'} icon={t.lostPtShift > 0.01 ? 'warning' : undefined} />
        <Kpi label="Truck queue" value={num(t.queueHrsShift, 2)} unit="h/shift" delta={t.queueHrsShift > 0.01 ? 'over-trucking' : 'no queueing'} deltaTone={t.queueHrsShift > 0.01 ? 'warn' : 'ok'} />
        <Kpi label={`Loaders below ${MIN_PT_HRS_DAY} PT h/day`} value={t.belowMinPt} delta={t.belowMinPt ? 'rule: min 18 h PT/day' : 'all meet the 18 h rule'} deltaTone={t.belowMinPt ? 'bad' : 'ok'} />
      </div>
    </Card>
  );
}

/** Horizontal scroll state of a wide table: which edges still hide columns (drives the edge fades). */
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ left: false, right: false, firstW: 220 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => {
      const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const firstW = (el.querySelector('th') as HTMLElement | null)?.offsetWidth ?? 220;
      setEdges(e => (e.left === left && e.right === right && e.firstW === firstW ? e : { left, right, firstW }));
    };
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', upd); ro.disconnect(); };
  }, []);
  return [ref, edges] as const;
}

export function CircuitsTable({ rows, t, selected, onSelect }: { rows: CircuitRow[]; t: Totals; selected?: string; onSelect: (id: string) => void }) {
  const [scroller, edges] = useScrollEdges<HTMLDivElement>();
  return (
    <Card className={p.headSafe}>
      <CardHead title="Circuits" sub={`${t.activeCircuits} active · haulage, trucks, PT hours and losses`} icon="table" />
      <div className={`${s.scrollFrame} ${edges.left ? s.fadeL : ''} ${edges.right ? s.fadeR : ''}`} style={{ ['--first-w' as string]: `${edges.firstW}px` }}>
      <div className={s.tableScroll} ref={scroller} tabIndex={0} aria-label="Circuits table (scrolls sideways)">
        <table className={s.tbl}>
          <thead>
            <tr>
              <th className={`${s.l} ${s.first}`} rowSpan={2} style={{ verticalAlign: 'bottom' }}>Circuit</th>
              <th className={`${s.grp} ${s.sepL}`} colSpan={4}>Haulage</th>
              <th className={`${s.grp} ${s.sepL}`} colSpan={3}>Trucks</th>
              <th className={`${s.grp} ${s.sepL}`} colSpan={5}>PT hours</th>
              <th className={`${s.grp} ${s.sepL}`} colSpan={3}>Production</th>
            </tr>
            <tr>
              <th className={s.sepL}>Haul km</th><th>Rise / fall m</th><th>Cycle min</th><th>Match</th>
              <th className={s.sepL}>Assigned</th><th>Exact</th><th>Rec.</th>
              <th className={s.sepL} title="Truck production hours per day (workbook C22)">Truck PT h/d</th>
              <th title="Loader PT target, h/day">Loader target</th>
              <th title={`Loader PT achieved with the assigned trucks; rule: ≥ ${MIN_PT_HRS_DAY} h/day`}>Loader PT h/d</th>
              <th title="Loader PT lost per shift to hang time (under-trucking)">Lost PT h/sh</th>
              <th title="Truck hours lost per shift queuing (over-trucking)">Queue h/sh</th>
              <th className={s.sepL}>bcm/day</th><th>vs target</th><th className={s.l}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={`${selected === r.id ? s.sel : ''} ${r.active ? '' : s.off}`} onClick={() => onSelect(r.id)}>
                <td className={`${s.l} ${s.first}`}>
                  <div className={s.name} title={`${r.name}\n${r.loader} · ${r.truck} · ${r.material}${r.route ? ` · ${r.route}` : ''}`}><Dot color={r.color} /><span>{r.name}</span>{!r.active && <Badge tone="na">inactive</Badge>}</div>
                  <div className={s.meta}>{r.loader} · {r.truck} · {r.material}{r.route && r.route !== r.name ? ` · ${r.route}` : ''}</div>
                </td>
                <td className={s.sepL}>{num(r.haulKm, 2)}</td>
                <td>{num(r.riseM, 0)} <span className={s.muted}>/</span> {num(r.fallM, 0)}</td>
                <td>{num(r.cycleMin, 2)}</td>
                <td title="Match factor = trucks × loader service time / cycle time">{num(r.matchFactor, 2)}</td>
                <td className={s.sepL}><b>{r.assigned}</b></td>
                <td>{num(r.exact, 2)}</td>
                <td className={r.assigned < r.recommended ? s.bad : undefined}>{num(r.recommended, 0)}</td>
                <td className={s.sepL}>{num(r.truckPtHrsDay, 1)}</td>
                <td className={s.muted}>{num(r.loaderPtTarget, 1)}</td>
                <td className={r.loaderPtHrsDay < MIN_PT_HRS_DAY - 1e-9 ? s.bad : s.ok}>{num(r.loaderPtHrsDay, 1)}</td>
                <td className={r.lostPtShift > 0.005 ? s.bad : s.muted}>{num(r.lostPtShift, 2)}</td>
                <td className={r.queueHrsShift > 0.005 ? s.warn : s.muted}>{num(r.queueHrsShift, 2)}</td>
                <td className={s.sepL}>{num(r.bcmDay, 0)}</td>
                <td className={r.bcmDay < r.targetBcmDay - 1 ? s.warn : s.muted}>{num((r.bcmDay / (r.targetBcmDay || 1)) * 100, 0)}%</td>
                <td className={s.l}>{r.ok ? <StatusBadge st={r.status} /> : <span className={s.bad} title={r.error}>{r.error ?? 'error'}</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${s.l} ${s.first}`}>Total · active circuits</td>
              <td className={s.sepL}>{num(t.haulKm, 2)}</td>
              <td />
              <td title="Truck-weighted mean cycle">{num(t.avgCycleMin, 2)}</td>
              <td />
              <td className={s.sepL}>
                <span className={t.trucksAssigned > t.trucksAvailable ? s.bad : undefined}>{t.trucksAssigned}</span>
                <span className={s.small}>/ {num(t.trucksAvailable, 0)} avail.</span>
              </td>
              <td>{num(t.trucksExact, 2)}</td>
              <td>{t.trucksRecommended}</td>
              <td className={s.sepL} />
              <td />
              <td className={t.belowMinPt ? s.bad : undefined}>{t.belowMinPt ? `${t.belowMinPt} < ${MIN_PT_HRS_DAY} h` : `all ≥ ${MIN_PT_HRS_DAY} h`}</td>
              <td className={t.lostPtShift > 0.005 ? s.bad : undefined}>{num(t.lostPtShift, 2)}</td>
              <td className={t.queueHrsShift > 0.005 ? s.warn : undefined}>{num(t.queueHrsShift, 2)}</td>
              <td className={s.sepL}>{num(t.bcmDay, 0)}</td>
              <td>{num((t.bcmDay / (t.targetBcmDay || 1)) * 100, 0)}%</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      </div>
    </Card>
  );
}

export function CircuitCharts({ rows }: { rows: CircuitRow[] }) {
  const act = rows.filter(r => r.active);
  return (
    <>
      <div className={`${p.s4} ${s.chartCol}`}>
        <Card className={p.headSafe}><CardHead title="Trucks needed vs assigned" icon="truck" /><TrucksDotPlot rows={act} /></Card>
      </div>
      <div className={`${p.s4} ${s.chartCol}`}>
        <Card className={p.headSafe}>
          <CardHead title="Loader PT per day" sub={`rule: ≥ ${MIN_PT_HRS_DAY} h`} icon="clock" />
          <HBarChart
            ariaLabel="Loader productive hours per day by circuit"
            unit="PT h/day" domain={[0, 24]} fmt={v => `${num(v, 1)} h`}
            refLine={{ value: MIN_PT_HRS_DAY, label: `${MIN_PT_HRS_DAY} h minimum` }}
            tickLabel="target PT"
            data={act.map(r => ({
              id: r.id, name: r.name, color: r.color, value: r.loaderPtHrsDay, tick: r.loaderPtTarget,
              tone: !r.ok ? 'na' : r.loaderPtHrsDay < MIN_PT_HRS_DAY - 1e-9 ? 'bad' : 'ok',
              tip: <><div className={s.tipHead}>{r.name}</div><div className={s.tipRow}><span>Achieved</span><b>{num(r.loaderPtHrsDay, 2)} h/day</b></div><div className={s.tipRow}><span>Target</span><b>{num(r.loaderPtTarget, 2)} h/day</b></div><div className={s.tipRow}><span>Rule</span><b>{r.loaderPtHrsDay >= MIN_PT_HRS_DAY - 1e-9 ? 'meets 18 h' : 'below 18 h'}</b></div></>,
            }))}
          />
        </Card>
      </div>
      <div className={`${p.s4} ${s.chartCol}`}>
        <Card className={p.headSafe}>
          <CardHead title="Lost PT per shift" sub="loader hang time" icon="warning" />
          <HBarChart
            ariaLabel="Loader productive time lost per shift by circuit"
            unit="h/shift" fmt={v => `${num(v, 2)} h`}
            data={act.map(r => ({
              id: r.id, name: r.name, color: r.color, value: r.lostPtShift, tone: r.lostPtShift > 0.005 ? 'bad' : 'na',
              tip: <><div className={s.tipHead}>{r.name}</div><div className={s.tipRow}><span>Lost PT</span><b>{num(r.lostPtShift, 2)} h/shift</b></div><div className={s.tipRow}><span>Truck queue</span><b>{num(r.queueHrsShift, 2)} h/shift</b></div><div className={s.tipRow}><span>Trucks</span><b>{r.assigned} of {num(r.exact, 2)} needed</b></div></>,
            }))}
          />
        </Card>
      </div>
    </>
  );
}
