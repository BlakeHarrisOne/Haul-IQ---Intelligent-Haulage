/**
 * Inspector for a selected truck: live phase, speed, payload, loads and next arrivals at the timeline time, from the
 * engine's shift simulation (truckStatesAt / simulateShift). Falls back to the local kinematic model if the
 * simulation is unavailable.
 */
import { useMemo } from 'react';
import { simulateShift, truckStatesAt, type ShiftSim, type TruckPhase as EnginePhase, type TruckState as EngineTruckState } from '@/engine';
import { useApp } from '@/state/store';
import { useCircuitResult, useResults } from '@/state/derived';
import { Badge, Button, CardBody, CardHead, Empty, Kpi, Section, circuitColor, cx } from '@/ui';
import { clock, num, secs } from '@/core/format';
import { truckStateAt } from './model';
import { BackButton } from './parts';
import s from './haulage.module.css';

const PHASE: Record<EnginePhase, string> = {
  queue: 'Queuing at loader', spot: 'Spotting', load: 'Loading', haul: 'Hauling loaded', dump: 'Dumping', return: 'Returning empty', parked: 'Parked',
};
const CYCLE: EnginePhase[] = ['queue', 'spot', 'load', 'haul', 'dump', 'return'];

export function TruckCard({ circuitId, truckIndex }: { circuitId: string; truckIndex: number }) {
  const scenario = useApp(st => st.scenario);
  const tMin = useApp(st => st.timeline.tMin);
  const playing = useApp(st => st.timeline.playing);
  const setTimeline = useApp(st => st.setTimeline);
  const select = useApp(st => st.select);
  const setCamera = useApp(st => st.setCamera);
  const results = useResults();
  const c = scenario.circuits.find(x => x.id === circuitId);
  const r = useCircuitResult(circuitId);

  const sim = useMemo<ShiftSim | undefined>(() => {
    if (!c || !r?.ok) return undefined;
    try { return simulateShift(scenario, results, circuitId); } catch (e) { console.warn('simulateShift failed', e); return undefined; }
  }, [scenario, results, circuitId, c, r]);
  let st: EngineTruckState | undefined;
  try { st = sim ? truckStatesAt(scenario, results, circuitId, tMin)[truckIndex] : undefined; } catch { st = undefined; }
  const label = st?.unitId ?? `Truck ${truckIndex + 1}`;

  if (!c || !r?.ok) {
    return (
      <>
        <CardHead title={<span className={s.headTitle}><BackButton onClick={() => select({ kind: 'none' })} /><span>{label}</span></span>} />
        <CardBody><Empty icon="truck" title="No live state">The circuit is not calculated.</Empty></CardBody>
      </>
    );
  }
  const truck = scenario.fleet.trucks.find(t => t.id === c.truckModelId);
  const local = st ? undefined : truckStateAt(r, c.params, c.trucks, truckIndex, tMin * 60);
  const phase: EnginePhase = st?.phase ?? local?.phase ?? 'parked';
  const speed = st?.speedKmh ?? local?.speedKmh ?? 0;
  const ch = st?.chainageM ?? local?.chainageM ?? 0;
  const loaded = st?.loaded ?? local?.loaded ?? false;
  const fill = st?.fill ?? (loaded ? 1 : 0);
  const leftS = st ? Math.max(0, (st.phaseEndMin - tMin) * 60) : local?.phaseLeftS ?? 0;

  // next arrivals from this truck's simulated timeline
  const recs = sim?.timelines.find(tl => tl.truckIndex === truckIndex)?.records ?? [];
  const tS = tMin * 60;
  const nextOf = (p: EnginePhase) => recs.find(x => x.phase === p && x.t0 >= tS - 1e-6);
  const nextLoader = phase === 'spot' || phase === 'load' ? 0 : nextOf('spot') ? nextOf('spot')!.t0 - tS : local?.toLoaderS;
  const nextDump = phase === 'dump' ? 0 : nextOf('dump') ? nextOf('dump')!.t0 - tS : undefined;
  const eff = c.params.haulEff || 1;
  const dur: Record<EnginePhase, number> = {
    queue: 0, spot: c.params.spotS, load: c.params.loadS, haul: r.travelLoadedS / eff + r.stopsS / 2, dump: c.params.dumpS,
    return: r.travelEmptyS / eff + r.stopsS / 2, parked: 0,
  };
  const loads = st?.loads ?? 0;
  const eta = (v: number | undefined, now: string) => (v == null ? '–' : v <= 0.5 ? now : secs(v));
  const etaUnit = (v: number | undefined) => (v != null && v >= 60 ? 'min' : undefined);
  const shown = CYCLE.filter(p => dur[p] > 0 || p === phase);

  return (
    <>
      <CardHead
        title={<span className={s.headTitle}><BackButton label="Back to circuit" onClick={() => select({ kind: 'circuit', id: c.id })} /><span className={s.cDot} style={{ background: circuitColor(c.color), width: 10, height: 10, flex: "none" }} /><span>{label} · {c.name}</span></span>}
        actions={st?.paused ? <Badge tone="warn" icon="pause">{st.pauseLabel ?? 'Paused'}</Badge> : <Badge tone="na" icon={loaded ? 'truck' : undefined}>{loaded ? 'Loaded' : 'Empty'}</Badge>}
      />
      <CardBody>
        <div className={s.sub}><b>{truck?.name ?? 'Truck'}</b><span className={s.dotSep}>truck {truckIndex + 1} of {c.trucks}</span><span className={s.dotSep}>{clock(scenario.shift.startHour, tMin)} · {playing ? 'playing' : 'paused'}</span></div>
        <div className={s.kpis}>
          <Kpi size="sm" label="Phase" value={<span style={{ fontSize: 15 }}>{PHASE[phase]}</span>} delta={phase === 'parked' ? 'not running' : `${secs(leftS)} left`} deltaTone="na" />
          <Kpi size="sm" label="Speed" value={num(speed, 0)} unit="km/h" delta={st?.queueIndex != null ? `queue #${st.queueIndex + 1}` : undefined} deltaTone="na" />
          <Kpi size="sm" label="Chainage" value={num(ch, 0)} unit="m" delta={`of ${num(r.lengthM, 0)} m`} deltaTone="na" />
          <Kpi size="sm" label="Payload" value={num(fill * c.params.truckLoadBcm, 0)} unit="bcm" delta={`${num(fill * 100, 0)}% full`} deltaTone="na" />
          <Kpi size="sm" label="Next at loader" value={eta(nextLoader, 'Now')} unit={etaUnit(nextLoader)} />
          <Kpi size="sm" label="Next at dump" value={eta(nextDump, 'Now')} unit={etaUnit(nextDump)} />
        </div>
        <Section title={`Cycle · ${num(r.cycleMin, 1)} min`} actions={<span className={s.figLab} style={{ textTransform: 'none', letterSpacing: 0 }}>{loads} loads · {num(loads * c.params.truckLoadBcm)} bcm so far</span>}>
          <div className={s.phaseBar}>
            {shown.map(p => (
              <span key={p} className={cx(s.phaseSeg, phase === p && s.phaseNow)} style={{ flex: Math.max(dur[p], 20) }}>
                {phase === p && dur[p] > 0 && <span className={s.phaseHead} style={{ left: `${Math.min(100, Math.max(0, (1 - leftS / dur[p]) * 100))}%` }} />}
              </span>
            ))}
          </div>
          <div style={{ paddingTop: 8 }}>
            {shown.map(p => {
              const on = phase === p;
              return (
                <div key={p} className={cx(s.pRow, on && s.phaseRowOn)} style={{ minHeight: 34 }}>
                  <span className={s.pLab}><span className={cx(on && s.pChanged)}>{PHASE[p]}</span></span>
                  <span className={s.num} style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
                    {on && dur[p] > 0 ? `${secs(Math.max(0, dur[p] - leftS))} / ` : ''}{dur[p] > 0 ? secs(dur[p]) : on ? secs(leftS) : '–'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={s.actions} style={{ paddingTop: 12 }}>
            <Button size="sm" icon={playing ? 'pause' : 'play'} onClick={() => setTimeline({ playing: !playing })}>{playing ? 'Pause' : 'Play shift'}</Button>
            <Button size="sm" icon="pov" onClick={() => setCamera('pov', c.id)}>Ride along</Button>
            <Button size="sm" icon="chase" onClick={() => setCamera('chase', c.id)}>Chase</Button>
          </div>
        </Section>
      </CardBody>
    </>
  );
}
