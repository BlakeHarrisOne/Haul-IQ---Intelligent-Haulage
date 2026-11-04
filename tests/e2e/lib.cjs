/**
 * hAIul SIM end-to-end helpers (Playwright, plain Node - NOT vitest).
 *
 * Environment:
 *   E2E_URL    app URL (default http://127.0.0.1:5173)
 *   E2E_OUT    screenshot / results directory (default: the QA scratchpad e2e dir if present, else <tmp>/haiul-e2e)
 *   E2E_TOPO   Vulcan topo surface fixture (.00t)   (default: scratchpad fixtures/demo_pit_surface.00t)
 *   E2E_SOLID  closed dump solid fixture (.00t)      (default: src/io/__fixtures__/demo_dump_S51_lift.00t)
 *   E2E_HEADED=1 to watch the run
 *
 * Driving model: every user action goes through the real UI (clicks, keys, file chooser, drag-and-drop). The zustand
 * store is not exposed on window, so assertions that need numbers the DOM does not print read it READ-ONLY through the
 * Vite dev server's module graph (`import('/src/state/store.ts')` resolves to the same module instance the app uses).
 * `window.__haiulScene` (published by SceneCore) is used for render stats.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH = '/tmp/claude-0/-home-user-Haul-IQ---Intelligent-Haulage/6a799533-cbdc-5f2c-b7d8-1a1fb31b2822/scratchpad';
const URL = process.env.E2E_URL || 'http://127.0.0.1:5173';
const OUT = process.env.E2E_OUT || (fs.existsSync(SCRATCH) ? path.join(SCRATCH, 'e2e') : path.join(os.tmpdir(), 'haiul-e2e'));
const FIX = {
  topo: process.env.E2E_TOPO || path.join(SCRATCH, 'fixtures', 'demo_pit_surface.00t'),
  solid: process.env.E2E_SOLID || path.join(ROOT, 'src/io/__fixtures__/demo_dump_S51_lift.00t'),
  strings: path.join(ROOT, 'docs/spec/fixtures/raw-data-strings.json'),
};
fs.mkdirSync(OUT, { recursive: true });

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function launch() {
  return chromium.launch({ headless: !process.env.E2E_HEADED, args: GL_ARGS });
}

/** Console noise from the headless / SwiftShader environment, not from the app. */
const ENV_NOISE = [
  /GPU stall due to ReadPixels/i, /swiftshader/i, /Automatic fallback to software WebGL/i, /WebGL.*performance/i,
  /\[vite\]/i, /Download the React DevTools/i, /GL Driver Message/i,
];
const isNoise = t => ENV_NOISE.some(r => r.test(t));

/** A fresh browser context + page with console / page-error capture. */
async function newSession(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: opts.colorScheme || 'light',
    acceptDownloads: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const log = [];
  page.on('console', m => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = m.text();
    log.push({ type, text: text.slice(0, 600), noise: isNoise(text), at: Date.now() });
  });
  page.on('pageerror', e => log.push({ type: 'pageerror', text: String(e && (e.stack || e.message) || e).slice(0, 1200), noise: false, at: Date.now() }));
  page.on('crash', () => log.push({ type: 'pageerror', text: 'PAGE CRASHED', noise: false, at: Date.now() }));
  page.setDefaultTimeout(30_000);
  return { context, page, log };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(page, query = '') {
  await page.goto(URL + '/' + query, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForSelector('#root > *', { timeout: 60_000 });
}

/** Wait until the 3D scene has rendered (SceneCore publishes window.__haiulScene once two frames are drawn). */
async function waitScene(page, timeout = 120_000) {
  await page.waitForFunction(() => !!(window.__haiulScene && window.__haiulScene.ready), null, { timeout, polling: 250 });
}

/**
 * In-page module import that resolves to the SAME instance the app uses. Vite rewrites imports of HMR-touched
 * modules to `/src/x.ts?t=<stamp>`, so the URL is taken from the page's resource timing entries.
 */
const MODULE_IMPORT = `async function __mod(p) {
  const hits = performance.getEntriesByType('resource').map(e => e.name).filter(n => { try { return new URL(n).pathname === p; } catch { return false; } });
  return import(hits.length ? hits[hits.length - 1] : p);
}`;

/** Read-only probe of the app store: fn(state) runs in the page. */
async function probe(page, fn, arg) {
  return page.evaluate(async ([src, a, mi]) => {
    // eslint-disable-next-line no-eval
    const __mod = (0, eval)('(' + mi + ')');
    const { useApp } = await __mod('/src/state/store.ts');
    // eslint-disable-next-line no-eval
    const f = (0, eval)('(' + src + ')');
    return f(useApp.getState(), a);
  }, [fn.toString(), arg === undefined ? null : arg, MODULE_IMPORT]);
}

/** Wait until fn(state) is truthy (polls the store). */
async function waitStore(page, fn, arg, timeout = 60_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await probe(page, fn, arg).catch(e => ({ __err: e.message }));
    if (last && !last.__err) return last;
    await sleep(300);
  }
  throw new Error(`waitStore timed out: ${fn.toString().slice(0, 160)} → ${JSON.stringify(last)}`);
}

/** Snapshot of the document + UI state that flows compare. */
async function summary(page) {
  return probe(page, st => ({
    name: st.scenario.name,
    id: st.scenario.id,
    assets: st.scenario.assets.length,
    roles: st.scenario.assets.map(a => `${a.role}:${a.kind}`).sort(),
    strings: st.scenario.strings.length,
    stringNames: st.scenario.strings.map(s => s.name).sort(),
    points: st.scenario.strings.reduce((a, s) => a + s.points.length, 0),
    circuits: st.scenario.circuits.length,
    circuitNames: st.scenario.circuits.map(c => c.name).sort(),
    trucks: st.scenario.circuits.reduce((a, c) => a + c.trucks, 0),
    rules: st.scenario.crew.rules.length,
    revision: st.revision, past: st.past.length, future: st.future.length, dirty: st.dirty,
    view: st.view, tool: st.tool, camera: st.camera, selection: st.selection,
    tMin: st.timeline.tMin, playing: st.timeline.playing, section: st.section || null,
  }));
}

/** Results of every circuit computed by the engine through the app's own derived module. */
async function circuitResults(page) {
  return page.evaluate(async mi => {
    // eslint-disable-next-line no-eval
    const __mod = (0, eval)('(' + mi + ')');
    const { useApp } = await __mod('/src/state/store.ts');
    const { resultsFor } = await __mod('/src/state/derived.ts');
    const s = useApp.getState().scenario;
    const res = resultsFor(s);
    return s.circuits.map(c => {
      const r = res[c.id];
      return {
        id: c.id, name: c.name, trucks: c.trucks, active: c.active, priority: c.priority, speedModel: c.params.speedModel,
        ok: !!(r && r.ok), cycleMin: r && r.cycleMin, trucksExact: r && r.trucksExact, status: r && r.assigned && r.assigned.status,
        bcmDay: r && r.assigned && r.assigned.bcmPerDay, lostPt: r && r.assigned && r.assigned.lostLoaderPtHrsShift,
      };
    });
  }, MODULE_IMPORT);
}

/** Screenshots that needed a retry (SwiftShader can hold the compositor during a heavy WebGL frame). */
const shotStalls = [];
async function shot(page, name, opts = {}) {
  const file = path.join(OUT, `${name}.png`);
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      await page.screenshot({ path: file, fullPage: false, timeout: 40_000, ...opts });
      break;
    } catch (e) {
      if (attempt >= 2 || !/Timeout/.test(e.message)) throw e;
      shotStalls.push({ name, attempt, ms: Date.now() - t0 });
      // nudge a frame and try again
      await page.mouse.move(5, 450).catch(() => undefined);
      await sleep(1500);
    }
  }
  return file;
}

/** Click the "Open the demo site" card on the welcome screen and wait for the scenario + scene. */
async function loadDemoViaWelcome(page) {
  await page.getByRole('button', { name: /Open the demo site/i }).click();
  await waitStore(page, st => st.scenario.circuits.length > 0 && st.scenario.assets.length > 0, undefined, 120_000);
  await waitScene(page);
  await sleep(1500);
}

/** Cold start + demo (most flows start here). */
async function startWithDemo(page) {
  await open(page);
  await page.getByRole('button', { name: /Open the demo site/i }).waitFor({ timeout: 60_000 });
  await loadDemoViaWelcome(page);
}

/** The scene container (pointer events are bound on it; the canvas is inside). */
async function canvasBox(page) {
  const c = page.locator('canvas').first();
  await c.waitFor();
  return c.boundingBox();
}

/** Inspector aside (right panel). */
const inspector = page => page.locator('aside[aria-label="Inspector"]');

/** Press a single global key with nothing focused (blur any field first). */
async function key(page, k) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
  await page.keyboard.press(k);
}

/** Write a string fixture as XYZ text (CSV with header) and return its path. */
function writeStringFixture(index = 0, name) {
  const d = JSON.parse(fs.readFileSync(FIX.strings, 'utf8'));
  const s = d.strings[index];
  const rows = ['Easting,Northing,RL', ...s.points.map(p => p.join(','))];
  const file = path.join(OUT, name || `string_${index}.csv`);
  fs.writeFileSync(file, rows.join('\n') + '\n');
  return { file, title: s.title, points: s.points.length, lengthM: s.geometry_summary.length_3d_m };
}

/** Simulate dropping local files on the window (DataTransfer built in the page from file bytes). */
async function dropFiles(page, files) {
  const payload = files.map(f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') }));
  const handle = await page.evaluateHandle(fs2 => {
    const dt = new DataTransfer();
    for (const f of fs2) {
      const bin = atob(f.b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      dt.items.add(new File([u8], f.name));
    }
    return dt;
  }, payload);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: handle });
  await page.dispatchEvent('body', 'dragover', { dataTransfer: handle });
  await page.dispatchEvent('body', 'drop', { dataTransfer: handle });
}

/** Parse the first number in a string ("1,234.5 bcm/d" → 1234.5). */
function numIn(s) {
  if (s == null) return NaN;
  const m = String(s).replace(/−/g, '-').match(/-?[\d,]*\.?\d+/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

/** Text of the KPI tile with the given label inside a scope (the value line). */
async function kpiValue(scope, label) {
  return scope.evaluate((el, lab) => {
    const labels = [...el.querySelectorAll('div')].filter(d => d.childElementCount <= 1 && d.textContent.trim() === lab);
    for (const l of labels) {
      const v = l.nextElementSibling;
      if (v) return v.textContent.trim();
    }
    return null;
  }, label);
}

/** Pixel difference between two PNG buffers of equal size, via the page canvas (0..1 share of changed pixels). */
async function imageDiff(page, a, b, threshold = 24) {
  return page.evaluate(async ([a64, b64, th]) => {
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load('data:image/png;base64,' + a64), load('data:image/png;base64,' + b64)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > th) n++;
    }
    return n / (w * h);
  }, [a.toString('base64'), b.toString('base64'), threshold]);
}

/** Bounding boxes of visible floating chrome, for overlap checks. */
async function chromeBoxes(page) {
  return page.evaluate(() => {
    const pick = (sel, name) => [...document.querySelectorAll(sel)].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
      return { name, x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
    }).filter(Boolean);
    const hud = document.querySelector('[data-hud]');
    const kids = hud ? [...hud.children] : [];
    const out = [];
    kids.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.display === 'none' || Number(cs.opacity) === 0) return;
      const label = el.getAttribute('aria-label') || (el.className || '').toString().split(' ')[0].replace(/^_?([a-zA-Z]+).*$/, '$1') || `hud${i}`;
      out.push({ name: label, x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom });
    });
    return out.concat(pick('[role="region"]', 'sheet'));
  });
}

function overlaps(boxes, tol = 1) {
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ix = Math.min(a.r, b.r) - Math.max(a.x, b.x), iy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
    if (ix > tol && iy > tol) out.push({ a: a.name, b: b.name, w: Math.round(ix), h: Math.round(iy) });
  }
  return out;
}

module.exports = {
  ROOT, URL, OUT, FIX, launch, newSession, open, waitScene, probe, waitStore, MODULE_IMPORT, summary, circuitResults, shot, sleep,
  loadDemoViaWelcome, startWithDemo, canvasBox, inspector, key, writeStringFixture, dropFiles, numIn, kpiValue,
  imageDiff, chromeBoxes, overlaps, isNoise, shotStalls,
};
