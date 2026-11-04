/** 11. Theme: the dark mode toggle renders correctly (site + a sheet); at 1366×768 the floating chrome does not overlap. */
async function lum(page, sel) {
  return page.evaluate(s => {
    const el = typeof s === 'string' ? document.querySelector(s) : document.body;
    let c = getComputedStyle(el).backgroundColor, node = el;
    while ((c === 'rgba(0, 0, 0, 0)' || c === 'transparent') && node.parentElement) { node = node.parentElement; c = getComputedStyle(node).backgroundColor; }
    const m = c.match(/[\d.]+/g).map(Number);
    return { css: c, l: (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 };
  }, sel);
}
async function imgLum(page, clip) {
  const buf = await page.screenshot({ clip, timeout: 120_000 });
  return page.evaluate(async b64 => {
    const i = new Image(); await new Promise(r => { i.onload = r; i.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, i.width, i.height).data; let s = 0;
    for (let k = 0; k < d.length; k += 4) s += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
    return s / (d.length / 4) / 255;
  }, buf.toString('base64'));
}
const textColorLum = (page, sel) => page.evaluate(s => { const m = getComputedStyle(document.querySelector(s)).color.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }, sel);

module.exports = {
  id: 11,
  name: 'Theme: dark mode; 1366×768 layout',
  timeout: 900_000,
  async run(t) {
    const { L, page } = t;
    await L.startWithDemo(page);
    const insp = L.inspector(page);
    const sky = { x: 80, y: 80, width: 400, height: 40 };
    const light = { body: await lum(page), insp: await lum(page, 'aside[aria-label="Inspector"]'), sky: await imgLum(page, sky) };

    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await L.sleep(2500);
    const dark = { body: await lum(page), insp: await lum(page, 'aside[aria-label="Inspector"]'), sky: await imgLum(page, sky) };
    t.check(dark.body.l < 0.25 && dark.body.l < light.body.l, `page background dark (${dark.body.css})`);
    t.check(dark.insp.l < 0.3, `inspector surface dark (${dark.insp.css})`);
    const inkL = await textColorLum(page, 'aside[aria-label="Inspector"] header');
    t.check(inkL > 0.6, `inspector text light on dark (luminance ${inkL.toFixed(2)})`);
    t.check(dark.sky.l < light.sky.l - 0.1, `3D scene follows the theme (sky luminance ${light.sky.toFixed ? '' : ''}${light.sky.toFixed(2)} → ${dark.sky.toFixed(2)})`);
    const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('haiul-sim.ui') || '{}').theme);
    t.check(pref === 'dark', 'theme preference remembered');
    await t.shot('dark_site');
    await insp.locator('button', { hasText: /EX09/ }).first().click();
    await L.sleep(1200);
    await t.shot('dark_circuit');
    const ib = await insp.boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + 30);
    await L.key(page, '2');
    const sheet = page.getByRole('region', { name: 'Assumptions' });
    await sheet.waitFor();
    await L.sleep(1200);
    const sheetL = await lum(page, '[role="region"][aria-label="Assumptions"] section');
    t.check(sheetL.l < 0.3, `sheet cards dark (${sheetL.css})`);
    await t.shot('dark_assumptions');
    await L.key(page, 'Escape');
    await L.waitStore(page, st => st.view === 'site');
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');

    // ── 1366 × 768
    await page.setViewportSize({ width: 1366, height: 768 });
    await L.sleep(3000);
    const check = async label => {
      const boxes = await L.chromeBoxes(page);
      const ov = L.overlaps(boxes);
      t.check(ov.length === 0, `${label}: no overlapping chrome (${boxes.length} pieces)`, ov.length ? ov : boxes.map(b => `${b.name}@${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`));
      const off = boxes.filter(b => b.x < -1 || b.y < -1 || b.r > 1367 || b.b > 769);
      t.check(off.length === 0, `${label}: all chrome inside the window`, off);
      const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
      t.check(scroll.w <= 1366 && scroll.h <= 768, `${label}: no page scroll (${scroll.w}×${scroll.h})`);
      return boxes;
    };
    await check('overview');
    await t.shot('1366_overview');
    // circuit selected → the long-section dock opens above the timeline
    await insp.locator('button', { hasText: /EX09/ }).first().click().catch(() => undefined);
    await L.sleep(1500);
    const b2 = await check('circuit + profile dock');
    t.check(b2.some(b => /Long section|dockPanel/.test(b.name)), 'profile dock visible at 1366×768', b2.map(b => b.name));
    await t.shot('1366_circuit');
    // a drawing tool shows its hint next to the rail
    await page.mouse.move(683, 20);
    await L.key(page, 'm');
    await L.sleep(800);
    await check('measure tool hint');
    await t.shot('1366_tool');
    await L.key(page, 'v');
    await page.mouse.move(683, 20);
    await L.key(page, '2');
    await page.getByRole('region', { name: 'Assumptions' }).waitFor();
    await L.sleep(1200);
    const sheetOverflow = await page.evaluate(() => {
      const r = document.querySelector('[role="region"][aria-label="Assumptions"]');
      const wide = [...r.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1; }).slice(0, 5).map(e => `${e.tagName}.${String(e.className).slice(0, 30)} r=${Math.round(e.getBoundingClientRect().right)}`);
      return wide;
    });
    t.check(sheetOverflow.length === 0, 'Assumptions sheet fits 1366 px (nothing past the right edge)', sheetOverflow);
    await t.shot('1366_assumptions');
  },
};
