/** Edit / create a crew rule: scope, condition, role, count, per-N, note, sheet reference - with a live sentence preview. */
import { useEffect, useMemo, useState } from 'react';
import type { CrewRole, CrewRule, LoaderType, RuleScope, Scenario } from '@/core/types';
import { Button, Field, Icon, Modal, NumberField, Select, TextField, cx } from '@/ui';
import { ROLE_META, ROLE_ORDER } from './roles';
import { SCOPE_META, cleanCondition, describeRule } from './rules';
import css from './manning.module.css';

function ChipSet<T extends string>({ all, value, onChange, label }: { all: { id: T; label: string }[]; value: T[] | undefined; onChange: (v: T[]) => void; label?: (id: T) => string }) {
  const on = new Set(value ?? []);
  return (
    <div className={css.chips}>
      {all.map(o => (
        <button key={o.id} type="button" className={cx(css.chipBtn, on.has(o.id) && css.chipOn)} aria-pressed={on.has(o.id)}
          onClick={() => { const n = new Set(on); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); onChange(all.map(x => x.id).filter(x => n.has(x))); }}>
          {on.has(o.id) && <Icon name="tick" size={14} strokeWidth={2.2} />}{label ? label(o.id) : o.label}
        </button>
      ))}
      {!all.length && <span className={css.roleMeta}>None in this scenario</span>}
    </div>
  );
}

export function RuleModal({ open, rule, scenario, onClose, onSave, isNew }: {
  open: boolean; rule: CrewRule | null; scenario: Scenario; onClose: () => void; onSave: (r: CrewRule) => void; isNew?: boolean;
}) {
  const [d, setD] = useState<CrewRule | null>(rule);
  const [tags, setTags] = useState('');
  useEffect(() => { setD(rule); setTags(rule?.when?.tags?.join(', ') ?? ''); }, [rule, open]);
  const ctx = useMemo(() => ({ materials: scenario.materials }), [scenario.materials]);
  if (!open || !d) return null;
  const set = (p: Partial<CrewRule>) => setD({ ...d, ...p });
  const when = (p: Partial<NonNullable<CrewRule['when']>>) => setD({ ...d, when: { ...d.when, ...p } });
  const sentence = describeRule({ ...d, when: cleanCondition(d.when) }, ctx);
  const loaderUnits = scenario.fleet.units.filter(u => u.kind === 'loader').map(u => ({ id: u.id, label: u.id }));
  const allTags = [...new Set(scenario.circuits.flatMap(c => c.tags ?? []))];
  const save = () => {
    const t = tags.split(',').map(x => x.trim()).filter(Boolean);
    onSave({ ...d, name: d.name.trim() || 'Untitled rule', when: cleanCondition({ ...d.when, tags: t }) });
  };
  const scopeUsesCondition = d.scope !== 'site' || !!d.when;
  return (
    <Modal open={open} onClose={onClose} width={760}
      title={isNew ? 'New crew rule' : 'Edit crew rule'}
      sub="Rules run top to bottom. Each one adds operators every time its scope fires and its condition holds."
      footer={<><span style={{ flex: 1 }} /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="tick" onClick={save}>{isNew ? 'Add rule' : 'Save rule'}</Button></>}>
      <div className={css.preview}><Icon name="formula" /><span>{sentence.condition}<span className={css.ruleArrow}>→</span><b>{sentence.effect}</b></span></div>
      <div className={css.form}>
        <Field label="Name"><TextField value={d.name} onChange={v => set({ name: v })} autoFocus={isNew} /></Field>
        <Field label="Scope" hint={SCOPE_META[d.scope].hint}>
          <Select value={d.scope} onChange={v => set({ scope: v as RuleScope })}
            options={(Object.keys(SCOPE_META) as RuleScope[]).map(k => ({ value: k, label: SCOPE_META[k].label }))} />
        </Field>
        <Field label="Role">
          <Select value={d.role} onChange={v => set({ role: v as CrewRole })} options={ROLE_ORDER.map(r => ({ value: r, label: ROLE_META[r].label }))} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="People each time"><NumberField value={d.count} onChange={v => set({ count: Math.round(v) })} step={1} dp={0} min={-50} max={99} /></Field>
          <Field label="Per N units" hint={d.scope === 'per-truck' ? 'ceil(trucks ÷ N)' : 'per-truck scope only'}>
            <NumberField value={d.perUnits ?? null} onChange={v => set({ perUnits: Math.max(1, Math.round(v)) })} onClear={() => set({ perUnits: undefined })}
              step={1} dp={0} min={1} max={99} placeholder="1" disabled={d.scope !== 'per-truck'} />
          </Field>
        </div>
        {scopeUsesCondition && <>
          <div className={css.span2} style={{ font: '650 12px/16px var(--font)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-2)', marginTop: 4 }}>Condition</div>
          <Field label="Materials"><ChipSet all={scenario.materials.map(m => ({ id: m.id, label: m.name }))} value={d.when?.materialIds} onChange={v => when({ materialIds: v })} /></Field>
          <Field label="Loader types">
            <ChipSet all={(['excavator', 'shovel', 'loader'] as LoaderType[]).map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))} value={d.when?.loaderTypes} onChange={v => when({ loaderTypes: v })} />
          </Field>
          <Field label="Loading units" style={{ gridColumn: '1 / -1' }}><ChipSet all={loaderUnits} value={d.when?.loaderUnitIds} onChange={v => when({ loaderUnitIds: v })} /></Field>
          <Field label="Minimum trucks on the circuit">
            <NumberField value={d.when?.minTrucks ?? null} onChange={v => when({ minTrucks: Math.max(0, Math.round(v)) })} onClear={() => when({ minTrucks: undefined })} step={1} dp={0} min={0} placeholder="any" unit="trucks" />
          </Field>
          <Field label="Circuit tags" hint={allTags.length ? `In use: ${allTags.join(', ')}` : 'Comma separated'}>
            <TextField value={tags} onChange={setTags} placeholder="e.g. coal, prestrip" />
          </Field>
        </>}
        <Field label="Note" style={{ gridColumn: '1 / -1' }}>
          <textarea className={css.textarea} value={d.note ?? ''} onChange={e => set({ note: e.target.value || undefined })} placeholder="Why the rule exists (shown under the sentence)" />
        </Field>
        <Field label="Spreadsheet reference"><TextField value={d.sheetRef ?? ''} onChange={v => set({ sheetRef: v || undefined })} placeholder="Targets & Haulage Priorities!E69" /></Field>
        <Field label="Rule id"><TextField value={d.id} onChange={v => set({ id: v.replace(/\s+/g, '_') })} /></Field>
      </div>
    </Modal>
  );
}
