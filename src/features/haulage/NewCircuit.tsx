/** "New circuit" flow: pick loader, truck, material, haul string and dig/dump; params default from the loader. */
import { useMemo, useState } from 'react';
import { useApp } from '@/state/store';
import { Button, Field, Modal, Select, TextField } from '@/ui';
import { num, secs } from '@/core/format';
import { buildCircuit, loaderDefaults, stringStats, suggestCircuitName, type NewCircuitInput } from './model';
import s from './haulage.module.css';

const NONE = '__none';

export function NewCircuitModal({ onClose }: { onClose: () => void }) {
  const scenario = useApp(st => st.scenario);
  const addCircuit = useApp(st => st.addCircuit);
  const select = useApp(st => st.select);

  const loaders = useMemo(() => {
    const ids = new Set<string>();
    scenario.fleet.units.filter(u => u.kind === 'loader').forEach(u => ids.add(u.id));
    scenario.fleet.loaderAssumptions.forEach(a => ids.add(a.unitId));
    return [...ids];
  }, [scenario]);
  const digs = scenario.assets.filter(a => a.role === 'dig');
  const dumps = scenario.assets.filter(a => a.role === 'dump');

  const [inp, setInp] = useState<NewCircuitInput>(() => {
    const busy = new Set(scenario.circuits.map(c => c.loaderUnitId));
    const loader = loaders.find(l => !busy.has(l)) ?? loaders[0] ?? '';
    const free = scenario.strings.find(hs => !scenario.circuits.some(c => c.haulStringId === hs.id));
    return {
      loaderUnitId: loader,
      truckModelId: scenario.fleet.trucks[0]?.id ?? '',
      materialId: scenario.materials[0]?.id ?? 'OB',
      haulStringId: free?.id ?? scenario.strings[0]?.id,
      digId: free?.digId ?? digs[0]?.id,
      dumpId: free?.dumpId ?? dumps[0]?.id,
    };
  });
  const [name, setName] = useState('');
  const set = (p: Partial<NewCircuitInput>) => setInp(v => ({ ...v, ...p }));

  const params = loaderDefaults(scenario, inp.loaderUnitId, inp.truckModelId, inp.materialId);
  const hs = scenario.strings.find(x => x.id === inp.haulStringId);
  const st = hs ? stringStats(hs.points) : undefined;
  const canCreate = !!inp.loaderUnitId && !!inp.truckModelId && !!inp.materialId;

  const create = () => {
    const c = buildCircuit(scenario, { ...inp, name });
    addCircuit(c);
    select({ kind: 'circuit', id: c.id });
    onClose();
  };

  const opt = <T extends { id: string; name: string }>(xs: T[], none?: string) => [
    ...(none ? [{ value: NONE, label: none }] : []),
    ...xs.map(x => ({ value: x.id, label: x.name })),
  ];

  return (
    <Modal open title="New circuit" sub="Pair a loader with a truck fleet on a haul string. Assumptions start from the loader's site defaults." onClose={onClose} width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="plus" disabled={!canCreate} onClick={create}>Create circuit</Button></>}>
      <div className={s.setup} style={{ padding: 0, gap: 14 }}>
        <Field label="Loader unit">
          <Select value={inp.loaderUnitId || NONE} onChange={v => set({ loaderUnitId: v === NONE ? '' : v })}
            options={loaders.length ? loaders.map(l => ({ value: l, label: `${l}${scenario.circuits.some(c => c.loaderUnitId === l) ? ' (in use)' : ''}` })) : [{ value: NONE, label: 'No loaders in fleet' }]} />
        </Field>
        <Field label="Truck model">
          <Select value={inp.truckModelId || NONE} onChange={v => set({ truckModelId: v })} options={scenario.fleet.trucks.length ? opt(scenario.fleet.trucks) : [{ value: NONE, label: 'No trucks in fleet' }]} />
        </Field>
        <Field label="Material">
          <Select value={inp.materialId} onChange={v => set({ materialId: v })} options={scenario.materials.length ? scenario.materials.map(m => ({ value: m.id, label: `${m.name} (${m.id})` })) : [{ value: 'OB', label: 'Overburden (OB)' }]} />
        </Field>
        <Field label="Haul string" hint={st ? `${num(st.lengthM)} m · ${hs!.points.length} points` : 'Draw one later'}>
          <Select value={inp.haulStringId ?? NONE} onChange={v => {
            const h = scenario.strings.find(x => x.id === v);
            set({ haulStringId: v === NONE ? undefined : v, ...(h?.digId ? { digId: h.digId } : {}), ...(h?.dumpId ? { dumpId: h.dumpId } : {}) });
          }} options={opt(scenario.strings, 'None yet')} />
        </Field>
        <Field label="Dig block">
          <Select value={inp.digId ?? NONE} onChange={v => set({ digId: v === NONE ? undefined : v })} options={opt(digs, 'None')} />
        </Field>
        <Field label="Dump">
          <Select value={inp.dumpId ?? NONE} onChange={v => set({ dumpId: v === NONE ? undefined : v })} options={opt(dumps, 'None')} />
        </Field>
        <div className={s.full}>
          <Field label="Name">
            <TextField value={name} onChange={setName} placeholder={suggestCircuitName(scenario, inp)} />
          </Field>
        </div>
        <div className={s.full} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: '20px' }}>
          <b style={{ color: 'var(--ink)' }}>Defaults from {inp.loaderUnitId || 'loader'}</b> · spot {secs(params.spotS)} · load {secs(params.loadS)} · dump {secs(params.dumpS)} ·
          planned {num(params.plannedRateBcmPerPtHr)} bcm/PT h · target {num(params.desiredDailyBcm)} bcm/d · {num(params.truckLoadBcm)} bcm/load · η {num(params.haulEff, 2)}
        </div>
      </div>
    </Modal>
  );
}
