/** Manning result: total required vs available gauge, required-by-role bars (with ticket caps), per-circuit breakdown. */
import type { ManningResult, Scenario } from '@/core/types';
import { useApp } from '@/state/store';
import { signed } from '@/core/format';
import { Badge, Card, CardBody, CardHead, Ctl, Dot, Icon, circuitColor } from '@/ui';
import { ROLE_META, ROLE_ORDER } from './roles';
import { groupLines, lineLabel } from './model';
import css from './manning.module.css';
import page from './page.module.css';

export function CrewGauge({ required, available, label }: { required: number; available: number; label?: string }) {
  const max = Math.max(required, available, 1);
  const over = required > available;
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className={css.gauge} role="meter" aria-valuemin={0} aria-valuemax={available} aria-valuenow={required}
      aria-label={`${required} crew required of ${available} available`}>
      <div className={css.gaugeTop}>
        <span className={css.gaugeBig}>{required}</span>
        <span className={css.gaugeOf}>required of {available} available{label ? ` · ${label}` : ''}</span>
        <span style={{ marginLeft: 'auto' }}>
          {over ? <Badge tone="bad" icon="warning">{required - available} short</Badge> : <Badge tone="ok" icon="tick">{available - required} spare</Badge>}
        </span>
      </div>
      <div style={{ paddingTop: 18 }}>
        <div className={css.track}>
          {/* neutral bar for the crew that fits; status colour only for the shortfall beyond the cut-off */}
          <div className={css.fill} style={{ width: pct(Math.min(required, available)), borderRadius: over ? '6px 0 0 6px' : undefined }} />
          {over && <div className={css.fillOver} style={{ left: pct(available), width: `calc(${pct(required - available)} - 0px)` }} />}
          <div className={css.cut} style={{ left: pct(available) }}>
            <span className={css.cutLabel} style={available / max > 0.8 ? { transform: 'translateX(-100%)', left: 0 } : available / max < 0.2 ? { transform: 'none', left: 0 } : undefined}>Available {available}</span>
          </div>
        </div>
      </div>
      <div className={css.gaugeScale}><span>0</span><span>{max}</span></div>
    </div>
  );
}

export function RequiredByRole({ scenario, manning }: { scenario: Scenario; manning: ManningResult }) {
  const shift = scenario.crew.shifts.find(x => x.id === scenario.crew.activeShiftId);
  const caps = shift?.byRole ?? {};
  const rows = ROLE_ORDER.map(role => ({ role, need: manning.required[role] ?? 0, cap: caps[role] })).filter(r => r.need > 0 || r.cap != null);
  const max = Math.max(1, ...rows.map(r => Math.max(r.need, r.cap ?? 0)));
  return (
    <Card>
      <CardHead icon="crew" title="Crew required" sub="By role, from the enabled rules" />
      <CardBody style={{ padding: 0 }}>
        <CrewGauge required={manning.total} available={manning.available} label={shift?.name} />
        <div className={page.hr} style={{ margin: '8px 0 0' }} />
        <div className={css.roles}>
          {rows.map(r => {
            const meta = ROLE_META[r.role];
            const over = r.cap != null && r.need > r.cap;
            return (
              <div key={r.role} className={css.roleRow} title={`${meta.label}: ${r.need} required${r.cap != null ? ` · ${r.cap} ticketed on ${shift?.name}` : ''}`}>
                <span className={css.roleIco}><Icon name={meta.icon} size={18} /></span>
                <span className={css.roleLab}>{meta.label}</span>
                <span className={css.roleBarWrap}>
                  <span className={`${css.roleBar} ${over ? css.roleBarOver : ''}`} style={{ width: `${(r.need / max) * 100}%` }} />
                  {r.cap != null && <span className={css.roleCap} style={{ left: `${(r.cap / max) * 100}%` }} />}
                </span>
                <span className={`${css.roleVal} ${over ? css.bad : ''}`}>{r.need}</span>
                <span className={css.roleMeta}>{r.cap != null ? <span className={over ? css.bad : undefined}>{over && <Icon name="warning" size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }} />}cap {r.cap}</span> : ''}</span>
              </div>
            );
          })}
          {!rows.length && <div className={page.footNote}>No roles required – activate a circuit or enable rules.</div>}
        </div>
      </CardBody>
    </Card>
  );
}

export function Breakdown({ scenario, manning }: { scenario: Scenario; manning: ManningResult }) {
  const select = useApp(st => st.select);
  const groups = groupLines(scenario, manning);
  const ruleName = (id: string) => scenario.crew.rules.find(r => r.id === id)?.name;
  return (
    <Card>
      <CardHead icon="report" title="Why this many" sub="Every line, its reason and the rule that fired" />
      <CardBody style={{ padding: 0 }}>
        {groups.map(g => (
          <div key={g.key} className={css.group}>
            <div className={css.groupHead}>
              {g.circuit ? <Dot color={circuitColor(g.circuit.color)} /> : <Icon name="pin" size={16} style={{ color: 'var(--ink-3)' }} />}
              <span className={css.groupTitle}>{g.title}</span>
              {g.circuit && <Badge tone="na">P{g.circuit.priority} · {g.circuit.trucks} trucks</Badge>}
              <span className={css.groupTotal}>{g.total}</span>
              {g.circuit && <Ctl small icon="target" tip="Select circuit" onClick={() => select({ kind: 'circuit', id: g.circuit!.id })} />}
            </div>
            {g.lines.map((l, i) => {
              const lab = lineLabel(scenario, l);
              return (
              <div key={i} className={css.line} title={`${l.reason}${ruleName(l.ruleId) ? ` · rule ${l.ruleId}` : ''}`}>
                <span className={css.lineIco}><Icon name={ROLE_META[l.role].icon} size={16} /></span>
                <span className={css.lineReason}><span style={{ color: 'var(--ink)' }}>{lab.name}</span>{lab.detail && <span style={{ color: 'var(--ink-3)' }}> · {lab.detail}</span>}</span>
                <span className={page.chip}>{l.ruleId}</span>
                <span className={css.lineCount}>{signed(l.count, 0)}</span>
              </div>
              );
            })}
          </div>
        ))}
        {!groups.length && <div className={page.footNote}><Icon name="info" size={16} />No manning lines – no active circuits.</div>}
        {manning.steps.length > 0 && (
          <div className={page.footNote}><Icon name="formula" size={16} />{manning.steps.length} calculation steps on the Assumptions tab (group “manning”).</div>
        )}
      </CardBody>
    </Card>
  );
}
