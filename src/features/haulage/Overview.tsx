/** Inspector with nothing selected: circuits overview, totals, new-circuit flow, strings and assets. */
import { useMemo, useState } from 'react';
import type { Circuit, CircuitResult, MeshAsset, Scenario } from '@/core/types';
import { useApp } from '@/state/store';
import { useResults } from '@/state/derived';
import { Badge, Button, CardBody, CardHead, Empty, Icon, Section, circuitColor, cx } from '@/ui';
import { num } from '@/core/format';
import { recommendedTrucks, stringStats } from './model';
import { Fig, StatusBadge, TruckPips } from './parts';
import { NewCircuitModal } from './NewCircuit';
import s from './haulage.module.css';

export function Overview() {
  const scenario = useApp(st => st.scenario);
  const results = useResults();
  const select = useApp(st => st.select);
  const [creating, setCreating] = useState(false);

  const totals = useMemo(() => {
    let trucks = 0, bcm = 0, lost = 0, needed = 0;
    for (const c of scenario.circuits) {
      if (!c.active) continue;
      const r = results[c.id];
      trucks += c.trucks;
      if (r?.ok) { bcm += r.assigned.bcmPerDay; lost += r.assigned.lostLoaderPtHrsShift; needed += recommendedTrucks(r); }
    }
    return { trucks, bcm, lost, needed };
  }, [scenario, results]);
  const avail = scenario.fleet.trucksAvailable;
  const active = scenario.circuits.filter(c => c.active).length;

  return (
    <>
      <CardHead
        title="Circuits"
        sub={scenario.circuits.length ? `${active} active` : undefined}
        icon="route"
        actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>New circuit</Button>}
      />
      <CardBody>
        {scenario.circuits.length > 0 && (
          <div className={s.totals}>
            <Fig label="Trucks used" value={`${totals.trucks} / ${avail}`} tone={totals.trucks > avail ? 'bad' : undefined}>
              <span className={s.figUnit} style={{ marginLeft: 0 }}>{totals.needed !== totals.trucks ? `need ${totals.needed}` : ''}</span>
            </Fig>
            <Fig label="Production" value={num(totals.bcm)} unit="bcm/d" />
            <Fig label="Lost loader PT" value={num(totals.lost, 1)} unit="h/shift" tone={totals.lost > 0.05 ? 'bad' : 'ok'} />
            <div style={{ gridColumn: '1 / -1' }}>
              <div className={s.meter} title={`${totals.trucks} of ${avail} available trucks assigned`}>
                <div className={cx(s.meterFill, totals.trucks > avail && s.meterOver)} style={{ width: `${Math.min(100, (totals.trucks / Math.max(1, avail)) * 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        <Section title="Circuits">
          {scenario.circuits.length === 0 ? (
            <Empty icon="route" title="No circuits yet" action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New circuit</Button>}>
              A circuit pairs a loader with a truck fleet on a haul string, from a dig block to a dump.
            </Empty>
          ) : (
            <div className={s.cList}>
              {[...scenario.circuits].sort((a, b) => a.priority - b.priority).map(c => (
                <CircuitRow key={c.id} c={c} r={results[c.id]} scenario={scenario} onClick={() => select({ kind: 'circuit', id: c.id })} />
              ))}
            </div>
          )}
        </Section>

        <StringsList scenario={scenario} />
        <AssetsList scenario={scenario} />
      </CardBody>
      {creating && <NewCircuitModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CircuitRow({ c, r, scenario, onClick }: { c: Circuit; r?: CircuitResult; scenario: Scenario; onClick: () => void }) {
  const truck = scenario.fleet.trucks.find(t => t.id === c.truckModelId);
  const dump = scenario.assets.find(a => a.id === c.dumpId);
  const dig = scenario.assets.find(a => a.id === c.digId);
  const mat = scenario.materials.find(m => m.id === c.materialId);
  const ok = !!r?.ok;
  const lost = r?.assigned.lostLoaderPtHrsShift ?? 0;
  return (
    <button type="button" className={cx(s.cRow, !c.active && s.cInactive)} onClick={onClick}>
      <span className={s.cDot} style={{ background: circuitColor(c.color) }} />
      <span className={s.cName}>{c.name}</span>
      <span>{ok ? <StatusBadge status={r!.assigned.status} short /> : <Badge tone="na">{c.active ? 'No route' : 'Parked'}</Badge>}</span>
      <span className={s.cMeta}>
        {dig?.name ?? c.loaderUnitId} → {dump?.name ?? 'no dump'} · {truck?.name ?? 'no truck'} · {mat?.id ?? c.materialId}
      </span>
      <div className={s.cFigs}>
        <Fig label="Trucks" value={c.trucks}>
          {ok && <TruckPips assigned={c.trucks} exact={r!.trucksExact} />}
        </Fig>
        <Fig label="Lost PT" value={ok ? num(lost, 2) : '–'} unit={ok ? 'h/sh' : undefined} tone={ok ? (lost > 0.005 ? 'bad' : 'na') : 'na'} />
        <Fig label="Production" value={ok ? num(r!.assigned.bcmPerDay) : '–'} unit={ok ? 'bcm/d' : undefined} />
      </div>
    </button>
  );
}

function StringsList({ scenario }: { scenario: Scenario }) {
  const select = useApp(st => st.select);
  const updateString = useApp(st => st.updateString);
  const setTool = useApp(st => st.setTool);
  return (
    <Section title={`Haul strings · ${scenario.strings.length}`} actions={<Button size="sm" variant="ghost" icon="string" onClick={() => setTool('draw')}>Draw</Button>}>
      {scenario.strings.length === 0 && <div className={s.sub} style={{ padding: '4px 16px 8px' }}>Draw a string on the surface, or paste XYZ rows into a new string.</div>}
      {scenario.strings.map(hs => {
        const st = stringStats(hs.points);
        const used = scenario.circuits.filter(c => c.haulStringId === hs.id).length;
        return (
          <div key={hs.id} className={s.lRow} role="button" tabIndex={0} onClick={() => select({ kind: 'string', id: hs.id })}
            onKeyDown={e => { if (e.key === 'Enter') select({ kind: 'string', id: hs.id }); }}>
            <span className={s.lineKey} style={{ background: circuitColor(hs.color) }} />
            <span className={s.lName} title={`${hs.name} · ${hs.points.length} points${used ? ` · ${used} circuit${used > 1 ? 's' : ''}` : ''}`}>{hs.name}</span>
            <span className={s.lVal}>{num(st.lengthM)} m</span>
            <button type="button" className={cx(s.iconBtn, hs.visible && s.iconBtnOn)} title={hs.visible ? 'Hide' : 'Show'}
              onClick={e => { e.stopPropagation(); updateString(hs.id, { visible: !hs.visible }); }}>
              <Icon name="eye" size={18} />
            </button>
          </div>
        );
      })}
    </Section>
  );
}

const ROLE_LABEL: Record<MeshAsset['role'], string> = { topo: 'Topo', dig: 'Dig', dump: 'Dump', design: 'Design', other: 'Other' };

function AssetsList({ scenario }: { scenario: Scenario }) {
  const select = useApp(st => st.select);
  const updateAsset = useApp(st => st.updateAsset);
  if (!scenario.assets.length) return null;
  const order: MeshAsset['role'][] = ['dig', 'dump', 'topo', 'design', 'other'];
  const list = [...scenario.assets].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return (
    <Section title={`Surfaces & solids · ${scenario.assets.length}`}>
      {list.map(a => (
        <div key={a.id} className={s.lRow} role="button" tabIndex={0} onClick={() => select({ kind: 'asset', id: a.id })}
          onKeyDown={e => { if (e.key === 'Enter') select({ kind: 'asset', id: a.id }); }}>
          <Icon name={a.kind === 'solid' ? 'solid' : 'surface'} size={18} style={{ color: a.color }} />
          <span className={s.lName}>{a.name}<span className={s.lHint}>{ROLE_LABEL[a.role]}</span></span>
          <span className={s.lVal}>{a.kind === 'solid' && a.stats.volume != null ? `${num((a.block?.plannedBcm ?? a.stats.volume) / 1000, 0)}k bcm` : `${num(a.stats.planArea / 10000, 1)} ha`}</span>
          <button type="button" className={cx(s.iconBtn, a.visible && s.iconBtnOn)} title={a.visible ? 'Hide' : 'Show'}
            onClick={e => { e.stopPropagation(); updateAsset(a.id, { visible: !a.visible }); }}>
            <Icon name="eye" size={18} />
          </button>
        </div>
      ))}
    </Section>
  );
}
