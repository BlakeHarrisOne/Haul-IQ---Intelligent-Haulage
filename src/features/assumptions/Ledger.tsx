import { useMemo, useState } from 'react';
import type { CalcGroup, CalcStep } from '@/core/types';
import { num } from '@/core/format';
import { Badge, Button, Card, CardHead, Icon, Tip, TextField, type IconName } from '@/ui';
import { FormulaText, Substituted } from './FormulaText';
import { smart } from './shared/delta';
import { Callout } from './shared/PageHeader';
import s from './assumptions.module.css';

export const GROUP_ORDER: CalcGroup[] = ['route', 'travel', 'cycle', 'productivity', 'fleet', 'loader', 'manning', 'priority', 'shift'];
export const GROUP_META: Record<CalcGroup, { title: string; icon: IconName }> = {
  route: { title: 'Route', icon: 'route' },
  travel: { title: 'Travel', icon: 'speed' },
  cycle: { title: 'Cycle', icon: 'clock' },
  productivity: { title: 'Productivity', icon: 'chart' },
  fleet: { title: 'Fleet', icon: 'truck' },
  loader: { title: 'Loader', icon: 'excavator' },
  manning: { title: 'Manning', icon: 'crew' },
  priority: { title: 'Priority', icon: 'priority' },
  shift: { title: 'Shift', icon: 'calendar' },
};

/** Headline cells of the workbook: highlighted in the ledger. */
const KEY_REFS = /!(C7|C14|C15|C16|C24|C26|C28)$/;

export const isEstimated = (src?: string) => !!src && /estimat|\[est\]|\(est\.?\)|\best\.\b/i.test(src);

export function fmtStepValue(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '–';
  const u = unit.toLowerCase();
  if (u === 's') return num(v, Math.abs(v) >= 1000 ? 0 : 1);
  if (u === 'm') return num(v, Math.abs(v) >= 100 ? 0 : 1);
  if (u.startsWith('min')) return num(v, 2);
  if (u.startsWith('h')) return num(v, 2);
  if (u === 'trucks' && Number.isInteger(v)) return num(v, 0);
  if (u === 'trucks') return num(v, 3);
  if (u === '%') return num(v, 1);
  return smart(v);
}

export function RefChip({ cell }: { cell: string }) {
  return (
    <Tip text={<>Equivalent cell in the Haulage Calculator workbook</>} side="up">
      <span className={s.refChip} tabIndex={0} aria-label={`Workbook cell ${cell}`}><Icon name="table" size={13} />{cell}</span>
    </Tip>
  );
}

function StepRow({ st, open, onToggle }: { st: CalcStep; open: boolean; onToggle: () => void }) {
  const hasInputs = !!st.inputs?.length;
  const key = !!st.sheetRef && KEY_REFS.test(st.sheetRef);
  const est = st.inputs?.some(i => isEstimated(i.source));
  return (
    <div className={`${s.step} ${key ? s.key : ''}`} data-step={st.id}>
      <div className={s.stepLabel}>
        <span>{st.label}{est && <> <Badge tone="warn" title="One or more inputs are estimated">est.</Badge></>}</span>
        {st.sheetRef && <RefChip cell={st.sheetRef} />}
      </div>
      <div className={s.stepBody}>
        <FormulaText text={st.formula} />
        {st.substituted && st.substituted !== st.formula && <Substituted text={st.substituted} />}
        {st.note && <div className={s.stepNote} style={{ marginTop: 3 }}>{st.note}</div>}
      </div>
      <div className={s.stepVal}>
        <span className={s.stepNum}>{fmtStepValue(st.value, st.unit)}</span>
        {st.unit && <span className={s.stepUnit}>{st.unit}</span>}
      </div>
      <div>
        {hasInputs && (
          <button type="button" className={s.expBtn} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} inputs of ${st.label}`} onClick={onToggle}>
            <Icon name="right" size={16} />
          </button>
        )}
      </div>
      {hasInputs && open && (
        <div className={s.inputs}>
          <table>
            <thead><tr><th>Input</th><th className={s.r}>Value</th><th>Source</th></tr></thead>
            <tbody>
              {st.inputs!.map((inp, i) => (
                <tr key={i}>
                  <td>{inp.label}</td>
                  <td className={s.r}>
                    {typeof inp.value === 'number' ? smart(inp.value) : inp.value}
                    {inp.unit && <span className={s.stepUnit}>{inp.unit}</span>}
                  </td>
                  <td><span className={s.srcCell}>{inp.source ?? <span className={s.subtle}>scenario</span>}{isEstimated(inp.source) && <Badge tone="warn">est.</Badge>}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Ledger({ steps, reconstructed, warnings, title, sub, onExport }: {
  steps: CalcStep[]; reconstructed?: boolean; warnings: string[]; title: string; sub?: string; onExport: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState(false);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (st: CalcStep) => !ql || [st.label, st.formula, st.sheetRef ?? '', st.note ?? ''].some(x => x.toLowerCase().includes(ql));
    const seen = new Set<CalcGroup>(steps.map(x => x.group));
    return GROUP_ORDER.filter(g => seen.has(g)).map(g => ({ g, items: steps.filter(x => x.group === g && match(x)) })).filter(x => x.items.length);
  }, [steps, q]);
  const isOpen = (id: string) => open[id] ?? allOpen;
  return (
    <Card>
      <CardHead
        title={title}
        sub={sub}
        icon="formula"
        actions={
          <span className={s.ledgerTools}>
            <TextField value={q} onChange={setQ} placeholder="Filter steps or cells" small width={190} />
            <Button size="sm" variant="ghost" icon={allOpen ? 'collapse' : 'expand'} onClick={() => { setAllOpen(o => !o); setOpen({}); }}>
              {allOpen ? 'Collapse inputs' : 'Expand inputs'}
            </Button>
            <Button size="sm" icon="download" onClick={onExport}>CSV</Button>
          </span>
        }
      />
      {reconstructed && (
        <Callout tone="info" icon="info">
          The engine returned no calculation trace for this circuit, so this ledger is <b>reconstructed</b> from its results using the
          workbook's ActiveRoute formulas. Values are the engine's; the formulas show how the workbook would derive them.
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warn">
          <ul className={s.whyList} style={{ padding: 0, gap: 2 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Callout>
      )}
      <div>
        {groups.map(({ g, items }) => (
          <section key={g} className={s.group} aria-label={GROUP_META[g].title}>
            <div className={s.groupHead}>
              <span className={s.groupIco}><Icon name={GROUP_META[g].icon} size={16} /></span>
              <span className={s.groupTitle}>{GROUP_META[g].title}</span>
              <span className={s.groupCount}>{items.length} {items.length === 1 ? 'step' : 'steps'}</span>
              <span className={s.groupRule} />
            </div>
            {items.map(st => <StepRow key={st.id} st={st} open={isOpen(st.id)} onToggle={() => setOpen(o => ({ ...o, [st.id]: !isOpen(st.id) }))} />)}
          </section>
        ))}
        {!groups.length && <div className={s.emptyGroup} style={{ padding: 20 }}>No steps match “{q}”.</div>}
      </div>
    </Card>
  );
}
