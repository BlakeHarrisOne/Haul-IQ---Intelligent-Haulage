/** Edit / create a crew rule: scope, condition, role, count, per-N, note, sheet reference - with a live sentence preview. */
import { useEffect, useMemo, useState } from 'react';
import type { CrewRole, CrewRule, LoaderType, RuleScope, Scenario } from '@/core/types';
import { Button, Field, Icon, Modal, NumberField, Select, TextField, cx } from '@/ui';
import { ROLE_META, ROLE_ORDER } from './roles';
import { SCOPE_META, cleanCondition, describeRule, type Rule } from './rules';
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
  const [d, setD] = useState<Rule | null>(rule as Rule | null);
  const [tags, setTags] = useState('');
  const [params, setParams] = useState('');
  useEffect(() => {
    setD(rule as Rule | null);
    setTags(rule?.when?.tags?.join(', ') ?? '');
    setParams(Object.entries((rule as Rule | null)?.params ?? {}).map(([k, v]) => `${k} = ${v}`).join(', '));
  }, [rule, open]);
  const ctx = useMemo(() => ({ materials: scenario.materials, rules: scenario.crew.rules }), [scenario.materials, scenario.crew.rules]);
  if (!open || !d) return null;
  const set = (p: Partial<Rule>) => setD({ ...d, ...p });
  const parseParams = (txt: string) => {
    const out: Record<string, number> = {};
    for (const part of txt.split(',')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[0-9.]+)\s*$/.exec(part);
      if (m) out[m[1]] = Number(m[2]);
    }
    return Object.keys(out).length ? out : undefined;
  };
  const when = (p: Partial<NonNullable<CrewRule['when']>>) => setD({ ...d, when: { ...d.when, ...p } });
  const sentence = describeRule({ ...d, when: cleanCondition(d.when), params: parseParams(params) } as Rule, ctx);
  const loaderUnits = scenario.fleet.units.filter(u => u.kind === 'loader').map(u => ({ id: u.id, label: u.id }));
  const allTags = [...new Set(scenario.circuits.flatMap(c => c.tags ?? []))];
  const save = () => {
    const t = tags.split(',').map(x => x.trim()).filter(Boolean);
    onSave({ ...d, name: d.name.trim() || 'Untitled rule', when: cleanCondition({ ...d.when, tags: t }), params: parseParams(params),
      expr: d.expr?.trim() || undefined, whenExpr: d.whenExpr?.trim() || undefined } as Rule);
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
        <div className={css.span2} style={{ font: '650 12px/16px var(--font)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-2)', marginTop: 4 }}>Derived count &amp; task priority (optional)</div>
        <Field label="Count expression" hint="Replaces “people each time”, e.g. params.pushFleet − params.enabling − max(0, totals.trucks − params.maxTrucks)" style={{ gridColumn: '1 / -1' }}>
          <TextField value={d.expr ?? ''} onChange={v => set({ expr: v || undefined })} placeholder="leave empty to use the fixed count" />
        </Field>
        <Field label="Extra condition" hint="Fires only when true, e.g. roles.pushDozer > 0">
          <TextField value={d.whenExpr ?? ''} onChange={v => set({ whenExpr: v || undefined })} placeholder="e.g. totals.trucks >= 10" />
        </Field>
        <Field label="Parameters" hint="name = value, comma separated">
          <TextField value={params} onChange={setParams} placeholder="pushFleet = 7, enabling = 1" />
        </Field>
        <Field label="Task priority" hint={d.scope === 'site' ? 'Site tasks with a priority are shed like circuits when crew is short' : 'Site-wide rules only'}>
          <NumberField value={d.priority ?? null} onChange={v => set({ priority: Math.max(1, Math.round(v)) })} onClear={() => set({ priority: undefined })} dp={0} min={1} placeholder="not a task" disabled={d.scope !== 'site'} />
        </Field>
        <Field label="Production per person" hint="For lost-production reporting when the task is shed">
          <NumberField value={d.bcmPerUnitDay ?? null} onChange={v => set({ bcmPerUnitDay: Math.max(0, v) })} onClear={() => set({ bcmPerUnitDay: undefined })} dp={0} min={0} unit="bcm/day" placeholder="—" disabled={d.scope !== 'site'} />
        </Field>
        <Field label="Note" style={{ gridColumn: '1 / -1' }}>
          <textarea className={css.textarea} value={d.note ?? ''} onChange={e => set({ note: e.target.value || undefined })} placeholder="Why the rule exists (shown under the sentence)" />
        </Field>
        <Field label="Spreadsheet reference"><TextField value={d.sheetRef ?? ''} onChange={v => set({ sheetRef: v || undefined })} placeholder="Targets & Haulage Priorities!E69" /></Field>
        <Field label="Rule id"><TextField value={d.id} onChange={v => set({ id: v.replace(/\s+/g, '_') })} /></Field>
      </div>
    </Modal>
  );
}
