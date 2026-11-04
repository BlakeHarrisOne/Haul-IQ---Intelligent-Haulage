/**
 * Saved-scenario access for "Scenario vs scenario", through the shell's public entry '@/features/scenarios'
 * (listScenarios / loadScenario / useScenarioPicks — the Scenarios library ticks the same picks).
 * The dev harness can register extra in-memory scenarios.
 */
import { listScenarios, loadScenario, useScenarioPicks } from '@/features/scenarios';
import type { Scenario, ScenarioMeta } from '@/core/types';

export const usePicks = useScenarioPicks;

const dev = new Map<string, Scenario>();
/** Harness only: make in-memory scenarios pickable without touching IndexedDB. */
export function registerDevScenarios(list: Scenario[]) { for (const s of list) dev.set(s.id, s); }

export function metaOf(s: Scenario): ScenarioMeta {
  return { id: s.id, name: s.name, description: s.description, updatedAt: s.updatedAt, circuits: s.circuits.length, strings: s.strings.length, assets: s.assets.length };
}

export async function listSaved(): Promise<ScenarioMeta[]> {
  const out: ScenarioMeta[] = [];
  try { out.push(...(await listScenarios())); } catch (e) { console.warn('scenario list failed', e); }
  for (const s of dev.values()) if (!out.some(m => m.id === s.id)) out.push(metaOf(s));
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function loadSaved(id: string): Promise<Scenario | undefined> {
  if (dev.has(id)) return dev.get(id);
  try { return await loadScenario(id); } catch (e) { console.warn('scenario load failed', e); return undefined; }
}
