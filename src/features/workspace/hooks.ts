import { useEffect, useState } from 'react';
import { app, useApp } from '@/state/store';
import { useShellUi, ui } from './uiStore';

/** Applies the theme preference to <html data-theme> (system follows prefers-color-scheme live). */
export function useThemeEffect() {
  const theme = useShellUi(st => st.theme);
  const motion = useShellUi(st => st.motion);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { root.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme; };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const root = document.documentElement;
    if (motion === 'system') delete root.dataset.motion; else root.dataset.motion = motion;
  }, [motion]);
}

export const prefersReducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  (document.documentElement.dataset.motion !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * The HUD "at rest" (Rain Model §2.8): during playback or a POV / chase ride, after 2.5 s with the pointer still and
 * nothing open, the chrome settles (fades, slides 6 px to its edge). Any pointer move, key, wheel or touch wakes it.
 * Never rests while a menu, dialog or popover is open, while the keyboard is in the chrome, or with "Keep controls visible".
 */
export function useHudRest(): boolean {
  const playing = useApp(st => st.timeline.playing);
  const camera = useApp(st => st.camera);
  const view = useApp(st => st.view);
  const keep = useShellUi(st => st.keepHud);
  const eligible = !keep && view === 'site' && (playing || camera === 'pov' || camera === 'chase');
  const [rested, setRested] = useState(false);
  useEffect(() => {
    if (!eligible) { setRested(false); return; }
    let timer: ReturnType<typeof setTimeout>;
    const held = () => {
      const u = ui();
      if (u.paletteOpen || u.shortcutsOpen || u.settingsOpen || u.importOpen || u.prompt || u.confirm) return true;
      if (document.querySelector('[role="menu"], [role="dialog"], [data-hud-hold]')) return true;
      const a = document.activeElement as HTMLElement | null;
      if (a && a.closest('[data-hud]') && a.matches(':focus-visible')) return true;
      return false;
    };
    const rest = () => { if (held()) { timer = setTimeout(rest, 400); return; } setRested(true); };
    const wake = () => { setRested(false); clearTimeout(timer); timer = setTimeout(rest, 2500); };
    const opts = { passive: true, capture: true } as const;
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    evs.forEach(e => window.addEventListener(e, wake, opts));
    timer = setTimeout(rest, 2500);
    return () => { clearTimeout(timer); evs.forEach(e => window.removeEventListener(e, wake, opts)); };
  }, [eligible]);
  return eligible && rested;
}

/** A clock that re-renders every `ms` (for "Saved 2 min ago"). */
export function useNow(ms = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** True when keyboard input should go to a text field rather than the app. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(type);
  }
  return false;
}

export { app };
