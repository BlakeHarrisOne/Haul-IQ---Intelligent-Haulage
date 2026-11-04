import { it } from 'vitest';
import * as N from '../mesh';
import * as O from './_orig_mesh.bench-tmp';
import * as ND from '../depletion';
import * as OD from './_orig_depl.bench-tmp';
import { gridTin, icosphere, translate, MGA } from './shapes';
import type { MeshData } from '@/core/types';

const time = (f: () => unknown, n = 9) => { const r: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); r.push(performance.now() - t); } r.sort((a, b) => a - b); return r[Math.floor(n / 2)]; };
const fresh = (m: MeshData): MeshData => ({ verts: m.verts, tris: m.tris });

it('perf', () => {
  const topo = gridTin(MGA[0], MGA[1], 5, 404, 404, (x, y) => 300 + Math.sin(x / 50) * 10 + Math.cos(y / 70) * 5);
  const ball = translate(icosphere(500, 7), MGA);
  const flipped = { verts: ball.verts, tris: ball.tris.slice() };
  for (let k = 0; k < flipped.tris.length / 3; k += 7) { const b = flipped.tris[k * 3 + 1]; flipped.tris[k * 3 + 1] = flipped.tris[k * 3 + 2]; flipped.tris[k * 3 + 2] = b; }
  for (const [name, m] of [['warm', ball], ['topo', topo], ['ball', ball], ['ball-flipped', flipped], ['topo', topo]] as const) {
    const T = m.tris.length / 3;
    const ot = time(() => O.meshTopology(fresh(m)));
    const oo = time(() => N.orientMesh(fresh(m)));
    const os = time(() => O.meshStats(fresh(m)));
    const ns = time(() => N.meshStats(fresh(m)));
    const op = time(() => OD.prepareSolid(fresh(m)));
    const np = time(() => ND.prepareSolid(fresh(m)));
    console.log(`${name} T=${T}: topo ${ot.toFixed(1)} orient ${oo.toFixed(1)} | meshStats old ${os.toFixed(1)} new ${ns.toFixed(1)} (${(ns / os).toFixed(2)}x) | prepareSolid old ${op.toFixed(1)} new ${np.toFixed(1)} (${(np / op).toFixed(2)}x) | vol ${N.meshStats(fresh(m)).volume} oldvol ${O.meshStats(fresh(m)).volume}`);
  }
}, 120000);
