/**
 * hAIul insights panel: ranked, explainable findings over the live scenario + the fleet optimiser.
 * Rendered inside the shell's floating glass card (the shell supplies the title bar).
 */
import { useMemo, useState } from 'react';
import { num } from '@/core/format';
import { computeCircuit, computeManning, shiftStateAt } from '@/engine';
import { sceneApi } from '@/scene';
import { useManning, useResults, useScenario } from '@/state/derived';
import { useApp } from '@/state/store';
import { usePriorityPlan } from '@/features/priority/usePlan';
import { Badge, Button, Ctl, Dot, Icon, Segmented, StatusGlyph, Toggle, circuitColor } from '@/ui';
import { generateInsights, SEVERITY_ORDER, type Insight, type InsightAction, type InsightTarget, type Severity } from './engine';
import { applyAllocation, optimiseFleet, type WeightMode } from './optimise';
import css from './insights.module.css';

const kb = (v: number) => (Math.abs(v) >= 10000 ? `${num(v / 1000, 1)}k` : num(v, 0));

function SevIcon({ sev }: { sev: Severity }) {
  if (sev === 'critical') return <StatusGlyph kind="fail" size={18} />;
  if (sev === 'warning') return <StatusGlyph kind="warn" size={18} />;
  if (sev === 'opportunity') return <Icon name="bolt" size={18} style={{ color: 'var(--ok)' }} />;
  return <Icon name="info" size={18} style={{ color: 'var(--accent)' }} />;
}

export function InsightsPanel() {
  const s = useScenario();
  const results = useResults();
  const manning = useManning();
  const plan = usePriorityPlan();
  const commit = useApp(st => st.commit);
  const select = useApp(st => st.select);
  const setView = useApp(st => st.setView);
  const toast = useApp(st => st.toast);
  const [filter, setFilter] = useState<'all' | Severity>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [optOn, setOptOn] = useState(false);
  const [mode, setMode] = useState<WeightMode>('weighted');
  const [keep, setKeep] = useState(true);
  const [locks, setLocks] = useState<string[]>([]);
  const shift = s.crew.shifts.find(x => x.id === s.crew.activeShiftId);
  const crewAvailable = shift?.available ?? manning.total;

  const insights = useMemo(() => {
    const end = s.shift.lengthH * 60;
    let shiftEnd;
    try { shiftEnd = shiftStateAt(s, results, end); } catch { shiftEnd = undefined; }
    // the provisional engine reports dig/dump fractions = shift fraction (no depletion model) - ignore that signature
    const modelled = shiftEnd?.perCircuit.some(p => Math.abs(p.digFraction - shiftEnd!.productiveFraction) > 1e-9 || Math.abs(p.dumpFraction - shiftEnd!.productiveFraction) > 1e-9);
    return generateInsights({
      scenario: s, results, manning, priority: plan,
      shiftEnd: modelled ? shiftEnd : undefined,
      shiftAt: t => shiftStateAt(s, results, t),
      evalCircuit: (c, o) => computeCircuit(s, c, o),
    });
  }, [s, results, manning, plan]);

  const opt = useMemo(() => {
    if (!optOn) return null;
    try {
      const baseline = Object.fromEntries(plan.allocations.map(a => [a.circuitId, a.allocatedTrucks]));
      return optimiseFleet(s, results, { crewAvailable, mode, keepDeliberate: keep, lockedIds: locks, baseline, computeManning, evalCircuit: (c, o) => computeCircuit(s, c, o) });
    } catch (e) { console.error(e); return null; }
  }, [optOn, s, results, crewAvailable, mode, keep, locks, plan]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, warning: 0, opportunity: 0, info: 0 };
    for (const i of insights) c[i.severity]++;
    return c;
  }, [insights]);
  const shown = filter === 'all' ? insights : insights.filter(i => i.severity === filter);
  const active = s.circuits.filter(c => c.active);

  const showMe = (t: InsightTarget) => {
    select(t.kind === 'circuit' ? { kind: 'circuit', id: t.id } : t.kind === 'string' ? { kind: 'string', id: t.id, pointIndex: t.pointIndex } : { kind: 'asset', id: t.id });
    setView('site');
    const focus = () => {
      if (t.kind === 'asset') sceneApi.focusAsset(t.id);
      else sceneApi.focusString(t.kind === 'string' ? t.id : s.circuits.find(c => c.id === t.id)?.haulStringId ?? '');
    };
    if (sceneApi.ready) focus(); else void sceneApi.whenReady().then(focus);
  };
  const run = (i: Insight, a: InsightAction) => {
    if (a.kind === 'apply') { commit(a.commitLabel, a.apply); toast('ok', a.commitLabel); }
    else if (a.kind === 'show') showMe(a.target);
    else setView(a.view);
  };

  if (!active.length) {
    return <div className={css.empty}><Icon name="sparkle" size={22} style={{ color: 'var(--accent)', margin: '0 auto 8px' }} />Activate a circuit to get insights: under/over-trucking, truck transfers, crew shortfalls, steep or dropped segments and better haul options – each with the numbers behind it.</div>;
  }

  const top = insights[0];
  const gainRows = opt?.rows ?? [];
  const optGain = opt ? opt.solution.bcm - opt.current.bcm : 0;
  const optChanged = gainRows.some(r => r.proposed !== r.current);

  return (
    <div className={css.panel}>
      <div className={css.hero}>
        <div className={css.heroTop}>
          <span className={css.spark}><Icon name="sparkle" size={20} /></span>
          <div style={{ minWidth: 0 }}>
            <div className={css.heroTitle}>{insights.length} finding{insights.length === 1 ? '' : 's'} on this plan</div>
            <div className={css.heroSub}>{top ? top.headline : 'Nothing to flag – the plan is balanced.'}</div>
          </div>
        </div>
        <div className={css.counts}>
          {counts.critical > 0 && <Badge tone="bad">{counts.critical} critical</Badge>}
          {counts.warning > 0 && <Badge tone="warn">{counts.warning} warning{counts.warning === 1 ? '' : 's'}</Badge>}
          {counts.opportunity > 0 && <Badge tone="ok">{counts.opportunity} opportunit{counts.opportunity === 1 ? 'y' : 'ies'}</Badge>}
          {counts.info > 0 && <Badge tone="info">{counts.info} info</Badge>}
        </div>
        {/* the one primary action on the panel; it steps back to secondary while the proposal (with its own Apply) is open */}
        <button type="button" className={`${css.optBtn} ${opt ? css.optBtnQuiet : ''}`} onClick={() => setOptOn(true)} title="Allocate the available trucks to maximise priority-weighted production within the crew available">
          <Icon name="sparkle" size={18} />{optOn ? 'Re-optimise fleet' : 'Optimise fleet'}
        </button>
      </div>

      {opt && (
        <div className={css.opt}>
          <div className={css.optHead}>
            <Icon name="sparkle" size={16} style={{ color: 'var(--accent)' }} />
            <span className={css.optTitle}>Proposed allocation <span style={{ fontWeight: 500, color: 'var(--ink-3)' }}>vs priority plan</span></span>
            <Badge tone="na" title={`${num(opt.solution.nodes, 0)} nodes`}>{opt.solution.method === 'branch-and-bound' ? 'Exact' : 'Greedy'}</Badge>
            <Ctl small icon="x" tip="Dismiss" onClick={() => setOptOn(false)} />
          </div>
          <div className={css.optMeta}>
            Maximises Σ {mode === 'weighted' ? 'priority weight × ' : ''}bcm/day within {opt.problem.trucksAvailable} trucks and {opt.problem.crewAvailable} crew
            {mode === 'weighted' && <> (weight ×0.85 per priority step: {opt.rows.map((r, i) => `${r.circuit.loaderUnitId} ×${num(opt.solution.weights[i], 2)}`).concat(opt.taskRows.map((t, i) => `${t.rule.name.split(' ')[0].toLowerCase()} ×${num(opt.solution.taskWeights[i], 2)}`)).join(', ')})</>}.
            {' '}Site tasks with a priority are sheddable.
            {' '}{opt.solution.method === 'branch-and-bound' ? `Branch-and-bound, ${num(opt.solution.nodes, 0)} nodes – provably optimal.` : 'Greedy by bcm per operator (more than 8 circuits).'}
          </div>
          <div className={css.optCtl}>
            <Segmented small value={mode} onChange={setMode} options={[{ value: 'weighted', label: 'Priority-weighted' }, { value: 'volume', label: 'Max volume' }]} />
            <Toggle on={keep} onChange={setKeep} label="Keep deliberate" title="Circuits marked deliberately over/under-trucked keep their trucks" />
          </div>
          {gainRows.map(r => {
            const d = r.proposed - r.current;
            const db = r.bcmNew - r.bcmNow;
            const pinned = locks.includes(r.circuit.id);
            return (
              <div key={r.circuit.id} className={css.optRow} title={`${r.circuit.name}: crew ${r.crewNow} → ${r.crewNew}`}>
                <Dot color={circuitColor(r.circuit.color)} />
                <span className={css.optName}>P{r.circuit.priority} {r.circuit.loaderUnitId}
                  <button type="button" className={css.lockBtn} aria-pressed={r.locked} title={r.locked ? (pinned ? 'Unpin – let the optimiser move it' : 'Kept: marked deliberate') : 'Pin at current trucks and re-optimise'}
                    onClick={() => setLocks(pinned ? locks.filter(x => x !== r.circuit.id) : [...locks, r.circuit.id])} disabled={r.locked && !pinned}>
                    <Icon name={r.locked ? 'lock' : 'unlock'} size={13} />
                  </button>
                </span>
                <span className={css.optNum}>{r.current} → <b style={{ color: d > 0 ? 'var(--ok-ink)' : d < 0 ? 'var(--bad-ink)' : undefined }}>{r.proposed}</b></span>
                <span className={css.optNum} style={{ color: db > 0.5 ? 'var(--ok-ink)' : db < -0.5 ? 'var(--bad-ink)' : 'var(--ink-3)' }}>{Math.abs(db) < 0.5 ? '–' : `${db > 0 ? '+' : '−'}${kb(Math.abs(db))}`}</span>
              </div>
            );
          })}
          {opt.taskRows.map(t => {
            const d = t.proposed - t.current;
            const db = t.bcmNew - t.bcmNow;
            return (
              <div key={t.rule.id} className={css.optRow} title={`Site task (P${t.rule.priority}) – people`}>
                <Dot color="var(--c7)" />
                <span className={css.optName} title={`${t.rule.name}: people`}>P{t.rule.priority} {t.rule.name}</span>
                <span className={css.optNum}>{t.current} → <b style={{ color: d > 0 ? 'var(--ok-ink)' : d < 0 ? 'var(--bad-ink)' : undefined }}>{t.proposed}</b></span>
                <span className={css.optNum} style={{ color: db > 0.5 ? 'var(--ok-ink)' : db < -0.5 ? 'var(--bad-ink)' : 'var(--ink-3)' }}>{Math.abs(db) < 0.5 ? '–' : `${db > 0 ? '+' : '−'}${kb(Math.abs(db))}`}</span>
              </div>
            );
          })}
          <div className={`${css.optRow} ${css.optTot}`}>
            <span />
            <span className={css.optName}>Total · crew {opt.crewExact ?? opt.solution.crew}/{opt.problem.crewAvailable}</span>
            <span className={css.optNum}>{opt.current.trucks} → {opt.solution.trucks}</span>
            <span className={css.optNum} style={{ color: optGain > 0.5 ? 'var(--ok-ink)' : undefined }}>{optGain > 0.5 ? `+${kb(optGain)}` : '–'}</span>
          </div>
          {opt.crewExact != null && opt.crewExact > opt.problem.crewAvailable && (
            <div className={css.optMeta} style={{ color: 'var(--warn-ink)', paddingTop: 8 }}>The full rule evaluator needs {opt.crewExact} crew for this allocation (rules interact) - check Manning before applying.</div>
          )}
          {!opt.current.feasible && <div className={css.optMeta} style={{ color: 'var(--bad-ink)', paddingTop: 8 }}>The current plan exceeds the trucks or crew available - the proposal brings it within limits.</div>}
          <div className={css.optFoot}>
            {optChanged
              ? <span style={{ fontSize: 12.5, color: 'var(--ink-2)', flex: 1 }}>{optGain > 0.5 ? <>+{kb(optGain)} bcm/day vs the priority plan</> : 'Same volume, better weighted by priority'}</span>
              : <span style={{ fontSize: 12.5, color: 'var(--ok-ink)', flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="tick" size={16} />Current allocation is already optimal</span>}
            <Button size="sm" variant="primary" icon="tick" disabled={!optChanged} onClick={() => { commit('Apply optimised fleet', applyAllocation(gainRows)); toast('ok', `Optimised fleet applied${optGain > 0.5 ? ` (+${kb(optGain)} bcm/day)` : ''}`); }}>Apply</Button>
          </div>
        </div>
      )}

      <div className={css.filters}>
        <Segmented small value={filter} onChange={setFilter} options={[
          { value: 'all', label: `All ${insights.length}` },
          ...SEVERITY_ORDER.filter(k => counts[k] > 0).map(k => ({ value: k, label: `${k === 'opportunity' ? 'Gains' : k === 'critical' ? 'Critical' : k === 'warning' ? 'Warn' : 'Info'} ${counts[k]}` })),
        ]} />
      </div>

      <div className={css.list}>
        {shown.map(i => {
          const isOpen = !!open[i.id];
          return (
            <article key={i.id} className={css.card}>
              <div className={css.cardTop}>
                <SevIcon sev={i.severity} />
                <div style={{ minWidth: 0 }}>
                  <div className={css.headline}>{i.headline}</div>
                  {i.detail && <div className={css.detail}>{i.detail}</div>}
                </div>
              </div>
              {i.figures.length > 0 && (
                <div className={css.figs}>
                  {i.figures.map((f, k) => (
                    <span key={k} className={`${css.fig} ${f.tone === 'bad' ? css.figBad : f.tone === 'ok' ? css.figOk : f.tone === 'warn' ? css.figWarn : ''}`}>{f.label}<b>{f.value}</b></span>
                  ))}
                </div>
              )}
              <div className={css.acts}>
                {i.actions.map((a, k) => (
                  <Button key={k} size="sm" variant={a.kind === 'apply' ? 'secondary' : 'ghost'} icon={a.kind === 'apply' ? 'tick' : a.kind === 'show' ? 'target' : 'right'} onClick={() => run(i, a)}>{a.label}</Button>
                ))}
                {i.explain.length > 0 && (
                  <Button size="sm" variant="ghost" icon={isOpen ? 'up' : 'formula'} onClick={() => setOpen({ ...open, [i.id]: !isOpen })}>{isOpen ? 'Hide' : 'Explain'}</Button>
                )}
              </div>
              {isOpen && (
                <div className={css.explain}>
                  {i.explain.map((l, k) => (
                    <div key={k} className={css.exLine}>
                      <span className={css.exLab}>{l.label}</span>
                      <span className={css.exVal}>{l.value}</span>
                      {l.formula && <span className={css.exFormula}>{l.formula}</span>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
        {!shown.length && <div className={css.empty}>Nothing in this category.</div>}
      </div>
      <div className={css.foot}>Deterministic rules over the engine results – every number is reproducible on the Assumptions tab.</div>
    </div>
  );
}


