/** Shift crews: available headcount, per-role caps (tickets), active shift selection (commits crew.activeShiftId). */
import { useMemo, useState } from 'react';
import type { CrewRole, Id, Scenario, ShiftCrew } from '@/core/types';
import { uid } from '@/core/ids';
import { computeManning } from '@/engine';
import { resultsFor } from '@/state/derived';
import { useApp } from '@/state/store';
import { Badge, Button, Card, CardBody, CardHead, Ctl, Empty, Icon, MenuButton, NumberField, TextField, cx } from '@/ui';
import { ROLE_META, ROLE_ORDER } from './roles';
import css from './manning.module.css';
import page from './page.module.css';

const PRESETS: Record<string, { label: string; shifts: Omit<ShiftCrew, 'id'>[] }> = {
  abcd: { label: 'A / B / C / D crews (7-on 7-off, 12 h)', shifts: [
    { name: 'A Crew – Day', available: 32 }, { name: 'B Crew – Night', available: 32 }, { name: 'C Crew – Day', available: 32 }, { name: 'D Crew – Night', available: 32 },
  ] },
  dn: { label: 'Day / Night', shifts: [{ name: 'Day shift', available: 32 }, { name: 'Night shift', available: 30 }] },
};

export function Shifts({ scenario }: { scenario: Scenario }) {
  const commit = useApp(st => st.commit);
  const [open, setOpen] = useState<Id | null>(null);
  const shifts = scenario.crew.shifts;
  const active = scenario.crew.activeShiftId;
  const results = resultsFor(scenario);
  const req = useMemo(() => computeManning(scenario, results).total, [scenario, results]);

  const setShifts = (label: string, fn: (x: ShiftCrew[]) => ShiftCrew[], activeId?: Id) =>
    commit(label, s => {
      const next = fn(s.crew.shifts);
      const act = activeId ?? (next.some(x => x.id === s.crew.activeShiftId) ? s.crew.activeShiftId : next[0]?.id ?? '');
      return { ...s, crew: { ...s.crew, shifts: next, activeShiftId: act } };
    });
  const patch = (id: Id, p: Partial<ShiftCrew>, label = 'Edit shift crew') => setShifts(label, xs => xs.map(x => (x.id === id ? { ...x, ...p } : x)));
  const setCap = (sh: ShiftCrew, role: CrewRole, v: number | undefined) => {
    const byRole = { ...sh.byRole };
    if (v == null) delete byRole[role]; else byRole[role] = v;
    patch(sh.id, { byRole: Object.keys(byRole).length ? byRole : undefined }, `${ROLE_META[role].short} cap`);
  };
  const loadPreset = (k: string) => {
    const ps = PRESETS[k].shifts.map(x => ({ ...x, id: uid('sh') }));
    setShifts(`Shift preset: ${PRESETS[k].label}`, () => ps, ps[0].id);
  };

  return (
    <Card>
      <CardHead icon="crew" title="Crews" sub="Headcount · caps = tickets"
        actions={<>
          <MenuButton align="right" items={[{ header: true, label: 'Replace with preset' }, ...Object.entries(PRESETS).map(([k, p]) => ({ label: p.label, icon: 'calendar' as const, onSelect: () => loadPreset(k) }))]}>
            {(o, t) => <Ctl small icon="calendar" tip="Crew presets" on={o} onClick={t} />}
          </MenuButton>
          <Button size="sm" icon="plus" onClick={() => { const id = uid('sh'); setShifts('Add shift crew', xs => [...xs, { id, name: `Crew ${String.fromCharCode(65 + xs.length)}`, available: 30 }], shifts.length ? undefined : id); }}>Add</Button>
        </>} />
      <CardBody style={{ padding: 0 }}>
        {!shifts.length && <Empty icon="crew" title="No shift crews" action={<Button variant="primary" onClick={() => loadPreset('abcd')}>Add A / B / C / D crews</Button>}>Crews hold the headcount the plan is checked against.</Empty>}
        {shifts.map(sh => {
          const surplus = sh.available - req;
          const isOn = sh.id === active;
          const caps = Object.entries(sh.byRole ?? {}) as [CrewRole, number][];
          return (
            <div key={sh.id} className={css.shift}>
              <div className={cx(css.shiftRow, isOn && css.shiftOn)}>
                <button type="button" role="radio" aria-checked={isOn} title="Make this the active shift" className={cx(css.radio, isOn && css.radioOn)}
                  onClick={() => !isOn && commit(`Active shift: ${sh.name}`, s => ({ ...s, crew: { ...s.crew, activeShiftId: sh.id } }))} />
                <TextField bare value={sh.name} onChange={v => patch(sh.id, { name: v }, 'Rename shift crew')} />
                <NumberField value={sh.available} onChange={v => patch(sh.id, { available: Math.max(0, Math.round(v)) }, `${sh.name}: available`)} dp={0} step={1} min={0} unit="ops" small title="Operators available on this crew" />
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {surplus >= 0 ? <Badge tone="ok" icon="tick">+{surplus} spare</Badge> : <Badge tone="bad" icon="warning">{surplus} short</Badge>}
                </span>
                <span style={{ display: 'flex' }}>
                  <Ctl small icon="sliders" on={open === sh.id} tip="Role caps (tickets)" onClick={() => setOpen(open === sh.id ? null : sh.id)} />
                  <Ctl small icon="trash" tip="Delete crew" onClick={() => setShifts(`Delete ${sh.name}`, xs => xs.filter(x => x.id !== sh.id))} />
                </span>
              </div>
              {open !== sh.id && caps.length > 0 && (
                <div className={css.caps}>{caps.map(([r, n]) => <span key={r} className={page.chip}><Icon name={ROLE_META[r].icon} size={12} />{ROLE_META[r].short} ≤ {n}</span>)}</div>
              )}
              {open === sh.id && (
                <div className={css.capsEdit}>
                  {ROLE_ORDER.filter(r => r !== 'other').map(r => (
                    <label key={r} className={css.capItem}>
                      <Icon name={ROLE_META[r].icon} size={16} /><span>{ROLE_META[r].short}</span>
                      <NumberField small value={sh.byRole?.[r] ?? null} onChange={v => setCap(sh, r, Math.max(0, Math.round(v)))} onClear={() => setCap(sh, r, undefined)} dp={0} min={0} placeholder="—" />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {shifts.length > 0 && (
          <div className={page.footNote}><Icon name="info" size={16} />Required crew ({req}) is the same rule evaluation for every crew; shortfall is per crew. The workbook's cap note: “32 crew cap − 4 for AL/PL/training = 28 operating”.</div>
        )}
      </CardBody>
    </Card>
  );
}
