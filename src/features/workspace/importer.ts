/**
 * File import: classify dropped / picked files, parse .00t in a Web Worker, and commit the user's choices from the
 * import modal to the scenario in ONE undoable step.
 */
import type { AssetRole, MeshAsset, Scenario } from '@/core/types';
import { uid, nowIso } from '@/core/ids';
import { originFor } from '@/core/frame';
import { app } from '@/state/store';
import { importScenarioFile, looksLikeScenario } from '@/features/scenarios';
import ParseWorker from './parse.worker?worker&inline';
import type { ParseReply } from './parse.worker';
import { read00t, readStringsText } from './geomBridge';
import { sceneFit } from './sceneBridge';
import type { ImportItem } from './importTypes';
import { ui } from './uiStore';
import { CAT_HEX } from '@/ui';

export const ROLE_COLORS: Record<AssetRole, string> = {
  topo: '#B9BCB4', dig: '#C79A6B', dump: '#7FA58E', design: CAT_HEX[0], other: '#8E949C',
};
/** Material / ground swatches (topo, OB, coal, IB, dump) followed by the categorical data palette. */
export const SWATCHES = ['#B9BCB4', '#C79A6B', '#2E3238', '#9C8C7A', '#7FA58E', ...CAT_HEX.slice(0, 6)];
export const DEFAULT_MATERIALS = [
  { id: 'OB', name: 'Overburden', color: '#C79A6B' },
  { id: 'CL', name: 'Coal', color: '#2E3238' },
  { id: 'IB', name: 'Interburden', color: '#9C8C7A' },
];

const ext = (name: string) => name.toLowerCase().replace(/^.*?((\.haiul)?\.[a-z0-9]+)$/, '$1');
export const MESH_EXT = ['.00t'];
export const STRING_EXT = ['.txt', '.csv', '.str', '.tsv'];

// ── worker pool (one worker, reused) ─────────────────────────────────────────────────────────────
let worker: Worker | null = null;
let workerBroken = false;
const waiting = new Map<string, (r: ParseReply) => void>();
function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerBroken) return null;
  try {
    worker = new ParseWorker();
    worker.onmessage = (e: MessageEvent<ParseReply>) => { const cb = waiting.get(e.data.key); waiting.delete(e.data.key); cb?.(e.data); };
    worker.onerror = e => {
      // a worker that fails to start would leave files "reading" forever: fail them and parse on the main thread from now on
      console.warn('[import] worker error, falling back to the main thread', e.message);
      workerBroken = true; worker?.terminate(); worker = null;
      for (const [key, cb] of waiting) cb({ key, ok: false, error: 'The background reader stopped – add the file again.' });
      waiting.clear();
    };
    return worker;
  } catch (e) {
    console.warn('[import] Web Worker unavailable, parsing on the main thread', e);
    return null;
  }
}

async function parseMesh(key: string, buf: ArrayBuffer): Promise<ParseReply> {
  const w = getWorker();
  if (w) {
    return new Promise(res => { waiting.set(key, res); w.postMessage({ key, buf }, [buf]); });
  }
  const t0 = performance.now();
  try {
    const { mesh, stats, warnings } = read00t(buf);
    return { key, ok: true, mesh, stats, warnings, ms: performance.now() - t0 };
  } catch (e) { return { key, ok: false, error: (e as Error).message }; }
}

// ── guesses ──────────────────────────────────────────────────────────────────────────────────────
function baseName(f: string) { return f.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(); }

function guessRole(fileName: string, closed: boolean, s: Scenario, pending: ImportItem[]): AssetRole {
  const n = fileName.toLowerCase();
  if (closed) return /dump|spoil|tip|fill|emplace|waste|lift/.test(n) ? 'dump' : 'dig';
  const hasTopo = s.assets.some(a => a.role === 'topo') || pending.some(p => p.role === 'topo' && p.include);
  if (/design|ramp|road|final|shell|plan/.test(n)) return 'design';
  if (!hasTopo) return 'topo';
  return /topo|surface|terrain|lidar|survey|ground|dtm/.test(n) ? 'topo' : 'design';
}

function warningsFor(item: ImportItem, s: Scenario): string[] {
  const out: string[] = [];
  const st = item.stats;
  if (!st) return out;
  if (!st.triangleCount) out.push('No triangles in this file.');
  if (!st.closed && (item.role === 'dig' || item.role === 'dump')) {
    out.push(`Not a closed solid (${st.boundaryEdges.toLocaleString('en-AU')} open edges) – volume and depletion can't be measured.`);
  }
  if (st.closed && st.volume != null && st.volume < 1) out.push('The solid encloses almost no volume – check the triangulation.');
  const zr = st.bbox.max[2] - st.bbox.min[2];
  if (zr > 3000) out.push(`Elevation range is ${Math.round(zr).toLocaleString('en-AU')} m – check the units.`);
  const ref = s.assets.length ? s.site.origin : undefined;
  if (ref && (ref[0] !== 0 || ref[1] !== 0)) {
    const d = Math.hypot(st.centroid[0] - ref[0], st.centroid[1] - ref[1]);
    if (d > 25_000) out.push(`About ${Math.round(d / 1000)} km from the site – is it in the same coordinate system?`);
  }
  return out;
}

export function refreshWarnings(item: ImportItem): ImportItem {
  return { ...item, warnings: [...(item.warnings.filter(w => w.startsWith('Reader:'))), ...warningsFor(item, app().scenario)] };
}

// ── entry points ─────────────────────────────────────────────────────────────────────────────────
export async function importFiles(list: FileList | File[]): Promise<void> {
  const files = Array.from(list);
  if (!files.length) return;
  const meshes: File[] = [], strings: File[] = [], scenarios: File[] = [], unknown: File[] = [];
  for (const f of files) {
    const e = ext(f.name);
    if (MESH_EXT.includes(e)) meshes.push(f);
    else if (e === '.haiul.json' || e === '.json') scenarios.push(f);
    else if (STRING_EXT.includes(e)) strings.push(f);
    else unknown.push(f);
  }
  for (const f of unknown) app().toast('warn', `${f.name}: not a file hAIul SIM can read (.00t, .str, .csv, .txt, .haiul.json)`);
  if (scenarios.length) {
    const f = scenarios[0];
    const head = await f.slice(0, 4096).text();
    if (looksLikeScenario(head) || ext(f.name) === '.haiul.json') await importScenarioFile(f);
    else app().toast('warn', `${f.name}: not a hAIul SIM scenario`);
    if (scenarios.length > 1) app().toast('info', 'Opened the first scenario file only.');
  }
  if (strings.length) await readStrings(strings[0]);
  if (meshes.length) await readMeshes(meshes);
}

async function readMeshes(files: File[]) {
  const s = app().scenario;
  const fresh: ImportItem[] = files.map(f => ({
    key: uid('imp'), fileName: f.name, sizeBytes: f.size, status: 'reading', include: true, name: baseName(f.name),
    kind: 'surface', role: 'topo', color: ROLE_COLORS.topo, materialId: 'OB', depletionMode: 'face-advance', advanceAzimuthDeg: 0, warnings: [],
  }));
  ui().set({ importItems: [...ui().importItems.filter(i => i.status !== 'error' || i.include), ...fresh], importOpen: true, stringsImport: undefined });
  await Promise.all(files.map(async (f, i) => {
    const key = fresh[i].key;
    const r = await parseMesh(key, await f.arrayBuffer());
    const items = ui().importItems;
    const cur = items.find(x => x.key === key);
    if (!cur) return; // removed meanwhile
    let next: ImportItem;
    if (r.ok) {
      const closed = r.stats.closed;
      const role = guessRole(f.name, closed, s, items.filter(x => x.key !== key));
      const coal = /coal|\bcl\b/i.test(f.name);
      const mats = s.materials.length ? s.materials : DEFAULT_MATERIALS;
      const materialId = (coal ? mats.find(m => /coal|^cl$/i.test(m.id + ' ' + m.name)) : mats.find(m => /^ob$|overburden/i.test(m.id) || /overburden/i.test(m.name)))?.id ?? mats[0].id;
      next = {
        ...cur, status: 'ready', mesh: r.mesh, stats: r.stats, ms: r.ms, kind: closed ? 'solid' : 'surface', role,
        color: role === 'dig' ? (mats.find(m => m.id === materialId)?.color ?? ROLE_COLORS.dig) : ROLE_COLORS[role],
        materialId, depletionMode: role === 'dump' ? 'bottom-up' : 'face-advance',
        warnings: r.warnings.map(w => `Reader: ${w}`),
      };
      next = refreshWarnings(next);
    } else {
      next = { ...cur, status: 'error', error: r.error, include: false };
    }
    ui().set({ importItems: ui().importItems.map(x => (x.key === key ? next : x)) });
  }));
}

async function readStrings(f: File) {
  try {
    const s = app().scenario;
    const topo = s.assets.find(a => a.role === 'topo');
    const { strings, warnings } = readStringsText(await f.text(), f.name, CAT_HEX, topo, s.strings.length);
    if (!strings.length) throw new Error('No strings found in this file.');
    ui().set({ stringsImport: { fileName: f.name, strings, warnings }, importOpen: true });
  } catch (e) {
    app().toast('error', `${f.name}: ${(e as Error).message}`);
  }
}

/** Commit the ready, included items as assets (one undo step). */
export function commitImport(): number {
  const items = ui().importItems.filter(i => i.include && i.status === 'ready' && i.mesh && i.stats);
  const strImp = ui().stringsImport;
  if (!items.length && !strImp) return 0;
  const t = nowIso();
  const assets: MeshAsset[] = items.map(i => ({
    id: uid('ast'), name: i.name.trim() || baseName(i.fileName), fileName: i.fileName, kind: i.kind, role: i.role,
    mesh: i.mesh!, stats: i.stats!, color: i.color, visible: true, opacity: i.role === 'topo' ? 1 : i.role === 'design' ? 0.6 : 0.88,
    block: i.role === 'dig' || i.role === 'dump'
      ? { materialId: i.materialId, depletionMode: i.depletionMode, advanceAzimuthDeg: i.advanceAzimuthDeg }
      : undefined,
    source: 'import', importedAt: t,
  }));
  const strings = strImp?.strings ?? [];
  const wasEmpty = !app().scenario.assets.length;
  const n = assets.length + strings.length;
  const label = assets.length && strings.length ? `Import ${n} items` : assets.length === 1 ? `Import ${assets[0].name}` : assets.length ? `Import ${assets.length} surfaces` : `Import ${strings.length} strings`;
  app().commit(label, s => {
    let site = s.site;
    if (!s.assets.length && assets.length) {
      const ref = assets.find(a => a.role === 'topo') ?? assets[0];
      site = { ...site, origin: originFor(ref.stats.bbox.min) };
    }
    return { ...s, site, assets: [...s.assets, ...assets], strings: [...s.strings, ...strings] };
  });
  ui().set({ importItems: [], importOpen: false, stringsImport: undefined });
  app().toast('ok', `${label.replace(/^Import/, 'Imported')}`);
  if (wasEmpty || assets.length) setTimeout(() => sceneFit(), 60);
  return n;
}

// ── file pickers ─────────────────────────────────────────────────────────────────────────────────
export function pickFiles(accept: string, multiple = true) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  input.onchange = () => { if (input.files?.length) importFiles(input.files); };
  input.click();
}
export const pickMeshes = () => pickFiles('.00t');
export const pickStrings = () => pickFiles(STRING_EXT.join(','), false);
export const pickScenarioFile = () => pickFiles('.json,.haiul.json,application/json', false);
