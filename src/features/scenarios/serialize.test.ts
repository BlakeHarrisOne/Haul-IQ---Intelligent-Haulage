import { describe, expect, it } from 'vitest';
import type { MeshAsset, Scenario } from '@/core/types';
import { emptyScenario } from '@/state/store';
import {
  base64ToBytes, bytesToBase64, parseScenarioFile, scenarioFileName, ScenarioFormatError, serializeScenario, SCENARIO_SCHEMA,
} from './serialize';

function sampleScenario(): Scenario {
  const s = emptyScenario('Week 45 – EX09 long haul');
  // MGA-sized coordinates: float64 precision must survive the trip
  const verts = new Float64Array([236000.125, 7051000.875, 318.0625, 236100.5, 7051000.25, 317.5, 236050.333333, 7051090.1, 319.75]);
  const tris = new Uint32Array([0, 1, 2]);
  const asset: MeshAsset = {
    id: 'ast_1', name: 'Pit surface', kind: 'surface', role: 'topo', mesh: { verts, tris },
    stats: { vertexCount: 3, triangleCount: 1, bbox: { min: [236000.125, 7051000.25, 317.5], max: [236100.5, 7051090.1, 319.75] }, planArea: 4500, closed: false, boundaryEdges: 3, centroid: [236050, 7051030, 318.4] },
    color: '#B9BDB5', visible: true, opacity: 1, source: 'import', importedAt: '2026-11-04T00:00:00.000Z',
  };
  s.assets = [asset];
  s.strings = [{
    id: 'str_1', name: 'EX09 → S51', color: '#0A6FE6', source: 'drawn', visible: true, createdAt: s.createdAt, updatedAt: s.updatedAt,
    points: [{ id: 'p1', e: 236000, n: 7051000, z: 318 }, { id: 'p2', e: 236100, n: 7051050, z: 330, seg: { speedLimitKmh: 40 } }],
  }];
  s.shift.events = [{ id: 'e1', label: 'Crib', kind: 'crib', startMin: 300, durMin: 30, fleetStopFraction: 0.5 }];
  return s;
}

describe('base64', () => {
  it('round-trips all byte values, including large buffers', () => {
    const u8 = new Uint8Array(200_000);
    for (let i = 0; i < u8.length; i++) u8[i] = (i * 31 + 7) & 255;
    expect(base64ToBytes(bytesToBase64(u8))).toEqual(u8);
  });
});

describe('scenario serializer', () => {
  it('round-trips a scenario with typed arrays exactly', () => {
    const s = sampleScenario();
    const text = serializeScenario(s);
    expect(text).toContain('"$typed":"Float64Array"');
    const { scenario, warnings, version } = parseScenarioFile(text);
    expect(warnings).toEqual([]);
    expect(version).toBe(1);
    const a = scenario.assets[0];
    expect(a.mesh.verts).toBeInstanceOf(Float64Array);
    expect(a.mesh.tris).toBeInstanceOf(Uint32Array);
    expect(Array.from(a.mesh.verts)).toEqual(Array.from(s.assets[0].mesh.verts));
    expect(Array.from(a.mesh.tris)).toEqual([0, 1, 2]);
    // everything else is plain JSON and comes back deep-equal
    expect({ ...scenario, assets: [] }).toEqual({ ...s, assets: [] });
    expect({ ...a, mesh: null }).toEqual({ ...s.assets[0], mesh: null });
  });

  it('accepts a bare scenario object (no envelope) and plain-number mesh arrays', () => {
    const s = sampleScenario();
    const bare = { ...s, assets: [{ ...s.assets[0], mesh: { verts: Array.from(s.assets[0].mesh.verts), tris: [0, 1, 2] } }] };
    const { scenario } = parseScenarioFile(JSON.stringify(bare));
    expect(scenario.assets[0].mesh.verts).toBeInstanceOf(Float64Array);
    expect(scenario.assets[0].mesh.tris[2]).toBe(2);
  });

  it('rejects files that are not scenarios', () => {
    expect(() => parseScenarioFile('not json')).toThrow(ScenarioFormatError);
    expect(() => parseScenarioFile('[1,2,3]')).toThrow(ScenarioFormatError);
    expect(() => parseScenarioFile(JSON.stringify({ name: 'x', assets: [] }))).toThrow(/schema/);
    expect(() => parseScenarioFile(JSON.stringify({ schema: 'other-app/scenario@1' }))).toThrow(ScenarioFormatError);
  });

  it('is version tolerant: fills missing sections, warns on newer schema', () => {
    const minimal = { schema: 'haiul-sim/scenario@3', id: 'scn_x', name: 'Future file', futureField: { a: 1 } };
    const { scenario, warnings, version } = parseScenarioFile(JSON.stringify({ scenario: minimal }));
    expect(version).toBe(3);
    expect(warnings[0]).toMatch(/newer version/);
    expect(scenario.schema).toBe(SCENARIO_SCHEMA);
    expect(scenario.id).toBe('scn_x');
    expect(scenario.assets).toEqual([]);
    expect(scenario.shift.lengthH).toBe(12);
    expect(scenario.settings.verticalExaggeration).toBe(1);
    expect(scenario.fleet.trucksAvailable).toBe(12);
  });

  it('drops unreadable meshes with a warning instead of failing', () => {
    const s = sampleScenario();
    const broken = { ...s, assets: [{ ...s.assets[0], mesh: { verts: 'nope', tris: [] } }] };
    const { scenario, warnings } = parseScenarioFile(JSON.stringify(broken));
    expect(scenario.assets).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/unreadable/);
  });

  it('rejects an unknown typed-array tag', () => {
    const text = JSON.stringify({ schema: SCENARIO_SCHEMA, assets: [{ mesh: { verts: { $typed: 'BigInt64Array', b64: '' } } }] });
    expect(() => parseScenarioFile(text)).toThrow(/Unknown array type/);
  });

  it('makes a safe file name', () => {
    expect(scenarioFileName({ name: 'Week 45 / EX09: long haul!' })).toBe('Week-45-EX09-long-haul.haiul.json');
    expect(scenarioFileName({ name: '???' })).toBe('scenario.haiul.json');
  });
});
