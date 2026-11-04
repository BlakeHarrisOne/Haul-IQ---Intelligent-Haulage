/** Document / app actions shared by the menu, command palette, keyboard and welcome card. */
import { app } from '@/state/store';
import { loadDemo } from '@/state/demo';
import { clock, num, pct } from '@/core/format';
import { resultsFor } from '@/state/derived';
import { downloadText, exportScenarioFile, newScenario, saveCurrent } from '@/features/scenarios';
import { stringsFileBase, stringsToCsv, stringsToDxf } from './exporters';
import { ui } from './uiStore';

/** Run `fn` now, or after the user agrees to drop unsaved changes. */
function guardDirty(what: string, fn: () => void) {
  const st = app();
  const hasContent = st.scenario.assets.length || st.scenario.strings.length || st.scenario.circuits.length;
  if (!st.dirty || !hasContent) { fn(); return; }
  ui().set({
    confirm: {
      title: 'Discard unsaved changes?',
      sub: `“${st.scenario.name}” has changes that are not saved. ${what} will replace it.`,
      okLabel: 'Discard changes', danger: true, onOk: fn,
    },
  });
}

export function cmdNew() { guardDirty('A new scenario', () => newScenario()); }

export async function cmdLoadDemo() {
  guardDirty('The demo site', async () => {
    ui().set({ demoLoading: true });
    try {
      await loadDemo();
      app().setView('site');
      app().toast('ok', 'Demo site loaded – press Space to play the shift');
    } catch (e) {
      app().toast('error', `Could not load the demo: ${(e as Error).message}`);
    } finally {
      ui().set({ demoLoading: false });
    }
  });
}

export function cmdSave() { void saveCurrent(); }

export function cmdSaveAs() {
  const s = app().scenario;
  ui().set({
    prompt: {
      title: 'Save as a new scenario', sub: 'A copy is saved to the library; you keep working on the copy.',
      value: `${s.name} (copy)`, okLabel: 'Save copy', onSubmit: name => { void saveCurrent({ asNew: { name } }); },
    },
  });
}

export function cmdRename() {
  const s = app().scenario;
  ui().set({
    prompt: {
      title: 'Rename scenario', value: s.name, okLabel: 'Rename',
      onSubmit: name => { if (name && name !== s.name) app().commit('Rename scenario', d => ({ ...d, name })); },
    },
  });
}

export function cmdExportScenario() { exportScenarioFile(); }

export function cmdExportStrings(kind: 'csv' | 'dxf') {
  const s = app().scenario;
  if (!s.strings.length) { app().toast('warn', 'There are no haul strings to export yet.'); return; }
  const base = stringsFileBase(s);
  if (kind === 'csv') downloadText(`${base}.csv`, stringsToCsv(s.strings), 'text/csv');
  else downloadText(`${base}.dxf`, stringsToDxf(s.strings), 'application/dxf');
  app().toast('ok', `Exported ${s.strings.length} strings as ${kind.toUpperCase()}`);
}

export function cmdTogglePlay() {
  const st = app();
  const end = st.scenario.shift.lengthH * 60;
  if (!st.timeline.playing && st.timeline.tMin >= end - 0.01) st.setTimeline({ tMin: 0, playing: true });
  else st.setTimeline({ playing: !st.timeline.playing });
}
export function cmdStep(dMin: number) {
  const st = app();
  const end = st.scenario.shift.lengthH * 60;
  st.setTimeline({ tMin: Math.min(end, Math.max(0, st.timeline.tMin + dMin)) });
}

const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A print-friendly one-page summary of the open scenario in a new window. */
export function cmdReport() {
  const s = app().scenario;
  const res = resultsFor(s);
  const w = window.open('', '_blank', 'width=980,height=1200');
  if (!w) { app().toast('warn', 'Allow pop-ups to open the report.'); return; }
  let bcm = 0, trucks = 0, lost = 0;
  const rows = s.circuits.map(c => {
    const r = res[c.id];
    if (c.active && r?.ok) { bcm += r.assigned.bcmPerDay; trucks += c.trucks; lost += r.lostPtHrsShift; }
    const hs = s.strings.find(x => x.id === c.haulStringId);
    return `<tr><td><span class="sw" style="background:${esc(c.color)}"></span>${esc(c.name)}${c.active ? '' : ' <em>(inactive)</em>'}</td>
      <td>${esc(hs?.name ?? '–')}</td><td class="r">${r?.ok ? num(r.lengthM / 1000, 2) : '–'}</td><td class="r">${r?.ok ? num(r.cycleMin, 1) : '–'}</td>
      <td class="r">${num(c.trucks)}</td><td class="r">${r?.ok ? num(r.trucksExact, 2) : '–'}</td><td class="r">${r?.ok ? num(r.assigned.bcmPerDay) : '–'}</td>
      <td class="r">${r?.ok ? num(r.lostPtHrsShift, 1) : '–'}</td><td>${r?.ok ? esc(r.assigned.status) : esc(r?.error ?? '')}</td></tr>`;
  }).join('');
  const ev = s.shift.events.map(e => `<li>${clock(s.shift.startHour, e.startMin)}–${clock(s.shift.startHour, e.startMin + e.durMin)} ${esc(e.label)} (${pct(e.fleetStopFraction, 0)} of fleet stopped)</li>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.name)} - hAIul SIM report</title>
  <style>
    body{font:13px/1.45 "Segoe UI",system-ui,sans-serif;color:#1F2329;margin:32px 40px}
    h1{font-size:22px;margin:0 0 2px}h2{font-size:14px;margin:26px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#4A5059}
    .sub{color:#646A73}.kpis{display:flex;gap:36px;margin:18px 0 6px}.k b{display:block;font-size:22px}.k span{color:#646A73;font-size:12px}
    table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid #E3E6EB;text-align:left;font-variant-numeric:tabular-nums}
    th{font-size:11.5px;color:#646A73}.r{text-align:right}.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px}
    .brand{font-weight:700}.brand i{font-style:normal;color:#0A6FE6}footer{margin-top:28px;color:#8E949C;font-size:11.5px}
    @media print{body{margin:12mm}}
  </style></head><body>
  <div class="brand">h<i>AI</i>ul SIM</div>
  <h1>${esc(s.name)}</h1><div class="sub">${esc(s.site.name)}${s.site.crs ? ` · ${esc(s.site.crs)}` : ''} · ${esc(s.shift.name)} ${clock(s.shift.startHour, 0)}–${clock(s.shift.startHour, s.shift.lengthH * 60)}</div>
  ${s.description ? `<p>${esc(s.description)}</p>` : ''}
  <div class="kpis"><div class="k"><b>${num(bcm)}</b><span>bcm/day planned</span></div><div class="k"><b>${num(trucks)}</b><span>trucks assigned</span></div>
  <div class="k"><b>${num(lost, 1)} h</b><span>loader PT lost / shift</span></div><div class="k"><b>${s.circuits.filter(c => c.active).length}</b><span>active circuits</span></div></div>
  <h2>Circuits</h2><table><thead><tr><th>Circuit</th><th>Haul string</th><th class="r">Length km</th><th class="r">Cycle min</th><th class="r">Trucks</th><th class="r">Trucks exact</th><th class="r">bcm/day</th><th class="r">Lost PT h/shift</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No circuits.</td></tr>'}</tbody></table>
  <h2>Shift</h2><ul>${ev || '<li>No shift events.</li>'}</ul>
  <footer>Generated ${new Date().toLocaleString('en-AU')} by hAIul SIM. Every figure is traced on the Assumptions page.</footer>
  <script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}
