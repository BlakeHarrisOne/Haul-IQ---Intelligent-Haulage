/** Rule set editor: crew rules as sentences with enable toggles, edit modal, add / duplicate / delete / reorder, reset. */
import { useMemo, useState } from 'react';
import type { CrewRule, ManningResult, Scenario } from '@/core/types';
import { uid } from '@/core/ids';
import { signed } from '@/core/format';
import { useApp } from '@/state/store';
import { Badge, Button, Card, CardBody, CardHead, Ctl, Empty, Icon, MenuButton, Modal, Toggle, cx } from '@/ui';
import { ROLE_META } from './roles';
import { asExt, blankRule, describeRule, workbookRules } from './rules';
import { RuleModal } from './RuleModal';
import css from './manning.module.css';
import page from './page.module.css';

export function RuleSet({ scenario, manning }: { scenario: Scenario; manning: ManningResult }) {
  const commit = useApp(st => st.commit);
  const toast = useApp(st => st.toast);
  const rules = scenario.crew.rules;
  const [edit, setEdit] = useState<{ rule: CrewRule; isNew: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const ctx = useMemo(() => ({ materials: scenario.materials, rules: scenario.crew.rules }), [scenario.materials, scenario.crew.rules]);

  const fires = useMemo(() => {
    const f: Record<string, { n: number; people: number }> = {};
    for (const l of manning.lines) {
      const x = (f[l.ruleId] ??= { n: 0, people: 0 });
      x.n++; x.people += l.count;
    }
    return f;
  }, [manning.lines]);

  const setRules = (label: string, fn: (r: CrewRule[]) => CrewRule[]) => commit(label, s => ({ ...s, crew: { ...s.crew, rules: fn(s.crew.rules) } }));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return;
    setRules('Reorder crew rules', rs => { const a = [...rs]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; });
  };
  const save = (r: CrewRule) => {
    const isNew = !!edit?.isNew;
    const origId = edit?.rule.id;
    let id = r.id;
    if (rules.some(x => x.id === id && x.id !== (isNew ? undefined : origId))) id = `${id}_${rules.length + 1}`;
    const rule = { ...r, id };
    setRules(isNew ? `Add rule ${rule.name}` : `Edit rule ${rule.name}`, rs => (isNew ? [...rs, rule] : rs.map(x => (x.id === origId ? rule : x))));
    setEdit(null);
  };
  const enabled = rules.filter(r => r.enabled).length;

  return (
    <Card>
      <CardHead icon="formula" title="Rule set" sub={`${enabled} of ${rules.length} rules on · evaluated top to bottom`}
        actions={<>
          <Button size="sm" variant="ghost" icon="reset" onClick={() => setConfirmReset(true)}>Reset to workbook rules</Button>
          <Button size="sm" icon="plus" onClick={() => setEdit({ rule: blankRule(uid('rule')), isNew: true })}>Add rule</Button>
        </>} />
      <CardBody style={{ padding: 0 }}>
        {!rules.length && (
          <Empty icon="formula" title="No crew rules" action={<Button variant="primary" icon="reset" onClick={() => setRules('Load workbook rules', () => workbookRules())}>Load workbook rules</Button>}>
            Rules turn the plan into crew: “for every active coal loader circuit with ≥ 1 truck → +1 coal dozer operator”.
          </Empty>
        )}
        <div className={css.rules} role="list">
          {rules.map((r, i) => {
            const sen = describeRule(r, ctx);
            const f = fires[r.id];
            const meta = ROLE_META[r.role];
            return (
              <div key={r.id} role="listitem"
                className={cx(css.rule, css.quiet, !r.enabled && css.ruleOff, drag === i && css.ruleDragging, over === i && drag !== null && drag !== i && css.ruleOver)}
                draggable onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                onDragOver={e => { e.preventDefault(); if (over !== i) setOver(i); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                onDrop={e => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}>
                <span className={css.ruleDrag} title="Drag to reorder"><Icon name="drag" size={18} /></span>
                <span className={css.ruleNo}>{i + 1}</span>
                <Toggle on={r.enabled} onChange={v => setRules(`${v ? 'Enable' : 'Disable'} rule ${r.name}`, rs => rs.map(x => (x.id === r.id ? { ...x, enabled: v } : x)))}
                  title={r.enabled ? 'Rule on' : 'Rule off'} />
                <div className={css.ruleBody}>
                  <div className={css.ruleText}>
                    {sen.condition}<span className={css.ruleArrow}>→</span>
                    <span className={css.ruleEffect}><Icon name={meta.icon} size={16} style={{ display: 'inline-block', verticalAlign: '-3px', marginRight: 5, color: 'var(--ink-2)' }} />{sen.effect}</span>
                  </div>
                  <div className={css.ruleMeta}>
                    <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{r.name}</span>
                    <span className={page.chip}>{r.id}</span>
                    {asExt(r).priority != null && <span className={page.chip} title="Prioritised site task – shed like a circuit when crew is short"><Icon name="priority" size={12} />Task P{asExt(r).priority}</span>}
                    {r.sheetRef && <span className={page.chip} title={r.sheetRef}><Icon name="table" size={12} />{r.sheetRef.replace('Targets & Haulage Priorities!', 'Targets!')}</span>}
                    {r.note && <span style={{ minWidth: 0 }}>{r.note}</span>}
                  </div>
                </div>
                <span className={css.ruleFires}>
                  {!r.enabled ? <span className={css.roleMeta}>Off</span>
                    : f ? <Badge tone="na" title={`Fired ${f.n} time${f.n === 1 ? '' : 's'} in the current plan`}>{f.n > 1 ? `${f.n}× · ` : ''}{signed(f.people, 0)}</Badge>
                      : <span className={css.roleMeta} title="Condition not met by the current plan">Not firing</span>}
                </span>
                <span className={css.ruleActs}>
                  <Ctl small icon="edit" tip="Edit rule" onClick={() => setEdit({ rule: r, isNew: false })} />
                  <MenuButton align="right" items={[
                    { label: 'Move up', icon: 'up', disabled: i === 0, onSelect: () => move(i, i - 1) },
                    { label: 'Move down', icon: 'down', disabled: i === rules.length - 1, onSelect: () => move(i, i + 1) },
                    { label: 'Duplicate', icon: 'copy', onSelect: () => setRules(`Duplicate rule ${r.name}`, rs => { const a = [...rs]; a.splice(i + 1, 0, { ...r, id: uid('rule'), name: `${r.name} (copy)` }); return a; }) },
                    { separator: true, label: '' },
                    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setRules(`Delete rule ${r.name}`, rs => rs.filter(x => x.id !== r.id)) },
                  ]}>
                    {(open, toggle) => <Ctl small icon="more" tip="More" on={open} onClick={toggle} />}
                  </MenuButton>
                </span>
              </div>
            );
          })}
        </div>
      </CardBody>
      <RuleModal open={!!edit} rule={edit?.rule ?? null} isNew={edit?.isNew} scenario={scenario} onClose={() => setEdit(null)} onSave={save} />
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset to the workbook rules?" width={520}
        sub="Replaces the current rule set with R1–R10 from 'Targets & Haulage Priorities' (36 crew for the linked plan). Undo is available."
        footer={<><span style={{ flex: 1 }} /><Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button variant="primary" icon="reset" onClick={() => { setRules('Reset to workbook rules', () => workbookRules()); setConfirmReset(false); toast('ok', 'Crew rules reset to the workbook (R1–R10)'); }}>Reset rules</Button></>}>
        <div style={{ display: 'grid', gap: 6 }}>
          {workbookRules().map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
              <span className={page.chip} style={{ minWidth: 0 }}>{r.id.split('_')[0]}</span>{describeRule(r, ctx).text}
            </div>
          ))}
        </div>
      </Modal>
    </Card>
  );
}
