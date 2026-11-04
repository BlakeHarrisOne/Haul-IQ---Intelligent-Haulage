/**
 * 5. Timeline: play (Space) for a few seconds → the clock advances, dig % and dump % increase and trucks move (engine
 * truck states + two screenshots); scrub to the crib break → every truck is parked (and the picture stops changing).
 */
async function shiftSnapshot(t) {
  return t.page.evaluate(async mi => {
    const __mod = (0, eval)('(' + mi + ')');
    const { useApp } = await __mod('/src/state/store.ts');
    const { resultsFor } = await __mod('/src/state/derived.ts');
    const eng = await __mod('/src/engine/index.ts');
    const st = useApp.getState();
    const s = st.scenario, res = resultsFor(s), tMin = st.timeline.tMin;
    const ss = eng.shiftStateAt(s, res, tMin);
    const trucks = s.circuits.filter(c => c.active).flatMap(c => eng.truckStatesAt(s, res, c.id, tMin).map(x => ({
      c: c.id, k: x.truckIndex, phase: x.phase, paused: x.paused, pause: x.pauseLabel, v: x.speedKmh, ch: x.chainageM, pos: x.pos,
    })));
    return {
      tMin, playing: st.timeline.playing, speed: st.timeline.speed,
      per: ss.perCircuit.map(p => ({ id: p.circuitId, dig: p.digFraction, dump: p.dumpFraction, bcm: p.bcmSoFar, loads: p.loads })),
      event: ss.activeEvent ? ss.activeEvent.label : null, trucks,
    };
  }, t.L.MODULE_IMPORT);
}

async function chipTitles(page) {
  return page.locator('button[title*="bcm this shift"]').evaluateAll(els => els.map(e => e.title));
}

async function canvasShot(page) {
  const box = await page.locator('canvas').first().boundingBox();
  // the 3D view left of the inspector, above the timeline
  return page.screenshot({ clip: { x: 70, y: 70, width: Math.min(940, box.width - 500), height: 640 }, timeout: 120_000 });
}

module.exports = {
  id: 5,
  name: 'Timeline: play, production, moving trucks, crib',
  timeout: 1_500_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const slider = page.getByRole('slider', { name: 'Shift time' });
    const clock0 = await slider.getAttribute('aria-valuetext');
    const a = await shiftSnapshot(t);
    t.check(a.tMin === 0 && !a.playing, `shift starts paused at 0 (clock ${clock0})`);
    const chips0 = await chipTitles(page);
    t.check(chips0.length >= 3, `production chips per circuit (${chips0.length})`);

    // speed ×120 through the timeline menu (×12 spends the first 2.5 s in prestart; SwiftShader frames are slow)
    await page.locator('button', { hasText: /^×\d+$/ }).first().click();
    await page.getByRole('menuitem', { name: /×120/ }).click();
    t.check((await L.summary(page)).tMin === 0 && (await shiftSnapshot(t)).speed === 120, 'playback speed set to ×120');

    // play with Space (pointer resting over the 3D view, nothing focused)
    const vb = await L.canvasBox(page);
    await page.mouse.move(vb.x + 300, vb.y + 600);
    await L.key(page, ' ');
    await L.sleep(500);
    t.check((await L.summary(page)).playing, 'Space starts playback');
    const tw0 = Date.now();
    await L.waitStore(page, st => st.timeline.tMin >= 60, undefined, 420_000);
    await L.key(page, ' ');
    await L.sleep(300);
    const b = await shiftSnapshot(t);
    t.note(`played ${((Date.now() - tw0) / 1000).toFixed(1)} s wall → ${b.tMin.toFixed(1)} sim min`);
    t.check(!b.playing, 'Space pauses playback');
    const clock1 = await slider.getAttribute('aria-valuetext');
    t.check(b.tMin > a.tMin && clock1 !== clock0, `clock advances (${clock0} → ${clock1})`);
    for (const p of b.per) {
      const p0 = a.per.find(x => x.id === p.id);
      t.check(p.dig > p0.dig && p.dump > p0.dump && p.bcm > p0.bcm, `${p.id}: dig ${(p.dig * 100).toFixed(2)} %, dump ${(p.dump * 100).toFixed(2)} %, ${Math.round(p.bcm)} bcm, ${p.loads} loads`);
    }
    const chips1 = await chipTitles(page);
    const bcmOf = s => L.numIn((s.match(/\n([\d,]+) of/) || [])[1]);
    t.check(chips1.every((c, i) => bcmOf(c) > bcmOf(chips0[i])), 'timeline chips show bcm so far increasing', chips1.map(c => c.split('\n')[1]));
    const domDig = await page.evaluate(() => [...document.querySelectorAll('[aria-hidden], span')].map(e => e.textContent).filter(x => /% mined|% placed/.test(x)).slice(0, 6));
    t.note(`scene labels: ${domDig.join(' | ')}`);
    t.check(b.trucks.some(x => x.v > 1), `trucks moving at ${b.tMin.toFixed(0)} min (${b.trucks.filter(x => x.v > 1).length}/${b.trucks.length} with speed)`);
    await t.shot('playing_paused');

    // two frames 30 sim-min apart (Shift+. steps 30 min): trucks are elsewhere
    const imgA = await canvasShot(page);
    const posA = b.trucks;
    await L.key(page, 'Shift+Period');
    await L.waitStore(page, (st, t0) => st.timeline.tMin >= t0 + 29, b.tMin);
    await L.sleep(1500);
    const c = await shiftSnapshot(t);
    const imgB = await canvasShot(page);
    const moved = c.trucks.filter((x, i) => Math.hypot(x.pos[0] - posA[i].pos[0], x.pos[1] - posA[i].pos[1]) > 5).length;
    t.check(c.tMin - b.tMin > 29 && moved >= Math.ceil(c.trucks.length / 2), `+${(c.tMin - b.tMin).toFixed(0)} min: ${moved}/${c.trucks.length} trucks moved > 5 m`);
    const diff = await L.imageDiff(page, imgA, imgB);
    t.check(diff > 0.0005, `3D view changes between the two times (${(diff * 100).toFixed(2)} % of pixels)`);
    await t.shot('later');

    // scrub: click the crib block on the scrubber
    const crib = slider.locator('[title^="Crib"]').first();
    const title = await crib.getAttribute('title');
    const cb = await crib.boundingBox();
    await page.mouse.click(cb.x + cb.width * 0.3, cb.y + cb.height / 2);
    await L.sleep(800);
    const d = await shiftSnapshot(t);
    t.check(d.event && /Crib/.test(d.event), `scrubbed into "${d.event}" at ${d.tMin} min (${title.split('·')[1] || ''})`);
    const parked = d.trucks.filter(x => x.v === 0 && (x.paused || x.phase === 'parked' || x.phase === 'queue'));
    t.check(parked.length === d.trucks.length, `all trucks stopped during crib (${parked.length}/${d.trucks.length})`, d.trucks.filter(x => x.v !== 0).slice(0, 3));
    t.check(d.trucks.every(x => x.paused && /Crib/.test(x.pause || '')), 'every truck is held by the crib event', d.trucks.slice(0, 3).map(x => [x.phase, x.paused, x.pause]));
    const sub = await page.locator('[data-hud]').getByText(/Crib .*stopped/).first().innerText().catch(() => '');
    t.check(/Crib/.test(sub) && /100 ?% stopped/.test(sub), `timeline shows the event (${sub})`);
    const imgC = await canvasShot(page);
    await L.key(page, '.'); // +5 min, still inside crib
    await L.sleep(1500);
    const e = await shiftSnapshot(t);
    const imgD = await canvasShot(page);
    const still = e.trucks.every((x, i) => Math.hypot(x.pos[0] - d.trucks[i].pos[0], x.pos[1] - d.trucks[i].pos[1]) < 0.01);
    t.check(e.event === d.event && still, `trucks stay put through crib (${d.tMin} → ${e.tMin} min)`);
    const diff2 = await L.imageDiff(page, imgC, imgD);
    t.check(diff2 < diff / 3, `3D view static during crib (${(diff2 * 100).toFixed(3)} % changed vs ${(diff * 100).toFixed(2)} % while working)`);
    await t.shot('crib');
  },
};
