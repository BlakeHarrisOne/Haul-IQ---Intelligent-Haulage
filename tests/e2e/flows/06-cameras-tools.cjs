/**
 * 6. Cameras / tools: driver POV shows the cockpit HUD; plan view; section tool (X, two clicks) → section panel with
 * filled solids; measure tool readout matches the picked geometry.
 */
async function project(page, pts) {
  return page.evaluate(ws => {
    const ctx = window.__haiulScene.core.ctx;
    return ws.map(([e, n]) => { const z = ctx.heightAt(e, n); const p = z == null ? null : ctx.project([e, n, z]); return p ? [p[0] ?? p.x, p[1] ?? p.y] : null; });
  }, pts);
}
const rigMode = page => page.evaluate(() => ({ mode: window.__haiulScene.core.rig.mode, tr: !!window.__haiulScene.core.rig.transitioning }));

module.exports = {
  id: 6,
  name: 'Cameras & tools: POV HUD, plan, section, measure',
  timeout: 1_800_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const ib = await L.inspector(page).boundingBox();
    const offScene = () => page.mouse.move(ib.x + ib.width / 2, ib.y + 40);

    // ── driver POV (P)
    await offScene();
    await L.key(page, 'p');
    await L.waitStore(page, st => st.camera === 'pov');
    const pov = await L.probe(page, st => ({ camera: st.camera, circuit: st.povCircuitId, name: (st.scenario.circuits.find(c => c.id === st.povCircuitId) || {}).name }));
    t.check(pov.camera === 'pov' && !!pov.circuit, `P rides a truck of "${pov.name}"`);
    const hud = page.locator('[data-k="v"]').locator('xpath=ancestor::div[contains(@class,"hud")][1]');
    await page.waitForFunction(() => { const v = document.querySelector('[data-k="v"]'); if (!v) return false; let el = v; while (el && el.style.display !== 'none' && el !== document.body) el = el.parentElement; return el === document.body; }, null, { timeout: 120_000, polling: 500 });
    await L.sleep(2500);
    // the cockpit root carries the CSS-module class "hud" (children use hudBig, hudCell…)
    const hudText = await page.evaluate(() => { let el = document.querySelector('[data-k="v"]'); while (el && !/(^|\s)_hud_/.test(String(el.className))) el = el.parentElement; return el ? el.innerText : ''; });
    t.check(/km\/h/i.test(hudText) && /grade/i.test(hudText) && /limit/i.test(hudText), 'cockpit HUD: speed, grade, speed limit / limiting factor', hudText.replace(/\n/g, ' · ').slice(0, 200));
    const povEnds = await L.probe(page, (st, id) => { const c = st.scenario.circuits.find(x => x.id === id); const n = i => (st.scenario.assets.find(a => a.id === i) || {}).name || ''; return [n(c.digId), n(c.dumpId)]; }, pov.circuit);
    t.check(/to (dump|dig)/i.test(hudText) && (hudText.includes(povEnds[0].split(' ')[0]) || /Dig/.test(hudText)) && (hudText.includes(povEnds[1]) || /Dump/.test(hudText)), `HUD route strip shows distance and the ends (${povEnds.join(' → ')})`);
    const pill = await page.evaluate(() => { const els = [...document.querySelectorAll('div')].filter(d => /(^|\s)_hudTop_/.test(String(d.className)) && d.style.display !== 'none'); return els.map(e => e.innerText || e.textContent).join(' | '); });
    t.note(`cockpit top pill: ${pill ? pill.replace(/\n/g, ' ').slice(0, 80) : '(none in this build)'}`);
    const rest = await page.locator('[aria-hidden]').filter({ hasText: /driver view/ }).count();
    t.check(rest > 0, 'rest pill says "driver view"');
    await t.shot('pov_hud');
    void hud;

    // ── plan (T)
    await offScene();
    await L.key(page, 't');
    await L.waitStore(page, st => st.camera === 'plan');
    await page.waitForFunction(() => window.__haiulScene.core.rig.mode === 'plan' && !window.__haiulScene.core.rig.transitioning, null, { timeout: 420_000, polling: 500 });
    t.check((await rigMode(page)).mode === 'plan', 'T flies to the plan camera');
    t.check(!(await page.evaluate(() => { const v = document.querySelector('[data-k="v"]'); let el = v; while (el && el.style.display !== 'none' && el !== document.body) el = el.parentElement; return el === document.body; })), 'cockpit HUD hidden outside POV');
    await L.sleep(1000);
    await t.shot('plan');

    // ── section (X, click A then B across a dig block and a dump)
    await offScene();
    await L.key(page, 'o');
    await page.waitForFunction(() => window.__haiulScene.core.rig.mode === 'orbit' && !window.__haiulScene.core.rig.transitioning, null, { timeout: 420_000, polling: 500 });
    await L.key(page, 'x');
    t.check((await L.summary(page)).tool === 'section', 'X selects the section tool');
    const ends = await L.probe(page, st => {
      const dig = st.scenario.assets.find(a => a.role === 'dig'); const dump = st.scenario.assets.find(a => a.role === 'dump' && /S51/.test(a.name)) || st.scenario.assets.find(a => a.role === 'dump');
      const c0 = dig.stats.centroid, c1 = dump.stats.centroid;
      const dx = c1[0] - c0[0], dy = c1[1] - c0[1];
      return { a: [c0[0] - dx * 0.25, c0[1] - dy * 0.25], b: [c1[0] + dx * 0.25, c1[1] + dy * 0.25], dig: dig.name, dump: dump.name };
    });
    const [pa, pb] = await project(page, [ends.a, ends.b]);
    t.check(pa && pb, `section ends on screen (${ends.dig} → ${ends.dump})`, { pa, pb });
    await page.mouse.click(pa[0], pa[1]);
    await L.sleep(400);
    await page.mouse.move((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
    await page.mouse.click(pb[0], pb[1]);
    await L.waitStore(page, st => !!st.section);
    const sec = (await L.summary(page)).section;
    const lenSec = Math.hypot(sec.b[0] - sec.a[0], sec.b[1] - sec.a[1]);
    t.check(lenSec > 100, `section line stored (${Math.round(lenSec)} m)`);
    const panel = page.locator('section[aria-label="Cross-section"]');
    await panel.waitFor({ timeout: 60_000 });
    await L.sleep(800);
    const fills = await panel.locator('svg path').evaluateAll(ps => ps.map(p => ({ fill: p.getAttribute('fill'), op: p.getAttribute('fill-opacity') })).filter(p => p.fill && p.fill !== 'none'));
    const solidFills = fills.filter(f => f.op === '0.32');
    t.check(fills.length >= 2, `section panel draws filled areas (${fills.length})`);
    t.check(solidFills.length >= 1, `solids cut by the section are filled (${solidFills.length} closed paths)`, solidFills.slice(0, 4));
    const ptxt = await panel.innerText();
    t.check(/A|B/.test(ptxt), 'section panel labelled', ptxt.replace(/\n/g, ' · ').slice(0, 140));
    await t.shot('section');

    // ── measure (M, three clicks, Enter) - with the section dock closed, on points the 3D view actually receives
    const closeSec = panel.getByRole('button', { name: /Close section/ });
    if (await closeSec.count()) { await closeSec.first().click(); await L.waitStore(page, st => !st.section); }
    await offScene();
    await L.key(page, 'm');
    t.check((await L.summary(page)).tool === 'measure', 'M selects the measure tool');
    const cands = [];
    for (let e = 236150; e <= 236900; e += 75) for (let n = 7051300; n <= 7052100; n += 75) cands.push([e, n]);
    const hits = await page.evaluate(ws => {
      const core = window.__haiulScene.core, ctx = core.ctx;
      const ok = el => el && (el.tagName === 'CANVAS' || el === core.hudLayer || el === core.labelLayer || el === core.container);
      return ws.map(([e, n]) => { const z = ctx.heightAt(e, n); const p = z == null ? null : ctx.project([e, n, z]); if (!p) return null; const x = p[0] ?? p.x, y = p[1] ?? p.y; return ok(document.elementFromPoint(x, y)) && ok(document.elementFromPoint(x + 16, y + 16)) ? { e, n, x, y } : null; }).filter(Boolean);
    }, cands);
    // three points ~150-250 m apart, well inside the view
    const pick3 = [];
    for (const h of hits) { if (!pick3.length || Math.hypot(h.e - pick3[pick3.length - 1].e, h.n - pick3[pick3.length - 1].n) > 140) pick3.push(h); if (pick3.length === 3) break; }
    const mp = pick3.map(h => [h.x, h.y]);
    t.check(mp.length === 3, 'measure points on screen (not under chrome)', mp);
    const picked = [];
    for (const p of mp) {
      picked.push(await page.evaluate(([x, y]) => window.__haiulScene.core.ctx.pickTerrain(x, y), p));
      await page.mouse.click(p[0], p[1]);
      await L.sleep(300);
    }
    await page.keyboard.press('Enter');
    await page.mouse.move(mp[2][0] + 3, mp[2][1] + 3);
    await L.sleep(800);
    // the smallest visible element holding the readout (the tool tip next to the cursor)
    const tip = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')].filter(d => /Max leg grade/.test(d.innerText || '') && /Plan/.test(d.innerText || '') && d.offsetParent !== null);
      els.sort((a, b) => a.innerText.length - b.innerText.length);
      return els[0] ? els[0].innerText : null;
    });
    t.check(!!tip, 'measure readout shown', tip && tip.replace(/\n/g, ' · '));
    const covered = await L.coveredBy(page, () => { const els = [...document.querySelectorAll('div')].filter(d => /Max leg grade/.test(d.innerText || '') && /Plan/.test(d.innerText || '') && d.offsetParent !== null); els.sort((a, b) => a.innerText.length - b.innerText.length); return els[0]; });
    t.check(Array.isArray(covered) && covered.length === 0, 'measure readout is not covered by other chrome', { coveredBy: covered });
    let plan = 0, d3 = 0;
    for (let i = 1; i < picked.length; i++) { const [a, b] = [picked[i - 1], picked[i]]; plan += Math.hypot(b[0] - a[0], b[1] - a[1]); d3 += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
    const shownPlan = tip ? L.numIn((tip.match(/Plan\s+([\d,.]+)/) || [])[1]) : NaN;
    const shownLen = tip ? L.numIn(tip) : NaN;
    t.check(Math.abs(shownPlan - plan) / plan < 0.01, `plan length ${shownPlan} m ≈ picked ${plan.toFixed(1)} m`);
    t.check(Math.abs(shownLen - d3) / d3 < 0.01, `3D length ${shownLen} m ≈ picked ${d3.toFixed(1)} m`);
    t.check(/3 points/.test(tip || ''), 'readout counts 3 points');
    await t.shot('measure');

    // readout next to the docked long section: measure just above the dock (a circuit selected opens it)
    await page.keyboard.press('Escape');
    await L.key(page, 'v');
    await L.inspector(page).locator('button', { hasText: 'EX09 OB → S51 West lift' }).first().click();
    const dock = page.locator('section[aria-label="Long section"]');
    await dock.waitFor({ timeout: 120_000 });
    await L.sleep(1000);
    const db = await dock.boundingBox();
    await offScene();
    await L.key(page, 'm');
    const yA = db.y - 40, xs = [db.x + db.width * 0.35, db.x + db.width * 0.55];
    for (const x of xs) { await page.mouse.click(x, yA); await L.sleep(300); }
    await page.mouse.move(xs[1] + 2, yA + 1);
    await L.sleep(800);
    const coveredNearDock = await L.coveredBy(page, () => { const els = [...document.querySelectorAll('div')].filter(d => /Max leg grade/.test(d.innerText || '') && /Plan/.test(d.innerText || '') && d.offsetParent !== null); els.sort((a, b) => a.innerText.length - b.innerText.length); return els[0]; });
    t.check(Array.isArray(coveredNearDock) && coveredNearDock.length === 0, 'measure readout near the long-section dock stays visible', { coveredBy: coveredNearDock });
    await t.shot('measure_near_dock');
  },
};
