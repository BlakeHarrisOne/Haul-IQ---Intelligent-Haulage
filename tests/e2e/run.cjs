#!/usr/bin/env node
/**
 * hAIul SIM end-to-end suite runner (plain Node + Playwright; deliberately not vitest - vitest only picks up *.test.ts).
 *
 *   node tests/e2e/run.cjs            run every flow in tests/e2e/flows (NN-name.cjs, in order)
 *   node tests/e2e/run.cjs 3 5        run flows 3 and 5 only
 *
 * Needs the dev server (npm run dev → http://127.0.0.1:5173, override with E2E_URL). Each flow gets a fresh browser
 * context (clean IndexedDB / localStorage). Screenshots, results.json and a console log go to E2E_OUT (see lib.cjs).
 * Exit code 1 when any flow fails.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');

const only = process.argv.slice(2).map(Number).filter(Number.isFinite);
const flowDir = path.join(__dirname, 'flows');
const files = fs.readdirSync(flowDir).filter(f => /^\d\d-.*\.cjs$/.test(f)).sort();

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms); })])
    .finally(() => clearTimeout(t));
}

async function runFlow(browser, flow, attempt) {
  const t0 = Date.now();
  const { context, page, log, nav } = await L.newSession(browser, flow.session || {});
  const t = {
    L, browser, context, page, log, nav, checks: [], shots: [], notes: [],
    check(ok, msg, detail) {
      const c = { ok: !!ok, msg, detail: detail === undefined ? undefined : detail };
      this.checks.push(c);
      console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${msg}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
      return c.ok;
    },
    note(s) { this.notes.push(s); console.log(`  note ${s}`); },
    async shot(name, opts) { const p = await L.shot(this.page, `${String(flow.id).padStart(2, '0')}_${name}`, opts); this.shots.push(p); return p; },
  };
  console.log(`\n▶ ${flow.id}. ${flow.name}${attempt ? ` (retry ${attempt})` : ''}`);
  let error;
  try {
    await withTimeout(flow.run(t), flow.timeout || 300_000, `flow ${flow.id}`);
  } catch (e) {
    error = e;
    t.check(false, `flow threw: ${e.message.split('\n')[0]}`);
    try { await t.shot('failure'); } catch { /* page gone */ }
  }
  const reloaded = nav.count > nav.expected;
  if (reloaded) t.note(`page navigated ${nav.count}× (expected ${nav.expected}) - dev-server reload during the flow`);
  const pageErrors = log.filter(l => l.type === 'pageerror');
  const consoleErrors = log.filter(l => l.type === 'error' && !l.noise);
  const warnings = log.filter(l => l.type === 'warning' && !l.noise);
  t.check(pageErrors.length === 0, 'no uncaught page errors', pageErrors.slice(0, 3).map(e => e.text.slice(0, 200)));
  if (!flow.allowConsoleErrors) t.check(consoleErrors.length === 0, 'no console errors', consoleErrors.slice(0, 5).map(e => e.text.slice(0, 200)));
  else if (consoleErrors.length) t.note(`console errors (allowed for this flow): ${consoleErrors.length}`);
  const status = t.checks.every(c => c.ok) ? 'PASS' : 'FAIL';
  console.log(`  → ${status} (${((Date.now() - t0) / 1000).toFixed(1)} s, ${pageErrors.length} page errors, ${consoleErrors.length} console errors, ${warnings.length} warnings)`);
  await context.close().catch(() => undefined);
  return {
    id: flow.id, name: flow.name, status, attempt, reloaded, ms: Date.now() - t0, checks: t.checks, notes: t.notes, shots: t.shots,
    error: error ? String(error.stack || error) : undefined,
    console: log.map(l => ({ type: l.type, noise: l.noise, text: l.text })),
  };
}

(async () => {
  const browser = await L.launch();
  const results = [];
  for (const f of files) {
    const flow = require(path.join(flowDir, f));
    if (only.length && !only.includes(flow.id)) continue;
    let attempt = 0, r;
    for (;;) {
      r = await runFlow(browser, flow, attempt);
      if (r.status === 'PASS' || !r.reloaded || attempt >= 2) break;
      console.log(`  ↻ the dev server reloaded the page mid-flow (source edited during the run) - retrying flow ${flow.id}`);
      attempt++;
    }
    results.push(r);
  }
  await browser.close();
  const out = path.join(L.OUT, only.length ? `results-${only.join('-')}.json` : 'results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('\n──────── summary');
  for (const r of results) console.log(`${r.status}  ${String(r.id).padStart(2)}. ${r.name}  (${r.checks.filter(c => !c.ok).length} failed checks)`);
  if (L.shotStalls.length) console.log(`screenshot stalls (retried): ${JSON.stringify(L.shotStalls)}`);
  console.log(`results: ${out}`);
  process.exit(results.every(r => r.status === 'PASS') ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
