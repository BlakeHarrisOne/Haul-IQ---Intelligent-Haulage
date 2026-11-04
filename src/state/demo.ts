/**
 * Demo scenario composer: geometry from '@/demo/demoSite' (geometry agent) + fleet / crew / shift / circuits from
 * '@/data' (engine agent). Uses import.meta.glob so the app compiles before either module exists.
 *
 * Contracts expected:
 *   src/demo/demoSite.ts  export function buildDemoSite(): { site: SiteInfo; assets: MeshAsset[]; strings: HaulString[] }
 *   src/data/index.ts     export function defaultScenarioData(): Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'>
 *                         export function demoCircuits(assets: MeshAsset[], strings: HaulString[], data: Pick<Scenario,'materials'|'fleet'|'crew'|'shift'>): Circuit[]
 */
import type { Circuit, HaulString, MeshAsset, Scenario, SiteInfo } from '@/core/types';
import { emptyScenario } from './store';

type DemoSiteMod = { buildDemoSite?: () => { site: SiteInfo; assets: MeshAsset[]; strings: HaulString[] } };
type DataMod = {
  defaultScenarioData?: () => Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'>;
  demoCircuits?: (assets: MeshAsset[], strings: HaulString[], data: Pick<Scenario, 'materials' | 'fleet' | 'crew' | 'shift'>) => Circuit[];
};

const siteMods = import.meta.glob<DemoSiteMod>('../demo/demoSite.ts');
const dataMods = import.meta.glob<DataMod>('../data/index.ts');

export async function createDemoScenario(): Promise<Scenario> {
  const s = emptyScenario('Demo – Strip pit, week 45');
  s.description = 'Synthetic Queensland strip coal mine: three circuits (EX09 OB, EX04 OB, LDR coal) on a procedurally generated pit.';
  const siteLoader = Object.values(siteMods)[0];
  const dataLoader = Object.values(dataMods)[0];
  const siteMod = siteLoader ? await siteLoader() : undefined;
  const dataMod = dataLoader ? await dataLoader() : undefined;
  if (dataMod?.defaultScenarioData) Object.assign(s, dataMod.defaultScenarioData());
  if (siteMod?.buildDemoSite) {
    const d = siteMod.buildDemoSite();
    s.site = d.site;
    s.assets = d.assets;
    s.strings = d.strings;
  }
  if (dataMod?.demoCircuits) s.circuits = dataMod.demoCircuits(s.assets, s.strings, s);
  return s;
}

/** Load the demo into the store (used by the welcome screen and `?demo`). */
export async function loadDemo(): Promise<void> {
  const { useApp } = await import('./store');
  const s = await createDemoScenario();
  useApp.getState().replaceScenario(s, { markClean: true });
}
