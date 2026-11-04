/**
 * Collision-aware layout for the floating chrome. The top row holds three surfaces (document · view switcher · show /
 * app controls) whose natural widths depend on labels, so nothing is decided by fixed breakpoints: the shell measures
 * the surfaces and steps down a "density" level until no two of them touch.
 *
 * Levels (each keeps everything from the one before):
 *   0  all labels
 *   1  Show toggles icon-only
 *   2  view switcher icon-only except the active view
 *   3  the five Show toggles fold into one "Show ▾" popover, and the document name narrows to 150 px
 *   4  the active view's label goes too
 *   5  the view switcher drops to a second row on the right (last resort)
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const TOP_LEVELS = 6;
export const TOP_MAX = TOP_LEVELS - 1;
/** Minimum clear space between two chrome surfaces (px). */
export const CHROME_GAP = 8;

export interface Box { l: number; t: number; r: number; b: number }

/** True when two boxes overlap or come closer than `gap` horizontally (vertical overlap required). */
export function touches(a: Box, b: Box, gap = CHROME_GAP): boolean {
  const vertical = Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0;
  if (!vertical) return false;
  return Math.min(a.r, b.r) - Math.max(a.l, b.l) > -gap;
}

export function anyTouch(boxes: Box[], gap = CHROME_GAP): boolean {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (touches(boxes[i], boxes[j], gap)) return true;
  return false;
}

/** Natural widths of the three top-row surfaces at one density level. */
export interface TopRowWidths { left: number; center: number; right: number }

/**
 * The boxes the CSS produces for a viewport width (left pinned to the gutter, switcher centred, right pinned to the
 * right gutter; at the last level the switcher sits on a second row and cannot collide).
 */
export function topRowBoxes(vw: number, w: TopRowWidths, level: number, gutter = 14, h = 44): Box[] {
  const t = gutter, b = gutter + h;
  const left: Box = { l: gutter, t, r: gutter + w.left, b };
  const right: Box = { l: vw - gutter - w.right, t, r: vw - gutter, b };
  if (level >= TOP_MAX) return [left, right];
  const c0 = vw / 2 - w.center / 2;
  return [left, { l: c0, t, r: c0 + w.center, b }, right];
}

/** The lowest density level at which the top row fits (TOP_MAX when nothing fits). */
export function fitTopRow(vw: number, widthsByLevel: TopRowWidths[], gutter = 14): number {
  for (let lv = 0; lv < Math.min(TOP_MAX, widthsByLevel.length); lv++) {
    if (!anyTouch(topRowBoxes(vw, widthsByLevel[lv], lv, gutter))) return lv;
  }
  return TOP_MAX;
}

const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };

/**
 * Measures the elements matching `selector` inside `root` and returns the density level at which they stop touching.
 * Re-fits from level 0 whenever the root's width or any of `deps` changes (and once web fonts have loaded); in between
 * it only ever steps down, so a value that grows during playback can never cause an overlap. All steps happen in
 * layout effects, before the browser paints.
 */
export function useTopRowFit(root: RefObject<HTMLElement | null>, selector: string, deps: readonly unknown[]): number {
  const [level, setLevel] = useState(0);
  const [width, setWidth] = useState(0);
  const [fontsTick, setFontsTick] = useState(0);
  const key = JSON.stringify([width, fontsTick, ...deps]);
  const keyRef = useRef<string>('');

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    document.fonts?.ready.then(() => setFontsTick(t => t + 1)).catch(() => undefined);
    return () => ro.disconnect();
  }, [root]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (keyRef.current !== key) {
      keyRef.current = key;
      if (level !== 0) { setLevel(0); return; }
    }
    if (level >= TOP_MAX) return;
    const boxes = Array.from(el.querySelectorAll(selector))
      .filter(e => (e as HTMLElement).offsetParent !== null)
      .map(boxOf)
      .filter(b => b.r - b.l > 0);
    if (anyTouch(boxes)) setLevel(level + 1);
  });

  return level;
}
