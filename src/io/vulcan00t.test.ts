import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { looksLike00t, parse00t, write00t } from './vulcan00t';
import { decodeVulZ, expandFastLZ, inspectVulZ, isVulZ } from './vulz';
import { buildVulZ, fastlzCompress } from './__tests__/vulzBuilder';
import { meshStats } from '@/geom/mesh';
import { mulberry32 } from '@/demo/rng';
import type { MeshData } from '@/core/types';

function randomMesh(V: number, T: number, seed = 1): MeshData {
  const r = mulberry32(seed);
  const verts = new Float64Array(V * 3);
  for (let i = 0; i < V; i++) { verts[i * 3] = 236000 + r() * 2400; verts[i * 3 + 1] = 7051000 + r() * 1700; verts[i * 3 + 2] = 262 + r() * 90; }
  const tris = new Uint32Array(T * 3);
  for (let k = 0; k < T * 3; k++) tris[k] = Math.floor(r() * V);
  return { verts, tris };
}

const fixture = (name: string) => {
  const b = readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('raw .00t', () => {
  it('write → parse round-trips exactly (1-based indices on disk)', () => {
    const m = randomMesh(500, 900);
    const buf = write00t(m);
    expect(buf.byteLength).toBe(120 + (500 + 900) * 24);
    const dv = new DataView(buf);
    expect(dv.getUint32(0x48, false)).toBe(500);
    expect(dv.getUint32(0x60, false)).toBe(900);
    expect(dv.getUint32(120 + 500 * 24, false)).toBe(m.tris[0] + 1);
    const p = parse00t(buf);
    expect(p.format).toBe('raw');
    expect(Array.from(p.mesh.verts)).toEqual(Array.from(m.verts));
    expect(Array.from(p.mesh.tris)).toEqual(Array.from(m.tris));
    expect(looksLike00t(buf)).toBe(true);
  });

  it('accepts typed-array views and 0-based files (with a warning)', () => {
    const m = randomMesh(10, 6, 2);
    m.tris[0] = 0; m.tris[1] = 9;
    const buf = write00t(m);
    const dv = new DataView(buf);
    for (let t = 0; t < 6; t++) for (let j = 0; j < 3; j++) dv.setUint32(120 + 10 * 24 + t * 24 + j * 4, m.tris[t * 3 + j], false);
    const p = parse00t(new Uint8Array(buf));
    expect(Array.from(p.mesh.tris)).toEqual(Array.from(m.tris));
    expect(p.warnings.join(' ')).toMatch(/0-based/);
  });

  it('rejects bad files with a friendly message', () => {
    const good = write00t(randomMesh(20, 10, 3));
    const msg = /^That file isn't a Vulcan \.00t surface \(/;
    expect(() => parse00t(new ArrayBuffer(50))).toThrow(msg);
    expect(() => parse00t(new ArrayBuffer(200))).toThrow(/no triangles/);
    expect(() => parse00t(good.slice(0, good.byteLength - 10))).toThrow(/cut short/);
    const nan = good.slice(0); new DataView(nan).setFloat64(120 + 8, NaN, false);
    expect(() => parse00t(nan)).toThrow(/non-finite/);
    const oob = good.slice(0); new DataView(oob).setUint32(120 + 20 * 24, 999, false);
    expect(() => parse00t(oob)).toThrow(/index out of range/);
    expect(() => parse00t('nope' as unknown as ArrayBuffer)).toThrow(/no file data/);
    expect(looksLike00t(new ArrayBuffer(10))).toBe(false);
  });

  it('parses the real-format fixtures (closed dig and dump solids)', () => {
    const dig = parse00t(fixture('demo_dig_EX09_block.00t'));
    expect(dig.format).toBe('raw');
    expect(dig.mesh.verts.length / 3).toBe(2142);
    expect(dig.mesh.tris.length / 3).toBe(4280);
    const ds = meshStats(dig.mesh);
    expect(ds.closed).toBe(true);
    // the prototype's EX09 block is a 1 cm sheet (its surface lay below the floor RL): 250 m × 100 m × 0.01 m
    expect(ds.volume!).toBeCloseTo(250, 3);
    expect(ds.bbox.min[0]).toBeCloseTo(237150, 6);
    expect(ds.bbox.max[1]).toBeCloseTo(7052060, 6);
    const dump = parse00t(fixture('demo_dump_S51_lift.00t'));
    expect(dump.mesh.tris.length / 3).toBe(15224);
    const us = meshStats(dump.mesh);
    expect(us.closed).toBe(true);
    expect(us.volume!).toBeCloseTo(1425074.507, 1);
    expect(us.bbox.max[2]).toBeCloseTo(367, 6);
    // round-trip through the writer is byte-identical for these canonical files
    expect(new Uint8Array(write00t(dig.mesh))).toEqual(new Uint8Array(fixture('demo_dig_EX09_block.00t')));
    // consistently wound: no winding notes
    expect([...dig.warnings, ...dump.warnings].join(' ')).not.toMatch(/winding|non-manifold|wound/);
  });

  it('flags a solid with faces wound the wrong way; the mesh is returned as in the file', () => {
    const cube: MeshData = {
      verts: Float64Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10].map((x, i) => x + [236000, 7051000, 300][i % 3])),
      tris: Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]), // top (2, 3) inward
    };
    const p = parse00t(write00t(cube));
    expect(Array.from(p.mesh.tris)).toEqual(Array.from(cube.tris));
    expect(p.warnings.join(' ')).toMatch(/2 triangles of 12 faced the wrong way and were re-oriented/);
    expect(meshStats(p.mesh).volume!).toBeCloseTo(1000, 6);
  });
});

describe('vulZ container', () => {
  const raw = new Uint8Array(write00t(randomMesh(300, 500, 4))); // ~19 KB → 19 pages of 1 KiB

  it('FastLZ test compressor round-trips through the decoder (level 1)', () => {
    const r = mulberry32(8);
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i % 97 < 40 ? 7 : Math.floor(r() * 4)));
    const c = fastlzCompress(data);
    expect(c.length).toBeLessThan(data.length);
    const out = new Uint8Array(data.length);
    expect(expandFastLZ(c, out)).toBe(data.length);
    expect(out).toEqual(data);
  });

  it('decodes a level-2 stream with an extended match length', () => {
    // literal "ab" (level-2 marker in the top bits), then a match of 2 + 7 + 255 + 3 = 267 bytes at distance 1
    const block = Uint8Array.from([0x20 | 1, 97, 98, 0xe0, 255, 3, 1]);
    const out = new Uint8Array(269);
    expect(expandFastLZ(block, out)).toBe(269);
    expect(String.fromCharCode(...out.subarray(0, 6))).toBe('ababab');
  });

  for (const [label, opts] of [
    ['flat pointer table', { layout: 'flat' }],
    ['pointer-table nodes (tree)', { layout: 'tree', perNode: 4 }],
    ['pages stored in reverse order, numbered', { layout: 'tree', perNode: 5, reverseStorage: true }],
    ['back-to-back run named by its first page', { layout: 'run' }],
    ['unnumbered back-to-back run (older files)', { layout: 'run', numbered: false }],
    ['end markers after page numbers', { layout: 'flat', endMarker: true }],
    ['literal-only pages', { layout: 'flat', literalOnly: true, pageSize: 4096 }],
  ] as const) {
    it(`round-trips a multi-page image: ${label}`, () => {
      const file = buildVulZ(raw, opts);
      expect(isVulZ(file)).toBe(true);
      const info = inspectVulZ(file);
      expect(info.length).toBe(raw.length);
      const d = decodeVulZ(file);
      expect(new Uint8Array(d.buffer)).toEqual(raw);
      const p = parse00t(file);
      expect(p.format).toBe('vulZ');
      expect(Array.from(p.mesh.verts)).toEqual(Array.from(parse00t(raw.buffer as ArrayBuffer).mesh.verts));
      expect(p.warnings[0]).toMatch(/Compressed Vulcan file/);
    });
  }

  it('rejects corrupt containers', () => {
    const good = buildVulZ(raw, { layout: 'tree', perNode: 4 });
    const bad = (mut: (dv: DataView, b: Uint8Array) => void, re: RegExp) => {
      const f = good.slice(0);
      mut(new DataView(f), new Uint8Array(f));
      expect(() => parse00t(f)).toThrow(re);
    };
    const msg = /^Cannot read this compressed Vulcan \.00t \(/;
    expect(() => parse00t(good.slice(0, 40))).toThrow(/cut short/);
    bad(dv => dv.setUint32(20, 100, true), /unsupported page size/);
    bad(dv => dv.setUint32(32, 50, true), /invalid expanded length/);
    bad(dv => dv.setUint32(36, 1, true), /1 GiB/);
    // root points at itself → cyclic
    bad(dv => dv.setUint32(60, 60, true), /cyclic|repeated/);
    // pointer outside the file
    bad(dv => dv.setUint32(60, good.byteLength + 100, true), /outside the file/);
    // drop the last node's entries → missing pages
    bad((dv) => { const node = dv.getUint32(60 + 8 * 4, true); dv.setUint32(node, 0, true); }, /empty page pointer table|missing compressed pages/);
    // truncated file
    expect(() => parse00t(good.slice(0, good.byteLength - 100))).toThrow(msg);
    // corrupt the first page's stream: invalid level bits
    bad((dv, b) => { const node = dv.getUint32(60, true); const page = dv.getUint32(node, true); b[page + 8] = 0xff; }, /compression level/);
    // back-reference before the start of the page
    bad((dv, b) => { const node = dv.getUint32(60, true); const page = dv.getUint32(node, true); b[page + 8] = 0; b[page + 10] = 0x3f; b[page + 11] = 0xff; }, /back-reference|cut short|declared size|wrong length/);
    // two live pages claiming the same number
    bad((dv) => {
      const node = dv.getUint32(60, true);
      const p0 = dv.getUint32(node, true), p1 = dv.getUint32(node + 8, true);
      const s1 = dv.getUint32(p1, true);
      dv.setUint32(p1 + 8 + s1, 0, true);
      void p0;
    }, /conflicting live page numbers/);
    expect(isVulZ(new ArrayBuffer(4))).toBe(false);
  });
});
