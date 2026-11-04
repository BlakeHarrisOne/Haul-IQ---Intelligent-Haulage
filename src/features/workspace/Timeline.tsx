/**
 * The shift timeline (bottom dock). It only sets playing / speed / tMin (scrub); the 3D actors module advances
 * store.timeline.tMin while `playing` is true.
 */
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useApp } from '@/state/store';
import { useShiftState } from '@/state/derived';
import { clock, num, pct } from '@/core/format';
import type { ShiftEventKind } from '@/core/types';
import { ChromeSep, Ctl, Icon, MenuButton, cx, type IconName } from '@/ui';
import { SPEEDS } from './defs';
import { cmdTogglePlay } from './actions';
import t from './timeline.module.css';

export const EVENT_ICON: Record<ShiftEventKind, IconName> = { prestart: 'tick', crib: 'crib', fuel: 'fuel', changeover: 'swap', blast: 'blast', other: 'clock' };

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

function Scrubber({ lengthMin, startHour }: { lengthMin: number; startHour: number }) {
  const tMin = useApp(st => st.timeline.tMin);
  const events = useApp(st => st.scenario.shift.events);
  const setTimeline = useApp(st => st.setTimeline);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ wasPlaying: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const frac = Math.min(1, Math.max(0, tMin / lengthMin));
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
      aria-valuetext={clock(startHour, tMin)}
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
        {events.map(e => {
          const l = (e.startMin / lengthMin) * 100, w = (e.durMin / lengthMin) * 100;
          const px = (ref.current?.clientWidth ?? 1000) * (w / 100);
          return (
            <div key={e.id} className={cx(t.ev, t[`ev-${e.kind}`], active?.id === e.id && t.evActive)} style={{ left: `${l}%`, width: `${w}%` }}
              title={`${e.label} · ${clock(startHour, e.startMin)}–${clock(startHour, e.startMin + e.durMin)} · ${pct(e.fleetStopFraction, 0)} of fleet stopped`}>
              {px > 22 && <Icon name={EVENT_ICON[e.kind]} size={13} strokeWidth={2} />}
              {px > 96 && <span>{e.label.replace(/\s*\(.*\)$/, '')}</span>}
            </div>
          );
        })}
      </div>
      <div className={t.ticks} aria-hidden>
        {hours.map(m => <span key={m} className={t.tick} style={{ left: `${(m / lengthMin) * 100}%` }}>{clock(startHour, m)}</span>)}
      </div>
      {hover != null && !scrubbing && <div className={t.ghost} style={{ left: `${(hover / lengthMin) * 100}%` }} />}
      <div className={t.head} style={{ left: `${frac * 100}%` }} />
      {(hover != null || scrubbing) && (
        <div className={t.flag} style={{ left: `${((scrubbing ? tMin : hover!) / lengthMin) * 100}%` }}>
          {clock(startHour, scrubbing ? tMin : hover!)}
          {!scrubbing && hoverEvent && <span>{hoverEvent.label}</span>}
        </div>
      )}
    </div>
  );
}

export function Timeline() {
  const shift = useApp(st => st.scenario.shift);
  const circuits = useApp(st => st.scenario.circuits);
  const timeline = useApp(st => st.timeline);
  const setTimeline = useApp(st => st.setTimeline);
  const selection = useApp(st => st.selection);
  const select = useApp(st => st.select);
  const profileOn = useApp(st => st.panels.profile);
  const togglePanel = useApp(st => st.togglePanel);
  const hasProfileTarget = useApp(st => st.selection.kind === 'string' || st.selection.kind === 'circuit' || !!st.section);
  const ss = useShiftState();
  const lengthMin = Math.max(1, shift.lengthH * 60);
  const ev = ss.activeEvent;
  const byId = useMemo(() => new Map(circuits.map(c => [c.id, c])), [circuits]);
  const atEnd = timeline.tMin >= lengthMin - 0.01;

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
            <span className={cx(t.sub, t.subEvent)}><Icon name={EVENT_ICON[ev.kind]} size={13} strokeWidth={2} />{ev.label} · {pct(ev.fleetStopFraction, 0)} stopped</span>
          ) : (
            <span className={t.sub}>{atEnd ? 'End of shift' : `${dur(timeline.tMin)} in · ${dur(lengthMin - timeline.tMin)} to go`}</span>
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
        <ChromeSep />
        <div className={t.pt} title="Share of the shift's productive time already worked (events such as crib and prestart stop part of the fleet)">
          <Ring f={ss.productiveFraction} />
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={t.ptVal}>{pct(ss.productiveFraction, 0)}</span>
            <span className={t.ptLab}>of shift PT</span>
          </span>
        </div>
        <ChromeSep />
        <div className={t.chips}>
          {ss.perCircuit.map(pc => {
            const c = byId.get(pc.circuitId);
            if (!c || !c.active) return null;
            const on = selection.kind === 'circuit' && selection.id === c.id;
            return (
              <button key={pc.circuitId} type="button" className={cx(t.chip, on && t.chipOn)} onClick={() => select({ kind: 'circuit', id: c.id })}
                title={`${c.name}\n${num(pc.bcmSoFar)} of ${num(pc.bcmShift)} bcm this shift · dig ${pct(pc.digFraction, 0)} · dump ${pct(pc.dumpFraction, 0)} · ${pc.loads} loads`}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: c.color, flex: 'none' }} />
                <b>{c.loaderUnitId}</b>
                <span className={t.metric} title="Dig block mined"><Icon name="dig" size={14} />{pct(pc.digFraction, 0)}</span>
                <span className={t.metric} title="Dump filled"><Icon name="dump" size={14} />{pct(pc.dumpFraction, 0)}</span>
                <span className={t.metric} title="Truck loads so far"><Icon name="truck" size={14} />{num(pc.loads)}</span>
                <span className={t.chipBar} style={{ width: `${Math.min(1, pc.digFraction) * 100}%`, background: c.color }} />
              </button>
            );
          })}
        </div>
        <Ctl icon="panelBottom" on={profileOn && hasProfileTarget} disabled={!hasProfileTarget} onClick={() => togglePanel('profile')}
          tip={hasProfileTarget ? (profileOn ? 'Hide long section' : 'Show long section') : 'Select a haul string to see its long section'} tipSide="up" />
      </div>
      <Scrubber lengthMin={lengthMin} startHour={shift.startHour} />
    </div>
  );
}
