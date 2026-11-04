/**
 * hAIul insight engine - deterministic, explainable "AI": every card is a rule over engine results with the numbers
 * behind it, a ranked severity and concrete actions (pure scenario transforms). Pure TS, no DOM (insights.test.ts).
 */
import type {
  Circuit, CircuitResult, FleetOption, Id, ManningResult, PriorityResult, Scenario, ShiftState,
} from '@/core/types';
import { num, signed } from '@/core/format';

export type Severity = 'critical' | 'warning' | 'opportunity' | 'info';
export type InsightKind =
  | 'fleet-over-limit' | 'fleet-idle' | 'under-trucked' | 'over-trucked' | 'deliberate' | 'transfer' | 'spare-trucks'
  | 'crew-shortfall' | 'crew-surplus' | 'role-cap' | 'spreadsheet-drop' | 'steep-grade' | 'pt-below-min'
  | 'dig-exhausted' | 'dump-full' | 'haul-option';

export interface InsightFigure { label: string; value: string; tone?: 'ok' | 'bad' | 'warn' }
/** One line of the "Explain" expansion: label, formula with numbers, result. */
export interface InsightLine { label: string; formula?: string; value: string }

export type InsightTarget =
  | { kind: 'circuit'; id: Id }
  | { kind: 'string'; id: Id; pointIndex?: number }
  | { kind: 'asset'; id: Id };

export type InsightAction =
  | { kind: 'apply'; label: string; commitLabel: string; apply: (s: Scenario) => Scenario }
  | { kind: 'show'; label: string; target: InsightTarget }
  | { kind: 'view'; label: string; view: 'priority' | 'manning' | 'assumptions' };

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  /** Ranking score (higher first): severity band + impact in bcm/day. */
  score: number;
  /** bcm/day at stake (positive = gain available / loss avoided). */
  impactBcmDay: number;
  headline: string;
  detail?: string;
  circuitId?: Id;
  figures: InsightFigure[];
  explain: InsightLine[];
  actions: InsightAction[];
}

export interface InsightOptions {
  /** Minimum planned loader PT hours/day (the 18 h rule). */
  minPtHrsDay: number;
  /** Design maximum haul grade (fraction). */
  maxGrade: number;
  /** Spreadsheet speed table range: |ROUND(grade,2)| above this is dropped (0 s). */
  tableMaxGrade: number;
  /** Ignore truck transfers / options worth less than this (bcm/day). */
  minGainBcmDay: number;
  /** Lost PT h/shift considered critical. */
  criticalLostPtHrs: number;
}

export const DEFAULT_INSIGHT_OPTIONS: InsightOptions = {
  minPtHrsDay: 18, maxGrade: 0.10, tableMaxGrade: 0.16, minGainBcmDay: 250, criticalLostPtHrs: 2,
};

export interface InsightInput {
  scenario: Scenario;
  results: Record<Id, CircuitResult>;
  manning?: ManningResult;
  priority?: PriorityResult;
  /** Shift state at the end of the shift (dig/dump fractions). */
  shiftEnd?: ShiftState;
  /** Shift state at any minute - used to find when a block runs out. */
  shiftAt?: (tMin: number) => ShiftState;
  /** Re-evaluate a circuit at another truck count / haul string (normally engine computeCircuit). */
  evalCircuit?: (c: Circuit, opts: { trucks?: number; haulStringId?: Id }) => CircuitResult;
  options?: Partial<InsightOptions>;
}

const SEV_BAND: Record<Severity, number> = { critical: 4e9, warning: 3e9, opportunity: 2e9, info: 1e9 };
export const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'opportunity', 'info'];

/** Excel ROUND(x, 2): half away from zero on the 15-significant-digit value (spec 01 §5.2). */
export function excelRound2(x: number): number {
  const a = Number(Math.abs(x).toPrecision(15));
  return Math.sign(x) * Math.round(a * 100 + 1e-9) / 100;
}

/** True when the circuit carries a 'deliberate' tag (planner chose to over-/under-truck it on purpose). */
export const isDeliberate = (c: Circuit) => !!c.tags?.some(t => t === 'deliberate' || t.startsWith('deliberate:'));
export const deliberateNote = (c: Circuit) => c.tags?.find(t => t.startsWith('deliberate:'))?.slice('deliberate:'.length).trim() || undefined;

/** Production option for `n` trucks, from the result's table or by re-evaluating the circuit. */
export function optionAt(r: CircuitResult, c: Circuit, n: number, evalCircuit?: InsightInput['evalCircuit']): FleetOption | undefined {
  if (n <= 0) return { ...(r.options[0] ?? r.assigned), trucks: 0, truckCapacityBcmDay: 0, bcmPerDay: 0, loaderPtHrsDay: 0, matchFactor: 0, loaderUtil: 0, truckQueueHrsShift: 0, lostLoaderPtHrsShift: r.loaderPtHrs / (c.params.shiftsPerDay || 2), status: 'under' };
  const hit = r.options.find(o => o.trucks === n);
  if (hit) return hit;
  if (n === c.trucks) return r.assigned;
  return evalCircuit?.(c, { trucks: n }).assigned;
}
export const bcmAt = (r: CircuitResult, c: Circuit, n: number, ev?: InsightInput['evalCircuit']) => optionAt(r, c, n, ev)?.bcmPerDay ?? 0;

/** Loader-limited potential production (the best any truck count achieves). */
export function potentialBcm(r: CircuitResult): number {
  return r.options.reduce((m, o) => Math.max(m, o.bcmPerDay), r.assigned.bcmPerDay);
}

/** Smallest truck count that reaches (within 0.5 %) the circuit's potential. */
export function trucksForPotential(r: CircuitResult): number {
  const pot = potentialBcm(r);
  const o = r.options.find(x => x.bcmPerDay >= pot * 0.995);
  return o?.trucks ?? r.trucksRecommended;
}

const setTrucks = (id: Id, n: number) => (s: Scenario): Scenario => ({ ...s, circuits: s.circuits.map(c => (c.id === id ? { ...c, trucks: n } : c)) });
const short = (c: Circuit) => c.loaderUnitId || c.name;
const kbcm = (v: number) => (Math.abs(v) >= 10000 ? `${num(v / 1000, 1)}k` : num(v, 0));

export function generateInsights(input: InsightInput): Insight[] {
  const o: InsightOptions = { ...DEFAULT_INSIGHT_OPTIONS, ...input.options };
  const { scenario: s, results } = input;
  const out: Insight[] = [];
  const push = (i: Omit<Insight, 'score'>) => out.push({ ...i, score: SEV_BAND[i.severity] + Math.max(0, i.impactBcmDay) });

  const active = s.circuits.filter(c => c.active && results[c.id]?.ok).sort((a, b) => a.priority - b.priority);
  const R = (c: Circuit) => results[c.id];
  const trucksUsed = active.reduce((a, c) => a + c.trucks, 0);
  const avail = s.fleet.trucksAvailable;
  const spare = avail - trucksUsed;

  // ── fleet vs available (workbook E57 red/green, AJ5 "highlight yellow if under-trucked")
  if (trucksUsed > avail) {
    const over = trucksUsed - avail;
    const last = active[active.length - 1];
    push({
      id: 'fleet-over-limit', kind: 'fleet-over-limit', severity: 'critical', impactBcmDay: 0,
      headline: `Plan needs ${trucksUsed} trucks but only ${avail} are available`,
      detail: `${over} truck${over > 1 ? 's' : ''} short. The workbook flags this red (Targets!E57 > 12). The lowest-priority circuit (${last ? short(last) : '–'}) gives first.`,
      figures: [{ label: 'Assigned', value: String(trucksUsed), tone: 'bad' }, { label: 'Available', value: String(avail) }, { label: 'Short', value: String(over), tone: 'bad' }],
      explain: [
        ...active.map(c => ({ label: `${short(c)} (P${c.priority})`, value: `${c.trucks} trucks` })),
        { label: 'Total assigned', formula: active.map(c => c.trucks).join(' + '), value: String(trucksUsed) },
      ],
      actions: [{ kind: 'view', label: 'Open priority plan', view: 'priority' }],
    });
  } else if (spare > 0 && active.length) {
    // best place for the idle trucks (greedy marginal gain)
    const adds: Record<Id, number> = {};
    let gain = 0;
    const lines: InsightLine[] = [];
    for (let k = 0; k < spare; k++) {
      let best: { c: Circuit; g: number } | undefined;
      for (const c of active) {
        const n = c.trucks + (adds[c.id] ?? 0);
        const g = bcmAt(R(c), c, n + 1, input.evalCircuit) - bcmAt(R(c), c, n, input.evalCircuit);
        if (g > (best?.g ?? 0.5)) best = { c, g };
      }
      if (!best) break;
      adds[best.c.id] = (adds[best.c.id] ?? 0) + 1;
      gain += best.g;
      lines.push({ label: `Truck ${k + 1} → ${short(best.c)}`, formula: `bcm(${best.c.trucks + adds[best.c.id]}) − bcm(${best.c.trucks + adds[best.c.id] - 1})`, value: `${signed(best.g, 0)} bcm/day` });
    }
    const ids = Object.keys(adds);
    if (ids.length && gain >= o.minGainBcmDay) {
      const names = ids.map(id => `${short(active.find(c => c.id === id)!)} +${adds[id]}`).join(', ');
      push({
        id: 'spare-trucks', kind: 'spare-trucks', severity: 'opportunity', impactBcmDay: gain,
        headline: `${spare} idle truck${spare > 1 ? 's' : ''}: put to work on ${names} → +${kbcm(gain)} bcm/day`,
        detail: 'Trucks available exceed trucks assigned (workbook note AJ5: under-trucked plan – prompts a haulage-strategy discussion).',
        figures: [{ label: 'Idle trucks', value: String(spare), tone: 'warn' }, { label: 'Gain', value: `+${kbcm(gain)} bcm/d`, tone: 'ok' }],
        explain: lines,
        actions: [{
          kind: 'apply', label: 'Assign', commitLabel: `Assign idle trucks (${names})`,
          apply: st => ({ ...st, circuits: st.circuits.map(c => (adds[c.id] ? { ...c, trucks: c.trucks + adds[c.id] } : c)) }),
        }],
      });
    } else {
      push({
        id: 'fleet-idle', kind: 'fleet-idle', severity: 'info', impactBcmDay: 0,
        headline: `${spare} truck${spare > 1 ? 's' : ''} idle – no circuit gains from ${spare > 1 ? 'them' : 'it'}`,
        detail: 'Every active circuit is at its loader limit. Consider starting a parked circuit or a long-haul option.',
        figures: [{ label: 'Idle trucks', value: String(spare) }], explain: [], actions: [{ kind: 'view', label: 'Open priority plan', view: 'priority' }],
      });
    }
  }

  // ── per circuit: trucking balance, PT minimum
  for (const c of active) {
    const r = R(c);
    const a = r.assigned;
    const pot = potentialBcm(r);
    const nPot = trucksForPotential(r);
    const deliberate = isDeliberate(c);
    const why = deliberateNote(c);
    if (c.trucks > 0 && a.status === 'under' && a.lostLoaderPtHrsShift > 0.05) {
      const lost = pot - a.bcmPerDay;
      const need = nPot - c.trucks;
      const canFix = need <= Math.max(0, spare);
      push({
        id: `under-${c.id}`, kind: deliberate ? 'deliberate' : 'under-trucked', circuitId: c.id,
        severity: deliberate ? 'info' : a.lostLoaderPtHrsShift >= o.criticalLostPtHrs ? 'critical' : 'warning',
        impactBcmDay: deliberate ? 0 : lost,
        headline: deliberate
          ? `${short(c)} deliberately under-trucked −${need}${why ? `: ${why}` : ''}`
          : `${short(c)} under-trucked: loader hangs ${num(a.lostLoaderPtHrsShift, 2)} h/shift, −${kbcm(lost)} bcm/day`,
        detail: `${c.trucks} trucks assigned vs ${num(r.trucksExact, 2)} needed (${nPot} for full rate).`,
        figures: [
          { label: 'Lost PT', value: `${num(a.lostLoaderPtHrsShift, 2)} h/shift`, tone: 'bad' },
          { label: 'Lost', value: `${kbcm(lost)} bcm/d`, tone: 'bad' },
          { label: 'Trucks', value: `${c.trucks} → ${nPot}` },
        ],
        explain: [
          { label: 'Trucks needed', formula: `${num(r.truckHoursReq, 1)} truck-h ÷ ${c.params.truckPtHrsPerDay} PT h`, value: num(r.trucksExact, 2) },
          { label: 'Truck capacity', formula: `${c.trucks} × ${c.params.truckPtHrsPerDay} h × ${num(r.truckProdBcmPerPtHr, 1)} bcm/h`, value: `${num(a.truckCapacityBcmDay, 0)} bcm/d` },
          { label: 'Loader capacity', formula: `min(${num(r.loaderPtHrs, 1)} h × ${num(c.params.plannedRateBcmPerPtHr, 0)}, ${num(c.params.desiredDailyBcm, 0)})`, value: `${num(pot, 0)} bcm/d` },
          { label: 'Loader PT lost / shift', formula: `(${num(r.loaderPtHrs, 2)} − ${num(a.loaderPtHrsDay, 2)}) ÷ ${c.params.shiftsPerDay}`, value: `${num(a.lostLoaderPtHrsShift, 2)} h` },
        ],
        actions: [
          ...(canFix && !deliberate ? [{ kind: 'apply' as const, label: `Set ${nPot} trucks`, commitLabel: `${short(c)} → ${nPot} trucks`, apply: setTrucks(c.id, nPot) }] : []),
          { kind: 'show', label: 'Show me', target: { kind: 'circuit', id: c.id } },
        ],
      });
    } else if (a.status === 'over' && a.truckQueueHrsShift > 0.05) {
      // smallest count with the same production
      let nMin = c.trucks;
      while (nMin > 1 && bcmAt(r, c, nMin - 1, input.evalCircuit) >= a.bcmPerDay - 1) nMin--;
      const extra = c.trucks - nMin;
      push({
        id: `over-${c.id}`, kind: deliberate ? 'deliberate' : 'over-trucked', circuitId: c.id,
        severity: deliberate ? 'info' : 'warning', impactBcmDay: 0,
        headline: deliberate
          ? `${short(c)} deliberately over-trucked +${extra}${why ? `: ${why}` : ': absorbs bunching'}`
          : `${short(c)} over-trucked by ${extra}: trucks queue ${num(a.truckQueueHrsShift, 2)} h/shift`,
        detail: `${extra} truck${extra === 1 ? '' : 's'} could move without losing production (match factor ${num(a.matchFactor, 2)}).`,
        figures: [
          { label: 'Queue', value: `${num(a.truckQueueHrsShift, 2)} h/shift`, tone: 'warn' },
          { label: 'Free', value: `${extra} truck${extra === 1 ? '' : 's'}` },
          { label: 'MF', value: num(a.matchFactor, 2) },
        ],
        explain: [
          { label: 'Truck capacity', formula: `${c.trucks} × ${c.params.truckPtHrsPerDay} h × ${num(r.truckProdBcmPerPtHr, 1)}`, value: `${num(a.truckCapacityBcmDay, 0)} bcm/d` },
          { label: 'Achieved (loader-limited)', value: `${num(a.bcmPerDay, 0)} bcm/d` },
          { label: 'Excess truck-hours / shift', formula: `(${num(a.truckCapacityBcmDay, 0)} − ${num(a.bcmPerDay, 0)}) ÷ ${num(r.truckProdBcmPerPtHr, 1)} ÷ ${c.params.shiftsPerDay}`, value: `${num(a.truckQueueHrsShift, 2)} h` },
        ],
        actions: [
          ...(!deliberate && extra > 0 ? [{ kind: 'apply' as const, label: `Release ${extra}`, commitLabel: `${short(c)} → ${nMin} trucks`, apply: setTrucks(c.id, nMin) }] : []),
          { kind: 'show', label: 'Show me', target: { kind: 'circuit', id: c.id } },
        ],
      });
    }

    // the 18 h PT minimum rule
    if (c.trucks > 0 && a.loaderPtHrsDay < o.minPtHrsDay - 0.01) {
      const fix = r.options.find(x => x.loaderPtHrsDay >= o.minPtHrsDay - 0.01);
      const plannedPt = r.loaderPtHrs;
      const reason = plannedPt < o.minPtHrsDay - 0.01 ? `planned PT is only ${num(plannedPt, 1)} h (desired volume ÷ rate)` : `${c.trucks} trucks cannot keep it loading`;
      push({
        id: `pt-${c.id}`, kind: 'pt-below-min', circuitId: c.id, severity: 'warning',
        impactBcmDay: (o.minPtHrsDay - a.loaderPtHrsDay) * c.params.plannedRateBcmPerPtHr,
        headline: `${short(c)} loader PT ${num(a.loaderPtHrsDay, 1)} h/day – below the ${o.minPtHrsDay} h minimum`,
        detail: `Rule: prime loaders plan ≥ ${o.minPtHrsDay} PT h/day. Here ${reason}.`,
        figures: [{ label: 'PT/day', value: `${num(a.loaderPtHrsDay, 1)} h`, tone: 'bad' }, { label: 'Minimum', value: `${o.minPtHrsDay} h` },
          ...(fix ? [{ label: 'Trucks for 18 h', value: String(fix.trucks) }] : [])],
        explain: [
          { label: 'Loader PT achieved', formula: `${num(a.bcmPerDay, 0)} bcm ÷ ${num(c.params.plannedRateBcmPerPtHr, 0)} bcm/h`, value: `${num(a.loaderPtHrsDay, 2)} h` },
          { label: 'Planned loader PT', formula: `${num(c.params.desiredDailyBcm, 0)} ÷ ${num(c.params.plannedRateBcmPerPtHr, 0)}`, value: `${num(plannedPt, 2)} h` },
        ],
        actions: [
          ...(fix && fix.trucks !== c.trucks && fix.trucks - c.trucks <= Math.max(0, spare) ? [{ kind: 'apply' as const, label: `Set ${fix.trucks} trucks`, commitLabel: `${short(c)} → ${fix.trucks} trucks (18 h PT)`, apply: setTrucks(c.id, fix.trucks) }] : []),
          { kind: 'show', label: 'Show me', target: { kind: 'circuit', id: c.id } },
        ],
      });
    }

    // segments: spreadsheet drop (> ±16 %) and steeper than design max (10 %)
    const drops = r.segments.filter(g => Math.abs(excelRound2(g.grade)) > o.tableMaxGrade + 1e-9);
    const steep = r.segments.filter(g => Math.abs(g.grade) > o.maxGrade + 1e-9 && !drops.includes(g));
    const hsId = c.haulStringId;
    if (drops.length && hsId) {
      const m = drops.reduce((acc, g) => acc + g.dist3dM, 0);
      const dropsLive = c.params.speedModel === 'spreadsheet' && (c.params as { outOfRange?: string }).outOfRange !== 'clamp';
      push({
        id: `drop-${c.id}`, kind: 'spreadsheet-drop', circuitId: c.id, severity: dropsLive ? 'warning' : 'info', impactBcmDay: 0,
        headline: `Spreadsheet would drop ${drops.length} segment${drops.length > 1 ? 's' : ''} (${num(m, 1)} m) on ${short(c)}'s haul`,
        detail: `|ROUND(grade, 2)| > ${Math.round(o.tableMaxGrade * 100)}% is outside the speed table: Excel times it as 0 s (quirk Q3). ${dropsLive ? 'This circuit uses that behaviour now – switch to clamp or rimpull mode.' : 'This circuit clamps or uses physics, so its times are complete.'}`,
        figures: [{ label: 'Segments', value: String(drops.length), tone: 'warn' }, { label: 'Length', value: `${num(m, 1)} m` },
          { label: 'Steepest', value: `${num(Math.max(...drops.map(g => Math.abs(g.grade))) * 100, 1)}%`, tone: 'bad' }],
        explain: drops.slice(0, 6).map(g => ({ label: `Seg ${g.i + 1} @ ch ${num(g.chainageM, 0)} m`, formula: `ROUND(${num(g.grade, 4)}, 2) = ${num(excelRound2(g.grade), 2)}`, value: `${num(g.dist3dM, 1)} m → 0 s` })),
        actions: [{ kind: 'show', label: 'Show me', target: { kind: 'string', id: hsId, pointIndex: drops[0].i } }],
      });
    }
    if (steep.length && hsId) {
      const m = steep.reduce((acc, g) => acc + g.dist3dM, 0);
      const worst = steep.reduce((w, g) => (Math.abs(g.grade) > Math.abs(w.grade) ? g : w), steep[0]);
      push({
        id: `steep-${c.id}`, kind: 'steep-grade', circuitId: c.id, severity: 'warning', impactBcmDay: 0,
        headline: `${num(m, 0)} m of ${short(c)}'s haul is steeper than ${Math.round(o.maxGrade * 100)}% (max ${num(Math.abs(worst.grade) * 100, 1)}%)`,
        detail: 'Exceeds the design ramp grade – slower loaded speeds, retarder load and spillage. Check the string or the ramp design.',
        figures: [{ label: 'Segments', value: String(steep.length), tone: 'warn' }, { label: 'Length', value: `${num(m, 0)} m` }],
        explain: steep.slice(0, 6).map(g => ({ label: `Seg ${g.i + 1} @ ch ${num(g.chainageM, 0)} m`, formula: `ΔZ ÷ L = ${num(g.grade * 100, 1)}%`, value: `${num(g.dist3dM, 1)} m` })),
        actions: [{ kind: 'show', label: 'Show me', target: { kind: 'string', id: hsId, pointIndex: worst.i } }],
      });
    }

    // haul options (long / short) at the same trucks
    if (input.evalCircuit && c.altHaulStringIds?.length) {
      let best: { id: Id; name: string; bcm: number; need: number; delta: number; trucksSaved: number; cyc: number } | undefined;
      for (const alt of c.altHaulStringIds) {
        const hs = s.strings.find(x => x.id === alt);
        if (!hs) continue;
        const ar = input.evalCircuit(c, { haulStringId: alt, trucks: c.trucks });
        if (!ar.ok) continue;
        const need = trucksForPotential(ar);
        const delta = ar.assigned.bcmPerDay - a.bcmPerDay;
        const trucksSaved = nPot - need;
        const cand = { id: alt, name: hs.name, bcm: ar.assigned.bcmPerDay, need, delta, trucksSaved, cyc: ar.cycleMin };
        const val = (x: typeof cand) => x.delta + x.trucksSaved * 1000;
        if (!best || val(cand) > val(best)) best = cand;
      }
      if (best && (best.delta >= o.minGainBcmDay || best.trucksSaved > 0)) {
        const b = best;
        push({
          id: `option-${c.id}`, kind: 'haul-option', circuitId: c.id, severity: 'opportunity', impactBcmDay: Math.max(0, b.delta),
          headline: b.delta >= o.minGainBcmDay
            ? `${short(c)}: “${b.name}” → +${kbcm(b.delta)} bcm/day at ${c.trucks} trucks`
            : `${short(c)}: “${b.name}” reaches full rate with ${b.need} trucks (saves ${b.trucksSaved})`,
          detail: `Cycle ${num(r.cycleMin, 1)} → ${num(b.cyc, 1)} min. Production ≠ plan: check the dig/dump sequence still holds.`,
          figures: [{ label: 'Δ bcm/day', value: signed(b.delta, 0), tone: b.delta >= 0 ? 'ok' : 'bad' }, { label: 'Trucks for full rate', value: `${nPot} → ${b.need}` }],
          explain: [
            { label: 'Current route', formula: `${num(r.cycleMin, 2)} min cycle`, value: `${num(a.bcmPerDay, 0)} bcm/d` },
            { label: 'Option', formula: `${num(b.cyc, 2)} min cycle`, value: `${num(b.bcm, 0)} bcm/d` },
          ],
          actions: [
            { kind: 'apply', label: 'Use this option', commitLabel: `${short(c)} → ${b.name}`, apply: applyHaulOption(c.id, b.id) },
            { kind: 'show', label: 'Show me', target: { kind: 'string', id: b.id } },
          ],
        });
      }
    }
  }

  // ── truck transfers (move 1 truck A → B) when no trucks are idle
  if (spare <= 0 && active.length > 1) {
    const cands: { from: Circuit; to: Circuit; gain: number; loss: number; net: number }[] = [];
    for (const from of active) {
      if (from.trucks <= 0) continue;
      const loss = bcmAt(R(from), from, from.trucks, input.evalCircuit) - bcmAt(R(from), from, from.trucks - 1, input.evalCircuit);
      for (const to of active) {
        if (to === from) continue;
        const gain = bcmAt(R(to), to, to.trucks + 1, input.evalCircuit) - bcmAt(R(to), to, to.trucks, input.evalCircuit);
        const net = gain - loss;
        if (net >= o.minGainBcmDay) cands.push({ from, to, gain, loss, net });
      }
    }
    cands.sort((x, y) => y.net - x.net);
    const used = new Set<Id>();
    for (const t of cands) {
      if (used.has(t.from.id) || used.has(t.to.id)) continue;
      used.add(t.from.id); used.add(t.to.id);
      const prioNote = t.from.priority < t.to.priority ? ` – note ${short(t.from)} is higher priority (P${t.from.priority})` : '';
      push({
        id: `transfer-${t.from.id}-${t.to.id}`, kind: 'transfer', circuitId: t.to.id, severity: 'opportunity', impactBcmDay: t.net,
        headline: `Move 1 truck ${short(t.from)} → ${short(t.to)}: +${kbcm(t.net)} bcm/day net`,
        detail: `${short(t.to)} gains ${kbcm(t.gain)}, ${short(t.from)} loses ${kbcm(t.loss)} bcm/day${prioNote}.`,
        figures: [{ label: 'Net', value: `+${kbcm(t.net)} bcm/d`, tone: 'ok' }, { label: short(t.to), value: `${t.to.trucks} → ${t.to.trucks + 1}` }, { label: short(t.from), value: `${t.from.trucks} → ${t.from.trucks - 1}` }],
        explain: [
          { label: `${short(t.to)} gain`, formula: `bcm(${t.to.trucks + 1}) − bcm(${t.to.trucks})`, value: `+${num(t.gain, 0)}` },
          { label: `${short(t.from)} loss`, formula: `bcm(${t.from.trucks}) − bcm(${t.from.trucks - 1})`, value: `−${num(t.loss, 0)}` },
          { label: 'Net', value: `+${num(t.net, 0)} bcm/d` },
        ],
        actions: [{
          kind: 'apply', label: 'Move truck', commitLabel: `Move 1 truck ${short(t.from)} → ${short(t.to)}`,
          apply: st => ({ ...st, circuits: st.circuits.map(c => (c.id === t.from.id ? { ...c, trucks: c.trucks - 1 } : c.id === t.to.id ? { ...c, trucks: c.trucks + 1 } : c)) }),
        }],
      });
      if (used.size >= 4) break;
    }
  }

  // ── crew
  const m = input.manning;
  const shift = s.crew.shifts.find(x => x.id === s.crew.activeShiftId);
  if (m && m.available > 0) {
    const p = input.priority;
    if (m.surplus < 0) {
      const cut = p?.allocations.filter(x => x.status !== 'full').sort((x, y) => y.priority - x.priority) ?? [];
      const tasks = ((p as { tasks?: { ruleId: string; name: string; priority: number; requested: number; allocated: number; bcmDayLost: number }[] } | undefined)?.tasks ?? [])
        .filter(t => t.allocated < t.requested);
      const lost = cut.reduce((acc, x) => acc + x.bcmDayLost, 0) + tasks.reduce((acc, t) => acc + t.bcmDayLost, 0);
      const parts = [
        ...tasks.map(t => ({ prio: t.priority, txt: `${t.name} (P${t.priority}) ${t.requested} → ${t.allocated}` })),
        ...cut.map(x => {
          const c = s.circuits.find(cc => cc.id === x.circuitId);
          return { prio: x.priority, txt: `${c ? short(c) : x.circuitId} (P${x.priority}) ${x.status === 'parked' ? 'parked' : `cut to ${x.allocatedTrucks} truck${x.allocatedTrucks === 1 ? '' : 's'}`}` };
        }),
      ].sort((a, b) => b.prio - a.prio);
      const cutTxt = parts.length ? parts.map(x => x.txt).join(', ') : 'the lowest-priority circuit gives first';
      push({
        id: 'crew-shortfall', kind: 'crew-shortfall', severity: 'critical', impactBcmDay: lost,
        headline: `Crew short by ${-m.surplus}${shift ? ` on ${shift.name}` : ''}: ${cutTxt}`,
        detail: lost > 0 ? `Priority plan loses ${kbcm(lost)} bcm/day before long/short-haul options are considered.` : 'Re-order priorities or find operators (overtime, cross-skilled).',
        figures: [{ label: 'Required', value: String(m.total), tone: 'bad' }, { label: 'Available', value: String(m.available) }, ...(lost > 0 ? [{ label: 'Lost', value: `${kbcm(lost)} bcm/d`, tone: 'bad' as const }] : [])],
        explain: [
          { label: 'Crew required', formula: 'Σ rule lines', value: String(m.total) },
          { label: 'Crew available', value: String(m.available) },
          ...(p?.narrative ?? []).slice(0, 6).map(t => ({ label: t, value: '' })),
        ],
        actions: [
          ...(p && (p.allocations.some(x => x.allocatedTrucks !== x.requestedTrucks) || (p.tasks ?? []).some(t => t.allocated < t.requested)) ? [{
            kind: 'apply' as const, label: 'Apply allocation', commitLabel: 'Apply crew-limited allocation',
            // the whole plan, as on the Priority view: trucks per circuit AND caps for stood-down site tasks (e2e D4)
            apply: (st: Scenario) => {
              const taskCaps: Record<string, number> = {};
              for (const t of p.tasks ?? []) if (t.allocated < t.requested) taskCaps[t.ruleId] = t.allocated;
              return {
                ...st,
                circuits: st.circuits.map(c => { const al = p.allocations.find(x => x.circuitId === c.id); return al ? { ...c, trucks: al.allocatedTrucks } : c; }),
                crew: { ...st.crew, taskCaps: Object.keys(taskCaps).length ? taskCaps : undefined },
              };
            },
          }] : []),
          { kind: 'view', label: 'Priority plan', view: 'priority' },
        ],
      });
    } else if (m.surplus >= 3) {
      push({
        id: 'crew-surplus', kind: 'crew-surplus', severity: 'info', impactBcmDay: 0,
        headline: `${m.surplus} operators spare${shift ? ` on ${shift.name}` : ''}`,
        detail: 'Enough to start a parked circuit or run an enabling task – check the trucks available first.',
        figures: [{ label: 'Required', value: String(m.total) }, { label: 'Available', value: String(m.available) }, { label: 'Spare', value: String(m.surplus), tone: 'ok' }],
        explain: [], actions: [{ kind: 'view', label: 'Manning', view: 'manning' }],
      });
    }
    // per-role caps (tickets)
    if (shift?.byRole) {
      for (const [role, cap] of Object.entries(shift.byRole)) {
        const need = m.required[role as keyof typeof m.required] ?? 0;
        if (cap != null && need > cap) {
          push({
            id: `cap-${role}`, kind: 'role-cap', severity: 'warning', impactBcmDay: 0,
            headline: `${need} ${role} operators needed, only ${cap} ticketed on ${shift.name}`,
            figures: [{ label: 'Needed', value: String(need), tone: 'bad' }, { label: 'Ticketed', value: String(cap) }],
            explain: m.lines.filter(l => l.role === role).map(l => ({ label: l.reason, value: `+${l.count}` })),
            actions: [{ kind: 'view', label: 'Manning', view: 'manning' }],
          });
        }
      }
    }
  }

  // ── dig blocks exhausted / dumps full within the shift
  if (input.shiftEnd) {
    const lenMin = s.shift.lengthH * 60;
    const when = (pick: (st: ShiftState) => number | undefined) => {
      if (!input.shiftAt) return undefined;
      let lo = 0, hi = lenMin;
      for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if ((pick(input.shiftAt(mid)) ?? 0) >= 1) hi = mid; else lo = mid; }
      return hi;
    };
    const clockAt = (tMin: number) => {
      const t = Math.round(s.shift.startHour * 60 + tMin) % 1440;
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    for (const pc of input.shiftEnd.perCircuit) {
      const c = s.circuits.find(x => x.id === pc.circuitId);
      if (!c || !c.active || c.trucks <= 0) continue;
      const blocks: [InsightKind, number, Id | undefined, string][] = [
        ['dig-exhausted', pc.digFraction, c.digId, 'dig block exhausted'],
        ['dump-full', pc.dumpFraction, c.dumpId, 'dump full'],
      ];
      for (const [kind, frac, assetId, what] of blocks) {
        if (!(frac >= 1) || !assetId) continue;
        const t = when(st => st.perCircuit.find(x => x.circuitId === c.id)?.[kind === 'dig-exhausted' ? 'digFraction' : 'dumpFraction']);
        const asset = s.assets.find(x => x.id === assetId);
        const nm = asset?.name ?? assetId;
        push({
          id: `${kind}-${c.id}`, kind, circuitId: c.id, severity: 'warning', impactBcmDay: 0,
          headline: `${short(c)}: ${nm} ${what}${t != null ? ` at ${clockAt(t)}` : ' before end of shift'}`,
          detail: kind === 'dig-exhausted' ? 'Plan the relocation (or the next block) before the loader runs out of dig.' : 'Open the next tip head or re-route before the dump fills.',
          figures: [{ label: kind === 'dig-exhausted' ? 'Dug' : 'Filled', value: `${num(frac * 100, 0)}%`, tone: 'warn' }, ...(t != null ? [{ label: 'At', value: clockAt(t) }] : [])],
          explain: [{ label: 'Shift volume', formula: `${num(pc.bcmShift, 0)} bcm`, value: `${num(frac * 100, 0)}% of block` }],
          actions: [{ kind: 'show', label: 'Show me', target: { kind: 'asset', id: assetId } }],
        });
      }
    }
  }

  return out.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}

/** Swap a circuit onto an alternative haul string (the old main route becomes an alternative). */
export function applyHaulOption(circuitId: Id, altId: Id) {
  return (s: Scenario): Scenario => ({
    ...s,
    circuits: s.circuits.map(c => {
      if (c.id !== circuitId) return c;
      const alts = (c.altHaulStringIds ?? []).filter(x => x !== altId);
      if (c.haulStringId && c.haulStringId !== altId) alts.unshift(c.haulStringId);
      return { ...c, haulStringId: altId, altHaulStringIds: alts };
    }),
  });
}

export const SEVERITY_META: Record<Severity, { label: string; tone: 'bad' | 'warn' | 'ok' | 'info' }> = {
  critical: { label: 'Critical', tone: 'bad' },
  warning: { label: 'Warning', tone: 'warn' },
  opportunity: { label: 'Opportunity', tone: 'ok' },
  info: { label: 'Info', tone: 'info' },
};
