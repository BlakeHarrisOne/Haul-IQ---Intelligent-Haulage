/**
 * 10. Persistence: save (Ctrl+S) → reload → open from the Scenarios library → identical circuits / strings / assets
 * (counts, geometry digest and a KPI); export .haiul.json (Ctrl+E) → import it back → identical again.
 */
const fs = require('fs');
const path = require('path');

/** Content digest of the document (ids included, timestamps excluded). */
async function digest(L, page) {
  return page.evaluate(async mi => {
    const __mod = (0, eval)('(' + mi + ')');
    const { useApp } = await __mod('/src/state/store.ts');
    const { resultsFor } = await __mod('/src/state/derived.ts');
    const s = useApp.getState().scenario;
    const res = resultsFor(s);
    let h = 0;
    const mix = v => { const str = typeof v === 'number' ? v.toPrecision(12) : String(v); for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0; };
    for (const a of s.assets) { mix(a.id); mix(a.name); mix(a.role); mix(a.mesh.verts.length); mix(a.mesh.tris.length); for (let i = 0; i < a.mesh.verts.length; i += 997) mix(a.mesh.verts[i]); for (let i = 0; i < a.mesh.tris.length; i += 1999) mix(a.mesh.tris[i]); mix(a.stats.volume ?? 0); }
    for (const x of s.strings) { mix(x.id); mix(x.name); for (const p of x.points) { mix(p.e); mix(p.n); mix(p.z); } }
    for (const c of s.circuits) { mix(c.id); mix(c.trucks); mix(c.haulStringId); mix(JSON.stringify(c.params)); }
    return {
      id: s.id, name: s.name, assets: s.assets.length, strings: s.strings.length, circuits: s.circuits.length, rules: s.crew.rules.length,
      points: s.strings.reduce((a, x) => a + x.points.length, 0), tris: s.assets.reduce((a, x) => a + x.mesh.tris.length / 3, 0),
      bcmDay: s.circuits.reduce((a, c) => a + (c.active && res[c.id] && res[c.id].ok ? res[c.id].assigned.bcmPerDay : 0), 0),
      cycle0: res[s.circuits[0].id].cycleMin, hash: h,
    };
  }, L.MODULE_IMPORT);
}

const same = (a, b, keys) => keys.every(k => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) < 1e-9 : a[k] === b[k]));
const KEYS = ['name', 'assets', 'strings', 'circuits', 'rules', 'points', 'tris', 'bcmDay', 'cycle0', 'hash'];

module.exports = {
  id: 10,
  name: 'Persistence: save → reload → open; export → import',
  timeout: 900_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    // make one edit so the saved document is not just the demo
    const insp = L.inspector(page);
    const ib = await insp.boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 30);
    const d0 = await digest(L, page);
    t.note(`document: ${d0.circuits} circuits, ${d0.strings} strings (${d0.points} pts), ${d0.assets} assets (${d0.tris} tris), ${Math.round(d0.bcmDay)} bcm/d`);

    // ── save
    await L.key(page, 'Control+s');
    await L.waitStore(page, st => !st.dirty && !!st.lastSavedAt, undefined, 120_000);
    await page.getByRole('status').getByText(/Saved “/).first().waitFor({ timeout: 60_000 });
    const docState = await page.locator('button[title$="click to rename"]').innerText();
    t.check(/Saved/.test(docState), `title bar reads saved (${docState.replace(/\n/g, ' · ')})`);
    await t.shot('saved');

    // ── reload → library → open
    await L.reload(page);
    await page.getByRole('dialog', { name: 'Start a scenario' }).waitFor({ timeout: 60_000 });
    const welcome = await page.getByRole('dialog', { name: 'Start a scenario' }).innerText();
    t.check(welcome.includes(d0.name), 'welcome card lists the saved scenario under Recent');
    t.check((await L.summary(page)).assets === 0, 'reload starts empty (nothing auto-opened)');
    await L.key(page, '7');
    const lib = page.getByRole('region', { name: 'Scenarios' });
    await lib.waitFor();
    const card = lib.locator('article').filter({ hasText: d0.name }).first();
    await card.waitFor({ timeout: 30_000 });
    const ctext = await card.innerText();
    t.check(ctext.includes(Math.round(d0.bcmDay).toLocaleString('en-AU')), `library card KPI ${Math.round(d0.bcmDay).toLocaleString('en-AU')} bcm/d`, ctext.replace(/\n/g, ' · ').slice(0, 160));
    await t.shot('library');
    await card.getByRole('button', { name: 'Open' }).click();
    await L.waitStore(page, st => st.scenario.circuits.length > 0 && st.view === 'site', undefined, 120_000);
    await L.waitScene(page);
    const d1 = await digest(L, page);
    t.check(d1.id === d0.id, 'opened the same scenario id');
    t.check(same(d0, d1, KEYS), 'save → reload → open: identical document and KPIs', KEYS.filter(k => !same(d0, d1, [k])).map(k => `${k}: ${d0[k]} vs ${d1[k]}`));
    t.check(!(await L.summary(page)).dirty, 'opened scenario reads clean');
    await L.sleep(1500);
    await t.shot('reopened');

    // ── export (Ctrl+E) → import back (Scenarios → Import file)
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 30);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), L.key(page, 'Control+e')]);
    const file = path.join(L.OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    t.check(/\.haiul\.json$/.test(dl.suggestedFilename()), `export named ${dl.suggestedFilename()}`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    t.check(json && (json.schema || (json.scenario && json.scenario.schema) || '').toString().startsWith('haiul-sim'), 'export carries the scenario schema', Object.keys(json).slice(0, 6));
    t.note(`export size ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
    await L.key(page, '7');
    await lib.waitFor();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), lib.getByRole('button', { name: 'Import file' }).click()]);
    await chooser.setFiles(file);
    await L.waitStore(page, (st, id) => st.scenario.id !== id && st.scenario.circuits.length > 0 && st.view === 'site', d0.id, 120_000);
    await L.waitScene(page);
    const d2 = await digest(L, page);
    const toast = await page.getByRole('status').innerText();
    t.check(/as a copy/.test(toast), 'import of an existing scenario opens as a copy', toast.replace(/\n/g, ' · ').slice(0, 120));
    t.check(same(d0, d2, KEYS), 'export → import: identical document and KPIs', KEYS.filter(k => !same(d0, d2, [k])).map(k => `${k}: ${d0[k]} vs ${d2[k]}`));
    await L.sleep(1500);
    await t.shot('imported');
  },
};
