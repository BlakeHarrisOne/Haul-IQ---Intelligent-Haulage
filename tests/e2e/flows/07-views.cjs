/**
 * 7. Views: Assumptions, Truck curves, Compare, Manning, Priority and Scenarios each render without errors and show
 * non-empty content consistent with the site view (e.g. the circuit's cycle time on Assumptions = the inspector's).
 */
async function openView(t, key, title) {
  const { L, page } = t;
  const before = t.log.filter(l => l.type === 'error' || l.type === 'pageerror').length;
  await L.key(page, key);
  const region = page.getByRole('region', { name: title });
  await region.waitFor({ timeout: 60_000 });
  await L.sleep(1200);
  const txt = await region.innerText();
  const errs = t.log.filter(l => l.type === 'error' || l.type === 'pageerror').slice(before);
  t.check(errs.length === 0, `${title}: no errors while rendering`, errs.map(e => e.text.slice(0, 160)));
  t.check(txt.length > 300, `${title}: non-empty (${txt.length} chars)`);
  t.check(!/is being built|cannot be calculated|No circuits yet|Nothing to man yet|No active circuits/.test(txt), `${title}: no empty / error state`);
  return { region, txt };
}

module.exports = {
  id: 7,
  name: 'Views: Assumptions, Curves, Compare, Manning, Priority, Scenarios',
  timeout: 900_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const insp = L.inspector(page);
    const overview = await insp.innerText();
    const totalBcm = (overview.match(/Production\s*\n?([\d,]+)/) || [])[1];
    const res = await L.circuitResults(page);
    const c0 = res[0];
    await insp.locator('button', { hasText: c0.name }).first().click();
    await insp.getByText('Cycle time').first().waitFor();
    const inspCycle = L.numIn(await L.kpiValue(insp, 'Cycle time'));
    const inspNeeded = L.numIn(await L.kpiValue(insp, 'Trucks needed'));
    const truckName = await L.probe(page, (st, id) => { const c = st.scenario.circuits.find(x => x.id === id); return st.scenario.fleet.trucks.find(x => x.id === c.truckModelId).name; }, c0.id);
    const ib = await insp.boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 30);

    // 2 Assumptions
    let v = await openView(t, '2', 'Assumptions');
    t.check(/Assumptions & calculations/.test(v.txt) && v.txt.includes(c0.name), `Assumptions opens on the selected circuit (${c0.name})`);
    const aCycle = L.numIn(await L.kpiValue(v.region, 'Cycle time'));
    t.check(Math.abs(Math.round(aCycle * 10) / 10 - inspCycle) < 1e-9 && Math.abs(aCycle - c0.cycleMin) < 0.006, `cycle ${aCycle} min (Assumptions) = ${inspCycle} min (inspector)`);
    const aNeeded = L.numIn(await L.kpiValue(v.region, 'Trucks needed'));
    t.check(Math.abs(aNeeded - inspNeeded) < 0.006, `trucks needed ${aNeeded} = inspector ${inspNeeded}`);
    t.check(/Calculation ledger/.test(v.txt) && /ActiveRoute!/.test(v.txt), 'ledger with workbook cell references');
    await t.shot('assumptions');

    // 3 Truck curves
    v = await openView(t, '3', 'Truck curves');
    const svgs = await v.region.locator('svg').count();
    t.check(svgs >= 3, `curves drawn (${svgs} svg)`);
    t.check(v.txt.includes(truckName) && /Rimpull|rimpull/.test(v.txt), `curves cover ${truckName}`);
    await t.shot('curves');

    // 4 Compare
    v = await openView(t, '4', 'Compare');
    for (const r of res) t.check(v.txt.includes(r.name.split(' → ')[0]), `Compare lists ${r.name}`);
    for (const r of res) t.check(v.txt.includes(r.cycleMin.toFixed(2)), `Compare cycle ${r.cycleMin.toFixed(2)} min for ${r.name.split(' ')[0]}`);
    await t.shot('compare');

    // 5 Manning
    v = await openView(t, '5', 'Manning');
    const man = await page.evaluate(async mi => {
      const __mod = (0, eval)('(' + mi + ')');
      const { useApp } = await __mod('/src/state/store.ts');
      const { manningFor } = await __mod('/src/state/derived.ts');
      const m = manningFor(useApp.getState().scenario);
      return { total: m.total, available: m.available };
    }, L.MODULE_IMPORT);
    const req = L.numIn(await L.kpiValue(v.region, 'Crew required'));
    t.check(req === man.total && req > 0, `Crew required ${req} = engine ${man.total}`);
    t.check(/Trucks operating/.test(v.txt) && new RegExp(`${res.reduce((a, r) => a + r.trucks, 0)}\\s*/`).test(v.txt), 'trucks operating = trucks assigned on site');
    await t.shot('manning');

    // 6 Priority
    v = await openView(t, '6', 'Priority');
    t.check(/Fleet & task priority/.test(v.txt), 'Priority page header');
    for (const r of res) t.check(v.txt.includes(r.name), `Priority lists ${r.name}`);
    const pAvail = L.numIn(await v.region.getByTitle('Crew available (what-if)').locator('input').inputValue());
    t.check(pAvail === man.available, `Priority crew available ${pAvail} = Manning available ${man.available}`);
    const trucksUsed = await L.kpiValue(v.region, 'Trucks used');
    t.check(!!trucksUsed, `Trucks used KPI (${trucksUsed})`);
    await t.shot('priority');

    // 7 Scenarios
    v = await openView(t, '7', 'Scenarios');
    const s = await L.summary(page);
    t.check(/Not saved yet|Unsaved changes/.test(v.txt), 'current scenario card (not saved yet)');
    t.check(v.txt.includes(s.name), `card names "${s.name}"`);
    const cardCounts = await v.region.locator('[title$="circuits"], [title$="haul strings"], [title$="surfaces"]').evaluateAll(els => els.map(e => e.title));
    t.check(cardCounts.includes(`${s.circuits} circuits`) && cardCounts.includes(`${s.strings} haul strings`) && cardCounts.includes(`${s.assets} surfaces`), 'card counts match the document', cardCounts);
    t.check(!!totalBcm && v.txt.includes(totalBcm), `card production ${totalBcm} bcm/d = inspector total`);
    await t.shot('scenarios');

    await L.key(page, 'Escape');
    await L.waitStore(page, st => st.view === 'site');
    t.check(true, 'Esc returns to Site');
  },
};
