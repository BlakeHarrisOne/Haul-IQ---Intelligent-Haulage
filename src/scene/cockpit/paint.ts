/**
 * Driver's-seat frame of a rigid haul truck (cab on the front deck), painted on the 2D overlay in angle space
 * (Haul Road Lab drawCockpit, kind 'hv'): canopy underside and deck seen through the glass, A / B pillars, header,
 * dash with a live speed dial, steering wheel, the big side mirror (with its blind spot) and the far mirror across the
 * deck. Geometry is defined from the driver's eye: azimuth X (+ right) and elevation Y (+ up), radians; points in the
 * eye frame (x right, y forward, z up, m) are projected with the same perspective as the 3D camera, so the overlay
 * stays registered with the world (including head glances: yaw / pitch).
 */

export interface CabGeom {
  /** Eye above the deck (m). */
  EH: number;
  /** Deck front edge ahead of the eye; deck extent right / left of the eye (m). */
  DF: number; DR: number; DL: number;
  /** Canopy underside above the eye, front edge ahead, extent right / left (m). */
  CZ: number; CF: number; CR: number; CL: number;
  /** Engine hood box on the deck (eye frame). */
  hood: { x0: number; x1: number; y1: number; h: number };
  /** Paint colour of the truck. */
  paint: [number, number, number];
}

export interface CabView { W: number; H: number; fovY: number; yaw: number; pitch: number; speedKmh: number; limitKmh?: number; t: number }

type Map2 = (X: number, Y: number) => [number, number];
type MapW = (x: number, y: number, z: number) => [number, number] | null;

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
interface Line { x0: number; y0: number; x1: number; y1: number }
const lineX = (L: Line, Y: number) => L.x0 + ((L.x1 - L.x0) * (Y - L.y0)) / (L.y1 - L.y0);
const vline = (x: number): Line => ({ x0: x, y0: -2, x1: x, y1: 2 });
function isect(L: Line, g: (X: number) => number): [number, number] { let Y = g(L.x0); for (let i = 0; i < 14; i++) Y = g(lineX(L, Y)); return [lineX(L, Y), Y]; }
function panel(L: Line, R: Line, top: (X: number) => number, bot: (X: number) => number, n = 24): [number, number][] {
  const bl = isect(L, bot), br = isect(R, bot), tr = isect(R, top), tl = isect(L, top);
  const pts: [number, number][] = [bl];
  for (let i = 1; i < n; i++) { const x = bl[0] + ((br[0] - bl[0]) * i) / n; pts.push([x, bot(x)]); }
  pts.push(br, tr);
  for (let i = 1; i < n; i++) { const x = tr[0] + ((tl[0] - tr[0]) * i) / n; pts.push([x, top(x)]); }
  pts.push(tl);
  return pts;
}
const rgb = (c: [number, number, number], k = 1, a = 1) => `rgba(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)},${a})`;

export function makeMaps(v: CabView): { map: Map2; mapW: MapW; f: number } {
  const f = v.H / 2 / Math.tan((v.fovY * Math.PI) / 360);
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const proj = (dx: number, dy: number, dz: number): [number, number] => {
    const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy;
    const y2 = dy * cp - z1 * sp, z2 = dy * sp + z1 * cp;
    const z = Math.max(z2, 0.02);
    return [v.W / 2 + (f * x1) / z, v.H / 2 - (f * y2) / z];
  };
  return {
    f,
    map: (X, Y) => proj(Math.cos(Y) * Math.sin(X), Math.sin(Y), Math.cos(Y) * Math.cos(X)),
    mapW: (x, y, z) => (y < 0.05 ? null : proj(x, z, y)),
  };
}

/** Screen y of the dash top straight ahead (for placing the HUD just above it). */
export function dashTopY(v: CabView): number {
  const { map } = makeMaps(v);
  return map(0, -0.36)[1];
}

export function paintCockpit(g: CanvasRenderingContext2D, v: CabView, cab: CabGeom) {
  const { map, mapW } = makeMaps(v);
  const px = Math.max(1, v.H / 900);
  const pathA = (pts: [number, number][], close = true) => {
    g.beginPath();
    pts.forEach(([X, Y], i) => { const [x, y] = map(X, Y); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    if (close) g.closePath();
  };
  const pathW = (pts: [number, number, number][]) => {
    g.beginPath();
    let pen = false;
    for (const p of pts) { const q = mapW(p[0], p[1], p[2]); if (!q) continue; if (pen) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); pen = true; }
    g.closePath();
  };
  const sample = (fn: (X: number) => number, x0: number, x1: number, n = 48): [number, number][] => { const p: [number, number][] = []; for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; p.push([x, fn(x)]); } return p; };

  // ── geometry (angle space) ─────────────────────────────────────────────────────────
  const header = (X: number) => 0.445 - 0.035 * X * X;
  const dashTop = (X: number) => -0.5 + 0.13 * smooth(-0.46, -0.38, X) * (1 - smooth(0.24, 0.32, X)) - 0.02 * Math.max(0, X - 0.3);
  const LAi: Line = { x0: -0.585, y0: -0.62, x1: -0.625, y1: 0.46 }, LAo: Line = { x0: -0.68, y0: -0.62, x1: -0.722, y1: 0.46 };
  const RAi: Line = { x0: 0.505, y0: -0.62, x1: 0.545, y1: 0.46 }, RAo: Line = { x0: 0.6, y0: -0.62, x1: 0.645, y1: 0.46 };
  const roofR = (X: number) => 0.44 + 0.035 * (X - 0.6), sillR = () => -0.7;
  const roofL = (X: number) => 0.425 + 0.035 * (-X - 0.7), beltL = (X: number) => -0.335 - 0.3 * Math.pow(Math.max(0, -X - 0.7), 1.2);
  const BR = [1.74, 1.9], BL = [-1.7, -1.86];
  const glass = [
    panel(LAi, RAi, header, () => -0.66, 32),
    panel(RAo, vline(BR[0]), roofR, sillR, 28),
    panel(vline(BL[0]), LAo, roofL, beltL, 24),
  ];
  const clipGlass = () => { g.beginPath(); for (const p of glass) { p.forEach(([X, Y], i) => { const [x, y] = map(X, Y); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); } g.clip(); };

  // ── 1. outside, through the glass: canopy, deck, rails, hood ───────────────────────
  g.save();
  clipGlass();
  const P = cab.paint;
  // canopy underside + lip
  const cy0 = 0.35;
  pathW([[-cab.CL, cy0, cab.CZ], [cab.CR, cy0, cab.CZ], [cab.CR, cab.CF, cab.CZ], [-cab.CL, cab.CF, cab.CZ]]);
  g.fillStyle = rgb(P, 0.6); g.fill();
  for (let x = -cab.CL + 0.4; x < cab.CR; x += 1.05) { pathW([[x - 0.06, cy0, cab.CZ - 0.01], [x + 0.06, cy0, cab.CZ - 0.01], [x + 0.06, cab.CF, cab.CZ - 0.01], [x - 0.06, cab.CF, cab.CZ - 0.01]]); g.fillStyle = rgb(P, 0.45); g.fill(); }
  pathW([[-cab.CL, cab.CF, cab.CZ], [cab.CR, cab.CF, cab.CZ], [cab.CR, cab.CF + 0.02, cab.CZ - 0.24], [-cab.CL, cab.CF + 0.02, cab.CZ - 0.24]]);
  g.fillStyle = rgb(P, 0.82); g.fill();
  // deck surface, toe board, anti-slip panels
  const z = -cab.EH;
  pathW([[-cab.DL, 0.3, z], [cab.DR, 0.3, z], [cab.DR, cab.DF, z], [-cab.DL, cab.DF, z]]);
  const dk = mapW(0, cab.DF, z), dk2 = mapW(0, 0.6, z);
  const grd = g.createLinearGradient(0, dk ? dk[1] : 0, 0, dk2 ? dk2[1] : v.H);
  grd.addColorStop(0, rgb(P, 0.95)); grd.addColorStop(1, rgb(P, 0.72));
  g.fillStyle = grd; g.fill();
  for (let y = 1.0; y < cab.DF - 0.2; y += 0.9) { pathW([[-cab.DL + 0.15, y, z + 0.005], [cab.DR - 0.15, y, z + 0.005], [cab.DR - 0.15, y + 0.04, z + 0.005], [-cab.DL + 0.15, y + 0.04, z + 0.005]]); g.fillStyle = rgb(P, 0.62, 0.55); g.fill(); }
  pathW([[-cab.DL, cab.DF, z], [cab.DR, cab.DF, z], [cab.DR, cab.DF, z - 0.3], [-cab.DL, cab.DF, z - 0.3]]);
  g.fillStyle = rgb(P, 0.7); g.fill();
  // engine hood on the deck
  const hd = cab.hood;
  const hz = z + hd.h;
  pathW([[hd.x0, 0.3, hz], [hd.x1, 0.3, hz], [hd.x1, hd.y1, hz], [hd.x0, hd.y1, hz]]); g.fillStyle = rgb(P, 0.98); g.fill();
  pathW([[hd.x0, hd.y1, hz], [hd.x1, hd.y1, hz], [hd.x1, hd.y1, z], [hd.x0, hd.y1, z]]); g.fillStyle = rgb(P, 0.78); g.fill();
  pathW([[hd.x0, 0.3, hz], [hd.x0, hd.y1, hz], [hd.x0, hd.y1, z], [hd.x0, 0.3, z]]); g.fillStyle = rgb(P, 0.68); g.fill();
  for (let i = 0; i < 6; i++) { const yy = 0.6 + i * ((hd.y1 - 0.8) / 6); const a = mapW(hd.x0 + 0.4, yy, hz + 0.003), b = mapW(hd.x1 - 0.3, yy, hz + 0.003); if (a && b) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineWidth = 1.4 * px; g.strokeStyle = 'rgba(60,58,54,0.4)'; g.stroke(); } }
  // handrail along the deck front
  const RF = cab.DF - 0.12, rh = 1.05;
  const rail = (a: [number, number, number], b: [number, number, number], w: number) => { const p = mapW(...a), q = mapW(...b); if (!p || !q) return; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.lineWidth = w; g.stroke(); };
  g.strokeStyle = '#1d2024'; g.lineCap = 'round';
  rail([-cab.DL + 0.1, RF, z + rh], [cab.DR - 0.1, RF, z + rh], 4.5 * px);
  rail([-cab.DL + 0.1, RF, z + rh * 0.5], [cab.DR - 0.1, RF, z + rh * 0.5], 3.5 * px);
  for (let x = -cab.DL + 0.1; x <= cab.DR - 0.05; x += 1.3) rail([x, RF, z], [x, RF, z + rh], 4 * px);
  // blind zone ahead: everything nearer than the deck edge is hidden - hatch a faint band along the edge
  g.restore();

  // ── 2. glass: faint tint, top shade band, soft reflections ──────────────────────────
  g.save();
  clipGlass();
  g.fillStyle = 'rgba(118,136,156,0.05)'; g.fillRect(0, 0, v.W, v.H);
  const [, hy] = map(0, header(0));
  const sh = g.createLinearGradient(0, hy, 0, hy + v.H * 0.16);
  sh.addColorStop(0, 'rgba(60,78,98,0.34)'); sh.addColorStop(0.55, 'rgba(80,98,118,0.1)'); sh.addColorStop(1, 'rgba(80,98,118,0)');
  g.fillStyle = sh; g.fillRect(0, hy - 4, v.W, v.H * 0.2);
  for (const [x0, wdt, a] of [[-0.5, 0.2, 0.05], [0.18, 0.1, 0.06]] as [number, number, number][]) {
    const p0 = map(x0, 0.5), p1 = map(x0 + wdt, 0.5), p2 = map(x0 + wdt + 0.34, -0.4), p3 = map(x0 + 0.34, -0.4);
    g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.lineTo(...p2); g.lineTo(...p3); g.closePath();
    const rg = g.createLinearGradient(p0[0], 0, p1[0], 0);
    rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.5, `rgba(255,255,255,${a})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fill();
  }
  g.restore();

  // ── 3. trim: everything that is not glass ───────────────────────────────────────────
  g.save();
  g.beginPath();
  g.rect(-10, -10, v.W + 20, v.H + 20);
  for (const p of glass) { p.forEach(([X, Y], i) => { const [x, y] = map(X, Y); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); }
  const tg = g.createLinearGradient(0, 0, 0, v.H);
  tg.addColorStop(0, '#d9dad8'); tg.addColorStop(0.45, '#c9cac8'); tg.addColorStop(1, '#a9abab');
  g.fillStyle = tg;
  g.fill('evenodd');
  g.restore();
  // inner shadow along the glass edges (depth)
  g.save();
  for (const p of glass) {
    pathA(p);
    g.lineWidth = 3 * px; g.strokeStyle = 'rgba(30,34,40,0.55)'; g.stroke();
    g.lineWidth = 1 * px; g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.translate(0, -1.5 * px); g.stroke(); g.translate(0, 1.5 * px);
  }
  g.restore();

  // ── 4. pillars ─────────────────────────────────────────────────────────────────────
  const pillar = (Li: Line, Lo: Line, yb: number, yt: number, flip: boolean) => {
    const pts: [number, number][] = [[lineX(Li, yb), yb], [lineX(Lo, yb), yb], [lineX(Lo, yt), yt], [lineX(Li, yt), yt]];
    pathA(pts);
    const ym = (yb + yt) / 2, a = map(lineX(Li, ym), ym), b = map(lineX(Lo, ym), ym);
    const pg = g.createLinearGradient(a[0], 0, b[0], 0);
    if (flip) { pg.addColorStop(0, '#6b7178'); pg.addColorStop(0.35, '#555b62'); pg.addColorStop(1, '#3b4046'); }
    else { pg.addColorStop(0, '#3b4046'); pg.addColorStop(0.65, '#555b62'); pg.addColorStop(1, '#6b7178'); }
    g.fillStyle = pg; g.fill();
  };
  pillar(LAi, LAo, -0.72, 0.52, true);
  pillar(RAi, RAo, -0.72, 0.52, false);
  pillar(vline(BR[0]), vline(BR[1]), -0.8, 0.6, false);
  pillar(vline(BL[1]), vline(BL[0]), -0.8, 0.6, true);

  // ── 5. dashboard + binnacle with a live speed dial ─────────────────────────────────
  const xL = -1.5, xR = 1.4;
  const dash = sample(dashTop, xL, xR, 90);
  const lip = (X: number) => dashTop(X) - 0.06 - 0.01 * X * X;
  g.save();
  g.shadowColor = 'rgba(15,20,28,0.35)'; g.shadowBlur = 16 * px; g.shadowOffsetY = -2 * px;
  pathA([...dash, [xR, -1.6], [xL, -1.6]]);
  const dg = g.createLinearGradient(0, map(0, -0.5)[1], 0, v.H);
  dg.addColorStop(0, '#3a4046'); dg.addColorStop(0.3, '#30353a'); dg.addColorStop(1, '#22262a');
  g.fillStyle = dg; g.fill();
  g.restore();
  pathA([...dash, ...sample(lip, xR, xL, 90)]);
  g.fillStyle = '#4a5056'; g.fill();
  g.beginPath(); sample(dashTop, xL, xR, 90).forEach(([X, Y], i) => { const [x, y] = map(X, Y); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.lineWidth = 1.4 * px; g.strokeStyle = 'rgba(255,255,255,0.28)'; g.stroke();
  // instrument cluster in the binnacle
  const [cx, cyy] = map(-0.08, -0.46), rr = Math.max(26, v.H * 0.052);
  g.save();
  g.beginPath(); g.ellipse(cx, cyy, rr * 2.5, rr * 1.12, 0, 0, Math.PI * 2);
  g.fillStyle = '#15181b'; g.fill();
  g.lineWidth = 1.5 * px; g.strokeStyle = 'rgba(255,255,255,0.18)'; g.stroke();
  const dial = (x: number, y: number, r: number, frac: number, label: string, warn?: number) => {
    g.beginPath(); g.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25); g.lineWidth = 2 * px; g.strokeStyle = 'rgba(220,228,236,0.25)'; g.stroke();
    for (let k = 0; k <= 10; k++) {
      const q = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
      g.beginPath(); g.moveTo(x + Math.cos(q) * r * 0.82, y + Math.sin(q) * r * 0.82); g.lineTo(x + Math.cos(q) * r * 0.96, y + Math.sin(q) * r * 0.96);
      g.lineWidth = (k % 5 ? 1 : 1.8) * px; g.strokeStyle = 'rgba(220,228,236,0.6)'; g.stroke();
    }
    if (warn !== undefined) {
      const q0 = Math.PI * 0.75 + warn * Math.PI * 1.5;
      g.beginPath(); g.arc(x, y, r * 0.9, q0, Math.PI * 2.25); g.lineWidth = 2.5 * px; g.strokeStyle = 'rgba(224,121,109,0.85)'; g.stroke();
    }
    const q = Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(q) * r * 0.86, y + Math.sin(q) * r * 0.86);
    g.lineWidth = 2.4 * px; g.strokeStyle = '#ff8a3d'; g.stroke();
    g.beginPath(); g.arc(x, y, 3 * px, 0, Math.PI * 2); g.fillStyle = '#ff8a3d'; g.fill();
    g.fillStyle = 'rgba(220,228,236,0.75)'; g.font = `600 ${Math.round(r * 0.28)}px system-ui,sans-serif`; g.textAlign = 'center'; g.fillText(label, x, y + r * 0.62);
  };
  const vmax = 60;
  dial(cx - rr * 1.25, cyy, rr * 0.92, v.speedKmh / vmax, 'km/h', v.limitKmh ? v.limitKmh / vmax : undefined);
  dial(cx + rr * 1.25, cyy, rr * 0.92, 0.35 + 0.45 * Math.min(1, v.speedKmh / 40) + 0.02 * Math.sin(v.t * 9), 'rpm ×100');
  g.restore();

  // ── 6. steering wheel (rim top just under the dash lip) ─────────────────────────────
  {
    const cxA = -0.06, cyA = -0.86, rA = 0.32;
    const [wx, wy] = map(cxA, cyA), [, ty] = map(cxA, cyA + rA), [sx] = map(cxA + rA * 1.12, cyA);
    const rx = Math.abs(sx - wx), ry = Math.abs(wy - ty), w = Math.max(10, rx * 0.15);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 18 * px; g.shadowOffsetY = 6 * px;
    g.beginPath(); g.ellipse(wx, wy, rx, ry, 0, Math.PI * 1.0, Math.PI * 2.0); g.lineWidth = w; g.strokeStyle = '#1b1e21'; g.lineCap = 'round'; g.stroke();
    g.shadowColor = 'transparent';
    g.beginPath(); g.ellipse(wx, wy - w * 0.12, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.85); g.lineWidth = w * 0.22; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();
    for (const a of [Math.PI * 1.12, Math.PI * 1.88]) {
      g.beginPath(); g.moveTo(wx + Math.cos(a) * rx * 0.97, wy + Math.sin(a) * ry * 0.97); g.lineTo(wx + Math.cos(a) * rx * 0.28, wy + Math.sin(a) * ry * 0.2);
      g.lineWidth = w * 0.9; g.strokeStyle = '#25292d'; g.stroke();
    }
    g.beginPath(); g.ellipse(wx, wy - ry * 0.12, rx * 0.3, ry * 0.2, 0, 0, Math.PI * 2); g.fillStyle = '#2a2e33'; g.fill();
    g.restore();
  }

  // ── 7. mirrors: big side mirror on its arm (with blind spot) + far mirror across the deck ──
  const mirror = (X: number, Y: number, wA: number, hA: number, blindSide: 1 | -1) => {
    const [x0, y0] = map(X - wA / 2, Y + hA / 2), [x1, y1] = map(X + wA / 2, Y - hA / 2);
    const mw = x1 - x0, mh = y1 - y0;
    if (mw < 4 || x1 < -20 || x0 > v.W + 20) return;
    g.save();
    // arm back to the cab
    const [ax, ay] = map(X - blindSide * wA * 0.9, Y - hA * 0.7);
    g.beginPath(); g.moveTo(x0 + mw / 2, y1); g.lineTo(ax, ay); g.lineWidth = Math.max(3, mw * 0.08); g.strokeStyle = '#2a2e33'; g.lineCap = 'round'; g.stroke();
    g.shadowColor = 'rgba(10,14,20,0.35)'; g.shadowBlur = 12 * px; g.shadowOffsetY = 3 * px;
    g.beginPath(); g.roundRect(x0, y0, mw, mh, Math.min(10, mw * 0.12)); g.fillStyle = '#1f2327'; g.fill();
    g.shadowColor = 'transparent';
    const inset = Math.max(2.5, mw * 0.06);
    g.beginPath(); g.roundRect(x0 + inset, y0 + inset, mw - 2 * inset, mh - 2 * inset, Math.min(8, mw * 0.09));
    g.save(); g.clip();
    // mirrored world: sky, horizon, road receding, own truck body down the inner edge, blind wedge
    const sky = g.createLinearGradient(0, y0, 0, y1);
    sky.addColorStop(0, '#c9d6e2'); sky.addColorStop(0.48, '#e2e7ec'); sky.addColorStop(0.5, '#b6aa94'); sky.addColorStop(1, '#8f8676');
    g.fillStyle = sky; g.fillRect(x0, y0, mw, mh);
    const hzY = y0 + mh * 0.49, inner = blindSide > 0 ? x1 : x0;
    g.beginPath(); g.moveTo(inner - blindSide * mw * 0.1, hzY); g.lineTo(inner - blindSide * mw * 0.2, y1); g.lineTo(inner - blindSide * mw * 0.75, y1); g.closePath();
    g.fillStyle = 'rgba(70,66,60,0.55)'; g.fill();
    g.beginPath(); g.moveTo(inner, y0 + mh * 0.25); g.lineTo(inner - blindSide * mw * 0.24, y0 + mh * 0.3); g.lineTo(inner - blindSide * mw * 0.3, y1); g.lineTo(inner, y1); g.closePath();
    g.fillStyle = rgb(P, 0.75); g.fill();
    // blind spot: the hatched zone the mirror cannot show (beside / below the body)
    g.beginPath(); g.moveTo(inner - blindSide * mw * 0.3, y1); g.lineTo(inner - blindSide * mw * 0.55, y0 + mh * 0.72); g.lineTo(inner - blindSide * mw * 1.0, y0 + mh * 0.78); g.lineTo(inner - blindSide * mw * 1.0, y1); g.closePath();
    g.fillStyle = 'rgba(200,40,40,0.16)'; g.fill();
    g.setLineDash([3 * px, 3 * px]); g.lineWidth = 1.2 * px; g.strokeStyle = 'rgba(190,40,40,0.65)'; g.stroke(); g.setLineDash([]);
    const shine = g.createLinearGradient(x0, 0, x1, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)'); shine.addColorStop(0.3, 'rgba(255,255,255,0.22)'); shine.addColorStop(0.42, 'rgba(255,255,255,0)');
    g.fillStyle = shine; g.fillRect(x0, y0, mw, mh);
    g.restore();
    g.lineWidth = 1 * px; g.strokeStyle = 'rgba(255,255,255,0.3)'; g.stroke();
    g.restore();
  };
  mirror(-0.8, 0.0, 0.12, 0.2, 1);
  mirror(-0.8, -0.17, 0.095, 0.07, 1);
  mirror(0.86, -0.1, 0.06, 0.1, -1);
}
