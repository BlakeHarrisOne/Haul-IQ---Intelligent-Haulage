/**
 * Audit 3 — physics sanity (rimpull mode) for the 8 library trucks and kinematic-mode plausibility.
 *   resistance magnitudes · power envelope · monotone speed vs grade · empty ≥ loaded · retarder-limited descents ·
 *   docs/spec/04 §G.3 sanity table · kinematic ≥ steady · stops add time · no NaN · per-interval force/power balance.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRUCK_MODELS } from '@/data';
import { computeCircuit, curveForce, maxSpeedForForce, resistanceKN, steadySpeed, truckPhysics, G } from '@/engine';
import type { CircuitResultExt, TruckModelExt } from '@/engine/types';
import { circuitFor, fixture, scenarioWith, straightString, stringFrom } from '@/engine/testing';
import { createDemoScenario } from '@/state/demo';

const trucks = TRUCK_MODELS as TruckModelExt[];

/** docs/spec/04 §G.3 sanity table parsed from the markdown. */
function sanityTable() {
  const md = readFileSync(fileURLToPath(new URL('../../docs/spec/04-market-and-methods.md', import.meta.url)), 'utf8');
  const sec = md.slice(md.indexOf('### G.3'), md.indexOf('### G.4'));
  const rows = sec.split('\n').filter(l => /^\| (CAT|KOM) /.test(l));
  const num = (c: string) => Number(c.replace(/[*,]/g, '').match(/-?[\d.]+/)?.[0]);
  return rows.map(l => {
    const c = l.split('|').slice(1, -1).map(x => x.trim());
    return { name: c[0], rimKW: num(c[1]), maxRimpull: num(c[3]), up: [num(c[4]), num(c[5]), num(c[6]), num(c[7])], emptyLevel: num(c[8]), emptyUp10: num(c[9]),
      retKW: num(c[10]), down8: num(c[11]), down10rule: num(c[12]), down10cont: num(c[13]) };
  }).filter(r => r.name !== 'Truck');
}

describe('audit 3 · steady-state physics per truck', () => {
  it('resistance force = m·g·(sinθ + cosθ·RR) (hand values)', () => {
    // 789C at GVW 317.5 t: 10 % effective, 8 % grade + 2 % RR, 0 % + 2 % RR, −8 % + 2 % RR
    expect(resistanceKN(317.5, 0.10, 0)).toBeCloseTo(317.5 * 9.81 * 0.10, 9);              // 311.47 kN
    expect(resistanceKN(317.5, 0.08, 2)).toBeCloseTo(317.5 * 9.81 * (0.08 + Math.sqrt(1 - 0.0064) * 0.02), 9); // 311.33 kN
    expect(resistanceKN(317.5, 0, 2)).toBeCloseTo(62.29, 2);
    expect(resistanceKN(317.5, -0.08, 2)).toBeCloseTo(-187.07, 2);
    expect(G).toBe(9.81);
  });

  it.each(trucks.map(t => [t.name, t] as const))('%s: power envelope, monotone speeds, empty ≥ loaded, retarder-limited descents', (_n, t) => {
    const tp = truckPhysics(t);
    const pNet = t.netPowerKW ?? t.enginePowerKW;
    const bad: string[] = [];
    // power: F·v ≤ 0.9 · P_net at every envelope point and every per-gear point
    let maxRatio = 0;
    for (const [v, f] of [...tp.rimpull, ...tp.rimpullGears.flatMap(g => g.points)]) maxRatio = Math.max(maxRatio, (f * v / 3.6) / pNet);
    if (maxRatio > 0.9) bad.push(`max F·v / P_net = ${maxRatio.toFixed(3)} > 0.9`);
    // monotone loaded speed in effective grade (GVW, RR folded into the grade), and empty ≥ loaded
    const mL = t.gvwT, mE = t.emptyMassT;
    let prev = Infinity;
    for (let k = 0; k <= 250; k++) {
      const g = k / 1000;
      const L = steadySpeed(tp, mL, g, 0, Infinity);
      const E = steadySpeed(tp, mE, g, 0, Infinity);
      if (!(L.kmh > 0) || !Number.isFinite(L.kmh)) bad.push(`loaded ${g}: ${L.kmh}`);
      if (L.kmh > prev + 1e-9) bad.push(`loaded speed rises with grade at ${(g * 100).toFixed(1)} %: ${prev.toFixed(3)} → ${L.kmh.toFixed(3)}`);
      if (E.kmh < L.kmh - 1e-9) bad.push(`empty < loaded at +${(g * 100).toFixed(1)} %: ${E.kmh.toFixed(2)} < ${L.kmh.toFixed(2)}`);
      // the balance speed actually balances: rimpull(v) ≥ resistance (unless capped / stalled)
      if (L.limit === 'rimpull' && L.binding !== 'stall' && curveForce(tp.rimpull, L.kmh) < L.resistanceKN - 1e-6) bad.push(`loaded ${g}: F_rim(${L.kmh.toFixed(2)}) < F_res`);
      prev = L.kmh;
    }
    // descents: speed non-increasing as the grade steepens, retarder force at v ≥ required, empty ≥ loaded
    prev = Infinity;
    for (let k = 1; k <= 200; k++) {
      const g = -k / 1000;
      const L = steadySpeed(tp, mL, g, 0, Infinity);
      const E = steadySpeed(tp, mE, g, 0, Infinity);
      if (L.kmh > prev + 1e-9) bad.push(`loaded descent speed rises as it steepens at ${(g * 100).toFixed(1)} %: ${prev.toFixed(2)} → ${L.kmh.toFixed(2)}`);
      if (E.kmh < L.kmh - 1e-9) bad.push(`empty < loaded at ${(g * 100).toFixed(1)} %: ${E.kmh.toFixed(2)} < ${L.kmh.toFixed(2)}`);
      if (L.mode === 'retard' && L.limit === 'retarder' && L.binding !== 'retarder-exceeded') {
        const fReq = -L.resistanceKN;
        const ret = tp.descentRule === 'discrete_gear' && L.gear != null
          ? curveForce(tp.retarderGears.find(x => x.gear === L.gear)!.points, L.kmh) : curveForce(tp.retarder, L.kmh);
        if (ret < fReq - 1e-6) bad.push(`retarder ${ret.toFixed(1)} kN < required ${fReq.toFixed(1)} kN at ${L.kmh.toFixed(2)} km/h (${(g * 100).toFixed(1)} %)`);
        // power bound: v ≤ P_ret / F_req
        if (t.retarderPowerKW && L.kmh / 3.6 * fReq > t.retarderPowerKW * 1.001) bad.push(`descent at ${L.kmh.toFixed(1)} km/h needs ${(L.kmh / 3.6 * fReq).toFixed(0)} kW > retarder ${t.retarderPowerKW} kW`);
      }
      prev = L.kmh;
    }
    expect(bad.slice(0, 12), bad.slice(0, 12).join('\n')).toEqual([]);
  });

  it('docs/spec/04 §G.3 sanity table (±0.15 km/h; loaded = GVW, effective grade, no limits)', () => {
    const tab = sanityTable();
    expect(tab.length).toBe(8);
    const bad: string[] = [];
    for (const row of tab) {
      const t = trucks.find(x => x.name === row.name);
      if (!t) { bad.push(`no truck ${row.name}`); continue; }
      const tp = truckPhysics(t);
      const sp = (m: number, g: number, rr = 0) => steadySpeed(tp, m, g, rr, Infinity).kmh;
      const chk = (what: string, got: number, exp: number, tol = 0.15) => { if (!(Math.abs(got - exp) <= tol)) bad.push(`${row.name} ${what}: engine ${got.toFixed(2)} vs doc ${exp}`); };
      [0.06, 0.08, 0.10, 0.12].forEach((g, k) => chk(`loaded up ${g * 100} %`, sp(t.gvwT, g), row.up[k]));
      chk('empty level 2 % RR', sp(t.emptyMassT, 0, 2), row.emptyLevel);
      chk('empty up 10 %', sp(t.emptyMassT, 0.10), row.emptyUp10);
      chk('loaded down −8 %', sp(t.gvwT, -0.08), row.down8);
      chk('loaded down −10 % (rule)', sp(t.gvwT, -0.10), row.down10rule);
      const fReq = -resistanceKN(t.gvwT, -0.10, 0);
      const cont = Math.min(maxSpeedForForce(tp.retarder, fReq).kmh, tp.topKmh);
      chk('loaded down −10 % continuous', cont, row.down10cont);
      chk('max rimpull kN', Math.max(...tp.rimpull.map(p => p[1])), row.maxRimpull, 1);
      chk('rim kW (max F·v)', Math.max(...tp.rimpull.map(p => p[0] * p[1] / 3.6)), row.rimKW, 6);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('audit 3 · kinematic mode plausibility', () => {
  const raw = fixture<{ strings: { id: string; title: string; points: number[][] }[] }>('raw-data-strings.json').strings;

  function both(points: number[][], truckId: string, material: string, extra: Parameters<typeof stringFrom>[3] = []) {
    const hs = stringFrom('hs', 'audit', points, extra);
    const ck = circuitFor('c', 'EX09', truckId, material, hs.id, 5, { speedModel: 'rimpull', motion: 'kinematic' });
    const cs = circuitFor('c', 'EX09', truckId, material, hs.id, 5, { speedModel: 'rimpull', motion: 'steady' });
    const s = scenarioWith([hs], [ck]);
    return { k: computeCircuit(s, ck) as CircuitResultExt, st: computeCircuit(s, cs) as CircuitResultExt, s, ck };
  }

  it('kinematic leg time ≥ steady leg time; no negative / NaN segment times (23 raw strings × 8 trucks)', () => {
    const bad: string[] = [];
    for (const str of raw) for (const t of trucks) {
      const { k, st } = both(str.points, t.id, 'OB');
      if (!k.ok || !st.ok) { bad.push(`${str.id} ${t.id}: ${k.error ?? st.error}`); continue; }
      if (k.travelLoadedS < st.travelLoadedS - 1e-6) bad.push(`${str.id} ${t.id} loaded: kinematic ${k.travelLoadedS.toFixed(2)} < steady ${st.travelLoadedS.toFixed(2)} s`);
      if (k.travelEmptyS < st.travelEmptyS - 1e-6) bad.push(`${str.id} ${t.id} empty: kinematic ${k.travelEmptyS.toFixed(2)} < steady ${st.travelEmptyS.toFixed(2)} s`);
      for (const g of k.segments) if (!(g.timeLoadedS > 0 && g.timeEmptyS > 0 && Number.isFinite(g.timeLoadedS + g.timeEmptyS))) bad.push(`${str.id} ${t.id} seg ${g.i}: ${g.timeLoadedS}/${g.timeEmptyS}`);
      const sumK = k.segments.reduce((a, g) => a + g.timeLoadedS, 0);
      if (Math.abs(sumK - k.travelLoadedS) > 1e-6) bad.push(`${str.id} ${t.id}: Σ segment times ${sumK} ≠ leg ${k.travelLoadedS}`);
    }
    expect(bad.slice(0, 20), `${bad.length} issues\n${bad.slice(0, 20).join('\n')}`).toEqual([]);
  });

  it('stop points add at least the dwell, and steady/kinematic both stay finite on the demo circuits', async () => {
    const legs = [{ len: 400, grade: 0 }, { len: 600, grade: 0.08, stop: true }, { len: 500, grade: 0 }];
    const plain = straightString('p', legs.map(l => ({ ...l, stop: false })));
    const stop = straightString('s', legs);
    const c1 = circuitFor('c1', 'EX09', 'CAT_789D', 'OB', 'p', 5, { speedModel: 'rimpull', motion: 'kinematic' });
    const c2 = circuitFor('c2', 'EX09', 'CAT_789D', 'OB', 's', 5, { speedModel: 'rimpull', motion: 'kinematic' });
    const sc = scenarioWith([plain, stop], [c1, c2]);
    const a = computeCircuit(sc, c1) as CircuitResultExt, b = computeCircuit(sc, c2) as CircuitResultExt;
    expect(b.stopsModelled).toBe(2);
    expect(b.travelLoadedS - a.travelLoadedS).toBeGreaterThanOrEqual(5);
    expect(b.travelEmptyS - a.travelEmptyS).toBeGreaterThanOrEqual(5);
    // a modelled stop replaces one 60 s penalty each way: cycle changes by (Δtravel/η − 2 × 60)
    expect(b.stopsS).toBe(0);
    const s = await createDemoScenario();
    for (const c of s.circuits) for (const motion of ['steady', 'kinematic'] as const) {
      const r = computeCircuit(s, { ...c, params: { ...c.params, speedModel: 'rimpull', motion } }) as CircuitResultExt;
      expect(r.ok).toBe(true);
      expect(Number.isFinite(r.cycleS) && r.cycleS > 0).toBe(true);
    }
  });

  it('every kinematic interval respects a ≤ min(a_max, (F_avail − F_res)/m_eff) and P ≤ rim power (demo × 8 trucks)', async () => {
    const s = await createDemoScenario();
    const bad: string[] = [];
    let n = 0;
    for (const c of s.circuits) for (const t of trucks) {
      const cc = { ...c, truckModelId: t.id, params: { ...c.params, speedModel: 'rimpull' as const, motion: 'kinematic' as const, truckLoadBcm: t.loadBcmByMaterial?.[c.materialId] ?? c.params.truckLoadBcm } };
      const r = computeCircuit(s, cc) as CircuitResultExt;
      const tp = truckPhysics(t);
      const pMax = Math.max(...tp.rimpull.map(p => p[0] * p[1] / 3.6));
      for (const [leg, prof, m, share] of [['loaded', r.profiles.loaded, r.massLoadedT!, tp.driveShare.loaded], ['empty', r.profiles.empty, r.massEmptyT!, tp.driveShare.empty]] as const) {
        const segs = leg === 'loaded' ? r.segments : r.segments;
        for (const iv of prof.intervals) {
          if (iv.dwell || iv.ds <= 0) continue;
          n++;
          const g = segs.find(x => x.i === iv.seg)!;
          const sin = leg === 'loaded' ? g.grade : -g.grade;
          const fRes = resistanceKN(m, sin, g.rrPct);
          const a = (iv.v1 * iv.v1 - iv.v0 * iv.v0) / (2 * iv.ds);
          if (a <= 1e-9) continue;
          const vMid = (iv.v0 + iv.v1) / 2;
          const fTrac = 0.5 * m * G * share * Math.sqrt(1 - sin * sin);
          const fAvail = Math.min(Math.max(curveForce(tp.rimpull, iv.v0 * 3.6), curveForce(tp.rimpull, iv.v1 * 3.6)), fTrac);
          const aMax = Math.min(0.6, (fAvail - fRes) / (m * 1.05));
          if (a > aMax + 0.02) bad.push(`${c.id}/${t.id} ${leg} seg ${iv.seg} s=${iv.s0.toFixed(0)}: a ${a.toFixed(3)} > ${aMax.toFixed(3)} m/s²`);
          const p = (m * 1.05 * a + fRes) * vMid;
          if (p > pMax * 1.02) bad.push(`${c.id}/${t.id} ${leg} seg ${iv.seg}: tractive power ${p.toFixed(0)} kW > ${pMax.toFixed(0)} kW`);
          const capV = ((leg === 'loaded' ? g.physLoaded : g.physEmpty)!.steadyKmh);
          void capV;
        }
      }
    }
    console.log(`[audit3] kinematic intervals checked: ${n}, issues ${bad.length}`);
    expect(bad.slice(0, 15), bad.slice(0, 15).join('\n')).toEqual([]);
  });
});
