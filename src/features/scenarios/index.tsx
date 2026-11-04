/**
 * OWNER: shell agent. Scenario library - public entry.
 *
 *  ScenariosView              the Scenarios page (grid of saved scenarios, compare picks)
 *  useScenarioPicks           zustand store { ids, toggle(id), clear() } - scenarios ticked for the Compare view
 *  listScenarios / loadScenario / saveScenario / deleteScenario      IndexedDB library (DB_NAME, DB_VERSION)
 *  serializeScenario / parseScenarioFile                             `.haiul.json` files (schema haiul-sim/scenario@1)
 */
export { ScenariosView } from './ScenariosView';
export {
  useScenarioPicks, useLibrary, saveCurrent, openScenario, newScenario, exportScenarioFile, importScenarioFile, downloadText,
  startAutosave, checkRecovery, restoreRecovery, discardRecovery,
} from './library';
export {
  DB_NAME, DB_VERSION, listScenarios, loadScenario, saveScenario, deleteScenario, scenarioKpis,
  type LibraryMeta, type ScenarioKpis, type SaveOptions,
} from './db';
export { serializeScenario, parseScenarioFile, scenarioFileName, looksLikeScenario, ScenarioFormatError, SCENARIO_SCHEMA, FILE_EXT } from './serialize';
export { makeThumbnail, planThumbnail } from './thumbnail';
export { ago } from './time';
