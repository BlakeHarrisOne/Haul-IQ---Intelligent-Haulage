/**
 * 3. Strings: import XYZ text through the File menu; draw a new string on the 3D surface (D, clicks, Enter) → it appears
 * in the inspector with metrics; edit a point RL in the point table of a circuit's string → string metrics and the
 * circuit's results update; undo / redo restore it.
 */
async function projectWorld(page, pts) {
  return page.evaluate(ws => {
    const ctx = window.__haiulScene.core.ctx;
    return ws.map(([e, n]) => {
      const z = ctx.heightAt(e, n);
      const p = z == null ? null : ctx.project([e, n, z]);
      return p ? { e, n, z, x: p[0] ?? p.x, y: p[1] ?? p.y } : { e, n, z, x: null, y: null };
    });
  }, pts);
}

module.exports = {
  id: 3,
  name: 'Strings: import XYZ, draw on surface, edit RL, undo/redo',
  timeout: 900_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const s0 = await L.summary(page);

    // ── import XYZ text (File menu → Import strings…)
    const fx = L.writeStringFixture(0, 'haul_string_ex07.csv');
    await page.getByRole('button', { name: 'File' }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15_000 }),
      page.getByRole('menuitem', { name: /Import strings/ }).click(),
    ]);
    await chooser.setFiles(fx.file);
    const modal = page.getByRole('dialog').filter({ hasText: 'Add to the scenario' });
    await modal.waitFor();
    const mtxt = await modal.innerText();
    t.check(/1 strings? from haul_string_ex07\.csv/.test(mtxt), 'strings preview lists the file', mtxt.match(/\d+ strings? from \S+/)?.[0]);
    t.check(new RegExp(`\\b${fx.points}\\b`).test(mtxt), `preview shows ${fx.points} points`);
    t.check(mtxt.includes(Math.round(fx.lengthM).toLocaleString('en-AU')), `preview length ≈ ${Math.round(fx.lengthM)} m`, mtxt.match(/[\d,]+ m/)?.[0]);
    await t.shot('strings_import_modal');
    await modal.getByRole('button', { name: /Add( \d+)? to scenario/ }).click();
    await L.waitStore(page, (st, n) => st.scenario.strings.length === n + 1, s0.strings);
    const imp = await L.probe(page, st => { const h = st.scenario.strings[st.scenario.strings.length - 1]; return { name: h.name, n: h.points.length, source: h.source, first: h.points[0] }; });
    t.check(imp.n === fx.points && imp.source === 'imported', 'imported string has every point', imp);
    t.check(Math.abs(imp.first.e - 236037.82) < 1e-6 && Math.abs(imp.first.n - 7051810.44) < 1e-6, 'Easting / Northing not swapped');

    // ── draw a new string on the surface
    // shortcut D with the cursor over the 3D view (where a user's pointer is when they decide to draw)
    const vb = await L.canvasBox(page);
    await page.mouse.move(vb.x + vb.width * 0.35, vb.y + vb.height * 0.55);
    await L.key(page, 'd');
    const toolAfterD = (await L.summary(page)).tool;
    t.check(toolAfterD === 'draw', 'D (cursor over the 3D view) selects the draw tool', { tool: toolAfterD });
    if (toolAfterD !== 'draw') {
      const ib = await L.inspector(page).boundingBox();
      await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2); // pointer over the inspector, off the scene
      await L.key(page, 'd');
      t.check((await L.summary(page)).tool === 'draw', 'D (cursor off the 3D view) selects the draw tool');
      if ((await L.summary(page)).tool !== 'draw') await page.getByRole('button', { name: 'Draw haul string' }).click();
    }
    const world = [[236150, 7051300], [236300, 7051330], [236450, 7051370], [236600, 7051420]];
    const scr = await projectWorld(page, world);
    const box = await L.canvasBox(page);
    const usable = scr.filter(p => p.x != null && p.x > 70 && p.x < box.width - 440 && p.y > 80 && p.y < box.height - 120);
    t.check(usable.length === 4, 'draw points project onto the visible terrain', scr.map(p => [Math.round(p.x), Math.round(p.y)]));
    for (const p of usable) { await page.mouse.click(p.x, p.y); await L.sleep(250); }
    await t.shot('draw_rubberband');
    await page.keyboard.press('Enter');
    await L.waitStore(page, (st, n) => st.scenario.strings.length === n + 2, s0.strings);
    const drawn = await L.probe(page, st => {
      const h = st.scenario.strings[st.scenario.strings.length - 1];
      return { id: h.id, name: h.name, n: h.points.length, source: h.source, snapped: h.points.every(p => p.snapped), sel: st.selection, tool: st.tool };
    });
    t.check(drawn.source === 'drawn' && drawn.n >= 4, 'Enter finishes the drawn string', drawn);
    t.check(drawn.snapped, 'drawn points are snapped to the surface');
    t.check(drawn.sel.kind === 'string' && drawn.sel.id === drawn.id && drawn.tool === 'select', 'new string selected; tool back to Select');
    const insp = L.inspector(page);
    await page.waitForTimeout(400);
    const itxt = await insp.innerText();
    t.check(await insp.getByLabel('String name').inputValue() === drawn.name, `inspector shows "${drawn.name}"`);
    for (const k of ['Length', 'Rise', 'Fall', 'Net grade', 'Max up', 'Max down']) t.check(itxt.includes(k), `metric "${k}" shown`);
    const len = L.numIn((itxt.match(/Length\s*\n?\s*([\d,]+)/) || [])[1]);
    t.check(len > 400 && len < 600, `drawn length ≈ 470 m plan (${len} m)`);
    t.check(new RegExp(`${drawn.n}\\s+points`).test(itxt), `point table lists ${drawn.n} points`);
    await t.shot('drawn_string');

    // ── edit a point RL on a string a circuit uses
    await insp.getByRole('button', { name: 'Overview' }).click();
    const target = await L.probe(page, st => {
      const c = st.scenario.circuits.find(x => x.haulStringId);
      const h = st.scenario.strings.find(x => x.id === c.haulStringId);
      const i = Math.floor(h.points.length / 2);
      return { circuitId: c.id, circuit: c.name, stringId: h.id, name: h.name, i, z: h.points[i].z, n: h.points.length };
    });
    // strings list rows: the name span carries title "<name> · N points…"
    await insp.locator(`[title^="${target.name} · "]`).first().click();
    await L.waitStore(page, (st, id) => st.selection.kind === 'string' && st.selection.id === id, target.stringId);
    const before = { res: (await L.circuitResults(page)).find(r => r.id === target.circuitId), txt: await insp.innerText() };
    const rise0 = (before.txt.match(/Rise\s*\n?\s*([+−-]?[\d.,]+)/) || [])[1];
    const cell = insp.getByLabel(`Point ${target.i + 1} RL`, { exact: true });
    await cell.scrollIntoViewIfNeeded();
    const z1 = Math.round((target.z + 12) * 100) / 100;
    await cell.fill(String(z1));
    await cell.press('Enter');
    await L.waitStore(page, (st, a) => Math.abs(st.scenario.strings.find(h => h.id === a.id).points[a.i].z - a.z1) < 1e-9, { id: target.stringId, i: target.i, z1 });
    await page.waitForTimeout(300);
    const after = { res: (await L.circuitResults(page)).find(r => r.id === target.circuitId), txt: await insp.innerText() };
    const rise1 = (after.txt.match(/Rise\s*\n?\s*([+−-]?[\d.,]+)/) || [])[1];
    t.check(rise0 !== rise1, `string Rise metric updates (${rise0} → ${rise1} m)`);
    t.check(Math.abs(after.res.cycleMin - before.res.cycleMin) > 1e-6, `circuit "${target.circuit}" cycle recalculates (${before.res.cycleMin.toFixed(3)} → ${after.res.cycleMin.toFixed(3)} min)`);
    const s1 = await L.summary(page);
    await t.shot('rl_edited');

    // ── undo / redo (keyboard, focus out of the table)
    await L.key(page, 'Control+z');
    await L.waitStore(page, a => true, null, 2000);
    const zu = await L.probe(page, (st, a) => st.scenario.strings.find(h => h.id === a.id).points[a.i].z, { id: target.stringId, i: target.i });
    const resU = (await L.circuitResults(page)).find(r => r.id === target.circuitId);
    t.check(zu === target.z, `Ctrl+Z restores RL ${target.z} (got ${zu})`);
    t.check(Math.abs(resU.cycleMin - before.res.cycleMin) < 1e-12, 'Ctrl+Z restores the circuit cycle exactly');
    t.check(rise0 === ((await insp.innerText()).match(/Rise\s*\n?\s*([+−-]?[\d.,]+)/) || [])[1], 'Rise metric restored in the inspector');
    await L.key(page, 'Control+Shift+z');
    const zr = await L.probe(page, (st, a) => st.scenario.strings.find(h => h.id === a.id).points[a.i].z, { id: target.stringId, i: target.i });
    t.check(zr === z1, `Ctrl+Shift+Z re-applies RL ${z1} (got ${zr})`);
    const s2 = await L.summary(page);
    t.check(s2.past === s1.past && s2.future === 0, 'history depth consistent after undo + redo', { s1: [s1.past, s1.future], s2: [s2.past, s2.future] });
    // toolbar undo button reflects the last action
    const undoBtn = page.getByRole('button', { name: /^Undo / });
    t.check(/Edit RL/.test(await undoBtn.getAttribute('aria-label') || ''), 'toolbar Undo names "Edit RL"', await undoBtn.getAttribute('aria-label'));
    await t.shot('rl_redo');
  },
};
