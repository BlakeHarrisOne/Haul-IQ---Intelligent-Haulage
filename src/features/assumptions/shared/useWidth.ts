import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Measured content width of an element (ResizeObserver) so SVG charts render at true pixel size with crisp, unscaled text. */
export function useWidth<T extends HTMLElement = HTMLDivElement>(initial = 640, min = 240): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (v: number) => setW(Math.max(min, Math.round(v)));
    set(el.clientWidth || initial);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => { const e = entries[0]; if (e) set(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial, min]);
  return [ref, w];
}
