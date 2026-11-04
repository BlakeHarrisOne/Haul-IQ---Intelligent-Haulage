/**
 * Crew rules as readable sentences + the workbook's rule set ('Targets & Haulage Priorities' rows 47, 65-88),
 * expressed with the CrewRule contract. Pure TS (unit-tested in rules.test.ts).
 */
import type { CrewRole, CrewRule, CrewRuleCondition, LoaderType, Material, RuleScope } from '@/core/types';
import type { CrewRuleExt } from '@/engine';
import { ROLE_META, plural } from './roles';

/** A crew rule with the engine's derived-rule extensions (expr / whenExpr / params / task priority). */
export type Rule = CrewRuleExt;
export const asExt = (r: CrewRule) => r as Rule;

export const SCOPE_META: Record<RuleScope, { label: string; hint: string }> = {
  'site': { label: 'Site-wide', hint: 'Fires once for the whole shift (fixed roles: water carts, graders, supervision).' },
  'per-circuit': { label: 'Per circuit', hint: 'Fires once for every active circuit that matches the condition.' },
  'per-active-loader': { label: 'Per active loader', hint: 'Fires once for every manned loading unit that matches.' },
  'per-material': { label: 'Per material', hint: 'Fires once for every material being moved by a matching circuit.' },
  'per-dump': { label: 'Per dump', hint: 'Fires once for every dump receiving loads from a matching circuit.' },
  'per-truck': { label: 'Per truck', hint: 'Fires for every truck on matching circuits; “per N” rounds up.' },
};

const LOADER_WORD: Record<LoaderType, string> = { excavator: 'excavator', shovel: 'shovel', loader: 'loader' };

export interface RuleContext {
  materials?: Pick<Material, 'id' | 'name'>[];
  /** Other rules, so `rules.<id>` in expressions reads as the rule's name. */
  rules?: Pick<CrewRule, 'id' | 'name'>[];
}

const ID_WORDS: Record<string, string> = {
  'totals.trucks': 'trucks operating', 'totals.circuits': 'circuits running', 'totals.activeLoaders': 'loaders manned',
  'fleet.trucksAvailable': 'trucks available', 'circuit.trucks': 'trucks on the circuit', 'circuit.priority': 'circuit priority',
};

/** Render an engine expression in words: params → their values, totals.trucks → 'trucks operating', roles.pushDozer → 'push dozers'. */
export function prettyExpr(src: string, rule: Pick<Rule, 'params'>, ctx?: RuleContext): string {
  return src
    .replace(/[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+/g, id => {
      if (ID_WORDS[id]) return ID_WORDS[id];
      const [ns, key] = id.split('.', 2);
      if (ns === 'params') return rule.params?.[key] != null ? String(rule.params[key]) : key;
      if (ns === 'roles') return ROLE_META[key as CrewRole]?.short.toLowerCase() ?? key;
      if (ns === 'rules') return ctx?.rules?.find(r => r.id === key)?.name.toLowerCase() ?? key;
      return id;
    })
    .replace(/\s*-\s*/g, ' − ').replace(/\s*\*\s*/g, ' × ').replace(/\s*>=\s*/g, ' ≥ ').replace(/\s*<=\s*/g, ' ≤ ')
    .replace(/\s*&&\s*/g, ' and ').replace(/\s*\|\|\s*/g, ' or ').replace(/\s*!=\s*/g, ' ≠ ').replace(/\s*==\s*/g, ' = ')
    .replace(/\(\s*− /g, '(−');
}

export interface RuleSentence {
  /** "For every active excavator or shovel circuit with ≥ 1 truck" */
  condition: string;
  /** "+2 dozer operators (floor & dump)" */
  effect: string;
  /** Full sentence: condition → effect. */
  text: string;
}

const joinOr = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

function materialWords(ids: string[], ctx?: RuleContext): string[] {
  return ids.map(id => {
    const m = ctx?.materials?.find(x => x.id === id);
    return m ? m.name.toLowerCase() : id;
  });
}

/** Adjectives + qualifiers for a condition, e.g. { adj: 'coal loader', quals: ['on LDR1', 'with ≥ 1 truck'] }. */
function conditionParts(w: CrewRuleCondition | undefined, ctx: RuleContext | undefined) {
  const adj: string[] = [];
  const quals: string[] = [];
  if (w?.materialIds?.length) adj.push(joinOr(materialWords(w.materialIds, ctx)));
  if (w?.loaderTypes?.length) adj.push(joinOr(w.loaderTypes.map(t => LOADER_WORD[t])));
  if (w?.loaderUnitIds?.length) quals.push(`on ${joinOr(w.loaderUnitIds)}`);
  if (w?.tags?.length) quals.push(`tagged ${joinOr(w.tags.map(t => `“${t}”`))}`);
  if (w?.minTrucks != null && w.minTrucks > 0) quals.push(`with ≥ ${w.minTrucks} ${w.minTrucks === 1 ? 'truck' : 'trucks'}`);
  return { adj: adj.join(' '), quals };
}

export function effectText(rule: Pick<Rule, 'count' | 'role' | 'perUnits' | 'scope' | 'expr' | 'params'>, ctx?: RuleContext): string {
  const meta = ROLE_META[rule.role];
  if (rule.expr) {
    let s = `+(${prettyExpr(rule.expr, rule, ctx)}) ${plural(2, meta.noun)}`;
    if (meta.qual) s += ` (${meta.qual})`;
    return s;
  }
  const n = rule.count;
  const sign = n >= 0 ? '+' : '−';
  let s = `${sign}${Math.abs(n)} ${plural(n, meta.noun)}`;
  if (meta.qual) s += ` (${meta.qual})`;
  return s;
}

/** Render a crew rule as a sentence: "For every active excavator circuit with ≥ 1 truck → +2 dozer operators (floor & dump)". */
export function describeRule(rule: CrewRule, ctx?: RuleContext): RuleSentence {
  const ext = asExt(rule);
  const { adj, quals } = conditionParts(rule.when, ctx);
  if (ext.whenExpr) quals.push(`when ${prettyExpr(ext.whenExpr, ext, ctx)}`);
  const q = quals.length ? ` ${quals.join(' ')}` : '';
  const a = adj ? `${adj} ` : '';
  let condition: string;
  switch (rule.scope) {
    case 'site':
      condition = adj || rule.when?.loaderUnitIds?.length || rule.when?.tags?.length
        ? `Site-wide, while any ${a}circuit runs${q}`
        : rule.when?.minTrucks ? `Site-wide, with ≥ ${rule.when.minTrucks} trucks operating${ext.whenExpr ? ` ${quals[quals.length - 1]}` : ''}`
          : ext.whenExpr ? `Site-wide, ${quals[quals.length - 1]}` : 'Site-wide, every shift';
      break;
    case 'per-circuit':
      condition = `For every active ${a}circuit${q}`;
      break;
    case 'per-active-loader':
      condition = `For every manned ${adj ? adj : 'loading unit'}${adj ? ' unit' : ''}${q}`;
      break;
    case 'per-material':
      condition = adj ? `For every ${adj} material being moved${q}` : `For every material being moved${q}`;
      break;
    case 'per-dump':
      condition = `For every active dump fed by ${adj ? `an ${adj}` : 'a'} circuit${q}`.replace(/ an ([^aeiou])/i, ' a $1');
      break;
    case 'per-truck': {
      const per = rule.perUnits && rule.perUnits > 1 ? `${rule.perUnits} trucks (rounded up)` : 'truck';
      condition = `For every ${per} on an active ${a}circuit${q}`;
      break;
    }
    default:
      condition = 'When';
  }
  const effect = effectText(ext, ctx);
  return { condition, effect, text: `${condition} → ${effect}` };
}

// ─────────────────────────────────────────────────────────────── the workbook's rule set

/**
 * The workbook manning rules (spec 01 §9.5, R1-R10) as CrewRules. Totals for the linked plan (EX09 5, EX04 4,
 * LDR1 3 trucks, 1 enabling dozer) = 36, matching Targets!D88.
 * R7 (bulk push = 7 − enabling − max(0, trucks − 12)) uses the engine's derived-rule `expr` (CrewRuleExt) and is a
 * prioritised site task (Targets DZR priority 4) the priority planner can shed; R8 is gated by `whenExpr`.
 */
export function workbookRules(): Rule[] {
  const T = 'Targets & Haulage Priorities';
  return [
    { id: 'R1_TRUCK_OPERATORS', name: 'Truck operators', enabled: true, scope: 'per-truck', role: 'truck', count: 1, perUnits: 1,
      note: 'Every truck allocated to a circuit needs one truck operator.', sheetRef: `${T}!D68 =$E$6` },
    { id: 'R2_EX_OPERATOR', name: 'Excavator operator', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['excavator', 'shovel'], minTrucks: 1 },
      role: 'excavator', count: 1, note: 'Prime-mover excavator operator for a trucked EX circuit.', sheetRef: `${T}!E68 =IF(D68>0,1,0)` },
    { id: 'R3_EX_DOZERS', name: 'EX floor & dump dozers', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['excavator', 'shovel'], minTrucks: 1 },
      role: 'dumpDozer', count: 2, note: '1 floor / clean-up dozer at the face + 1 dump dozer at the tip head.', sheetRef: `${T}!E69 =IF(D68>0,2,0)` },
    { id: 'R4_LOADER_OPERATOR', name: 'Loader operator', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['loader'], minTrucks: 1 },
      role: 'loader', count: 1, note: 'Coal loader (WA900) operator.', sheetRef: `${T}!E75 =IF(D75>0,1,0)` },
    { id: 'R5_COAL_DOZER', name: 'Coal dozer', enabled: true, scope: 'per-circuit', when: { loaderTypes: ['loader'], minTrucks: 1 },
      role: 'coalDozer', count: 1, note: 'A coal circuit always needs its coal dozer (push-up / clean-up for the loader).', sheetRef: `${T}!E76 =IF(D75>0,1,0)` },
    { id: 'R6_SUPPORT_EX', name: 'Support excavator (EX03/EX08)', enabled: true, scope: 'per-circuit', when: { loaderUnitIds: ['LDR1'], minTrucks: 1 },
      role: 'excavator', count: 1, note: 'A coal circuit needs its supporting EX. Workbook keys this to LDR 1 only.', sheetRef: `${T}!E79 =IF(D75>0,1,0)` },
    { id: 'R7_BULK_PUSH', name: 'Bulk push dozers', enabled: true, scope: 'site', role: 'pushDozer', count: 6,
      expr: 'params.pushFleet - params.enabling - max(0, totals.trucks - params.maxTrucks)', params: { pushFleet: 7, enabling: 1, maxTrucks: 12 },
      priority: 4, bcmPerUnitDay: 18 * 320,
      note: 'Push fleet less enabling dozers; every truck above 12 takes a push-dozer operator. Task priority 4 (DZR), 18 h × 320 bcm/h per dozer.',
      sheetRef: `${T}!E47 =IF(E57>12,7-(E57-12)-E52,7-E52)` },
    { id: 'R8_PUSH_ASSIST', name: 'EX06 dozer-push assist', enabled: true, scope: 'site', role: 'excavator', count: 1, whenExpr: 'roles.pushDozer > 0',
      note: '“EX06 DZR Assist”: manned whenever bulk push dozers > 0.', sheetRef: `${T}!E82 =IF(E81>0,1,0)` },
    { id: 'R9_ENABLING_DOZERS', name: 'Enabling-task dozer', enabled: true, scope: 'site', role: 'pushDozer', count: 1,
      note: 'Dozer taken off push for enabling tasks (DR prep).', sheetRef: `${T}!E83 =$E$52` },
    { id: 'R10_WATER_CARTS', name: 'Water carts', enabled: true, scope: 'site', role: 'waterCart', count: 2, note: 'Fixed daily manning.', sheetRef: `${T}!E85` },
    { id: 'R10_GRADERS', name: 'Graders', enabled: true, scope: 'site', role: 'grader', count: 2, note: 'Fixed daily manning.', sheetRef: `${T}!E86` },
    { id: 'R10_SUPERVISORS', name: 'Supervisors', enabled: true, scope: 'site', role: 'supervisor', count: 2, note: 'Supervisors/OCE row = 3 (2 supervisors + 1 OCE, AG15:AG16).', sheetRef: `${T}!E87` },
    { id: 'R10_OCE', name: 'Open cut examiner', enabled: true, scope: 'site', role: 'oce', count: 1, note: 'Statutory: an OCE present whenever mining (CMSHR 2017 s.104).', sheetRef: `${T}!E87` },
  ];
}

/** A new blank rule for the editor. */
export function blankRule(id: string): Rule {
  return { id, name: 'New rule', enabled: true, scope: 'per-circuit', when: { minTrucks: 1 }, role: 'other', count: 1 };
}

/** Remove empty arrays / undefined so stored rules stay tidy. */
export function cleanCondition(w: CrewRuleCondition | undefined): CrewRuleCondition | undefined {
  if (!w) return undefined;
  const out: CrewRuleCondition = {};
  if (w.materialIds?.length) out.materialIds = w.materialIds;
  if (w.loaderTypes?.length) out.loaderTypes = w.loaderTypes;
  if (w.loaderUnitIds?.length) out.loaderUnitIds = w.loaderUnitIds;
  if (w.tags?.length) out.tags = w.tags;
  if (w.minTrucks != null && Number.isFinite(w.minTrucks)) out.minTrucks = w.minTrucks;
  return Object.keys(out).length ? out : undefined;
}
