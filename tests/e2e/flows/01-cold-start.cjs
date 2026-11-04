/** 1. Cold start shows the welcome card; "Open the demo site" loads circuits, strings and solids; no console errors. */
module.exports = {
  id: 1,
  name: 'Cold start → welcome → Open demo',
  async run(t) {
    const { L, page } = t;
    await L.open(page);
    const card = page.getByRole('dialog', { name: 'Start a scenario' });
    await card.waitFor({ timeout: 60_000 });
    t.check(await card.isVisible(), 'welcome card visible on cold start');
    t.check(/Plan the haul/.test(await card.innerText()), 'welcome headline rendered');
    const demoBtn = page.getByRole('button', { name: /Open the demo site/i });
    t.check(await demoBtn.isEnabled(), '"Open the demo site" enabled');
    const s0 = await L.summary(page);
    t.check(s0.assets === 0 && s0.circuits === 0 && s0.strings === 0, 'empty scenario before demo', s0);
    t.check(await page.locator('[role="slider"][aria-label="Shift time"]').count() === 0, 'no timeline before a site exists');
    await t.shot('welcome');

    const t0 = Date.now();
    await L.loadDemoViaWelcome(page);
    t.note(`demo loaded + scene ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const s = await L.summary(page);
    t.check(s.circuits >= 3, `demo has circuits (${s.circuits})`);
    t.check(s.strings >= 4, `demo has haul strings (${s.strings})`);
    const solids = s.roles.filter(r => r.endsWith(':solid'));
    t.check(solids.filter(r => r.startsWith('dig')).length >= 1 && solids.filter(r => r.startsWith('dump')).length >= 1, `dig and dump solids present (${solids.join(', ')})`);
    t.check(s.roles.includes('topo:surface'), 'topo surface present');
    t.check(!(await card.isVisible().catch(() => false)), 'welcome card gone after demo');

    const insp = await L.inspector(page).innerText();
    t.check(new RegExp(`${s.circuits}\\s+active`).test(insp), 'inspector lists active circuits', insp.slice(0, 120));
    t.check(new RegExp(`HAUL STRINGS · ${s.strings}`, 'i').test(insp), 'inspector strings count matches document');
    t.check(new RegExp(`SURFACES & SOLIDS · ${s.assets}`, 'i').test(insp), 'inspector surfaces count matches document');
    for (const n of s.circuitNames) t.check(insp.includes(n), `circuit row "${n}"`);
    t.check(await page.locator('[role="slider"][aria-label="Shift time"]').isVisible(), 'shift timeline visible');
    const stats = await page.evaluate(() => window.__haiulScene.stats);
    t.check(stats.triangles > 10000 && stats.frames > 0, 'scene rendered terrain + solids', { triangles: stats.triangles, frames: stats.frames });
    const res = await L.circuitResults(page);
    t.check(res.every(r => r.ok && r.cycleMin > 0), 'every demo circuit calculates', res.map(r => `${r.name}: ${r.cycleMin && r.cycleMin.toFixed(2)} min`));
    await t.shot('demo');
  },
};
