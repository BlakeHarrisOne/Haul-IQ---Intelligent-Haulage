/**
 * 8. Manning / Priority: toggle a crew rule → the required total changes; lower the crew available on Priority → the
 * lowest-priority circuit is reduced / parked; Apply → Manning's required total equals the plan's crew used.
 */
async function crewRequired(region, L) { return L.numIn(await L.kpiValue(region, 'Crew required')); }

/** Priority cards in list order with their grant: full / reduced / parked (badge "Got g of r", "Parked", "Stood down"). */
async function priorityCards(region) {
  return region.locator('[class*="_pc_"]').evaluateAll(els => els
    .filter(e => !e.parentElement.closest('[class*="_pc_"]'))
    .map(e => {
      const text = e.innerText;
      const m = text.match(/Got (\d+) of (\d+)/);
      const status = /\b(Parked|Stood down)\b/.test(text) ? 'parked'
        : m ? (Number(m[1]) >= Number(m[2]) ? 'full' : 'reduced')
          : /\bFull\b/.test(text) ? 'full' : /\bReduced\b/.test(text) ? 'reduced' : null;
      return { text, status, grant: m ? `${m[1]}/${m[2]}` : null };
    }));
}

module.exports = {
  id: 8,
  name: 'Manning rules, priority crew cut, apply',
  timeout: 900_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const ib = await L.inspector(page).boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 30);

    // ── Manning: toggle rules until the total moves
    await L.key(page, '5');
    let region = page.getByRole('region', { name: 'Manning' });
    await region.waitFor();
    await L.sleep(800);
    const req0 = await crewRequired(region, L);
    t.check(req0 > 0, `crew required ${req0}`);
    const items = region.getByRole('listitem').filter({ has: page.getByRole('switch') });
    const n = await items.count();
    t.check(n >= 5, `rule set lists ${n} rules`);
    let toggled = null, req1 = req0;
    for (let i = 0; i < n && !toggled; i++) {
      const it = items.nth(i);
      const sw = it.getByRole('switch');
      if (await sw.getAttribute('aria-checked') !== 'true') continue;
      await sw.scrollIntoViewIfNeeded();
      await sw.click();
      await L.sleep(400);
      req1 = await crewRequired(region, L);
      const name = (await it.innerText()).split('\n').find(l => l.trim().length > 2 && !/^\d+$/.test(l.trim())) || `rule ${i + 1}`;
      if (req1 !== req0) toggled = { i, name: name.slice(0, 80), on: await sw.getAttribute('aria-checked') };
      else { await sw.click(); await L.sleep(300); } // no effect: restore and try the next
    }
    t.check(!!toggled && toggled.on === 'false', `disabling a rule changes crew required (${req0} → ${req1})`, toggled);
    const engineTotal = await page.evaluate(async mi => { const __mod = (0, eval)('(' + mi + ')'); const { useApp } = await __mod('/src/state/store.ts'); const { manningFor } = await __mod('/src/state/derived.ts'); return manningFor(useApp.getState().scenario).total; }, L.MODULE_IMPORT);
    t.check(engineTotal === req1, `Manning total ${req1} = engine ${engineTotal}`);
    await t.shot('rule_toggled');
    if (toggled) {
      await items.nth(toggled.i).getByRole('switch').click();
      await L.sleep(400);
      t.check(await crewRequired(region, L) === req0, `re-enabling restores ${req0}`);
    }

    // ── Priority: cut the crew below the requirement
    await L.key(page, '6');
    region = page.getByRole('region', { name: 'Priority' });
    await region.waitFor();
    await L.sleep(800);
    const field = region.getByTitle('Crew available (what-if)').locator('input');
    const avail0 = L.numIn(await field.inputValue());
    const res = await L.circuitResults(page);
    const active = res.filter(r => r.active).sort((a, b) => a.priority - b.priority);
    const lowest = active[active.length - 1], highest = active[0];
    const cards0 = await priorityCards(region);
    t.check(cards0.length >= active.length, `priority list shows ${cards0.length} cards`);
    t.check(cards0.every(c => c.status), 'every priority card shows its grant', cards0.map(c => `${c.text.split('\n').find(l => l.length > 3).slice(0, 24)}=${c.status}${c.grant ? ' ' + c.grant : ''}`));
    t.note(`shift crew ${avail0} vs ${req0} required: ${cards0.map(c => c.status).join(', ')}`);
    // smallest cut that reaches the last-priority circuit: walk down from the requirement
    let target = Math.min(avail0, req0) - 1, cards = cards0, lowCard, hiCard;
    for (; target > 0; target--) {
      await field.fill(String(target));
      await field.press('Enter');
      await L.sleep(500);
      cards = await priorityCards(region);
      lowCard = cards.find(c => c.text.includes(lowest.name));
      if (lowCard && /reduced|parked/.test(lowCard.status || '')) break;
    }
    hiCard = cards.find(c => c.text.includes(highest.name));
    const circuitCards = cards.filter(c => active.some(r => c.text.includes(r.name)));
    const firstCut = circuitCards.findIndex(c => c.status !== 'full');
    t.note(`crew available ${avail0} → ${target}: ${cards.map(c => `${c.text.split('\n').find(l => l.length > 3).slice(0, 28)}=${c.status}`).join(' | ')}`);
    t.check(lowCard && /reduced|parked/.test(lowCard.status || ''), `lowest-priority circuit "${lowest.name}" is ${lowCard && lowCard.status} (${lowCard && lowCard.grant || ''})`);
    t.check(hiCard && hiCard.status === 'full', `highest-priority circuit "${highest.name}" keeps its trucks (${hiCard && hiCard.grant})`);
    t.check(firstCut === -1 || circuitCards.slice(firstCut).every(c => c.status !== 'full'), 'circuit cuts land at the bottom of the priority list first', circuitCards.map(c => c.status));
    const lostTxt = await L.kpiValue(region, 'Lost bcm / day');
    t.check(/−/.test(lostTxt || '') || L.numIn(lostTxt) > 0, `lost bcm/day shown (${lostTxt})`);
    const crewUsedTxt = await L.kpiValue(region, 'Crew used');
    const crewUsed = L.numIn(crewUsedTxt);
    t.check(crewUsed <= target, `crew used ${crewUsed} ≤ available ${target}`);
    await t.shot('crew_cut');

    // ── Apply → Manning total = plan crew used
    const applyBtn = region.getByRole('button', { name: 'Apply allocation' });
    t.check(await applyBtn.isEnabled(), 'Apply allocation enabled once the plan differs');
    await applyBtn.click();
    await L.sleep(600);
    const after = await L.circuitResults(page);
    const lowAfter = after.find(r => r.id === lowest.id);
    t.check(lowAfter.trucks < lowest.trucks || !lowAfter.active, `apply cuts ${lowest.name} trucks (${lowest.trucks} → ${lowAfter.trucks})`);
    t.check(await page.locator('[role="status"]').filter({ hasText: /applied/ }).count() > 0, 'toast confirms the allocation');
    await L.key(page, '5');
    region = page.getByRole('region', { name: 'Manning' });
    await region.waitFor();
    await L.sleep(800);
    const reqAfter = await crewRequired(region, L);
    t.check(reqAfter === crewUsed, `Manning crew required ${reqAfter} = plan crew used ${crewUsed}`);
    await t.shot('manning_after_apply');
    // undo restores the request
    await L.key(page, 'Control+z');
    await L.sleep(500);
    const undone = await L.circuitResults(page);
    t.check(undone.every(r => r.trucks === res.find(x => x.id === r.id).trucks), 'Ctrl+Z restores the requested trucks');
  },
};
