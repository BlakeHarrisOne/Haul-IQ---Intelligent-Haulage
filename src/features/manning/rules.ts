/**
 * Crew rules as readable sentences + the workbook's rule set ('Targets & Haulage Priorities' rows 47, 65-88),
 * expressed with the CrewRule contract. Pure TS (unit-tested in rules.test.ts).
 */
import type { CrewRole, CrewRule, CrewRuleCondition, LoaderType, Material, RuleScope } from '@/core/types';
import type { CrewRuleExt } from '@/engine';
import { defaultCrewRules } from '@/data';
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
  // operators first (identifiers never contain them), then identifiers → words
  return src
    .replace(/\s*-\s*/g, ' − ').replace(/\s*\*\s*/g, ' × ').replace(/\s*>=\s*/g, ' ≥ ').replace(/\s*<=\s*/g, ' ≤ ')
    .replace(/\s*&&\s*/g, ' and ').replace(/\s*\|\|\s*/g, ' or ').replace(/\s*!=\s*/g, ' ≠ ').replace(/\s*==\s*/g, ' = ')
    .replace(/\(\s*− /g, '(−')
    .replace(/[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+/g, id => {
      if (ID_WORDS[id]) return ID_WORDS[id];
      const [ns, key] = id.split('.', 2);
      if (ns === 'params') return rule.params?.[key] != null ? String(rule.params[key]) : key;
      if (ns === 'roles') return ROLE_META[key as CrewRole]?.short.toLowerCase() ?? key;
      if (ns === 'rules') return ctx?.rules?.find(r => r.id === key)?.name.toLowerCase() ?? key;
      return id;
    });
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
 * The workbook manning rules (spec 01 §9.5, R1-R10): the data module's defaults, so "Reset to workbook rules"
 * restores exactly what a new scenario starts with. Totals for the linked plan (EX09 5, EX04 4, LDR1 3 trucks,
 * 1 enabling dozer) = 36, matching Targets!D88. R7 (bulk push = 7 − enabling − max(0, trucks − 12)) uses the
 * engine's derived-rule `expr` and is a prioritised site task (DZR priority 4); R8 is gated by `whenExpr`.
 */
export function workbookRules(): Rule[] {
  return defaultCrewRules() as Rule[];
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
