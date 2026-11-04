/**
 * The shift time bar (bottom dock), Rain Model time-bar grammar (spec 03 §11.4): transport | clock | speed · horizon |
 * PT ring | circuit chips | panel toggle, over a track that carries 15-minute production bars, shift events and a head
 * flag with the running total. It only sets playing / speed / tMin / horizon; the 3D actors module advances
 * store.timeline.tMin while `playing` is true.
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { useApp, type DepletionHorizon } from '@/state/store';
import { resultsFor, useShiftState } from '@/state/derived';
import { clock, num, pct } from '@/core/format';
import type { Circuit, ShiftState } from '@/core/types';
import { ChromeSep, Ctl, EVENT_STYLE, Icon, MenuButton, circuitColor, cx, eventBackground, type IconName, type MenuItem } from '@/ui';
import { SPEEDS } from './defs';
import { cmdTogglePlay } from './actions';
import { BUCKET_MIN, CHIP_MODES, bcmAt, dotsFit, eventLabelFor, kbcm, productionBuckets, type ChipMode } from './timelineData';
import t from './timeline.module.css';

const HORIZONS: { id: DepletionHorizon; label: string; short: string; hint: string }[] = [
  { id: 'shift', label: 'Shift', short: 'Shift', hint: 'This shift’s work' },
  { id: 'week', label: 'Week', short: 'Week', hint: 'Seven days of production' },
  { id: 'completion', label: 'To completion', short: 'To completion', hint: 'Time-lapse until the blocks are done' },
];

function Ring({ f }: { f: number }) {
  const r = 9, c = 2 * Math.PI * r;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden style={{ flex: 'none', rotate: '-90deg' }}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--hair)" strokeWidth="3" />
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--ok)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${Math.max(0.001, f) * c} ${c}`} style={{ transition: 'stroke-dasharray .3s linear' }} />
    </svg>
  );
}

const dur = (m: number) => {
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h ? `${h} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
};

/** Live content-box width of an element (ResizeObserver). */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// ── track: production bars + events + head flag ──────────────────────────────────────────────────
function ProductionBars({ bars, frac }: { bars: number[]; frac: number }) {
  const n = bars.length;
  const max = Math.max(1, ...bars);
  const d = bars.map((v, i) => {
    const h = (v / max) * 13;
    return h > 0.05 ? `M${i + 0.2} 20V${20 - h}H${i + 0.8}V20Z` : '';
  }).join('');
  return (
    <svg className={t.bars} viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" aria-hidden>
      <defs><clipPath id="tl-played"><rect x="0" y="0" width={frac * n} height="20" /></clipPath></defs>
      <path d={d} className={t.barFuture} />
      <path d={d} className={t.barPlayed} clipPath="url(#tl-played)" />
    </svg>
  );
}

function Scrubber({ lengthMin, startHour, soFar }: { lengthMin: number; startHour: number; soFar: number }) {
  const tMin = useApp(st => st.timeline.tMin);
  const events = useApp(st => st.scenario.shift.events);
  const scenario = useApp(st => st.scenario);
  const setTimeline = useApp(st => st.setTimeline);
  const ref = useRef<HTMLDivElement>(null);
  const flagRef = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const drag = useRef<{ wasPlaying: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [flagW, setFlagW] = useState(150);
  const results = resultsFor(scenario);
  const bars = useMemo(() => productionBuckets(scenario, results, lengthMin, BUCKET_MIN), [scenario, results, lengthMin]);
  const frac = Math.min(1, Math.max(0, tMin / lengthMin));
  const W = width || 1000;
  const at = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return Math.round(f * lengthMin * 4) / 4; // quarter-minute steps
  };
  const step = lengthMin / 60 > 10 ? 2 : 1; // hour labels every 1 or 2 h
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = 0; h <= lengthMin / 60 + 1e-9; h += step) out.push(h * 60);
    if (out[out.length - 1] !== lengthMin) out.push(lengthMin);
    return out;
  }, [lengthMin, step]);
  const hourLines = useMemo(() => {
    const out: number[] = [];
    for (let m = 60; m < lengthMin; m += 60) out.push(m);
    return out;
  }, [lengthMin]);
  const active = events.find(e => tMin >= e.startMin && tMin < e.startMin + e.durMin);
  const hoverEvent = hover != null ? events.find(e => hover >= e.startMin && hover < e.startMin + e.durMin) : undefined;

  // head flag "10:30 · 12,400 bcm so far" under the track, clamped inside the bar; hour labels it covers step aside
  useLayoutEffect(() => { const w = flagRef.current?.offsetWidth; if (w && Math.abs(w - flagW) > 1) setFlagW(w); });
  const headX = frac * W;
  const flagL = Math.min(Math.max(0, headX - flagW / 2), Math.max(0, W - flagW));
  const tickHidden = (m: number, i: number, last: boolean) => {
    const x = (m / lengthMin) * W, tw = 30;
    const l = i === 0 ? x : last ? x - tw : x - tw / 2;
    return l < flagL + flagW + 6 && l + tw > flagL - 6;
  };

  return (
    <div
      ref={ref}
      className={t.scrub}
      role="slider"
      tabIndex={0}
      aria-label="Shift time"
      aria-valuemin={0}
      aria-valuemax={lengthMin}
      aria-valuenow={Math.round(tMin)}
      aria-valuetext={`${clock(startHour, tMin)}, ${num(soFar)} bcm so far`}
      onPointerDown={e => {
        if (e.button !== 0) return;
        ref.current!.setPointerCapture(e.pointerId);
        const st = useApp.getState();
        drag.current = { wasPlaying: st.timeline.playing };
        setScrubbing(true);
        setTimeline({ tMin: at(e), playing: false });
      }}
      onPointerMove={e => {
        const m = at(e);
        setHover(m);
        if (drag.current) setTimeline({ tMin: m });
      }}
      onPointerUp={e => {
        if (!drag.current) return;
        ref.current!.releasePointerCapture(e.pointerId);
        if (drag.current.wasPlaying && at(e) < lengthMin) setTimeline({ playing: true });
        drag.current = null;
        setScrubbing(false);
      }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={e => {
        const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : e.key === 'PageUp' ? 60 : e.key === 'PageDown' ? -60 : 0;
        if (d) { e.preventDefault(); e.stopPropagation(); setTimeline({ tMin: Math.min(lengthMin, Math.max(0, tMin + d * (e.shiftKey ? 6 : 1))) }); }
      }}
    >
      <div className={t.track}>
        <div className={t.elapsed} style={{ width: `${frac * 100}%` }} />
        {hourLines.map(m => <span key={m} className={t.hourLine} style={{ left: `${(m / lengthMin) * 100}%` }} />)}
        {events.map(e => (
          <div key={e.id} className={cx(t.ev, active?.id === e.id && t.evActive)} aria-hidden
            style={{ left: `${(e.startMin / lengthMin) * 100}%`, width: `${(e.durMin / lengthMin) * 100}%`, background: eventBackground(e.kind), color: EVENT_STYLE[e.kind].ink }} />
        ))}
        <ProductionBars bars={bars} frac={frac} />
        {events.map(e => {
          const st = EVENT_STYLE[e.kind];
          const px = W * (e.durMin / lengthMin);
          const full = e.label.replace(/\s*\(.*\)$/, '');
          const text = eventLabelFor(px, full, st.label);
          return (
            <div key={e.id} className={t.evLabel} style={{ left: `${(e.startMin / lengthMin) * 100}%`, width: `${(e.durMin / lengthMin) * 100}%`, color: st.ink }}
              title={`${e.label} · ${clock(startHour, e.startMin)}–${clock(startHour, e.startMin + e.durMin)} · ${pct(e.fleetStopFraction, 0)} of fleet stopped`}>
              {px > 20 && <Icon name={st.icon} size={13} strokeWidth={2} />}
              {text && <span>{text}</span>}
            </div>
          );
        })}
      </div>
      <div className={t.ticks} aria-hidden>
        {hours.map((m, i) => (
          <span key={m} className={cx(t.tick, tickHidden(m, i, i === hours.length - 1) && t.tickHidden)} style={{ left: `${(m / lengthMin) * 100}%` }}>{clock(startHour, m)}</span>
        ))}
      </div>
      {hover != null && !scrubbing && <div className={t.ghost} style={{ left: `${(hover / lengthMin) * 100}%` }} />}
      <div className={t.head} style={{ left: `${frac * 100}%` }} />
      <div ref={flagRef} className={cx(t.headFlag, scrubbing && t.headFlagLive)} style={{ left: flagL }} aria-hidden>
        <b>{clock(startHour, tMin)}</b> · {num(soFar)} bcm so far
      </div>
      {hover != null && !scrubbing && (
        <div className={t.flag} style={{ left: `${(hover / lengthMin) * 100}%` }}>
          {clock(startHour, hover)}
          <span>{num(bcmAt(scenario, results, hover))} bcm so far{hoverEvent ? ` · ${hoverEvent.label.replace(/\s*\(.*\)$/, '')}` : ''}</span>
        </div>
      )}
    </div>
  );
}

// ── circuit chips: full → compact → name only → dots + "+N" ──────────────────────────────────────────────────
type PerCircuit = ShiftState['perCircuit'][number];

function CircuitChips({ items }: { items: { c: Circuit; pc: PerCircuit }[] }) {
  const selection = useApp(st => st.selection);
  const select = useApp(st => st.select);
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [mode, setMode] = useState<ChipMode>('full');
  const key = `${width}|${items.map(x => x.c.id).join(',')}`;
  const keyRef = useRef('');
  // step down (before paint) until the chips fit; re-fit from "full" when the space or the circuits change
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (keyRef.current !== key) {
      keyRef.current = key;
      if (mode !== 'full') { setMode('full'); return; }
    }
    const i = CHIP_MODES.indexOf(mode);
    if (i < CHIP_MODES.length - 1 && el.scrollWidth > el.clientWidth + 1) setMode(CHIP_MODES[i + 1]);
  });
  const tip = (c: Circuit, pc: PerCircuit) =>
    `${c.name}\n${num(pc.bcmSoFar)} of ${num(pc.bcmShift)} bcm this shift · ${num(pc.loads)} loads · dig block ${pct(pc.digFraction, 0)} mined`;
  const fit = mode === 'dots' ? dotsFit(items.length, width) : { visible: items.length, hidden: 0 };
  const shown = items.slice(0, fit.visible), rest = items.slice(fit.visible);
  return (
    <div ref={ref} className={cx(t.chips, mode === 'dots' && t.chipsDots)}>
      {shown.map(({ c, pc }) => {
        const on = selection.kind === 'circuit' && selection.id === c.id;
        const col = circuitColor(c.color);
        const f = pc.bcmShift > 0 ? Math.min(1, pc.bcmSoFar / pc.bcmShift) : 0;
        if (mode === 'dots') {
          return (
            <button key={c.id} type="button" className={cx(t.dotChip, on && t.chipOn)} onClick={() => select({ kind: 'circuit', id: c.id })}
              title={tip(c, pc)} aria-label={`${c.loaderUnitId}: ${num(pc.bcmSoFar)} of ${num(pc.bcmShift)} bcm`}>
              <span className={t.swatch} style={{ background: col }} />
            </button>
          );
        }
        return (
          <button key={c.id} type="button" className={cx(t.chip, mode === 'ids' && t.chipIds, on && t.chipOn)} onClick={() => select({ kind: 'circuit', id: c.id })} title={tip(c, pc)}>
            <span className={t.swatch} style={{ background: col }} />
            <b>{c.loaderUnitId}</b>
            {mode !== 'ids' && (
              <span className={t.metric}>
                {kbcm(pc.bcmSoFar)}{mode === 'full' && <i> / {kbcm(pc.bcmShift)} bcm</i>}
              </span>
            )}
            <span className={t.chipBar} style={{ width: `${f * 100}%`, background: col }} />
          </button>
        );
      })}
      {rest.length > 0 && (
        <MenuButton up align="right" items={[
          { header: true, label: 'More circuits' },
          ...rest.map(({ c, pc }): MenuItem => ({
            label: <span className={t.menuChip}><span className={t.swatch} style={{ background: circuitColor(c.color) }} />{c.loaderUnitId}</span>,
            hint: `${kbcm(pc.bcmSoFar)} / ${kbcm(pc.bcmShift)} bcm`, onSelect: () => select({ kind: 'circuit', id: c.id }),
          })),
        ]}>
          {(open, tg) => <button type="button" className={cx(t.more, open && t.chipOn)} onClick={tg} aria-label={`${rest.length} more circuits`}>+{rest.length}</button>}
        </MenuButton>
      )}
    </div>
  );
}

export function Timeline() {
  const shift = useApp(st => st.scenario.shift);
  const circuits = useApp(st => st.scenario.circuits);
  const timeline = useApp(st => st.timeline);
  const setTimeline = useApp(st => st.setTimeline);
  const profileOn = useApp(st => st.panels.profile);
  const togglePanel = useApp(st => st.togglePanel);
  const hasProfileTarget = useApp(st => st.selection.kind === 'string' || st.selection.kind === 'circuit' || !!st.section);
  const ss = useShiftState();
  const lengthMin = Math.max(1, shift.lengthH * 60);
  const ev = ss.activeEvent;
  const byId = useMemo(() => new Map(circuits.map(c => [c.id, c])), [circuits]);
  const atEnd = timeline.tMin >= lengthMin - 0.01;
  const horizon = timeline.horizon ?? 'shift';
  const hz = HORIZONS.find(h => h.id === horizon) ?? HORIZONS[0];
  const chips = ss.perCircuit.flatMap(pc => { const c = byId.get(pc.circuitId); return c && c.active ? [{ c, pc }] : []; });
  const soFar = chips.reduce((a, x) => a + x.pc.bcmSoFar, 0);

  return (
    <div className={t.bar} data-hud>
      <div className={t.controls}>
        <Ctl icon="skipBack" onClick={() => setTimeline({ tMin: 0 })} tip="Shift start" shortcut="Home" tipSide="up" />
        <button type="button" className={cx(t.play, timeline.playing && t.playing)} onClick={cmdTogglePlay}
          aria-label={timeline.playing ? 'Pause' : 'Play'} title={timeline.playing ? 'Pause (Space)' : atEnd ? 'Replay the shift (Space)' : 'Play the shift (Space)'}>
          <Icon name={timeline.playing ? 'pause' : 'play'} size={18} strokeWidth={2.2} />
        </button>
        <Ctl icon="skipFwd" onClick={() => setTimeline({ tMin: lengthMin, playing: false })} tip="Shift end" shortcut="End" tipSide="up" />
        <ChromeSep />
        <div className={t.clock}>
          <span className={t.time}>{clock(shift.startHour, timeline.tMin)}<small>{shift.name}</small></span>
          {ev ? (
            <span className={t.sub} style={{ color: EVENT_STYLE[ev.kind].ink, fontWeight: 600 }} title={`${ev.label} · ${pct(ev.fleetStopFraction, 0)} of the fleet stopped`}>
              <Icon name={EVENT_STYLE[ev.kind].icon} size={13} strokeWidth={2} /><span className={t.subText}>{ev.label.replace(/\s*\(.*\)$/, '')} · {pct(ev.fleetStopFraction, 0)} stopped</span>
            </span>
          ) : (
            <span className={t.sub}><span className={t.subText}>{atEnd ? 'End of shift' : `${dur(timeline.tMin)} in · ${dur(lengthMin - timeline.tMin)} to go`}</span></span>
          )}
        </div>
        <ChromeSep />
        <MenuButton up items={[
          { header: true, label: 'Simulated time per second' },
          ...SPEEDS.map(sp => ({
            label: `×${sp}`, hint: sp >= 60 ? `${sp / 60} h per second` : `${sp} min per second`,
            icon: (timeline.speed === sp ? 'tick' : undefined) as IconName | undefined, onSelect: () => setTimeline({ speed: sp }),
          })),
        ]}>
          {(open, tg) => <Ctl icon="speed" on={open} onClick={tg} className={t.speed} tip="Playback speed" tipSide="up">×{timeline.speed}</Ctl>}
        </MenuButton>
        <MenuButton up items={[
          { header: true, label: 'Depletion shown in 3D' },
          ...HORIZONS.map((h): MenuItem => ({
            label: h.label, hint: h.hint, icon: horizon === h.id ? 'tick' : undefined, onSelect: () => setTimeline({ horizon: h.id }),
          })),
        ]}>
          {(open, tg) => (
            <Ctl icon="calendar" on={open} onClick={tg} className={t.horizon} tip={`Depletion horizon – ${hz.hint.toLowerCase()}`} tipSide="up">
              {hz.short}<Icon name="down" size={13} className={t.caret} />
            </Ctl>
          )}
        </MenuButton>
        <ChromeSep />
        <div className={t.pt} title="Share of the shift's productive time already worked (events such as crib and prestart stop part of the fleet)">
          <Ring f={ss.productiveFraction} />
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={t.ptVal}>{pct(ss.productiveFraction, 0)}</span>
            <span className={t.ptLab}>of shift PT</span>
          </span>
        </div>
        <ChromeSep />
        <CircuitChips items={chips} />
        <ChromeSep />
        <Ctl icon="panelBottom" on={profileOn && hasProfileTarget} disabled={!hasProfileTarget} onClick={() => togglePanel('profile')} className={t.panelToggle}
          tip={hasProfileTarget ? (profileOn ? 'Hide long section' : 'Show long section') : 'Select a haul string to see its long section'} tipSide="up" />
      </div>
      <Scrubber lengthMin={lengthMin} startHour={shift.startHour} soFar={soFar} />
    </div>
  );
}
