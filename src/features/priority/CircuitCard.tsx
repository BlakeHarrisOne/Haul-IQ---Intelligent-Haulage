/** One circuit in the priority list: requested vs allocated trucks, production, losses, trucking annotation, haul options. */
import { useMemo, useState, type ReactNode } from 'react';
import type { Circuit, CircuitResult, PriorityAllocation, Scenario } from '@/core/types';
import { num, signed } from '@/core/format';
import { computeCircuit, type CrewRuleExt, type PriorityTask } from '@/engine';
import { ROLE_META } from '@/features/manning/roles';
import { Badge, Button, Ctl, Icon, MenuButton } from '@/ui';
import { deliberateNote, isDeliberate, potentialBcm, trucksForPotential } from '@/features/insights/engine';
import css from './priority.module.css';

const kb = (v: number) => (Math.abs(v) >= 10000 ? `${num(v / 1000, 1)}k` : num(v, 0));
const REASONS = {
  over: ['absorbs bunching', 'covers a truck breakdown', 'protects coal feed to the CHPP', 'long-haul surge'],
  under: ['trucks prioritised elsewhere', 'dig block running out', 'crew limited', 'scheduled hang time'],
};

export interface CircuitCardProps {
  scenario: Scenario;
  circuit: Circuit;
  result?: CircuitResult;
  alloc?: PriorityAllocation;
  rank: number;
  isLast: boolean;
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onTrucks: (n: number) => void;
  onTags: (tags: string[] | undefined, label: string) => void;
  onUseOption: (altId: string, name: string) => void;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDeactivate: () => void;
}

export function CircuitCard(p: CircuitCardProps) {
  const { scenario: s, circuit: c, result: r, alloc: a } = p;
  const [armed, setArmed] = useState(false);
  const [showAlts, setShowAlts] = useState<boolean | null>(null);
  const loader = s.fleet.loaders.find(l => l.id === c.loaderModelId);
  const truck = s.fleet.trucks.find(t => t.id === c.truckModelId);
  const mat = s.materials.find(m => m.id === c.materialId);
  const status = a?.status ?? (c.trucks > 0 ? 'full' : 'parked');
  const nFull = r?.ok ? trucksForPotential(r) : 0;
  const deliberate = isDeliberate(c);
  const why = deliberateNote(c);
  const allocated = a?.allocatedTrucks ?? c.trucks;
  const planned = a?.bcmDayPlanned ?? r?.assigned.bcmPerDay ?? 0;
  const achieved = a?.bcmDayAchieved ?? r?.assigned.bcmPerDay ?? 0;
  const lost = a?.bcmDayLost ?? 0;
  const lostPt = a?.lostPtHrsShift ?? r?.assigned.lostLoaderPtHrsShift ?? 0;
  const pot = r?.ok ? potentialBcm(r) : planned;

  // alternatives (long / short haul): engine list for reduced/parked circuits, local evaluation otherwise
  const alts = useMemo(() => {
    if (!c.altHaulStringIds?.length || !r?.ok) return [];
    const n = Math.max(1, allocated);
    return c.altHaulStringIds.map(id => {
      const hs = s.strings.find(x => x.id === id);
      const eng = a?.alternatives.find(x => x.haulStringId === id);
      const ar = computeCircuit(s, c, { haulStringId: id, trucks: n });
      const bcm = eng?.bcmDay ?? (ar.ok ? ar.assigned.bcmPerDay : 0);
      const need = eng?.trucksNeeded ?? (ar.ok ? trucksForPotential(ar) : 0);
      return { id, name: hs?.name ?? id, ok: ar.ok, cycle: ar.cycleMin, lengthM: ar.lengthM, need, bcm, delta: eng?.deltaBcmDay ?? bcm - achieved };
    });
  }, [s, c, r, a, allocated, achieved]);
  const altsOpen = showAlts ?? (status !== 'full' || p.isLast);

  const statusBadge = status === 'full' ? <Badge tone="ok" icon="tick">Full</Badge>
    : status === 'reduced' ? <Badge tone="warn" icon="minus">Reduced {allocated}/{a?.requestedTrucks}</Badge>
      : <Badge tone="bad" icon="pause">Parked</Badge>;

  // trucking annotation (deliberate over/under-trucking)
  let annot: { kind: 'over' | 'under'; text: ReactNode } | null = null;
  if (r?.ok && c.trucks > 0 && c.trucks !== nFull) {
    if (c.trucks > nFull) {
      const extra = c.trucks - nFull;
      annot = { kind: 'over', text: deliberate
        ? <><b>{c.loaderUnitId} deliberately over-trucked +{extra}</b>: {why ?? 'absorbs bunching'} · {num(r.assigned.truckQueueHrsShift, 2)} truck-h/shift queuing</>
        : <><b>Over-trucked +{extra}</b> vs {nFull} for full rate: trucks queue {num(r.assigned.truckQueueHrsShift, 2)} h/shift, no extra bcm</> };
    } else {
      const k = nFull - c.trucks;
      annot = { kind: 'under', text: deliberate
        ? <><b>{c.loaderUnitId} deliberately under-trucked −{k}</b>: {why ?? 'trucks prioritised elsewhere'} · loader hangs {num(r.assigned.lostLoaderPtHrsShift, 2)} h/shift</>
        : <><b>Under-trucked −{k}</b> vs {nFull} for full rate: loader hangs {num(r.assigned.lostLoaderPtHrsShift, 2)} h/shift, −{kb(pot - r.assigned.bcmPerDay)} bcm/day</> };
    }
  }
  const setDeliberate = (reason: string | null) => {
    const rest = (c.tags ?? []).filter(t => t !== 'deliberate' && !t.startsWith('deliberate:'));
    const tags = reason == null ? rest : [...rest, `deliberate:${reason}`];
    p.onTags(tags.length ? tags : undefined, reason == null ? `${c.loaderUnitId}: clear deliberate trucking` : `${c.loaderUnitId}: deliberate (${reason})`);
  };

  return (
    <div className={`${css.pc} ${p.isLast ? css.pcLast : ''} ${p.dragging ? css.pcDragging : ''} ${p.over ? css.pcOver : ''}`}
      draggable={armed}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); p.onDragStart(); }}
      onDragOver={e => { e.preventDefault(); p.onDragOver(); }}
      onDrop={e => { e.preventDefault(); p.onDrop(); }}
      onDragEnd={() => { setArmed(false); p.onDragEnd(); }}>
      <span className={css.pcStripe} style={{ background: c.color }} />
      <div className={css.pcHead}>
        <span className={css.pcDrag} title="Drag to change priority" onMouseDown={() => setArmed(true)} onMouseUp={() => setArmed(false)}><Icon name="drag" size={20} /></span>
        <span className={css.pcRank}><small>P</small>{p.rank}</span>
        <div style={{ minWidth: 0 }}>
          <div className={css.pcTitle}>
            {c.name}
            {p.isLast && <span className={css.lastTag}><Icon name="warning" size={13} />Last priority - gives first</span>}
          </div>
          <div className={css.pcSub}>{[mat?.name, loader?.name, `${truck?.name ?? c.truckModelId}`, r?.ok ? `${num(r.lengthM / 1000, 2)} km · ${num(r.cycleMin, 1)} min cycle` : r?.error].filter(Boolean).join(' · ')}</div>
        </div>
        <div className={css.pcRight}>
          {statusBadge}
          <Ctl small icon="target" tip="Select on site" onClick={p.onSelect} />
          <MenuButton align="right" items={[
            { label: 'Raise priority', icon: 'up', disabled: p.rank === 1, onSelect: () => p.onMove(-1) },
            { label: 'Lower priority', icon: 'down', onSelect: () => p.onMove(1) },
            { separator: true, label: '' },
            { label: 'Deactivate circuit', icon: 'pause', onSelect: p.onDeactivate },
          ]}>{(o, t) => <Ctl small icon="more" tip="More" on={o} onClick={t} />}</MenuButton>
        </div>
      </div>

      <div className={css.pcGrid}>
        <div className={css.stat}>
          <span className={css.statLab}>Trucks requested</span>
          <span className={css.statVal}>
            <span className={css.stepper}>
              <Ctl small icon="minus" tip="One truck fewer (under-truck)" disabled={c.trucks <= 0} onClick={() => p.onTrucks(c.trucks - 1)} />
              <span style={{ minWidth: 22, textAlign: 'center', fontSize: 17 }}>{c.trucks}</span>
              <Ctl small icon="plus" tip="One truck more (over-truck)" onClick={() => p.onTrucks(c.trucks + 1)} />
            </span>
          </span>
          <span className={css.pcSub} style={{ marginTop: 0 }}>
            got <b className={allocated < c.trucks ? css.bad : undefined}>{allocated}</b> · full rate {nFull}
          </span>
        </div>
        <div className={css.stat}>
          <span className={css.statLab}>bcm / day</span>
          <span className={css.statVal}>{kb(achieved)}<small>/ {kb(planned)} planned</small></span>
          <span className={css.mini} title={`Achieved ${num(achieved, 0)} · planned ${num(planned, 0)} · loader potential ${num(pot, 0)}`}>
            <span style={{ width: `${(achieved / Math.max(pot, planned, 1)) * 100}%`, background: c.color }} />
            {lost > 0 && <i style={{ left: `${(achieved / Math.max(pot, planned, 1)) * 100}%`, width: `${(lost / Math.max(pot, planned, 1)) * 100}%` }} />}
          </span>
        </div>
        <div className={css.stat}>
          <span className={css.statLab}>Lost vs plan</span>
          <span className={`${css.statVal} ${lost > 0 ? css.bad : ''}`}>{lost > 0 ? `−${kb(lost)}` : '0'}<small>bcm/d</small></span>
          <span className={css.pcSub} style={{ marginTop: 0 }} title={`Loader target ${num(pot, 0)} bcm/day`}>target {kb(pot)}</span>
        </div>
        <div className={css.stat}>
          <span className={css.statLab}>Loader PT lost</span>
          <span className={`${css.statVal} ${lostPt > 0.05 ? css.bad : ''}`}>{num(lostPt, 2)}<small>h / shift</small></span>
          <span className={css.pcSub} style={{ marginTop: 0 }}>crew {a?.crewAllocated ?? '–'} / {a?.crewRequested ?? '–'}</span>
        </div>
      </div>

      {annot && (
        <div className={`${css.annot} ${annot.kind === 'over' ? css.annotOver : css.annotUnder}`}>
          <Icon name={annot.kind === 'over' ? 'plus' : 'minus'} size={18} strokeWidth={2.2} style={{ color: annot.kind === 'over' ? 'var(--warn)' : 'var(--bad)' }} />
          <span className={css.annotText}>{annot.text}</span>
          {deliberate
            ? <Button size="sm" variant="ghost" icon="x" onClick={() => setDeliberate(null)}>Not deliberate</Button>
            : (
              <MenuButton align="right" items={[{ header: true, label: `Deliberately ${annot.kind}-trucked because…` }, ...REASONS[annot.kind].map(t => ({ label: t, onSelect: () => setDeliberate(t) }))]}>
                {(_, t) => <Button size="sm" icon="pin" onClick={t}>Mark deliberate</Button>}
              </MenuButton>
            )}
        </div>
      )}

      {alts.length > 0 && (
        <div className={css.alts}>
          <button type="button" className={css.altHead} style={{ width: '100%', border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setShowAlts(!altsOpen)}>
            <Icon name={altsOpen ? 'down' : 'right'} size={14} />Haul options · {alts.length} alternative{alts.length > 1 ? 's' : ''}
            <span style={{ flex: 1 }} />
            {!altsOpen && alts.some(x => x.delta > 0) && <span style={{ textTransform: 'none', letterSpacing: 0 }}><Badge tone="ok">best {signed(Math.max(...alts.map(x => x.delta)), 0)} bcm/d</Badge></span>}
          </button>
          {altsOpen && <>
            <div className={css.alt} style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600 }}>
              <span>Route</span><span className={css.altNum}>Length</span><span className={css.altNum}>Trucks (full)</span><span className={css.altNum}>bcm/d @ {Math.max(1, allocated)}</span><span className={css.altNum}>Δ bcm/d</span><span />
            </div>
            <div className={`${css.alt} ${css.altCur}`}>
              <span className={css.altName} style={{ color: 'var(--ink-2)' }}>{s.strings.find(x => x.id === c.haulStringId)?.name ?? 'Current route'} <Badge tone="na">current</Badge></span>
              <span className={css.altNum}>{r?.ok ? `${num(r.lengthM / 1000, 2)} km` : '–'}</span>
              <span className={css.altNum}>{nFull}</span>
              <span className={css.altNum}>{kb(achieved)}</span>
              <span className={css.altNum}>–</span><span />
            </div>
            {alts.map(x => (
              <div key={x.id} className={css.alt}>
                <span className={css.altName} title={x.name}>{x.name}</span>
                <span className={css.altNum}>{x.ok ? `${num(x.lengthM / 1000, 2)} km` : '–'}</span>
                <span className={css.altNum}>{x.need}</span>
                <span className={css.altNum}>{kb(x.bcm)}</span>
                <span className={`${css.altNum} ${x.delta > 0.5 ? css.ok : x.delta < -0.5 ? css.bad : ''}`} style={{ fontWeight: 650 }}>{signed(x.delta, 0)}</span>
                <Button size="sm" variant={x.delta > 0 ? 'primary' : 'secondary'} disabled={!x.ok} onClick={() => p.onUseOption(x.id, x.name)}>Use this option</Button>
              </div>
            ))}
          </>}
        </div>
      )}
    </div>
  );
}

/** A prioritised site task (e.g. bulk push dozers) in the priority list: people requested vs allocated, bcm lost. */
export function TaskCard({ rule, task, rank, isLast, dragging, over, onDragStart, onDragOver, onDrop, onDragEnd, onMove, onEdit }: {
  rule: CrewRuleExt; task?: PriorityTask; rank: number; isLast: boolean; dragging: boolean; over: boolean;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void; onDragEnd: () => void; onMove: (d: -1 | 1) => void; onEdit: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const req = task?.requested ?? 0, got = task?.allocated ?? req;
  const per = rule.bcmPerUnitDay ?? 0;
  const status = got >= req ? 'full' : got > 0 ? 'reduced' : 'parked';
  return (
    <div className={`${css.pc} ${isLast ? css.pcLast : ''} ${dragging ? css.pcDragging : ''} ${over ? css.pcOver : ''}`}
      draggable={armed}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rule.id); onDragStart(); }}
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDrop={e => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { setArmed(false); onDragEnd(); }}>
      <span className={css.pcStripe} style={{ background: 'var(--c7)' }} />
      <div className={css.pcHead}>
        <span className={css.pcDrag} title="Drag to change priority" onMouseDown={() => setArmed(true)} onMouseUp={() => setArmed(false)}><Icon name="drag" size={20} /></span>
        <span className={css.pcRank}><small>P</small>{rank}</span>
        <div style={{ minWidth: 0 }}>
          <div className={css.pcTitle}><Icon name={ROLE_META[rule.role].icon} size={18} style={{ color: 'var(--ink-2)' }} />{rule.name}
            {isLast && <span className={css.lastTag}><Icon name="warning" size={13} />Last priority - gives first</span>}</div>
          <div className={css.pcSub}>Site task · {ROLE_META[rule.role].label.toLowerCase()}{per ? ` · ${kb(per)} bcm/day per person` : ''}{rule.sheetRef ? ` · ${rule.sheetRef.replace('Targets & Haulage Priorities!', 'Targets!').split(' ')[0]}` : ''}</div>
        </div>
        <div className={css.pcRight}>
          {status === 'full' ? <Badge tone="ok" icon="tick">Full</Badge> : status === 'reduced' ? <Badge tone="warn" icon="minus">Reduced {got}/{req}</Badge> : <Badge tone="bad" icon="pause">Stood down</Badge>}
          <Ctl small icon="edit" tip="Edit rule (Manning)" onClick={onEdit} />
          <MenuButton align="right" items={[
            { label: 'Raise priority', icon: 'up', disabled: rank === 1, onSelect: () => onMove(-1) },
            { label: 'Lower priority', icon: 'down', onSelect: () => onMove(1) },
          ]}>{(o, t) => <Ctl small icon="more" tip="More" on={o} onClick={t} />}</MenuButton>
        </div>
      </div>
      <div className={css.pcGrid}>
        <div className={css.stat}><span className={css.statLab}>People</span><span className={css.statVal}>{got}<small>/ {req} requested</small></span></div>
        <div className={css.stat}><span className={css.statLab}>bcm / day</span><span className={css.statVal}>{per ? kb(got * per) : '–'}<small>{per ? `/ ${kb(req * per)}` : 'no production rate'}</small></span></div>
        <div className={css.stat}><span className={css.statLab}>Lost bcm / day</span><span className={`${css.statVal} ${(task?.bcmDayLost ?? 0) > 0 ? css.bad : ''}`}>{(task?.bcmDayLost ?? 0) > 0 ? `−${kb(task!.bcmDayLost)}` : '0'}</span></div>
        <div className={css.stat}><span className={css.statLab}>Shed</span><span className={css.statVal}>{req - got}<small>operator{req - got === 1 ? '' : 's'}</small></span></div>
      </div>
    </div>
  );
}
