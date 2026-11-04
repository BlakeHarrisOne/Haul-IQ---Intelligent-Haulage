#!/usr/bin/env node
/**
 * hAIul SIM end-to-end suite runner (plain Node + Playwright; deliberately not vitest - vitest only picks up *.test.ts).
 *
 *   node tests/e2e/run.cjs              run every flow in tests/e2e/flows (NN-name.cjs, in order)
 *   node tests/e2e/run.cjs 3 5          run flows 3 and 5 only
 *   node tests/e2e/run.cjs --isolated   start a private dev server (HMR off, tests/e2e/vite.e2e.config.mjs) on :5174
 *                                       for the run - use it while others are editing src/ (saves would reload the page)
 *
 * Without --isolated it needs the dev server (npm run dev → http://127.0.0.1:5173, override with E2E_URL). A flow
 * that loses its page to a dev-server reload or a boot crash is retried (up to twice). Each flow gets a fresh browser
 * context (clean IndexedDB / localStorage). Screenshots, results.json and a console log go to E2E_OUT (see lib.cjs).
 * Exit code 1 when any flow fails.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const isolated = args.includes('--isolated');
const net = require('net');
/** First port ≥ start nobody listens on (another agent / dev server may own the usual ones). */
function freePort(start) {
  return new Promise(res => {
    const tryPort = p => {
      const srv = net.createServer().once('error', () => tryPort(p + 1)).once('listening', () => srv.close(() => res(p)));
      srv.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}
let L;

const only = args.map(Number).filter(Number.isFinite);
let ISO_PORT = 0;
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
    await withTimeout(flow.run(t), flow.timeout || 600_000, `flow ${flow.id}`);
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

function startIsolatedServer() {
  const vite = path.join(L.ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, '--config', path.join(__dirname, 'vite.e2e.config.mjs'), '--port', String(ISO_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: L.ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => process.env.E2E_VERBOSE && process.stdout.write(`[vite] ${d}`));
  child.stderr.on('data', d => process.stdout.write(`[vite] ${d}`));
  const up = () => new Promise(res => http.get(`${L.URL}/`, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const poll = async () => {
      if (await up()) return res(child);
      if (child.exitCode != null) return rej(new Error(`isolated vite exited (${child.exitCode})`));
      if (Date.now() - t0 > 120_000) return rej(new Error('isolated vite did not start'));
      setTimeout(poll, 500);
    };
    poll();
  });
}

(async () => {
  if (isolated) { ISO_PORT = await freePort(Number(process.env.E2E_ISO_PORT || 5181)); process.env.E2E_URL = `http://127.0.0.1:${ISO_PORT}`; }
  L = require('./lib.cjs');
  let server;
  if (isolated) { server = await startIsolatedServer(); console.log(`isolated dev server (HMR off) on ${L.URL}`); }
  process.on('exit', () => { if (server) server.kill(); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (server) server.kill(); process.exit(130); });
  const browser = await L.launch();
  const results = [];
  for (const f of files) {
    const flow = require(path.join(flowDir, f));
    if (only.length && !only.includes(flow.id)) continue;
    let attempt = 0, r;
    for (;;) {
      r = await runFlow(browser, flow, attempt);
      const bootFail = /app failed to boot/.test(r.error || '');
      if (r.status === 'PASS' || !(r.reloaded || bootFail) || attempt >= 2) break;
      console.log(`  ↻ ${bootFail ? 'the app did not boot (a source file mid-edit?)' : 'the dev server reloaded the page mid-flow (source edited during the run)'} - retrying flow ${flow.id}`);
      if (bootFail) await new Promise(res => setTimeout(res, 60_000));
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
