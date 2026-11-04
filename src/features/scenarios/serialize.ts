/**
 * `.haiul.json` scenario files.
 *
 * Envelope: { format, schema, app, exportedAt, scenario }. Typed arrays (mesh vertices / triangles) are written as
 * { "$typed": "Float64Array", "b64": "…", "n": length } - little-endian bytes, base64 - so a 1 M-triangle pit stays
 * exact and loads fast. Reading is version-tolerant: a bare scenario object (no envelope), plain-number arrays and
 * missing sections are accepted and filled from defaults; newer schema versions load with a warning.
 */
import type { HaulString, MeshAsset, Scenario } from '@/core/types';
import { emptyScenario } from '@/state/store';
import { nowIso, uid } from '@/core/ids';

export const SCENARIO_SCHEMA = 'haiul-sim/scenario@1' as const;
export const FILE_FORMAT = 'haiul-sim/file' as const;
export const FILE_EXT = '.haiul.json';

export class ScenarioFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'ScenarioFormatError'; }
}

// ── base64 (portable: browser, worker, Node ≥ 16) ────────────────────────────────────────────────
export function bytesToBase64(u8: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH) as unknown as number[]);
  return btoa(bin);
}
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type TypedCtor = Float64ArrayConstructor | Float32ArrayConstructor | Uint32ArrayConstructor | Int32ArrayConstructor
  | Uint16ArrayConstructor | Int16ArrayConstructor | Uint8ArrayConstructor | Int8ArrayConstructor | Uint8ClampedArrayConstructor;
const TYPED: Record<string, TypedCtor> = {
  Float64Array, Float32Array, Uint32Array, Int32Array, Uint16Array, Int16Array, Uint8Array, Int8Array, Uint8ClampedArray,
};
type AnyTyped = InstanceType<TypedCtor>;

function typedName(v: ArrayBufferView): string | undefined {
  for (const [name, C] of Object.entries(TYPED)) if (v instanceof C) return name;
  return undefined;
}

function replacer(_key: string, v: unknown): unknown {
  if (v && typeof v === 'object' && ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const name = typedName(v);
    if (!name) return v;
    const t = v as AnyTyped;
    return { $typed: name, n: t.length, b64: bytesToBase64(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)) };
  }
  return v;
}

function reviver(_key: string, v: unknown): unknown {
  if (v && typeof v === 'object' && '$typed' in v && 'b64' in v) {
    const o = v as { $typed: string; b64: string; n?: number };
    const C = TYPED[o.$typed];
    if (!C || typeof o.b64 !== 'string') throw new ScenarioFormatError(`Unknown array type "${o.$typed}"`);
    const bytes = base64ToBytes(o.b64);
    if (bytes.byteLength % C.BYTES_PER_ELEMENT !== 0) throw new ScenarioFormatError(`Corrupt ${o.$typed} data`);
    // copy into a fresh, aligned buffer
    return new C(bytes.buffer, bytes.byteOffset, bytes.byteLength / C.BYTES_PER_ELEMENT);
  }
  return v;
}

// ── write ────────────────────────────────────────────────────────────────────────────────────────
export interface FileEnvelope {
  format: typeof FILE_FORMAT;
  schema: string;
  app: string;
  exportedAt: string;
  scenario: Scenario;
}

export function serializeScenario(s: Scenario, opts: { pretty?: boolean } = {}): string {
  const env: FileEnvelope = { format: FILE_FORMAT, schema: SCENARIO_SCHEMA, app: 'hAIul SIM', exportedAt: nowIso(), scenario: s };
  return JSON.stringify(env, replacer, opts.pretty ? 1 : undefined);
}

export function scenarioFileName(s: Pick<Scenario, 'name'>): string {
  const base = s.name.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'scenario';
  return `${base}${FILE_EXT}`;
}

// ── read ─────────────────────────────────────────────────────────────────────────────────────────
export interface ParsedScenario { scenario: Scenario; warnings: string[]; version: number }

const SCHEMA_RE = /^haiul-sim\/scenario@(\d+)$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function toTyped<C extends TypedCtor>(v: unknown, C: C): InstanceType<C> | null {
  if (v instanceof C) return v as InstanceType<C>;
  if (Array.isArray(v) && v.every(x => typeof x === 'number')) return C.from(v) as InstanceType<C>;
  if (v && typeof v === 'object' && ArrayBuffer.isView(v)) return C.from(v as unknown as ArrayLike<number>) as InstanceType<C>;
  return null;
}

/** Fill gaps from defaults so older / hand-edited files load; never throws on a well-formed scenario object. */
export function normaliseScenario(raw: Record<string, unknown>, warnings: string[] = []): Scenario {
  const base = emptyScenario(typeof raw.name === 'string' ? raw.name : 'Imported scenario');
  const r = raw as Partial<Scenario>;
  const assets: MeshAsset[] = [];
  for (const a of arr<MeshAsset>(r.assets)) {
    if (!isObj(a) || !isObj(a.mesh)) { warnings.push('Skipped a surface with no triangulation.'); continue; }
    const verts = toTyped(a.mesh.verts, Float64Array);
    const tris = toTyped(a.mesh.tris, Uint32Array);
    if (!verts || !tris) { warnings.push(`Skipped "${a.name ?? 'surface'}": unreadable mesh data.`); continue; }
    assets.push({ ...a, id: a.id || uid('ast'), visible: a.visible ?? true, opacity: a.opacity ?? 1, mesh: { verts, tris } });
  }
  const strings: HaulString[] = arr<HaulString>(r.strings)
    .filter(isObj)
    .map(hs => ({ ...hs, id: hs.id || uid('str'), points: arr(hs.points), visible: hs.visible ?? true }));
  return {
    ...base,
    ...r,
    schema: SCENARIO_SCHEMA,
    id: typeof r.id === 'string' && r.id ? r.id : base.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name : base.name,
    createdAt: r.createdAt ?? base.createdAt,
    updatedAt: r.updatedAt ?? base.updatedAt,
    site: { ...base.site, ...(isObj(r.site) ? r.site : {}) },
    assets,
    strings,
    circuits: arr(r.circuits),
    materials: arr(r.materials),
    fleet: { ...base.fleet, ...(isObj(r.fleet) ? r.fleet : {}) },
    crew: { ...base.crew, ...(isObj(r.crew) ? r.crew : {}) },
    shift: { ...base.shift, ...(isObj(r.shift) ? r.shift : {}), events: arr(isObj(r.shift) ? r.shift.events : []) },
    settings: { ...base.settings, ...(isObj(r.settings) ? r.settings : {}) },
  };
}

/** Parse a `.haiul.json` file (or a bare scenario JSON). Throws ScenarioFormatError when it is not a scenario. */
export function parseScenarioFile(text: string): ParsedScenario {
  let data: unknown;
  try { data = JSON.parse(text, reviver); }
  catch (e) {
    if (e instanceof ScenarioFormatError) throw e;
    throw new ScenarioFormatError('This file is not valid JSON.');
  }
  if (!isObj(data)) throw new ScenarioFormatError('This file does not contain a hAIul SIM scenario.');
  const raw = isObj(data.scenario) ? data.scenario : data;
  const schema = typeof raw.schema === 'string' ? raw.schema : typeof data.schema === 'string' ? data.schema : '';
  const m = SCHEMA_RE.exec(schema);
  if (!m) throw new ScenarioFormatError('This file does not contain a hAIul SIM scenario (missing "haiul-sim/scenario" schema).');
  const version = Number(m[1]);
  const warnings: string[] = [];
  if (version > 1) warnings.push(`Saved by a newer version of hAIul SIM (schema @${version}); fields this version does not know are kept but ignored.`);
  const scenario = normaliseScenario(raw, warnings);
  return { scenario, warnings, version };
}

/** True when the text looks like a scenario file (cheap sniff before a full parse). */
export const looksLikeScenario = (head: string) => /"haiul-sim\/(scenario|file)/.test(head);
