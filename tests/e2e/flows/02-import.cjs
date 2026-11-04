/**
 * 2. Import: the .00t topo via the welcome file picker → import modal → role Topo → added; the closed solid dropped on
 * the window → detected as a closed solid with a volume → role Dump → added; parse warnings shown if any.
 */
const fs = require('fs');

async function modalItem(page) {
  const modal = page.getByRole('dialog').filter({ hasText: /Load the pit|Add to the scenario/ });
  await modal.waitFor({ timeout: 30_000 });
  return modal;
}

/** Wait until no import card says "Reading the triangulation…". */
async function waitParsed(page, modal, timeout = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const txt = await modal.innerText();
    if (!/Reading the triangulation/.test(txt) && /Triangles/.test(txt)) return txt;
    if (/could not be read/.test(txt)) return txt;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('import parse timed out');
}

/** Warnings rendered in the modal vs warnings held by the import item (shell ui store). */
async function warningsState(t) {
  const items = await t.page.evaluate(async mi => {
    const __mod = (0, eval)('(' + mi + ')');
    const { useShellUi } = await __mod('/src/features/workspace/uiStore.ts');
    return useShellUi.getState().importItems.map(i => ({ name: i.fileName, status: i.status, kind: i.kind, role: i.role, warnings: i.warnings, volume: i.stats && i.stats.volume, closed: i.stats && i.stats.closed, tris: i.stats && i.stats.triangleCount }));
  }, t.L.MODULE_IMPORT).catch(e => ({ error: e.message }));
  return items;
}

module.exports = {
  id: 2,
  name: 'Import .00t topo (picker) + closed solid (drop)',
  timeout: 420_000,
  async run(t) {
    const { L, page } = t;
    if (!fs.existsSync(L.FIX.topo)) throw new Error(`topo fixture missing: ${L.FIX.topo} (set E2E_TOPO)`);
    await L.open(page);
    await page.getByRole('dialog', { name: 'Start a scenario' }).waitFor({ timeout: 60_000 });

    // ── topo via the welcome "Pit surface" tile → native file chooser
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15_000 }),
      page.getByRole('button', { name: /Pit surface/ }).click(),
    ]);
    t.check(!chooser.isMultiple(), 'pit surface picker is single-file');
    const t0 = Date.now();
    await chooser.setFiles(L.FIX.topo);
    let modal = await modalItem(page);
    t.check(/Load the pit/.test(await modal.innerText()), 'import modal opens ("Load the pit")');
    let txt = await waitParsed(page, modal);
    t.note(`topo (${(fs.statSync(L.FIX.topo).size / 1e6).toFixed(1)} MB) parsed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    t.check(/Surface/.test(txt) && !/Closed solid/.test(txt), 'topo detected as an open surface', txt.slice(0, 200));
    t.check(/Triangles/.test(txt) && /Plan area/.test(txt) && /RL range/.test(txt), 'surface readouts shown (triangles, plan area, RL range)');
    const topoTab = modal.getByRole('tab', { name: 'Topo', exact: true });
    await topoTab.click();
    t.check(await topoTab.getAttribute('aria-selected') === 'true', 'role Topo selected');
    let w = await warningsState(t);
    const domWarns = await modal.locator('svg + *').filter({ hasText: /./ }).count().catch(() => 0);
    t.check(Array.isArray(w) && w.length === 1 && w[0].status === 'ready' && w[0].role === 'topo', 'import item ready with role topo', w);
    if (Array.isArray(w) && w[0] && w[0].warnings.length) {
      for (const msg of w[0].warnings) t.check(txt.includes(msg.replace(/^Reader: /, '')), `parse warning shown: ${msg}`);
    } else t.note(`topo: no parse warnings (${domWarns} candidate warning nodes)`);
    await t.shot('topo_modal');
    await modal.getByRole('button', { name: /^Add to scenario$|^Add \d+ to scenario$/ }).click();
    await L.waitStore(page, st => st.scenario.assets.length === 1);
    let s = await L.summary(page);
    t.check(s.assets === 1 && s.roles[0] === 'topo:surface', 'topo added to the scenario', s.roles);
    await page.getByRole('dialog').filter({ hasText: /Load the pit/ }).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    t.check(!(await page.getByRole('dialog', { name: 'Start a scenario' }).isVisible().catch(() => false)), 'welcome card replaced by the site');
    await L.waitScene(page);
    await L.sleep(2500);
    await t.shot('topo_added');

    // ── closed solid dropped on the window
    await L.dropFiles(page, [L.FIX.solid]);
    modal = await modalItem(page);
    txt = await waitParsed(page, modal);
    t.check(/Add to the scenario/.test(txt), 'second import opens "Add to the scenario"');
    t.check(/Closed solid/.test(txt), 'solid detected as "Closed solid"', txt.slice(0, 160));
    t.check(/Volume/.test(txt) && /bcm/.test(txt), 'volume readout shown', (txt.match(/Volume\s*[\d.,]+\s*\w*\s*bcm/) || [])[0]);
    w = await warningsState(t);
    const item = Array.isArray(w) ? w.find(i => /dump/i.test(i.name)) : undefined;
    t.check(item && item.closed && item.volume > 1000, 'parser: closed with positive volume', item && { volume: item.volume, closed: item.closed, tris: item.tris });
    t.check(item && item.role === 'dump', 'role guessed Dump from the file name', item && item.role);
    const dumpTab = modal.getByRole('tab', { name: 'Dump', exact: true });
    await dumpTab.click();
    t.check(await dumpTab.getAttribute('aria-selected') === 'true', 'role Dump selected');
    txt = await modal.innerText();
    t.check(/Material/.test(txt) && /Fill/.test(txt), 'dump options (material, fill mode) shown');
    w = await warningsState(t);
    const item2 = Array.isArray(w) ? w.find(i => /dump/i.test(i.name)) : undefined;
    if (item2 && item2.warnings.length) {
      for (const msg of item2.warnings) t.check(txt.includes(msg.replace(/^Reader: /, '')), `parse warning shown: ${msg}`);
      t.check(/with notes/.test(txt), 'footer flags items with notes');
    } else t.note('solid: no parse warnings');
    await t.shot('solid_modal');
    await modal.getByRole('button', { name: /^Add to scenario$|^Add \d+ to scenario$/ }).click();
    await L.waitStore(page, st => st.scenario.assets.length === 2);
    s = await L.summary(page);
    t.check(s.roles.includes('dump:solid'), 'dump solid added', s.roles);
    const vol = await L.probe(page, st => { const a = st.scenario.assets.find(x => x.role === 'dump'); return { vol: a.stats.volume, block: a.block }; });
    t.check(vol.vol > 1000 && vol.block && vol.block.depletionMode === 'bottom-up', 'dump keeps its volume and fills bottom-up', vol);
    const insp = await L.inspector(page).innerText();
    t.check(/SURFACES & SOLIDS · 2/i.test(insp) && /Dump/.test(insp), 'inspector lists the dump solid', insp.slice(-200));
    await L.sleep(2000);
    await t.shot('solid_added');
    // the import is one undo step per commit
    t.check(s.past === 2, `two undoable import steps (${s.past})`);
  },
};
