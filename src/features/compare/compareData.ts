/** Pure helpers for the Compare tab (unit-tested): circuit rows, totals, scenario KPIs and cross-scenario matching. */
import type { Circuit, CircuitResult, FleetOption, Id, Scenario } from '@/core/types';

/** The user's rule: every loader must achieve at least this many PT hours per day. */
export const MIN_PT_HRS_DAY = 18;

export interface CircuitRow {
  id: Id;
  name: string;
  color: string;
  active: boolean;
  loader: string;
  truck: string;
  material: string;
  route?: string;
  haulKm: number;
  riseM: number;
  fallM: number;
  cycleMin: number;
  assigned: number;
  exact: number;
  recommended: number;
  truckPtHrsDay: number;
  loaderPtTarget: number;
  loaderPtHrsDay: number;
  lostPtShift: number;
  queueHrsShift: number;
  matchFactor: number;
  bcmDay: number;
  targetBcmDay: number;
  status: FleetOption['status'] | 'error';
  ok: boolean;
  error?: string;
}

export function circuitRow(sc: Scenario, c: Circuit, r: CircuitResult | undefined, opt?: FleetOption): CircuitRow {
  const truck = sc.fleet.trucks.find(t => t.id === c.truckModelId);
  const mat = sc.materials.find(m => m.id === c.materialId);
  const hs = sc.strings.find(s => s.id === c.haulStringId);
  const a = opt ?? r?.assigned;
  const ok = !!r?.ok;
  return {
    id: c.id, name: c.name, color: c.color, active: c.active, loader: c.loaderUnitId, truck: truck?.name ?? c.truckModelId, material: mat?.name ?? c.materialId,
    route: hs?.name,
    haulKm: ok ? r!.lengthM / 1000 : NaN, riseM: ok ? r!.riseM : NaN, fallM: ok ? r!.fallM : NaN, cycleMin: ok ? r!.cycleMin : NaN,
    assigned: opt?.trucks ?? c.trucks, exact: ok ? r!.trucksExact : NaN, recommended: ok ? r!.trucksRecommended : NaN,
    truckPtHrsDay: c.params.truckPtHrsPerDay,
    loaderPtTarget: ok ? r!.loaderPtHrs : NaN,
    loaderPtHrsDay: ok && a ? a.loaderPtHrsDay : NaN,
    lostPtShift: ok && a ? a.lostLoaderPtHrsShift : NaN,
    queueHrsShift: ok && a ? a.truckQueueHrsShift : NaN,
    matchFactor: ok && a ? a.matchFactor : NaN,
    bcmDay: ok && a ? a.bcmPerDay : 0,
    targetBcmDay: c.params.desiredDailyBcm,
    status: ok && a ? a.status : 'error',
    ok, error: r?.error,
  };
}

export function circuitRows(sc: Scenario, results: Record<Id, CircuitResult>): CircuitRow[] {
  return sc.circuits.map(c => circuitRow(sc, c, results[c.id]));
}

export interface Totals {
  trucksAssigned: number;
  trucksExact: number;
  trucksRecommended: number;
  trucksAvailable: number;
  bcmDay: number;
  targetBcmDay: number;
  lostPtShift: number;
  queueHrsShift: number;
  belowMinPt: number;
  activeCircuits: number;
  haulKm: number;
  avgCycleMin: number;
}

const fin = (v: number) => (Number.isFinite(v) ? v : 0);

export function totals(rows: CircuitRow[], trucksAvailable: number): Totals {
  const act = rows.filter(r => r.active);
  const loads = act.reduce((a, r) => a + (r.ok ? r.assigned : 0), 0);
  return {
    trucksAssigned: act.reduce((a, r) => a + r.assigned, 0),
    trucksExact: act.reduce((a, r) => a + fin(r.exact), 0),
    trucksRecommended: act.reduce((a, r) => a + fin(r.recommended), 0),
    trucksAvailable,
    bcmDay: act.reduce((a, r) => a + fin(r.bcmDay), 0),
    targetBcmDay: act.reduce((a, r) => a + fin(r.targetBcmDay), 0),
    lostPtShift: act.reduce((a, r) => a + fin(r.lostPtShift), 0),
    queueHrsShift: act.reduce((a, r) => a + fin(r.queueHrsShift), 0),
    belowMinPt: act.filter(r => r.ok && r.loaderPtHrsDay < MIN_PT_HRS_DAY - 1e-9).length,
    activeCircuits: act.length,
    haulKm: act.reduce((a, r) => a + fin(r.haulKm), 0),
    // truck-weighted mean cycle (what the fleet experiences)
    avgCycleMin: loads > 0 ? act.reduce((a, r) => a + (r.ok ? r.cycleMin * r.assigned : 0), 0) / loads : NaN,
  };
}

/** Match circuits across scenarios: same id first, then same loader + material, then same name. */
export function matchCircuit(target: Scenario, c: Circuit): Circuit | undefined {
  return target.circuits.find(x => x.id === c.id)
    ?? target.circuits.find(x => x.loaderUnitId === c.loaderUnitId && x.materialId === c.materialId)
    ?? target.circuits.find(x => x.name === c.name);
}

/** Union of circuits across scenarios as aligned rows: rows[k][j] = circuit of scenario j (or undefined). */
export function alignCircuits(list: Scenario[]): { key: string; name: string; color: string; per: (Circuit | undefined)[] }[] {
  const out: { key: string; name: string; color: string; per: (Circuit | undefined)[] }[] = [];
  list.forEach((sc, j) => {
    for (const c of sc.circuits) {
      if (out.some(row => row.per[j]?.id === c.id)) continue;
      const row = out.find(r => !r.per[j] && r.per.some(x => x && (x.id === c.id || (x.loaderUnitId === c.loaderUnitId && x.materialId === c.materialId))));
      if (row) row.per[j] = c;
      else {
        const per: (Circuit | undefined)[] = list.map(() => undefined);
        per[j] = c;
        out.push({ key: `${c.loaderUnitId}|${c.materialId}|${c.id}`, name: c.name, color: c.color, per });
      }
    }
  });
  return out;
}
