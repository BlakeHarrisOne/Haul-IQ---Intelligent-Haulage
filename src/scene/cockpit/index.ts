/**
 * Cockpit module (store.camera === 'pov'): the driver's-seat frame of the followed truck on the overlay canvas plus a
 * minimal glass HUD - speed, grade, the speed-limiting reason, phase, distance to the dump / dig and the next stop sign.
 * The followed truck itself is hidden from the 3D view by the actors module while in POV.
 */
import * as THREE from 'three';
import type { SceneContext, SceneModule } from '../context';
import { useApp } from '@/state/store';
import { busOf, type TruckInfo } from '../strings/bus';
import { hexToRgb, literalColor } from '../strings/palette';
import { gradeHex } from '../strings/palette';
import css from '../strings/ui.module.css';
import { dashTopY, paintCockpit, type CabGeom } from './paint';
import { wrapAngle } from '../actors/pose';
import { PHASE_COLOR } from '../actors';

const LIMIT_LABEL: Record<string, string> = {
  rimpull: 'Rimpull', retarder: 'Retarder', 'speed-limit': 'Speed limit', 'top-speed': 'Top speed', table: 'Speed table', 'table-out-of-range': 'Off table',
};
const PHASE_SHORT: Record<string, string> = { queue: 'Queued', spot: 'Spotting', load: 'Loading', haul: 'Loaded haul', dump: 'Dumping', return: 'Empty return', parked: 'Parked' };

export const cockpitModule: SceneModule = (ctx: SceneContext) => {
  const bus = busOf(ctx);
  const st = () => useApp.getState();
  const root = document.createElement('div');
  root.className = css.root;
  ctx.labelLayer.appendChild(root);
  const hud = document.createElement('div');
  hud.className = css.hud;
  hud.style.display = 'none';
  const top = document.createElement('div');
  top.className = css.hudTop;
  top.style.display = 'none';
  root.append(hud, top);
  const dir = new THREE.Vector3();
  let t0 = performance.now();

  function cabFor(info: TruckInfo): { cab: CabGeom; mirror: boolean } {
    const s = st().scenario;
    const c = s.circuits.find(x => x.id === info.circuitId);
    const m = s.fleet.trucks.find(t => t.id === c?.truckModelId);
    const d = m?.dims ?? { length: 12, width: 7.6, height: 6.1, eyeHeight: 4.5, eyeBack: 3.3, eyeRight: -2.8 };
    const L = d.length, W = d.width, H = d.height, hw = W / 2;
    const er = Math.abs(d.eyeRight ?? 0.3 * W), eb = d.eyeBack ?? 0.27 * L, ez = d.eyeHeight || 0.75 * H;
    const D = Math.min(0.55 * H, 0.3 * L);
    const deck = Math.max(ez - 1.2, D + 0.18);
    const cab: CabGeom = {
      EH: Math.max(1.5, ez - deck), DF: Math.max(1.8, eb - 0.045 * L), DR: 0.47 * W + er, DL: Math.max(0.5, 0.47 * W - er),
      CZ: Math.max(0.9, H - ez), CF: Math.max(1.5, eb - 0.03 * L), CR: hw + er, CL: Math.max(0.4, hw - er),
      hood: { x0: Math.max(1.2, er - 2.0 + 0.9), x1: er + 0.3 * W, y1: Math.max(0.8, eb - 0.11 * L), h: 0.85 },
      paint: hexToRgb(literalColor(m?.color ?? '#E3A21B')),
    };
    return { cab, mirror: (d.eyeRight ?? -1) > 0 };
  }

  const offOverlay = ctx.onOverlay((g, w, h) => {
    const s = st();
    const info = bus.followed;
    const target = ctx.getFollowTarget();
    if (s.camera !== 'pov' || !info || !target) { hud.style.display = 'none'; top.style.display = 'none'; return; }
    const cam = ctx.camera() as THREE.PerspectiveCamera;
    cam.getWorldDirection(dir);
    const camYaw = Math.atan2(-dir.z, dir.x), camPitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const { cab, mirror } = cabFor(info);
    let yaw = -wrapAngle(camYaw - target.heading);
    const pitch = camPitch - target.pitch;
    g.save();
    if (mirror) { g.translate(w, 0); g.scale(-1, 1); yaw = -yaw; }
    const seg = s.scenario.circuits.find(c => c.id === info.circuitId);
    const view = { W: w, H: h, fovY: cam.fov || 70, yaw, pitch, speedKmh: info.speedKmh, limitKmh: seg?.params.speedLimitKmh, t: (performance.now() - t0) / 1000 };
    paintCockpit(g, view, cab);
    g.restore();
    renderHud(info);
    // the HUD floats on the windscreen just above the dash (over the deck - the blind zone ahead of the cab)
    const dy = dashTopY({ ...view, yaw: 0 });
    hud.style.bottom = `${Math.max(12, Math.min(h * 0.4, h - dy + 18)).toFixed(0)}px`;
  });

  function renderHud(info: TruckInfo) {
    const toDump = info.dir < 0 || info.phase === 'queue' || info.phase === 'spot' || info.phase === 'load' ? null : Math.max(0, info.pathLength - info.chainage);
    const toDig = Math.max(0, info.chainage);
    const stop = info.nextStopM !== undefined ? Math.abs(info.nextStopM - info.chainage) : null;
    const g = info.grade;
    const col = PHASE_COLOR[info.phase];
    const html = `<div class="${css.hudCell}"><div><span class="${css.hudBig}">${info.speedKmh.toFixed(0)}</span><span class="${css.hudUnit}">km/h</span></div><div class="${css.hudLbl}">Speed</div></div>`
      + `<div class="${css.hudCell}"><div class="${css.hudVal}" style="color:${lighten(gradeHex(g))}">${g >= 0 ? '+' : '−'}${(Math.abs(g) * 100).toFixed(1)} %</div><div class="${css.hudLbl}">Grade</div></div>`
      + `<div class="${css.hudCell}"><div class="${css.hudVal}">${info.limit && info.speedKmh > 0.5 ? LIMIT_LABEL[info.limit] ?? info.limit : '—'}</div><div class="${css.hudLbl}">Limited by</div></div>`
      + `<div class="${css.hudCell}"><div class="${css.hudPhase}"><i style="background:${col}"></i>${PHASE_SHORT[info.phase] ?? info.phase}</div><div class="${css.hudLbl}">${info.loaded ? `Loaded · ${info.materialName ?? ''}` : 'Empty'}</div></div>`
      + `<div class="${css.hudCell}"><div class="${css.hudVal}">${toDump !== null ? fmtM(toDump) : fmtM(toDig)}</div><div class="${css.hudLbl}">${toDump !== null ? 'To dump' : 'To dig'}</div></div>`
      + `<div class="${css.hudCell}"><div class="${css.hudVal} ${css.hudStop}">${stop !== null ? `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1h6l4 4v6l-4 4H5l-4-4V5z" fill="#C8102E" stroke="#fff" stroke-width="1.2"/></svg>${fmtM(stop)}` : '—'}</div><div class="${css.hudLbl}">Next stop</div></div>`;
    if (hud.dataset.k !== html) { hud.innerHTML = html; hud.dataset.k = html; }
    hud.style.display = '';
    const c = st().scenario.circuits.find(x => x.id === info.circuitId);
    const th = `${info.unitId}<span>${info.modelName}${c ? ` · ${c.name}` : ''}</span>`;
    if (top.dataset.k !== th) { top.innerHTML = th; top.dataset.k = th; }
    top.style.display = '';
  }

  return () => { offOverlay(); root.remove(); t0 = 0; };
};

function fmtM(m: number): string { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }
function lighten(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const k = (x: number) => Math.round((x + (1 - x) * 0.45) * 255);
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}
