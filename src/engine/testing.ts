/**
 * Test helpers (Node only): load spec fixtures and build small scenarios. Not imported by app code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Circuit, CircuitParams, HaulString, Scenario, StringPoint } from '@/core/types';
import { defaultCircuitParams, defaultScenarioData } from '@/data';

/** Read a JSON fixture from docs/spec/fixtures. */
export function fixture<T = unknown>(name: string): T {
  const p = fileURLToPath(new URL(`../../docs/spec/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

const T0 = '2026-11-04T00:00:00.000Z';

/** A haul string from [E, N, Z] points. */
export function stringFrom(id: string, name: string, pts: number[][], extra: Partial<StringPoint>[] = []): HaulString {
  return {
    id, name, color: '#888', source: 'imported', visible: true, createdAt: T0, updatedAt: T0,
    points: pts.map((p, k) => ({ id: `${id}-${k}`, e: p[0], n: p[1], z: p[2], ...(extra[k] ?? {}) })),
  };
}

/** Straight route of `legs` (slope length m, grade = ΔZ / slope) with points every `step` m. */
export function straightString(id: string, legs: { len: number; grade: number; stop?: boolean }[], step = 20): HaulString {
  const pts: number[][] = [[1000, 2000, 100]];
  const extra: Partial<StringPoint>[] = [{}];
  let [e, n, z] = pts[0];
  for (const leg of legs) {
    const k = Math.max(1, Math.round(leg.len / step));
    const d = leg.len / k;
    for (let i = 0; i < k; i++) {
      const dz = d * leg.grade;
      e += Math.sqrt(d * d - dz * dz);
      z += dz;
      pts.push([e, n, z]);
      extra.push(leg.stop && i === k - 1 ? { stop: true } : {});
    }
  }
  return stringFrom(id, id, pts, extra);
}

/** Scenario with the default data, the given strings and circuits. */
export function scenarioWith(strings: HaulString[], circuits: Circuit[]): Scenario {
  const d = defaultScenarioData();
  return {
    schema: 'haiul-sim/scenario@1', id: 'scn-test', name: 'test', createdAt: T0, updatedAt: T0,
    site: { name: 'test', origin: [0, 0, 0] }, assets: [], strings, circuits, ...d,
    settings: { verticalExaggeration: 1, contourIntervalM: 5, theme: 'light', showGradeColours: true },
  };
}

/** A circuit for loader unit / truck / material with workbook defaults and param overrides. */
export function circuitFor(id: string, unit: string, truckId: string, materialId: string, haulStringId: string, trucks: number, patch: Partial<CircuitParams> = {}, extra: Partial<Circuit> = {}): Circuit {
  const d = defaultScenarioData();
  const la = d.fleet.loaderAssumptions.find(l => l.unitId === unit);
  const truck = d.fleet.trucks.find(t => t.id === truckId);
  const loaderModelId = unit.startsWith('LDR') ? 'KOM_WA900_8' : unit === 'EX04' ? 'KOM_PC4000_11' : unit === 'EX06' ? 'HIT_EX2600_7' : unit === 'EX07' ? 'LIE_R996B' : 'HIT_EX5600_7';
  return {
    id, name: `${unit} test`, loaderUnitId: unit, loaderModelId, truckModelId: truckId, materialId, haulStringId, trucks, priority: 1, active: true,
    params: defaultCircuitParams(la, truck, materialId, patch), color: '#888', ...extra,
  };
}

/** Relative difference |a − b| / max(|b|, tiny). */
export const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
