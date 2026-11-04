/**
 * Fleet & task priority: crew and trucks go to circuits and site tasks in priority order, so the impact lands on the
 * last-priority fleet/task first - shown before long/short-haul alternatives are considered.
 * Header: the shared PageHeader; then a verdict-first sentence, the controls / KPI strip and the cards.
 */
import { useMemo, useState } from 'react';
import type { Circuit, Id } from '@/core/types';
import { num, pct } from '@/core/format';
import { useManning, useResults, useScenario } from '@/state/derived';
import { useApp } from '@/state/store';
import { applyHaulOption } from '@/features/insights/engine';
import { ROLE_META } from '@/features/manning/roles';
import { Badge, Button, Card, CardBody, CardHead, Ctl, Empty, Icon, Kpi, NumberField, PageHeader, Range, StatusGlyph, circuitColor } from '@/ui';
import { CrewBudget } from './CrewBudget';
import { CircuitCard, GrantBadge, TaskCard } from './CircuitCard';
import { priorityItems, reprioritise, taskRules, type PItem } from './items';
import { planVerdict, truckingVsGranted } from './plan';
import { usePriorityPlan } from './usePlan';
import page from '../manning/page.module.css';
import css from './priority.module.css';

const kb = (v: number) => (Math.abs(v) >= 10000 ? `${num(v / 1000, 1)}k` : num(v, 0));

export function PriorityView() {
  const s = useScenario();
  const results = useResults();
  const manning = useManning();
  const commit = useApp(st => st.commit);
  const select = useApp(st => st.select);
  const setView = useApp(st => st.setView);
  const toast = useApp(st => st.toast);
  const shift = s.crew.shifts.find(x => x.id === s.crew.activeShiftId);
  const [crewOverride, setCrewOverride] = useState<number | null>(null);
  const plan = usePriorityPlan(crewOverride);
  const crewAvailable = plan.crewAvailable;
  const trucksAvailable = s.fleet.trucksAvailable;
  const [drag, setDrag] = useState<Id | null>(null);
  const [over, setOver] = useState<Id | null>(null);

  const items = useMemo(() => priorityItems(s), [s]);
  const inactive = s.circuits.filter(c => !c.active).sort((a, b) => a.priority - b.priority);
  const allocOf = (id: Id) => plan.allocations.find(x => x.circuitId === id);
  const taskOf = (id: Id) => plan.tasks.find(x => x.ruleId === id);
  const requestedOf = (it: PItem) => (it.kind === 'circuit' ? it.circuit.trucks : taskOf(it.id)?.requested ?? 0);
  const last = [...items].reverse().find(it => requestedOf(it) > 0);
  const lost = plan.bcmDayPlanned - plan.bcmDayAchieved;
  const changed = plan.allocations.some(x => x.allocatedTrucks !== x.requestedTrucks) || (plan.tasks ?? []).some(t => t.allocated < t.requested);
  const crewShort = plan.crewRequired - crewAvailable;
  const maxCrew = Math.max(60, plan.crewRequired + 10, crewAvailable + 5);
  // a cut that costs production is 'reduced'; idle trucks the planner released at no loss are 'released' (same words as the cards)
  const reduced = plan.allocations.filter(x => x.status === 'reduced' && x.bcmDayLost > 0.5).length + plan.tasks.filter(t => t.allocated < t.requested && t.allocated > 0).length;
  const released = plan.allocations.filter(x => x.status === 'reduced' && x.bcmDayLost <= 0.5).length;
  const parked = plan.allocations.filter(x => x.status === 'parked').length + plan.tasks.filter(t => t.requested > 0 && t.allocated === 0).length;
  const verdict = useMemo(() => planVerdict(s, results, plan), [s, results, plan]);
  const trucksRequested = items.reduce((a, i) => a + (i.kind === 'circuit' ? i.circuit.trucks : 0), 0);
  // production scope: circuits (the figure Compare shows) + prioritised site tasks with a production rate (push dozers)
  const haulBcm = plan.allocations.reduce((a, x) => a + x.bcmDayAchieved, 0);
  const taskBcm = plan.bcmDayAchieved - haulBcm;
  const taskRoles = [...new Set(taskRules(s).filter(r => (r.bcmPerUnitDay ?? 0) > 0).map(r => r.role))];
  const taskScope = taskRoles.length === 1 ? ROLE_META[taskRoles[0]].short.toLowerCase() : 'site tasks';
  const ofPlan = plan.bcmDayPlanned ? plan.bcmDayAchieved / plan.bcmDayPlanned : null;

  const order = items.map(i => i.id);
  const moveTo = (from: Id, to: Id) => {
    if (from === to) return;
    const ids = [...order];
    ids.splice(ids.indexOf(from), 1);
    ids.splice(ids.indexOf(to) + (order.indexOf(from) < order.indexOf(to) ? 1 : 0), 0, from);
    commit('Reorder priorities', reprioritise(ids));
  };
  const moveBy = (id: Id, d: -1 | 1) => {
    const i = order.indexOf(id), j = Math.min(order.length - 1, Math.max(0, i + d));
    if (i === j) return;
    const ids = [...order];
    ids.splice(i, 1); ids.splice(j, 0, id);
    commit('Reorder priorities', reprioritise(ids));
  };
  const patch = (id: Id, p: Partial<Circuit>, label: string) => commit(label, st => ({ ...st, circuits: st.circuits.map(c => (c.id === id ? { ...c, ...p } : c)) }));
  const apply = () => {
    // Apply the whole plan: trucks per circuit AND people caps for site tasks the plan stands down (e.g. push 6 → 4),
    // so the Manning view mans exactly what the planner reported.
    const taskCaps: Record<string, number> = {};
    for (const t of plan.tasks ?? []) if (t.allocated < t.requested) taskCaps[t.ruleId] = t.allocated;
    commit('Apply priority allocation', st => ({
      ...st,
      circuits: st.circuits.map(c => { const a = allocOf(c.id); return a ? { ...c, trucks: a.allocatedTrucks } : c; }),
      crew: { ...st.crew, taskCaps: Object.keys(taskCaps).length ? taskCaps : undefined },
    }));
    toast('ok', 'Allocated trucks applied to the circuits');
  };
  const dnd = (id: Id) => ({
    dragging: drag === id, over: over === id && drag !== null && drag !== id,
    onDragStart: () => setDrag(id), onDragOver: () => { if (over !== id) setOver(id); },
    onDrop: () => { if (drag) moveTo(drag, id); setDrag(null); setOver(null); },
    onDragEnd: () => { setDrag(null); setOver(null); },
    onMove: (d: -1 | 1) => moveBy(id, d),
  });

  return (
    <div className={page.page}>
      <PageHeader eyebrow="Planning" icon="priority" title="Fleet & task priority"
        desc="Drag to re-prioritise circuits and site tasks. Crew and trucks run out at the bottom of the list first – see the impact on the last priority before long or short-haul options."
        actions={<>
          <Button icon="crew" onClick={() => setView('manning')}>Manning</Button>
          <Button variant="primary" icon="tick" disabled={!changed} onClick={apply} title={changed ? 'Set each circuit’s trucks to the allocated number and stand down the reduced site tasks' : 'Allocation equals the request'}>Apply allocation</Button>
        </>} />

      {items.length > 0 && (
        <p className={css.verdict} role="status">
          <StatusGlyph kind={verdict.tone === 'bad' ? 'fail' : verdict.tone} size={20} />
          <span>{verdict.text}</span>
        </p>
      )}

      <Card className={css.controlsHost}>
        <div className={css.controls}>
          <div className={css.ctlCell}>
            <span className={css.ctlLab}><Icon name="crew" size={14} />Crew available
              <span style={{ flex: 1 }} />
              {crewOverride != null
                ? <button type="button" className={css.linkBtn} onClick={() => setCrewOverride(null)}>Reset to {shift?.name ?? 'shift'} ({shift?.available ?? '–'})</button>
                : <span style={{ fontWeight: 500 }}>{shift?.name ?? 'No active shift'}</span>}
            </span>
            <div className={css.ctlRow}>
              <Range value={crewAvailable} min={0} max={maxCrew} onChange={v => setCrewOverride(v)} title="What-if crew available (not saved)" />
              <NumberField value={crewAvailable} onChange={v => setCrewOverride(Math.max(0, Math.round(v)))} dp={0} min={0} width={68} title="Crew available (what-if)" />
            </div>
          </div>
          <div className={css.ctlCell}>
            <span className={css.ctlLab}><Icon name="truck" size={14} />Trucks available</span>
            <div className={css.ctlRow}>
              <span className={css.stepper}>
                <Ctl small icon="minus" tip="One fewer truck available" disabled={trucksAvailable <= 0} onClick={() => commit('Trucks available', st => ({ ...st, fleet: { ...st.fleet, trucksAvailable: Math.max(0, st.fleet.trucksAvailable - 1) } }))} />
                <NumberField value={trucksAvailable} dp={0} min={0} width={60} onChange={v => commit('Trucks available', st => ({ ...st, fleet: { ...st.fleet, trucksAvailable: Math.max(0, Math.round(v)) } }))} />
                <Ctl small icon="plus" tip="One more truck available" onClick={() => commit('Trucks available', st => ({ ...st, fleet: { ...st.fleet, trucksAvailable: st.fleet.trucksAvailable + 1 } }))} />
              </span>
              <span className={page.note} style={{ whiteSpace: 'nowrap' }}>{s.fleet.units.filter(u => u.kind === 'truck').length} in fleet</span>
            </div>
          </div>
          <div className={css.ctlCell}>
            <Kpi label="Crew used" value={plan.crewUsed} unit={`/ ${crewAvailable}`} delta={crewShort > 0 ? `${crewShort} short` : `${crewAvailable - plan.crewRequired} spare`} deltaTone={crewShort > 0 ? 'bad' : 'ok'} />
          </div>
          <div className={css.ctlCell}>
            <Kpi label="Trucks used" value={plan.trucksUsed} unit={`/ ${trucksAvailable}`} delta={`${trucksRequested} requested`} deltaTone="na"
              title={`${plan.trucksUsed} trucks granted by the plan (the truck bar below) of ${trucksAvailable} available; ${trucksRequested} requested`} />
          </div>
          <div className={css.ctlCell}>
            <Kpi label="bcm / day" value={kb(plan.bcmDayAchieved)} unit={`/ ${kb(plan.bcmDayPlanned)}`}
              delta={taskBcm > 0.5 ? `incl. ${taskScope} · haul ${kb(haulBcm)}` : ofPlan != null ? `${pct(ofPlan, 0)} of plan` : undefined} deltaTone={taskBcm > 0.5 ? 'na' : lost > 1 ? 'warn' : 'ok'}
              title={`Includes ${taskBcm > 0.5 ? taskScope : 'haul circuits only'}. Haul circuits ${num(haulBcm, 0)} bcm/day (the Compare figure)${taskBcm > 0.5 ? ` + ${taskScope} ${num(taskBcm, 0)}` : ''} = ${num(plan.bcmDayAchieved, 0)} of ${num(plan.bcmDayPlanned, 0)} planned${ofPlan != null ? ` (${pct(ofPlan, 0)})` : ''}`} />
          </div>
          <div className={css.ctlCell}>
            <Kpi label="Lost bcm / day" value={<span className={lost > 0.5 ? css.bad : undefined}>{lost > 0.5 ? `−${kb(lost)}` : '0'}</span>}
              delta={[reduced && `${reduced} reduced`, parked && `${parked} parked`, released && `${released} released`].filter(Boolean).join(' · ') || 'nothing cut'} deltaTone={lost > 0.5 ? 'bad' : 'na'} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHead icon="crew" title="Crew budget" sub="Requested in priority order vs the crew available – the cut-off is where crew runs out"
          actions={crewShort > 0 ? <Badge tone="bad" icon="warning">{crewShort} short</Badge> : <Badge tone="ok" icon="tick">{crewAvailable - plan.crewRequired} spare</Badge>} />
        <CrewBudget scenario={s} manning={manning} plan={plan} crewAvailable={crewAvailable} trucksAvailable={trucksAvailable} />
      </Card>

      {!items.length ? (
        <Card><Empty icon="priority" title="No active circuits">Activate circuits on the site view or below to plan by priority.</Empty></Card>
      ) : (
        <div className={page.grid64}>
          <div>
            <div className={css.list} onDragLeave={() => setOver(null)}>
              {items.map((it, i) => it.kind === 'circuit' ? (
                <CircuitCard key={it.id} scenario={s} circuit={it.circuit} result={results[it.id]} alloc={allocOf(it.id)} rank={i + 1} isLast={last?.id === it.id}
                  {...dnd(it.id)}
                  onTrucks={n => patch(it.id, { trucks: Math.max(0, n) }, `${it.circuit.loaderUnitId} → ${Math.max(0, n)} trucks`)}
                  onTags={(tags, label) => patch(it.id, { tags }, label)}
                  onUseOption={(alt, name) => { commit(`${it.circuit.loaderUnitId} → ${name}`, applyHaulOption(it.id, alt)); toast('ok', `${it.circuit.loaderUnitId} now hauls “${name}”`); }}
                  onSelect={() => { select({ kind: 'circuit', id: it.id }); setView('site'); }}
                  onDeactivate={() => patch(it.id, { active: false }, `Deactivate ${it.circuit.name}`)} />
              ) : (
                <TaskCard key={it.id} rule={it.rule} task={taskOf(it.id)} rank={i + 1} isLast={last?.id === it.id} {...dnd(it.id)} onEdit={() => setView('manning')} />
              ))}
            </div>
            {inactive.length > 0 && (
              <div className={css.inactive}>
                <span className={page.note} style={{ alignSelf: 'center', marginRight: 4 }}>Not active:</span>
                {inactive.map(c => (
                  <span key={c.id} className={css.inChip}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: circuitColor(c.color) }} />{c.name}
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => patch(c.id, { active: true }, `Activate ${c.name}`)}>Activate</Button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {last && <LastImpact item={last} plan={plan} results={results} />}
            <Card>
              <CardHead icon="report" title="How the plan was built" sub={`${plan.narrative.length} steps · engine planner`} />
              <CardBody style={{ padding: 0 }}>
                <ol className={css.narr}>
                  {plan.narrative.map((t, i) => <li key={i} className={/^\s/.test(t) ? css.sub : undefined}>{t.trim()}</li>)}
                  {!plan.narrative.length && <li>No narrative from the planner.</li>}
                </ol>
                {plan.warnings.length > 0 && (
                  <div className={page.footNote}><Icon name="warning" size={16} style={{ color: 'var(--warn)' }} /><span>{plan.warnings.join(' ')}</span></div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function LastImpact({ item, plan, results }: { item: PItem; plan: ReturnType<typeof usePriorityPlan>; results: ReturnType<typeof useResults> }) {
  if (item.kind === 'task') {
    const t = plan.tasks.find(x => x.ruleId === item.id);
    if (!t) return null;
    const full = t.allocated >= t.requested;
    return (
      <Card>
        <CardHead icon="warning" title="Last-priority impact" sub={`P${t.priority} ${t.name}`} actions={<GrantBadge got={t.allocated} req={t.requested} lost={t.bcmDayLost} unit="people" />} />
        <div className={css.impact}>
          <div className={`${css.impactBig} ${t.bcmDayLost > 0 ? css.bad : css.ok}`}>{t.bcmDayLost > 0 ? `−${kb(t.bcmDayLost)}` : '0'} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>bcm/day lost</span></div>
          <div className={page.note}>{full ? `${t.name} keeps all ${t.requested} operators: the crew covers every priority.` : `${t.name} gives first: ${t.requested - t.allocated} operator${t.requested - t.allocated === 1 ? '' : 's'} stood down before any circuit is cut.`}</div>
          <div className={css.impactRow}><Kpi size="sm" label="People" value={`${t.allocated} / ${t.requested}`} /><Kpi size="sm" label="Shed" value={t.requested - t.allocated} /></div>
        </div>
      </Card>
    );
  }
  const a = plan.allocations.find(x => x.circuitId === item.id);
  if (!a) return null;
  const c = item.circuit;
  const tr = truckingVsGranted(results, plan).find(x => x.circuitId === c.id);
  const bestAlt = a.alternatives.length ? [...a.alternatives].sort((x, y) => y.deltaBcmDay - x.deltaBcmDay)[0] : undefined;
  return (
    <Card>
      <CardHead icon="warning" title="Last-priority impact" sub={`P${a.priority} ${c.loaderUnitId}`}
        actions={<GrantBadge got={a.allocatedTrucks} req={a.requestedTrucks} lost={a.bcmDayLost} fullRate={tr?.fullRate} />} />
      <div className={css.impact}>
        <div>
          <div className={`${css.impactBig} ${a.bcmDayLost > 0.5 ? css.bad : css.ok}`}>{a.bcmDayLost > 0.5 ? `−${kb(a.bcmDayLost)}` : '0'} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>bcm/day lost</span></div>
          <div className={page.note} style={{ marginTop: 4 }}>
            {a.status === 'full'
              ? `${c.name} gets all ${a.requestedTrucks} trucks: the crew covers every priority.`
              : a.bcmDayLost <= 0.5 && a.allocatedTrucks > 0
                ? `${c.name} releases ${a.requestedTrucks - a.allocatedTrucks} idle truck${a.requestedTrucks - a.allocatedTrucks === 1 ? '' : 's'} (${a.allocatedTrucks} of ${a.requestedTrucks}): the extra truck${a.requestedTrucks - a.allocatedTrucks === 1 ? ' only queued' : 's only queued'}, no production lost.`
                : `${c.name} absorbs the shortfall: ${a.allocatedTrucks} of ${a.requestedTrucks} trucks; ${a.crewRequested - a.crewAllocated} more operator${a.crewRequested - a.crewAllocated === 1 ? '' : 's'} would crew it fully.`}
          </div>
        </div>
        <div className={css.impactRow}>
          <Kpi size="sm" label="Trucks" value={`${a.allocatedTrucks} / ${a.requestedTrucks}`} />
          <Kpi size="sm" label="Loader PT lost" value={num(a.lostPtHrsShift, 2)} unit="h/shift" />
          <Kpi size="sm" label="Crew" value={`${a.crewAllocated} / ${a.crewRequested}`} />
        </div>
        {a.status !== 'full' && (bestAlt
          ? <div className={page.note}><Icon name="route" size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />Next option: <b style={{ color: 'var(--ink)' }}>{bestAlt.name}</b> → {bestAlt.deltaBcmDay >= 0 ? '+' : '−'}{kb(Math.abs(bestAlt.deltaBcmDay))} bcm/day at {Math.max(1, a.allocatedTrucks)} truck{a.allocatedTrucks === 1 ? '' : 's'} (needs {bestAlt.trucksNeeded} for full rate).</div>
          : <div className={page.note}>No long/short-haul options defined for {c.loaderUnitId}. Add alternative strings to the circuit to compare them here.</div>)}
      </div>
    </Card>
  );
}
