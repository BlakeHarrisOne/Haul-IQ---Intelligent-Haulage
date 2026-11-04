/**
 * Generic crew-rule evaluator (CrewRule contract + CrewRuleExt derived rules).
 *
 * Scopes (only active circuits count):
 *   site               once (gated by `when`: any matching circuit with ≥ max(1, minTrucks) trucks; minTrucks alone → total trucks)
 *   per-circuit        each matching circuit with trucks ≥ minTrucks
 *   per-active-loader  each distinct loader unit on matching circuits with ≥ 1 truck
 *   per-material       each distinct material on matching circuits with ≥ 1 truck
 *   per-dump           each distinct dump fed by matching circuits with ≥ 1 truck
 *   per-truck          each matching circuit: count × ceil(trucks / perUnits)
 * Rules run in array order; `expr` (derived count) and `whenExpr` see roles.* / rules.* accumulated so far.
 * `overrides[ruleId]` replaces a rule's per-firing count (the workbook's typed what-if values, block 2).
 */
import type { CalcStep, CrewRole, CrewRule, Id, LoaderType, ManningLine, ManningResult, MaterialId, Scenario, ShiftCrew } from '@/core/types';
import type { CrewRuleExt } from '../types';
import { fmt, StepLog } from '../util/steps';
import { evalExpr } from './expr';

export const ROLES: CrewRole[] = ['truck', 'excavator', 'loader', 'pushDozer', 'dumpDozer', 'coalDozer', 'wheelDozer', 'waterCart', 'grader', 'supervisor', 'oce', 'utility', 'other'];

/** One circuit as the crew rules see it. */
export interface CrewCircuit {
  circuitId: Id;
  name?: string;
  loaderUnitId: string;
  loaderType: LoaderType;
  materialId: MaterialId;
  dumpId?: Id;
  trucks: number;
  priority?: number;
  tags?: string[];
}

export interface CrewEvalInput {
  circuits: CrewCircuit[];
  rules: CrewRule[];
  trucksAvailable: number;
  /** Crew available on the shift. */
  available: number;
  shift?: ShiftCrew;
  /** Per-firing count overrides by rule id. */
  overrides?: Record<string, number>;
}

export interface CrewEvalResult extends ManningResult {
  /** People contributed by each rule. */
  ruleCounts: Record<string, number>;
  /** People per circuit (lines with a circuitId). */
  byCircuit: Record<Id, number>;
  totalTrucks: number;
  warnings: string[];
}

const zeroRoles = () => Object.fromEntries(ROLES.map(r => [r, 0])) as Record<CrewRole, number>;

function matches(rule: CrewRule, c: CrewCircuit): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.materialIds?.length && !w.materialIds.includes(c.materialId)) return false;
  if (w.loaderTypes?.length && !w.loaderTypes.includes(c.loaderType)) return false;
  if (w.loaderUnitIds?.length && !w.loaderUnitIds.some(u => norm(u) === norm(c.loaderUnitId))) return false;
  if (w.tags?.length && !w.tags.some(t => c.tags?.includes(t))) return false;
  return true;
}
const norm = (u: string) => u.toUpperCase().replace(/\s+/g, '');
const hasFilters = (r: CrewRule) => !!(r.when?.materialIds?.length || r.when?.loaderTypes?.length || r.when?.loaderUnitIds?.length || r.when?.tags?.length);

const SCOPE_TEXT: Record<CrewRule['scope'], string> = {
  'site': 'site-wide', 'per-circuit': 'per circuit', 'per-active-loader': 'per active loader', 'per-material': 'per material',
  'per-dump': 'per dump', 'per-truck': 'per truck',
};

/**
 * Evaluate the crew rules for a set of circuits.
 * @param input circuits (active only), rules, trucks/crew available, overrides
 */
export function evaluateCrew(input: CrewEvalInput): CrewEvalResult {
  const required = zeroRoles();
  const lines: ManningLine[] = [];
  const ruleCounts: Record<string, number> = {};
  const byCircuit: Record<Id, number> = {};
  const warnings: string[] = [];
  const log = new StepLog();
  const circuits = input.circuits;
  const totalTrucks = circuits.reduce((a, c) => a + Math.max(0, c.trucks), 0);
  const working = circuits.filter(c => c.trucks > 0);
  const totals: Record<string, number> = {
    trucks: totalTrucks, circuits: working.length, activeLoaders: new Set(working.map(c => norm(c.loaderUnitId))).size,
  };
  for (const raw of input.rules) {
    const rule = raw as CrewRuleExt;
    if (!rule.enabled) continue;
    const firings: { c?: CrewCircuit; units: number; label: string }[] = [];
    const m = circuits.filter(c => matches(rule, c));
    const minT = rule.when?.minTrucks;
    switch (rule.scope) {
      case 'site': {
        const ok = hasFilters(rule)
          ? m.some(c => c.trucks >= Math.max(1, minT ?? 1))
          : minT == null || totalTrucks >= minT;
        if (ok) firings.push({ units: 1, label: 'site' });
        break;
      }
      case 'per-circuit':
        for (const c of m) if (c.trucks >= (minT ?? 0)) firings.push({ c, units: 1, label: c.name ?? c.loaderUnitId });
        break;
      case 'per-active-loader': {
        const seen = new Map<string, CrewCircuit>();
        for (const c of m) if (c.trucks >= Math.max(1, minT ?? 1) && !seen.has(norm(c.loaderUnitId))) seen.set(norm(c.loaderUnitId), c);
        for (const c of seen.values()) firings.push({ c, units: 1, label: c.loaderUnitId });
        break;
      }
      case 'per-material': {
        const seen = new Map<string, CrewCircuit>();
        for (const c of m) if (c.trucks >= Math.max(1, minT ?? 1) && !seen.has(c.materialId)) seen.set(c.materialId, c);
        for (const [mat] of seen) firings.push({ units: 1, label: mat });
        break;
      }
      case 'per-dump': {
        const seen = new Map<string, CrewCircuit>();
        for (const c of m) {
          const key = c.dumpId ?? `(no dump: ${c.circuitId})`;
          if (c.trucks >= Math.max(1, minT ?? 1) && !seen.has(key)) seen.set(key, c);
        }
        for (const [d] of seen) firings.push({ units: 1, label: d });
        break;
      }
      case 'per-truck': {
        const per = rule.perUnits && rule.perUnits > 0 ? rule.perUnits : 1;
        for (const c of m) if (c.trucks > 0 && c.trucks >= (minT ?? 0)) firings.push({ c, units: Math.ceil(c.trucks / per), label: c.name ?? c.loaderUnitId });
        break;
      }
    }
    let ruleTotal = 0;
    const parts: string[] = [];
    for (const f of firings) {
      const env = {
        lookup: (name: string): number | undefined => {
          const [ns, key] = name.split('.', 2);
          if (ns === 'totals') return totals[key];
          if (ns === 'fleet' && key === 'trucksAvailable') return input.trucksAvailable;
          if (ns === 'params') return rule.params?.[key];
          if (ns === 'roles') return required[key as CrewRole];
          if (ns === 'rules') return ruleCounts[key] ?? 0;
          if (ns === 'circuit') return key === 'trucks' ? f.c?.trucks : key === 'priority' ? f.c?.priority : undefined;
          return undefined;
        },
      };
      if (rule.whenExpr) {
        const g = safeEval(rule.whenExpr, env, warnings, rule.id);
        if (!g) continue;
      }
      const ov = input.overrides?.[rule.id];
      const per = ov != null ? ov : rule.expr ? safeEval(rule.expr, env, warnings, rule.id) : rule.count;
      const people = per * f.units;
      if (people < 0) warnings.push(`${rule.name}: evaluates to ${people} (negative; the workbook has no clamp at 0)`);
      required[rule.role] += people;
      ruleTotal += people;
      ruleCounts[rule.id] = (ruleCounts[rule.id] ?? 0) + people;
      if (f.c) byCircuit[f.c.circuitId] = (byCircuit[f.c.circuitId] ?? 0) + people;
      const why = ov != null ? `override ${ov}` : rule.expr ? `${rule.expr} = ${fmt(per)}` : `${rule.count}`;
      lines.push({
        circuitId: f.c?.circuitId, role: rule.role, count: people, ruleId: rule.id,
        reason: rule.scope === 'per-truck' ? `${f.label}: ${f.c?.trucks} trucks → ${people}` : `${rule.name}${f.label !== 'site' ? ` · ${f.label}` : ''} (${why})`,
      });
      parts.push(rule.scope === 'per-truck' ? `${f.label} ${people}` : `${f.label !== 'site' ? `${f.label} ` : ''}${fmt(per)}`);
    }
    log.add('manning', `manning.${rule.id}`, rule.name,
      `${SCOPE_TEXT[rule.scope]}${rule.when ? ` when ${condText(rule)}` : ''}${rule.whenExpr ? ` and ${rule.whenExpr}` : ''} → ${rule.expr ? rule.expr : `${rule.count}${rule.scope === 'per-truck' && (rule.perUnits ?? 1) > 1 ? ` per ${rule.perUnits} trucks` : ''}`} ${rule.role}`,
      ruleTotal, 'people', {
        substituted: firings.length ? parts.join(' + ') || '0' : 'does not fire',
        sheetRef: rule.sheetRef, note: rule.note,
        inputs: rule.params ? Object.entries(rule.params).map(([k, v]) => ({ label: k, value: v, source: 'Rule params' })) : undefined,
      });
  }
  const total = ROLES.reduce((a, r) => a + required[r], 0);
  const surplus = input.available - total;
  log.add('manning', 'manning.total', 'Total crew required', 'Σ people over all rules', total, 'people', {
    substituted: ROLES.filter(r => required[r]).map(r => `${r} ${required[r]}`).join(' + '), sheetRef: "'Targets & Haulage Priorities'!D88",
  });
  log.add('manning', 'manning.surplus', surplus >= 0 ? 'Crew surplus' : 'Crew shortfall', 'available − required', surplus, 'people', {
    substituted: `${input.available} − ${total}`, inputs: [{ label: 'Crew available', value: input.available, source: input.shift ? `Shift crew · ${input.shift.name}` : 'Input' }],
  });
  if (totalTrucks > input.trucksAvailable) warnings.push(`${totalTrucks} trucks assigned > ${input.trucksAvailable} available (Targets!E57 red).`);
  if (input.shift?.byRole) {
    for (const [role, cap] of Object.entries(input.shift.byRole) as [CrewRole, number][]) {
      if (cap != null && required[role] > cap) warnings.push(`${role}: ${required[role]} required > ${cap} ticketed on ${input.shift.name}.`);
    }
  }
  const steps: CalcStep[] = log.steps;
  for (const w of warnings) steps.push({ id: `manning.warn.${steps.length}`, group: 'manning', label: 'Check', formula: w, value: 0, unit: '' });
  return { required, total, available: input.available, surplus, lines, steps, ruleCounts, byCircuit, totalTrucks, warnings };
}

function condText(r: CrewRule): string {
  const w = r.when!;
  const parts: string[] = [];
  if (w.materialIds?.length) parts.push(`material ∈ {${w.materialIds.join(', ')}}`);
  if (w.loaderTypes?.length) parts.push(`loader ∈ {${w.loaderTypes.join(', ')}}`);
  if (w.loaderUnitIds?.length) parts.push(`unit ∈ {${w.loaderUnitIds.join(', ')}}`);
  if (w.tags?.length) parts.push(`tag ∈ {${w.tags.join(', ')}}`);
  if (w.minTrucks != null) parts.push(`trucks ≥ ${w.minTrucks}`);
  return parts.join(' ∧ ') || 'always';
}

function safeEval(src: string, env: { lookup: (n: string) => number | undefined }, warnings: string[], id: string): number {
  try {
    const r = evalExpr(src, env);
    if (r.unknown.length) warnings.push(`Rule ${id}: unknown identifier(s) ${r.unknown.join(', ')} treated as 0`);
    return r.value;
  } catch (e) {
    warnings.push(`Rule ${id}: ${(e as Error).message}`);
    return 0;
  }
}

/** Crew-rule view of the scenario's active circuits (optionally with trucks overridden per circuit). */
export function crewCircuits(scenario: Scenario, trucksOf?: (circuitId: Id) => number | undefined): CrewCircuit[] {
  return scenario.circuits.filter(c => c.active).map(c => ({
    circuitId: c.id, name: c.name, loaderUnitId: c.loaderUnitId,
    loaderType: scenario.fleet.loaders.find(l => l.id === c.loaderModelId)?.type ?? (/^LDR/i.test(c.loaderUnitId) ? 'loader' : 'excavator'),
    materialId: c.materialId, dumpId: c.dumpId, trucks: trucksOf?.(c.id) ?? c.trucks, priority: c.priority, tags: c.tags,
  }));
}
