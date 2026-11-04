/** 9. Insights: open the panel; apply one suggestion → the scenario changes; undo restores it exactly. */
const APPLY = /^(Assign|Set \d+ trucks|Release \d+|Use this option|Move truck|Apply allocation)$/;

async function docState(L, page) {
  return L.probe(page, st => JSON.stringify({ c: st.scenario.circuits, f: st.scenario.fleet.trucksAvailable, crew: st.scenario.crew }));
}

module.exports = {
  id: 9,
  name: 'Insights: open, apply a suggestion, undo',
  timeout: 900_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const ib = await L.inspector(page).boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 30);
    await L.key(page, 'i');
    const panel = page.getByRole('complementary', { name: 'Insights' });
    await panel.waitFor({ timeout: 60_000 });
    await panel.locator('article').first().waitFor({ timeout: 60_000 });
    await L.sleep(800);
    const n = await panel.locator('article').count();
    t.check(n >= 1, `insights listed (${n})`);
    const heads = await panel.locator('article').evaluateAll(els => els.slice(0, 6).map(e => e.innerText.split('\n')[0]));
    t.note(`top insights: ${heads.join(' | ')}`);
    t.check(!(await L.inspector(page).isVisible().catch(() => false)), 'insights replace the inspector on the right');
    await t.shot('insights_open');

    // first insight card with an Apply-type action
    const btn = panel.locator('article').getByRole('button').filter({ hasText: APPLY }).first();
    t.check(await btn.count() > 0, 'at least one suggestion can be applied');
    const card = btn.locator('xpath=ancestor::article[1]');
    const headline = (await card.innerText()).split('\n')[0];
    const label = (await btn.innerText()).trim();
    const before = await docState(L, page);
    const s0 = await L.summary(page);
    const res0 = await L.circuitResults(page);
    // "Explain" opens the numbers behind it
    const explain = card.getByRole('button', { name: 'Explain' });
    if (await explain.count()) { await explain.click(); await L.sleep(300); t.check((await card.innerText()).split('\n').length > 6, 'Explain shows the working'); }
    await btn.click();
    await L.waitStore(page, (st, rev) => st.revision > rev, s0.revision);
    await L.sleep(500);
    const after = await docState(L, page);
    const res1 = await L.circuitResults(page);
    const s1 = await L.summary(page);
    t.check(after !== before, `"${label}" on "${headline}" changes the scenario`);
    const changed = res1.filter(r => { const o = res0.find(x => x.id === r.id); return o.trucks !== r.trucks || Math.abs((o.bcmDay || 0) - (r.bcmDay || 0)) > 1; }).map(r => `${r.name.split(' ')[0]}: ${res0.find(x => x.id === r.id).trucks}→${r.trucks} trucks`);
    t.check(changed.length > 0 || after !== before, `results move (${changed.join(', ') || 'crew/fleet edit'})`);
    t.check(s1.past === s0.past + 1, 'one undoable step');
    if (label === 'Apply allocation') {
      // the crew-limited allocation should leave a plan the shift can man (as Priority → Apply allocation does)
      const man = await page.evaluate(async mi => { const __mod = (0, eval)('(' + mi + ')'); const { useApp } = await __mod('/src/state/store.ts'); const { manningFor } = await __mod('/src/state/derived.ts'); const m = manningFor(useApp.getState().scenario); return { total: m.total, available: m.available }; }, L.MODULE_IMPORT);
      t.check(man.total <= man.available, `after "Apply allocation" the crew fits (required ${man.total} vs available ${man.available})`);
      const still = await panel.locator('article').filter({ hasText: /Crew short by/ }).count();
      t.check(still === 0, 'the crew-shortfall finding is resolved after applying its allocation', { remaining: (await panel.locator('article').first().innerText()).split('\n')[0] });
    }
    const undoName = await page.getByRole('button', { name: /^Undo / }).getAttribute('aria-label');
    t.note(`undo button: ${undoName}`);
    await t.shot('insight_applied');

    await L.key(page, 'Control+z');
    await L.waitStore(page, (st, rev) => st.revision > rev, s1.revision);
    const undone = await docState(L, page);
    t.check(undone === before, 'Ctrl+Z restores the scenario exactly');
    const res2 = await L.circuitResults(page);
    t.check(res2.every(r => { const o = res0.find(x => x.id === r.id); return o.trucks === r.trucks && Math.abs(o.bcmDay - r.bcmDay) < 1e-9; }), 'results back to the original');
    t.check(await panel.isVisible(), 'insights panel stays open after undo');
    await t.shot('insight_undone');
  },
};
