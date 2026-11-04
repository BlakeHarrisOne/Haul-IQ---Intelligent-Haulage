/**
 * Built-in viewport chrome (bottom-right, HRL white 44 px surfaces): legend chip (solids + continuous grade ramp),
 * fit, north arrow (rotates with the view; click = face north), scale bar.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Chrome, ChromeSep, Ctl, GRADE_HEX, cx, uiStyles } from '@/ui';
import { useApp } from '@/state/store';
import type { SceneCore, ViewInfo } from './SceneCore';
import css from './core.module.css';

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

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
      {showSolids && dig && <span className={css.lgItem} title="Dig solid · the dashed ghost is the part already mined"><i className={css.lgSolid} style={{ background: dig.color }} />Dig</span>}
      {showSolids && dump && <span className={css.lgItem} title="Dump solid · the dashed ghost is the part still to fill"><i className={css.lgSolid} style={{ background: dump.color }} />Dump</span>}
      {showGrade && (
        <span className={css.lgItem} title="Grade (rise over run): 0–4 % flat · 4–8 % moderate · 8–10 % steep · >10 % excessive">
          <span className={css.lgRamp}>
            <i style={{ background: grad }} />
            <span className={css.lgTicks}><b style={{ left: '0%' }}>0</b><b style={{ left: `${(4 / 12) * 100}%` }}>4</b><b style={{ left: `${(8 / 12) * 100}%` }}>8</b><b className={css.lgEnd}>10+%</b></span>
          </span>
        </span>
      )}
      <ChromeSep />
    </span>
  );
}

export function SceneChrome({ core }: { core: SceneCore }) {
  const needle = useRef<SVGGElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let lastH = NaN, lastL = '', lastW = -1;
    return core.onView((v: ViewInfo) => {
      if (needle.current && Math.abs(v.heading - lastH) > 0.05) { needle.current.style.transform = `rotate(${(-v.heading).toFixed(2)}deg)`; lastH = v.heading; }
      if (!(v.mpp > 0)) return;
      const maxPx = 72;
      let L = NICE[0];
      for (const n of NICE) if (n / v.mpp <= maxPx) L = n;
      const px = Math.max(24, Math.round(L / v.mpp));
      const txt = L >= 1000 ? `${L / 1000} km` : `${L} m`;
      if (label.current && txt !== lastL) { label.current.textContent = txt; lastL = txt; }
      if (bar.current && px !== lastW) { bar.current.style.width = `${px}px`; lastW = px; }
    });
  }, [core]);
  return (
    <div className={css.chromeDock}>
      <Chrome className={css.dockChrome}>
        <Legend />
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
        <ChromeSep />
        <div className={css.scale}><span ref={label}>–</span><div ref={bar} className={css.scaleBar} style={{ width: 60 }} /></div>
      </Chrome>
    </div>
  );
}
