/**
 * Cockpit module (store.camera === 'pov'). The cab itself is real 3D geometry (the actors module swaps the followed
 * truck for its body-without-cab + cab interior shell); this module draws only the glass HUD on top:
 *   speed with an arc gauge and the posted-limit tick · a live route strip (elevation profile of the haul string coloured
 *   by grade class, the truck's position and direction, stop signs, dig / dump ends) · grade, what limits the speed,
 *   load, phase, distance to the dump / dig and to the next stop sign · a top pill with the unit and circuit.
 */
import type { SceneContext, SceneModule } from '../context';
import { useApp } from '@/state/store';
import { busOf, type TruckInfo } from '../strings/bus';
import { gradeRuns, type PathTable } from '../strings/path';
import { gradeHex, hexToRgb } from '../strings/palette';
import css from '../strings/ui.module.css';
import { PHASE_COLOR } from '../actors';

const LIMIT_LABEL: Record<string, string> = {
  rimpull: 'Rimpull', retarder: 'Retarder', 'speed-limit': 'Speed limit', 'top-speed': 'Top speed', table: 'Speed table', 'table-out-of-range': 'Off table',
};
const PHASE_SHORT: Record<string, string> = { queue: 'Queued', spot: 'Spotting', load: 'Loading', haul: 'Loaded haul', dump: 'Dumping', return: 'Empty return', parked: 'Parked' };
const PW = 420, PH = 54;            // profile strip size (px)
const GAUGE_MAX = 60;

export const cockpitModule: SceneModule = (ctx: SceneContext) => {
  const bus = busOf(ctx);
  const st = () => useApp.getState();
  const root = document.createElement('div');
  root.className = css.root;
  (ctx.hudLayer ?? ctx.labelLayer).appendChild(root); // hints / HUD stay visible when labels are off
  const hud = document.createElement('div');
  hud.className = css.hud;
  hud.style.display = 'none';
  const top = document.createElement('div');
  top.className = css.hudTop;
  top.style.display = 'none';
  root.append(hud, top);

  hud.innerHTML = `
    <div class="${css.hudCell} ${css.hudSpeed}">
      <svg class="${css.hudGauge}" viewBox="0 0 120 70" aria-hidden="true">
        <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="6" stroke-linecap="round"/>
        <path data-k="arc" d="" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
        <line data-k="lim" x1="0" y1="0" x2="0" y2="0" stroke="#FF8A7A" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div class="${css.hudSpeedVal}"><span data-k="v" class="${css.hudBig}">0</span><span class="${css.hudUnit}">km/h</span></div>
      <div class="${css.hudLbl}" data-k="limtxt">Speed</div>
    </div>
    <div class="${css.hudCell} ${css.hudRoute}">
      <div class="${css.hudRouteHead}">
        <span class="${css.hudPhase}"><i data-k="pdot"></i><span data-k="phase">—</span></span>
        <span data-k="dist" class="${css.hudDist}">—</span>
        <span data-k="stop" class="${css.hudStop}"></span>
      </div>
      <svg data-k="prof" class="${css.hudProfile}" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" aria-hidden="true"></svg>
      <div class="${css.hudEnds}"><span data-k="e0">Dig</span><span data-k="e1">Dump</span></div>
    </div>
    <div class="${css.hudCell} ${css.hudRight}">
      <div class="${css.hudVal}"><span data-k="garrow"></span><span data-k="grade">0.0 %</span></div>
      <div class="${css.hudLbl}">Grade</div>
      <div class="${css.hudVal} ${css.hudSmall}" data-k="limit">—</div>
      <div class="${css.hudLbl}">Limited by</div>
      <div class="${css.hudVal} ${css.hudSmall}" data-k="load">—</div>
    </div>`;
  const q = (k: string) => hud.querySelector(`[data-k="${k}"]`) as HTMLElement;
  const el = {
    arc: q('arc'), lim: q('lim'), limtxt: q('limtxt'), v: q('v'), pdot: q('pdot'), phase: q('phase'), dist: q('dist'), stop: q('stop'),
    prof: q('prof'), e0: q('e0'), e1: q('e1'), garrow: q('garrow'), grade: q('grade'), limit: q('limit'), load: q('load'),
  };
  let profKey = '';
  let marker: SVGGElement | null = null;
  let profScale = { L: 1, zlo: 0, zhi: 1 };
  let lastPath: PathTable | null = null;
  const set = (e: Element, txt: string) => { if (e.textContent !== txt) e.textContent = txt; };

  function buildProfile(path: PathTable, stops: number[]) {
    const L = Math.max(1, path.length);
    let zlo = Infinity, zhi = -Infinity;
    for (let i = 0; i < path.n; i++) { zlo = Math.min(zlo, path.z[i]); zhi = Math.max(zhi, path.z[i]); }
    if (zhi - zlo < 8) { const m = (zhi + zlo) / 2; zlo = m - 4; zhi = m + 4; }
    profScale = { L, zlo, zhi };
    const X = (s: number) => (s / L) * (PW - 8) + 4, Y = (z: number) => PH - 6 - ((z - zlo) / (zhi - zlo)) * (PH - 16);
    let svg = '';
    for (const r of gradeRuns(path)) {
      let d = `M${X(r.s0).toFixed(1)},${PH}`;
      for (let i = r.i0; i <= r.i1 + 1; i++) d += `L${X(path.s[i]).toFixed(1)},${Y(path.z[i]).toFixed(1)}`;
      d += `L${X(r.s1).toFixed(1)},${PH}Z`;
      svg += `<path d="${d}" fill="${gradeHex(r.grade)}" fill-opacity=".78"/>`;
    }
    let line = '';
    for (let i = 0; i < path.n; i++) line += `${i ? 'L' : 'M'}${X(path.s[i]).toFixed(1)},${Y(path.z[i]).toFixed(1)}`;
    svg += `<path d="${line}" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="1.6" stroke-linejoin="round"/>`;
    for (const sc of stops) {
      const x = X(sc);
      svg += `<line x1="${x}" x2="${x}" y1="2" y2="${PH}" stroke="rgba(255,255,255,.35)" stroke-dasharray="2 2"/><path transform="translate(${x - 5},1)" d="M3 0h4l3 3v4l-3 3H3L0 7V3z" fill="#C8102E" stroke="#fff" stroke-width=".9"/>`;
    }
    svg += `<g data-k="marker"><line x1="0" x2="0" y1="0" y2="${PH}" stroke="#fff" stroke-width="1.4"/><circle r="5.5" fill="#fff"/><path data-k="mdir" d="M-3,-3 L3,0 L-3,3 Z" fill="#16202a"/></g>`;
    el.prof.innerHTML = svg;
    marker = el.prof.querySelector('[data-k="marker"]');
  }

  const offOverlay = ctx.onOverlay((_g, _w, h) => {
    const s = st();
    const info = bus.followed;
    if (s.camera !== 'pov' || !info) { hud.style.display = 'none'; top.style.display = 'none'; return; }
    hud.style.display = '';
    top.style.display = '';
    hud.style.bottom = `${Math.max(16, Math.min(40, h * 0.035)).toFixed(0)}px`;
    render(info);
  });

  function render(info: TruckInfo) {
    const sc = st().scenario;
    const c = sc.circuits.find(x => x.id === info.circuitId);
    const path = info.stringId ? bus.pathOf?.(info.stringId) ?? null : null;
    // route strip (rebuilt when the string / its geometry changes)
    if (path) {
      const stops: number[] = [];
      const hs = sc.strings.find(x => x.id === info.stringId);
      if (hs) for (let i = 0; i < path.n; i++) if (hs.points[path.src[i]]?.stop) stops.push(path.s[i]);
      const key = `${info.stringId}|${path.length.toFixed(1)}|${path.n}|${stops.length}`;
      if (key !== profKey || path !== lastPath) { profKey = key; lastPath = path; buildProfile(path, stops); }
      if (marker) {
        const sx = Math.max(0, Math.min(profScale.L, info.chainage));
        let z = path.z[0];
        for (let i = 1; i < path.n; i++) if (path.s[i] >= sx) { const t = (sx - path.s[i - 1]) / Math.max(1e-6, path.s[i] - path.s[i - 1]); z = path.z[i - 1] + (path.z[i] - path.z[i - 1]) * t; break; }
        const x = (sx / profScale.L) * (PW - 8) + 4, y = PH - 6 - ((z - profScale.zlo) / (profScale.zhi - profScale.zlo)) * (PH - 16);
        marker.setAttribute('transform', `translate(${x.toFixed(1)},0)`);
        const circ = marker.querySelector('circle')!, dirp = marker.querySelector('[data-k="mdir"]')!;
        circ.setAttribute('cy', y.toFixed(1));
        dirp.setAttribute('transform', `translate(0,${y.toFixed(1)}) scale(${info.dir < 0 || (info.dir === 0 && !info.loaded) ? -1 : 1},1)`);
      }
    }
    const end = (k: 0 | 1) => { const p = c?.name.split(/→|->/); return p ? p[k]?.trim() ?? '' : ''; };
    set(el.e0, end(0) || 'Dig');
    set(el.e1, end(1) || 'Dump');
    // speed + gauge
    const v = Math.max(0, info.speedKmh), lim = c?.params.speedLimitKmh;
    set(el.v, v.toFixed(0));
    const ang = (f: number) => Math.PI * (1 - Math.max(0, Math.min(1, f)));
    const P = (f: number, r = 48) => [60 + Math.cos(ang(f)) * r, 62 - Math.sin(ang(f)) * r];
    const [ax, ay] = P(v / GAUGE_MAX);
    el.arc.setAttribute('d', v > 0.3 ? `M12 62 A48 48 0 0 1 ${ax.toFixed(1)} ${ay.toFixed(1)}` : '');
    el.arc.setAttribute('stroke', lim && v > lim + 0.5 ? '#FF8A7A' : '#ffffff');
    if (lim) {
      const [x1, y1] = P(lim / GAUGE_MAX, 40), [x2, y2] = P(lim / GAUGE_MAX, 56);
      el.lim.setAttribute('x1', x1.toFixed(1)); el.lim.setAttribute('y1', y1.toFixed(1)); el.lim.setAttribute('x2', x2.toFixed(1)); el.lim.setAttribute('y2', y2.toFixed(1));
    }
    set(el.limtxt, lim ? `Limit ${lim} km/h` : 'Speed');
    // phase / distances
    el.pdot.style.background = PHASE_COLOR[info.phase];
    set(el.phase, `${PHASE_SHORT[info.phase] ?? info.phase}${info.pauseLabel ? ` · ${info.pauseLabel}` : ''}`);
    const towardsDig = info.dir < 0 || info.phase === 'return' || info.phase === 'queue' || info.phase === 'spot' || info.phase === 'load';
    set(el.dist, towardsDig ? `${fmtM(Math.max(0, info.chainage))} to dig` : `${fmtM(Math.max(0, info.pathLength - info.chainage))} to dump`);
    if (info.nextStopM !== undefined) {
      const html = `<svg width="13" height="13" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 0h4l3 3v4l-3 3H3L0 7V3z" fill="#C8102E" stroke="#fff" stroke-width=".9"/></svg>Stop in ${fmtM(Math.abs(info.nextStopM - info.chainage))}`;
      if (el.stop.dataset.k !== html) { el.stop.innerHTML = html; el.stop.dataset.k = html; }
    } else if (el.stop.dataset.k !== '') { el.stop.innerHTML = ''; el.stop.dataset.k = ''; }
    // grade, limit, load
    const g = info.grade;
    const gc = lighten(gradeHex(g));
    el.grade.style.color = gc;
    el.garrow.style.color = gc;
    set(el.grade, `${g >= 0 ? '+' : '−'}${(Math.abs(g) * 100).toFixed(1)} %`);
    set(el.garrow, g > 0.004 ? '◢ ' : g < -0.004 ? '◣ ' : '▬ ');
    set(el.limit, info.limit && v > 0.5 ? LIMIT_LABEL[info.limit] ?? info.limit : 'Stationary');
    set(el.load, info.loaded ? `Loaded · ${info.materialName ?? ''}` : 'Empty');
    const th = `${info.unitId}<span>${info.modelName}${c ? ` · ${c.name}` : ''}</span>`;
    if (top.dataset.k !== th) { top.innerHTML = th; top.dataset.k = th; }
  }

  return () => { offOverlay(); root.remove(); };
};

function fmtM(m: number): string { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }
function lighten(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const k = (x: number) => Math.round((x + (1 - x) * 0.45) * 255);
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}
