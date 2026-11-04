/** Built-in viewport chrome (bottom-right, HRL white 44 px surface): fit, compass (face north), scale bar. */
import { useEffect, useRef } from 'react';
import { Chrome, ChromeSep, Ctl, cx, uiStyles } from '@/ui';
import type { SceneCore, ViewInfo } from './SceneCore';
import css from './core.module.css';

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

export function SceneChrome({ core }: { core: SceneCore }) {
  const needle = useRef<SVGGElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let lastH = NaN, lastL = '', lastW = -1;
    return core.onView((v: ViewInfo) => {
      if (needle.current && Math.abs(v.heading - lastH) > 0.05) { needle.current.style.transform = `rotate(${(-v.heading).toFixed(2)}deg)`; lastH = v.heading; }
      if (!(v.mpp > 0)) return;
      const maxPx = 110;
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
      <Chrome>
        <Ctl icon="fit" tip="Fit to site" shortcut="F" tipSide="up" onClick={() => core.fitAll()} />
        <Ctl tip="Face north" shortcut="N" tipSide="up" className={cx(uiStyles.iconOnly, css.compass)} onClick={() => { core.rig.faceNorth(); core.requestRender(); }}>
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
            <circle cx="13" cy="13" r="10.2" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.2" />
            <g ref={needle} className={css.needle}>
              <path d="M13 4.2 L16.2 13 L9.8 13 Z" fill="var(--bad)" />
              <path d="M13 21.8 L16.2 13 L9.8 13 Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <text x="13" y="3.2" textAnchor="middle" fontSize="5.2" fontWeight="700" fill="currentColor" style={{ font: '700 5.2px var(--font)' }}>N</text>
            </g>
          </svg>
        </Ctl>
        <ChromeSep />
        <div className={css.scale}><span ref={label}>–</span><div ref={bar} className={css.scaleBar} style={{ width: 60 }} /></div>
      </Chrome>
    </div>
  );
}

