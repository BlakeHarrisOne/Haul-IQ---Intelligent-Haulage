/**
 * Crew budget: requested crew stacked in priority order (site roles, then each circuit's loader operator, trucks and
 * support roles) against the crew available, with the cut-off where crew runs out; the allocated crew below it; and
 * a thin truck-budget bar against the trucks available.
 */
import { useState, type ReactNode } from 'react';
import type { Circuit, ManningResult, Scenario } from '@/core/types';
import type { PriorityResultExt } from '@/engine';
import { niceStep } from '@/ui';
import { crewSplit } from './plan';
import { priorityItems } from './items';
import css from './priority.module.css';

interface Block { key: string; a: number; b: number; color: string; label?: string; tip: ReactNode; site?: boolean }

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--surface))`;

function Track({ blocks, max, cut, cutLabel, thin, onHover }: {
  blocks: Block[]; max: number; cut?: number; cutLabel?: string; thin?: boolean; onHover: (b: Block | null, xPct: number, row: HTMLElement | null) => void;
}) {
  const pct = (v: number) => (v / max) * 100;
  const parts: (Block & { cutPart?: boolean })[] = [];
  for (const b of blocks) {
    if (b.b <= b.a) continue;
    if (cut == null || b.b <= cut + 1e-9) parts.push(b);
    else if (b.a >= cut - 1e-9) parts.push({ ...b, cutPart: true });
    else { parts.push({ ...b, b: cut }); parts.push({ ...b, key: `${b.key}~cut`, a: cut, cutPart: true, label: undefined }); }
  }
  return (
    <div className={`${css.bTrack} ${thin ? css.bTrackThin : ''}`} onMouseLeave={() => onHover(null, 0, null)}>
      {parts.map(p => {
        const w = pct(p.b - p.a);
        return (
          <div key={p.key} className={`${css.seg} ${p.cutPart ? css.segCut : ''} ${p.site ? css.segSite : ''}`}
            style={{ left: `${pct(p.a)}%`, width: `max(1px, calc(${w}% - 2px))`, background: p.site ? undefined : p.color }}
            onMouseEnter={e => onHover(p, pct((p.a + p.b) / 2), e.currentTarget.parentElement)} aria-label={typeof p.tip === 'string' ? p.tip : undefined}>
            {!thin && p.label && w >= 6 ? p.label : null}
          </div>
        );
      })}
      {cut != null && (
        <>
          <div className={css.cutLine} style={{ left: `${pct(cut)}%` }} />
          {cutLabel && <div className={css.cutTag} style={{ left: `clamp(60px, ${pct(cut)}%, calc(100% - 60px))` }}>{cutLabel}</div>}
        </>
      )}
    </div>
  );
}

export function CrewBudget({ scenario, manning, plan, crewAvailable, trucksAvailable }: {
  scenario: Scenario; manning: ManningResult; plan: PriorityResultExt; crewAvailable: number; trucksAvailable: number;
}) {
  const [hover, setHover] = useState<{ b: Block; x: number; top: number } | null>(null);
  const items = priorityItems(scenario);
  const act = items.flatMap(i => (i.kind === 'circuit' ? [i.circuit] : []));
  const taskIds = new Set(items.filter(i => i.kind === 'task').map(i => i.id));
  const circuitIds = new Set(act.map(c => c.id));
  const siteLines = manning.lines.filter(l => !l.circuitId || !circuitIds.has(l.circuitId));
  const fixed = siteLines.filter(l => !taskIds.has(l.ruleId)).reduce((a, l) => a + l.count, 0);
  const taskReq = (id: string) => siteLines.filter(l => l.ruleId === id).reduce((a, l) => a + l.count, 0);
  const TASK = 'var(--c7)';

  const circuitBlocks = (c: Circuit, loader: number, trucks: number, support: number, at: number, keyP: string, extra?: ReactNode): Block[] => {
    const out: Block[] = [];
    const name = c.loaderUnitId || c.name;
    const tot = loader + trucks + support;
    const tip = (what: string, n: number) => <><b>P{c.priority} {name}</b> · {what}<Row k="This block" v={n} /><Row k="Circuit crew" v={tot} />{extra}</>;
    let p = at;
    if (loader) { out.push({ key: `${keyP}${c.id}-l`, a: p, b: p + loader, color: c.color, tip: tip('loader operator', loader) }); p += loader; }
    if (trucks) { out.push({ key: `${keyP}${c.id}-t`, a: p, b: p + trucks, color: mix(c.color, 80), label: `${name} ${tot}`, tip: tip('truck operators', trucks) }); p += trucks; }
    if (support) { out.push({ key: `${keyP}${c.id}-s`, a: p, b: p + support, color: mix(c.color, 55), tip: tip('support roles', support) }); p += support; }
    return out;
  };
  const taskBlock = (id: string, name: string, prio: number, n: number, at: number, keyP: string, extra?: ReactNode): Block =>
    ({ key: `${keyP}${id}`, a: at, b: at + n, color: TASK, label: `${name.split(' ')[0]} ${n}`, tip: <><b>P{prio} {name}</b> · site task<Row k="People" v={n} />{extra}</> });

  // requested crew, cumulative: fixed site roles first, then circuits and tasks in priority order
  const req: Block[] = [];
  let x = 0;
  if (fixed > 0) { req.push({ key: 'site', a: 0, b: fixed, color: 'var(--ink-4)', site: true, label: `Site ${fixed}`, tip: <><b>Fixed site roles</b><Row k="Crew" v={fixed} /><Row k="Crewed first" v="supervision, OCE, roads" /></> }); x = fixed; }
  for (const it of items) {
    if (it.kind === 'circuit') {
      const sp = crewSplit(manning, it.circuit);
      req.push(...circuitBlocks(it.circuit, sp.loader, sp.trucks, sp.support, x, 'r'));
      x += sp.total;
    } else {
      const n = taskReq(it.id);
      if (n > 0) { req.push(taskBlock(it.id, it.rule.name, it.priority, n, x, 'r')); x += n; }
    }
  }
  const totalReq = x;

  // allocated crew
  const alloc: Block[] = [];
  let y = 0;
  const taskAlloc = (id: string) => plan.tasks.find(t => t.ruleId === id)?.allocated ?? taskReq(id);
  const fixedAlloc = Math.max(0, plan.crewUsed - plan.allocations.reduce((a, al) => a + al.crewAllocated, 0) - [...taskIds].reduce((a, id) => a + taskAlloc(id), 0));
  if (fixedAlloc > 0) { alloc.push({ key: 'asite', a: 0, b: fixedAlloc, color: 'var(--ink-4)', site: true, label: `Site ${fixedAlloc}`, tip: <><b>Fixed site roles</b><Row k="Crew" v={fixedAlloc} /></> }); y = fixedAlloc; }
  for (const it of items) {
    if (it.kind === 'circuit') {
      const al = plan.allocations.find(a => a.circuitId === it.id);
      if (!al || al.crewAllocated <= 0) continue;
      const loader = al.allocatedTrucks > 0 ? 1 : 0;
      const trucks = al.allocatedTrucks;
      const support = Math.max(0, al.crewAllocated - trucks - loader);
      alloc.push(...circuitBlocks(it.circuit, loader, trucks, support, y, 'a', <Row k="Status" v={al.status} />));
      y += al.crewAllocated;
    } else {
      const t = plan.tasks.find(tt => tt.ruleId === it.id);
      const n = t?.allocated ?? taskReq(it.id);
      if (n > 0) { alloc.push(taskBlock(it.id, it.rule.name, it.priority, n, y, 'a', t && t.allocated < t.requested ? <Row k="Shed" v={t.requested - t.allocated} /> : undefined)); y += n; }
    }
  }

  // trucks
  const tb: Block[] = [];
  let t = 0;
  for (const c of act) {
    if (c.trucks <= 0) continue;
    tb.push({ key: `tr-${c.id}`, a: t, b: t + c.trucks, color: mix(c.color, 80), tip: <><b>P{c.priority} {c.loaderUnitId || c.name}</b><Row k="Trucks requested" v={c.trucks} /><Row k="Cumulative" v={t + c.trucks} /></> });
    t += c.trucks;
  }
  const hasTasks = items.some(i => i.kind === 'task' && taskReq(i.id) > 0);

  const max = Math.max(crewAvailable, totalReq, 1) * 1.04;
  const step = niceStep(max, 8);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const tMax = Math.max(trucksAvailable, t, 1) * 1.04;
  const short = Math.max(0, totalReq - crewAvailable);
  const onHover = (b: Block | null, xp: number, row: HTMLElement | null) => {
    if (!b || !row) { setHover(null); return; }
    const host = row.closest(`.${css.budget}`) as HTMLElement | null;
    const top = host ? row.getBoundingClientRect().top - host.getBoundingClientRect().top : 0;
    const left = host ? (row.getBoundingClientRect().left - host.getBoundingClientRect().left) + (xp / 100) * row.getBoundingClientRect().width : 0;
    setHover({ b, x: left, top });
  };
  const legendCircuits = act.filter(c => c.trucks > 0);
  return (
    <div>
      <div className={css.budget} style={{ position: 'relative', paddingTop: 34 }}>
        <div className={css.bRow}>
          <span className={css.bLab}>Requested<small>{totalReq} crew</small></span>
          <Track blocks={req} max={max} cut={crewAvailable} cutLabel={`${crewAvailable} available${short ? ` · ${short} short` : ''}`} onHover={onHover} />
        </div>
        <div className={css.bRow}>
          <span className={css.bLab}>Allocated<small>{plan.crewUsed} crew</small></span>
          <Track blocks={alloc} max={max} cut={crewAvailable} onHover={onHover} />
        </div>
        <div className={css.axis} style={{ marginLeft: 106 }}>
          {ticks.map(v => <span key={v} className={css.tick} style={{ left: `${(v / max) * 100}%` }}>{v}</span>)}
        </div>
        <div className={css.bRow} style={{ marginTop: 4 }}>
          <span className={css.bLab}>Trucks<small>{t} of {trucksAvailable}</small></span>
          <Track blocks={tb} max={tMax} cut={trucksAvailable} thin onHover={onHover} />
        </div>
        {hover && (
          <div className={css.tipBox} style={{ left: hover.x, top: hover.top }}>{hover.b.tip}</div>
        )}
      </div>
      <div className={css.legend}>
        <span className={css.legItem}><span className={css.legSw} style={{ background: 'var(--ink-4)' }} />Fixed site roles</span>
        {legendCircuits.map(c => <span key={c.id} className={css.legItem}><span className={css.legSw} style={{ background: c.color }} />P{c.priority} {c.loaderUnitId || c.name}</span>)}
        {hasTasks && <span className={css.legItem}><span className={css.legSw} style={{ background: TASK }} />Site tasks</span>}
        <span style={{ color: 'var(--ink-4)' }}>|</span>
        <span className={css.legItem}>Blocks: loader · trucks · support (lighter)</span>
        <span className={css.legItem}><span className={`${css.legSw} ${css.legHatch}`} />Beyond the crew available</span>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className={css.tipRow}><span>{k}</span><b>{v}</b></div>;
}
