/**
 * 4. Circuit: create a new circuit from the inspector (loader, truck, material, string) → KPIs show; click a different
 * row in the # trucks chooser → trucks assigned changes and the status badge (under / balanced / over) and lost PT
 * follow; switch the speed model Spreadsheet ↔ Rimpull → the cycle time changes (and comes back).
 */
async function headBadge(insp) {
  // StatusBadge in the card head: Under / Balanced / Over
  const head = insp.locator('header').first();
  const t = await head.innerText();
  return (t.match(/\b(Under|Balanced|Over|Incomplete|Parked)\b/) || [])[1] || null;
}

module.exports = {
  id: 4,
  name: 'Circuit: create, # trucks chooser, speed model',
  timeout: 1_800_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const insp = L.inspector(page);
    const s0 = await L.summary(page);

    await insp.getByRole('button', { name: 'New circuit' }).first().click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New circuit' });
    await modal.waitFor();
    const loaderSel = modal.getByLabel('Loader unit');
    const loaders = await loaderSel.locator('option').allInnerTexts();
    const free = loaders.find(l => !/in use/.test(l));
    t.check(loaders.length >= 1, `loader options listed (${loaders.join(', ')})`);
    if (free) await loaderSel.selectOption({ label: free });
    const truckSel = modal.getByLabel('Truck model');
    const trucks = await truckSel.locator('option').allInnerTexts();
    const truckPick = trucks[Math.min(1, trucks.length - 1)];
    await truckSel.selectOption({ label: truckPick });
    const matSel = modal.getByLabel('Material');
    const mats = await matSel.locator('option').allInnerTexts();
    const matPick = mats.find(m => /\(OB\)/.test(m)) || mats[0];
    await matSel.selectOption({ label: matPick });
    const strSel = modal.getByLabel('Haul string');
    const strPick = (await strSel.locator('option').allInnerTexts()).find(x => /long haul/i.test(x));
    await strSel.selectOption({ label: strPick });
    const digSel = modal.getByLabel('Dig block'), dumpSel = modal.getByLabel('Dump');
    const digPick = (await digSel.locator('option').allInnerTexts()).find(x => /EX09/.test(x));
    const dumpPick = (await dumpSel.locator('option').allInnerTexts()).find(x => /S51/.test(x));
    if (digPick) await digSel.selectOption({ label: digPick });
    if (dumpPick) await dumpSel.selectOption({ label: dumpPick });
    await modal.getByPlaceholder(/./).first().fill('QA circuit');
    t.note(`new circuit: loader ${free || loaders[0]}, ${truckPick}, ${matPick}, ${strPick}, ${digPick} → ${dumpPick}`);
    const mtxt = await modal.innerText();
    t.check(/Defaults from/.test(mtxt) && /bcm\/load/.test(mtxt), 'loader defaults preview shown');
    await t.shot('new_circuit_modal');
    await modal.getByRole('button', { name: 'Create circuit' }).click();
    await L.waitStore(page, (st, n) => st.scenario.circuits.length === n + 1, s0.circuits);
    const c = await L.probe(page, st => { const c = st.scenario.circuits[st.scenario.circuits.length - 1]; return { id: c.id, name: c.name, trucks: c.trucks, model: c.params.speedModel, truck: c.truckModelId, sel: st.selection }; });
    t.check(c.name === 'QA circuit', 'circuit created with the typed name', c);
    t.check(c.sel.kind === 'circuit' && c.sel.id === c.id, 'new circuit opens in the inspector');
    await insp.getByText('Cycle time').first().waitFor();
    let txt = await insp.innerText();
    for (const k of ['Cycle time', 'Trucks needed', 'Loader PT', 'Lost PT', 'Production', 'Match factor']) t.check(txt.includes(k), `KPI "${k}" shown`);
    let res = (await L.circuitResults(page)).find(r => r.id === c.id);
    t.check(res.ok && res.cycleMin > 0, `engine result ok (cycle ${res.cycleMin && res.cycleMin.toFixed(2)} min, ${res.trucksExact && res.trucksExact.toFixed(2)} trucks needed)`);
    const kCycle = L.numIn(await L.kpiValue(insp, 'Cycle time'));
    t.check(Math.abs(kCycle - Math.round(res.cycleMin * 10) / 10) < 1e-9, `inspector cycle ${kCycle} min = engine ${res.cycleMin.toFixed(3)}`);
    await t.shot('new_circuit_kpis');

    // ── # trucks chooser
    const list = insp.getByRole('listbox', { name: 'Number of trucks' });
    await list.scrollIntoViewIfNeeded();
    const rows = list.getByRole('option');
    const n = await rows.count();
    const ns = [];
    for (let i = 0; i < n; i++) ns.push(Number((await rows.nth(i).locator('span').first().innerText()).trim()));
    t.check(n >= 3, `chooser offers ${n} rows (${ns.join(', ')})`);
    const recIdx = await rows.evaluateAll(els => els.findIndex(e => /recommended:/.test(e.title)));
    const recN = ns[recIdx];
    t.note(`recommended ${recN} trucks; assigned ${c.trucks}`);
    const seen = {};
    for (const target of [ns[0], ns[ns.length - 1], recN]) {
      const before = (await L.circuitResults(page)).find(r => r.id === c.id);
      const lostBefore = await L.kpiValue(insp, 'Lost PT');
      await rows.nth(ns.indexOf(target)).click();
      await L.waitStore(page, (st, a) => st.scenario.circuits.find(x => x.id === a.id).trucks === a.n, { id: c.id, n: target });
      await page.waitForTimeout(300);
      const after = (await L.circuitResults(page)).find(r => r.id === c.id);
      const sel = await rows.nth(ns.indexOf(target)).getAttribute('aria-selected');
      const badge = await headBadge(insp);
      const lost = await L.kpiValue(insp, 'Lost PT');
      const expectBadge = { under: 'Under', balanced: 'Balanced', over: 'Over' }[after.status];
      seen[after.status] = true;
      t.check(after.trucks === target && sel === 'true', `row ${target} → ${target} trucks assigned (aria-selected)`);
      t.check(badge === expectBadge, `status badge "${badge}" = engine status ${after.status}`);
      t.check(Math.abs(L.numIn(lost) - Math.round(after.lostPt * 100) / 100) < 1e-9, `Lost PT KPI ${lost} = engine ${after.lostPt.toFixed(3)} h/shift`);
      if (before.trucks !== after.trucks && Math.abs(before.lostPt - after.lostPt) > 0.005) t.check(lost !== lostBefore, `Lost PT updates (${lostBefore} → ${lost})`);
    }
    t.check(seen.under && seen.over, `chooser reaches under and over (${Object.keys(seen).join(', ')})`);
    t.check(seen.balanced, 'recommended row reads Balanced');
    await t.shot('trucks_chooser');

    // ── speed model (segment buttons located by their text: see the label-wrapping check below)
    const tabBtn = label => insp.locator('button[role="tab"]', { hasText: new RegExp(`^${label}$`) });
    await tabBtn('Rimpull').scrollIntoViewIfNeeded();
    res = (await L.circuitResults(page)).find(r => r.id === c.id);
    const cyc0 = await L.kpiValue(insp, 'Cycle time');
    await tabBtn('Rimpull').click();
    await L.waitStore(page, (st, id) => st.scenario.circuits.find(x => x.id === id).params.speedModel === 'rimpull', c.id);
    await page.waitForTimeout(300);
    const resR = (await L.circuitResults(page)).find(r => r.id === c.id);
    const cycR = await L.kpiValue(insp, 'Cycle time');
    t.check(resR.ok && Math.abs(resR.cycleMin - res.cycleMin) > 0.01, `rimpull cycle differs (${res.cycleMin.toFixed(2)} → ${resR.cycleMin && resR.cycleMin.toFixed(2)} min)`);
    t.check(cycR !== cyc0 && Math.abs(L.numIn(cycR) - Math.round(resR.cycleMin * 10) / 10) < 1e-9, `inspector cycle follows (${cyc0} → ${cycR})`);
    t.check(/Motion/.test(await insp.innerText()), 'rimpull exposes the motion model option');
    await t.shot('rimpull');

    // accessibility / label activation: the segmented control sits inside <label> (ui Field)
    const names = await insp.getByRole('tablist').filter({ hasText: /^SpreadsheetRimpull$/ }).first().ariaSnapshot();
    t.check(!/tab "Speed model/.test(names), 'speed-model tabs are named by their own text (not the field caption)', names.replace(/\n/g, ' | '));
    await insp.locator('label > span', { hasText: /^Speed model$/ }).click();
    const afterCaption = await L.probe(page, (st, id) => st.scenario.circuits.find(x => x.id === id).params.speedModel, c.id);
    t.check(afterCaption === 'rimpull', 'clicking the "Speed model" caption does not change the model', { speedModel: afterCaption });
    if (afterCaption !== 'rimpull') { await tabBtn('Rimpull').click(); await page.waitForTimeout(200); }
    const hsCap = insp.locator('label > span', { hasText: /^Haul string/ }).first();
    const hb = await hsCap.boundingBox();
    await page.mouse.click(hb.x + 10, hb.y + hb.height / 2);
    await page.waitForTimeout(300);
    const selAfter = (await L.summary(page)).selection;
    t.check(selAfter.kind === 'circuit', 'clicking the "Haul string" caption keeps the circuit open', selAfter);
    if (selAfter.kind !== 'circuit') {
      await insp.getByRole('button', { name: 'Overview' }).click();
      await insp.locator('button', { hasText: 'QA circuit' }).first().click();
      await insp.getByText('Cycle time').first().waitFor();
    }

    await tabBtn('Spreadsheet').scrollIntoViewIfNeeded();
    await tabBtn('Spreadsheet').click();
    await L.waitStore(page, (st, id) => st.scenario.circuits.find(x => x.id === id).params.speedModel === 'spreadsheet', c.id);
    await page.waitForTimeout(300);
    const resS = (await L.circuitResults(page)).find(r => r.id === c.id);
    t.check(Math.abs(resS.cycleMin - res.cycleMin) < 1e-12, 'back to Spreadsheet restores the cycle exactly');
    t.check(await L.kpiValue(insp, 'Cycle time') === cyc0, 'inspector cycle restored');
  },
};
