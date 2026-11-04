/**
 * Built-in viewport chrome (bottom-right, HRL white 44 px surfaces): legend chip (solids + continuous grade ramp),
 * fit, north arrow (rotates with the view; click = face north), scale bar.
 *  - hidden until the scenario has assets (nothing to measure on the welcome screen);
 *  - in POV / chase the scale bar and the legend go (a scale bar means nothing in perspective from the cab);
 *  - the dock sizes to its content inside the right column: the room left after fit / compass / legend sets the
 *    scale bar's longest length, and the legend drops out first when even a short bar would not fit — the bar
 *    never spills out of its pill or off-screen.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chrome, ChromeSep, Ctl, GRADE_HEX, cx, uiStyles } from '@/ui';
import { useApp } from '@/state/store';
import type { SceneCore, ViewInfo } from './SceneCore';
import css from './core.module.css';

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
/** Scale element chrome: padding 14 + 12, gap 10 (+ the live label width, + slack for a longer label). */
const SCALE_FIXED = 14 + 12 + 10 + 6;
const BAR_MIN = 24, BAR_MAX = 96;

/** Grade ramp stops shared with the terrain slope overlay (fractions; matches geom GRADE_CLASS_LIMITS 4/8/10 %). */
export const GRADE_STOPS: [number, string][] = [[0, GRADE_HEX.flat], [0.04, GRADE_HEX.mod], [0.08, GRADE_HEX.steep], [0.1, GRADE_HEX.max]];

/** Compact legend (inside the bottom-right chrome surface): solids swatches + continuous grade ramp. */
function Legend() {
  const assets = useApp(s => s.scenario.assets);
  const layers = useApp(s => s.layers);
  const { dig, dump } = useMemo(() => ({
    dig: assets.find(a => a.role === 'dig' && a.kind === 'solid'),
    dump: assets.find(a => a.role === 'dump' && a.kind === 'solid'),
  }), [assets]);
  const showGrade = layers.grade !== false || !!layers.slope;
  const showSolids = layers.solids !== false && !!(dig || dump);
  if (!showGrade && !showSolids) return null;
  const max = 0.12;
  const grad = `linear-gradient(90deg, ${GRADE_STOPS.map(([g, c], i) => `${c} ${((i === GRADE_STOPS.length - 1 ? g + 0.005 : g) / max) * 100}%`).join(', ')})`;
  return (
    <span className={css.legend}>
      {showSolids && dig && <span className={css.lgItem} title="Dig solid · carved ground is blue, the bright slab is this shift's work"><i className={css.lgSolid} style={{ background: dig.color }} />Dig</span>}
      {showSolids && dump && <span className={css.lgItem} title="Dump solid · the dashed ghost is the part still to fill"><i className={css.lgSolid} style={{ background: dump.color }} />Dump</span>}
      {showGrade && (
        <span className={css.lgItem} title="Grade (rise over run): 0–4 % flat · 4–8 % moderate · 8–10 % steep · >10 % excessive">
          <span className={css.lgRamp}>
            <i style={{ background: grad }} />
            <span className={css.lgTicks}><b style={{ left: '0%' }}>0</b><b style={{ left: `${(4 / 12) * 100}%` }}>4</b><b style={{ left: `${(8 / 12) * 100}%` }}>8 %</b></span>
          </span>
        </span>
      )}
      <ChromeSep />
    </span>
  );
}

export function SceneChrome({ core }: { core: SceneCore }) {
  const hasAssets = useApp(s => s.scenario.assets.length > 0);
  const camera = useApp(s => s.camera);
  const layers = useApp(s => s.layers);
  const assets = useApp(s => s.scenario.assets);
  const ride = camera === 'pov' || camera === 'chase';
  const [legendFits, setLegendFits] = useState(true);
  const dock = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const scaleEl = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const maxPx = useRef(72);
  const legendW = useRef(0);
  const lastMpp = useRef(0);
  const last = useRef({ h: NaN, l: '', w: -1 });

  const applyScale = (mpp: number) => {
    if (!(mpp > 0)) return;
    const lim = maxPx.current;
    let L = NICE[0];
    for (const n of NICE) if (n / mpp <= lim) L = n;
    const px = Math.max(BAR_MIN, Math.min(lim, Math.round(L / mpp)));
    const txt = L >= 1000 ? `${L / 1000} km` : `${L} m`;
    if (label.current && txt !== last.current.l) { label.current.textContent = txt; last.current.l = txt; }
    if (bar.current && px !== last.current.w) { bar.current.style.width = `${px}px`; last.current.w = px; }
  };

  // room for the scale bar = the dock's limit − everything else in the surface
  const measure = () => {
    const d = dock.current;
    const surf = d?.firstElementChild as HTMLElement | null;
    const host = d?.parentElement;
    if (!d || !surf || !host) return;
    const W = host.clientWidth;
    const right = core.insets().right;
    const limit = Math.min(W - 28, Math.max(380, right - 28));
    if (!(W > 0)) return;
    const scaleW = scaleEl.current?.offsetWidth ?? 0;
    const lg = surf.querySelector(`.${css.legend}`) as HTMLElement | null;
    if (lg) legendW.current = lg.offsetWidth;
    const rest = surf.scrollWidth - scaleW + 2;
    const room = limit - rest - SCALE_FIXED - Math.max(34, label.current?.offsetWidth ?? 40);
    // the legend goes first when even a short bar would not fit; it comes back only when it would fit with room to spare
    if (room < BAR_MIN + 8 && legendFits && lg && !ride) { setLegendFits(false); return; }
    if (!legendFits && !ride && room - legendW.current > BAR_MIN + 24) { setLegendFits(true); return; }
    maxPx.current = Math.max(BAR_MIN, Math.min(BAR_MAX, room));
    last.current.w = -1;
    applyScale(lastMpp.current);
  };

  useLayoutEffect(measure);
  useEffect(() => {
    const host = dock.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    return () => ro.disconnect();
  });
  useEffect(() => {
    return core.onView((v: ViewInfo) => {
      if (needle.current && Math.abs(v.heading - last.current.h) > 0.05) { needle.current.style.transform = `rotate(${(-v.heading).toFixed(2)}deg)`; last.current.h = v.heading; }
      lastMpp.current = v.mpp;
      applyScale(v.mpp);
    });
  }, [core]);
  useEffect(() => { last.current = { h: last.current.h, l: '', w: -1 }; applyScale(lastMpp.current); }, [ride, legendFits, layers, assets]);

  if (!hasAssets) return null;
  return (
    <div ref={dock} className={css.chromeDock}>
      <Chrome className={css.dockChrome}>
        {!ride && legendFits && <Legend />}
        <Ctl icon="fit" tip="Fit to site" shortcut="F" tipSide="up" onClick={() => core.fitAll()} />
        <Ctl tip="North · click to face north" shortcut="N" tipSide="up" className={cx(uiStyles.iconOnly, css.compass)} onClick={() => { core.rig.faceNorth(); core.requestRender(); }}>
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
            <g ref={needle} className={css.needle}>
              <circle cx="15" cy="15" r="12.2" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.2" />
              <path d="M15 6.2 L19.4 21.2 L15 18.1 L10.6 21.2 Z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              <path d="M15 6.2 L15 18.1 L10.6 21.2 Z" fill="var(--bad)" />
              <text x="15" y="5.1" textAnchor="middle" style={{ font: '700 6.4px var(--font)' }} fill="currentColor">N</text>
            </g>
          </svg>
        </Ctl>
        {!ride && <ChromeSep />}
        {!ride && <div ref={scaleEl} className={css.scale}><span ref={label}>–</span><div ref={bar} className={css.scaleBar} style={{ width: 60 }} /></div>}
      </Chrome>
    </div>
  );
}
