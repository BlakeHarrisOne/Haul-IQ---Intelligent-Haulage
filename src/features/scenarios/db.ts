/**
 * Scenario library in IndexedDB (raw idb, no dependencies). Typed arrays clone natively, so a scenario is stored
 * as-is. Three object stores:
 *   scenarios  id → Scenario           (the full document, meshes included)
 *   meta       id → LibraryMeta        (light listing: counts, KPIs, thumbnail)
 *   kv         key → value             (the autosave recovery slot, small prefs)
 */
import type { Scenario, ScenarioMeta } from '@/core/types';
import { nowIso, uid } from '@/core/ids';
import { computeAllCircuits } from '@/engine';

export const DB_NAME = 'haiul-sim';
export const DB_VERSION = 1;
export const STORE_SCENARIOS = 'scenarios';
export const STORE_META = 'meta';
export const STORE_KV = 'kv';
const RECOVERY_KEY = 'recovery';

export interface ScenarioKpis {
  /** Production achieved at the assigned trucks, all active circuits (bcm/day). */
  bcmDay: number;
  /** Trucks assigned to active circuits. */
  trucks: number;
  /** Loader PT lost per shift, all active circuits (h). */
  lostPtHrsShift: number;
  activeCircuits: number;
}

export interface LibraryMeta extends ScenarioMeta {
  createdAt?: string;
  siteName?: string;
  savedAt?: string;
  kpis?: ScenarioKpis;
}

export interface RecoverySlot { scenario: Scenario; at: string; baseSavedAt?: string }

let dbp: Promise<IDBDatabase> | null = null;

export const idbAvailable = () => typeof indexedDB !== 'undefined';

function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    if (!idbAvailable()) { reject(new Error('IndexedDB is not available in this browser.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SCENARIOS)) db.createObjectStore(STORE_SCENARIOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error ?? new Error('Could not open the scenario library.')); };
    req.onblocked = () => console.warn('[scenarios] IndexedDB upgrade blocked by another tab');
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

// ── KPIs ─────────────────────────────────────────────────────────────────────────────────────────
export function scenarioKpis(s: Scenario): ScenarioKpis {
  let bcmDay = 0, trucks = 0, lost = 0, active = 0;
  try {
    const res = computeAllCircuits(s);
    for (const c of s.circuits) {
      if (!c.active) continue;
      active++;
      trucks += c.trucks;
      const r = res[c.id];
      if (r?.ok) { bcmDay += r.assigned.bcmPerDay; lost += r.lostPtHrsShift; }
    }
  } catch (e) { console.warn('[scenarios] KPI calculation failed', e); }
  return { bcmDay, trucks, lostPtHrsShift: lost, activeCircuits: active };
}

export function metaFor(s: Scenario, extra: Partial<LibraryMeta> = {}): LibraryMeta {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
    siteName: s.site?.name,
    circuits: s.circuits.length,
    strings: s.strings.length,
    assets: s.assets.length,
    kpis: scenarioKpis(s),
    ...extra,
  };
}

// ── library API ──────────────────────────────────────────────────────────────────────────────────
export async function listScenarios(): Promise<LibraryMeta[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  const all = await wrap(tx.objectStore(STORE_META).getAll() as IDBRequest<LibraryMeta[]>);
  return all.sort((a, b) => (b.savedAt ?? b.updatedAt).localeCompare(a.savedAt ?? a.updatedAt));
}

export async function getMeta(id: string): Promise<LibraryMeta | undefined> {
  const db = await openDb();
  return wrap(db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get(id) as IDBRequest<LibraryMeta | undefined>);
}

export async function loadScenario(id: string): Promise<Scenario | undefined> {
  const db = await openDb();
  return wrap(db.transaction(STORE_SCENARIOS, 'readonly').objectStore(STORE_SCENARIOS).get(id) as IDBRequest<Scenario | undefined>);
}

export interface SaveOptions {
  /** Data-URL thumbnail; omitted = keep the previous one. */
  thumbnail?: string;
}

export async function saveScenario(s: Scenario, opts: SaveOptions = {}): Promise<LibraryMeta> {
  const db = await openDb();
  const prev = await getMeta(s.id).catch(() => undefined);
  const meta = metaFor(s, { thumbnail: opts.thumbnail ?? prev?.thumbnail, savedAt: nowIso() });
  const tx = db.transaction([STORE_SCENARIOS, STORE_META], 'readwrite');
  tx.objectStore(STORE_SCENARIOS).put(s);
  tx.objectStore(STORE_META).put(meta);
  await done(tx);
  return meta;
}

export async function deleteScenario(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_SCENARIOS, STORE_META], 'readwrite');
  tx.objectStore(STORE_SCENARIOS).delete(id);
  tx.objectStore(STORE_META).delete(id);
  await done(tx);
}

export async function renameScenario(id: string, name: string): Promise<LibraryMeta | undefined> {
  const s = await loadScenario(id);
  if (!s) return undefined;
  return saveScenario({ ...s, name, updatedAt: nowIso() });
}

export async function duplicateScenario(id: string, name?: string): Promise<LibraryMeta | undefined> {
  const s = await loadScenario(id);
  if (!s) return undefined;
  const prev = await getMeta(id);
  const t = nowIso();
  return saveScenario({ ...s, id: uid('scn'), name: name ?? `${s.name} (copy)`, createdAt: t, updatedAt: t }, { thumbnail: prev?.thumbnail });
}

// ── autosave recovery slot ───────────────────────────────────────────────────────────────────────
export async function putRecovery(slot: RecoverySlot): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_KV, 'readwrite');
  tx.objectStore(STORE_KV).put(slot, RECOVERY_KEY);
  await done(tx);
}
export async function getRecovery(): Promise<RecoverySlot | undefined> {
  const db = await openDb();
  return wrap(db.transaction(STORE_KV, 'readonly').objectStore(STORE_KV).get(RECOVERY_KEY) as IDBRequest<RecoverySlot | undefined>);
}
export async function clearRecovery(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_KV, 'readwrite');
  tx.objectStore(STORE_KV).delete(RECOVERY_KEY);
  await done(tx);
}
