/**
 * Point table of a haul string: two views sharing the # column (Points: E / N / RL; Segments: the segment that
 * starts at the point - length, grade, overrides, zone, stop). Rows hover ↔ 3D hover, click selects the point.
 * Virtualised above 300 rows.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitParams, HaulString, SegmentZone, StringPoint } from '@/core/types';
import { useApp } from '@/state/store';
import { Button, Icon, Segmented, Select, cx } from '@/ui';
import { num } from '@/core/format';
import { ZONES, effectiveSeg, insertAfter, removeAt, segmentsOf, withSegOverride, withStop, withXYZ, type SegRow } from './model';
import { heightAt, type HeightIndex } from '@/geom';
import { Callout, CellNum, GradeChip } from './parts';
import s from './haulage.module.css';

export type TableView = 'points' | 'segments';
const ROW_H = 30;
const VIRTUAL_OVER = 300;
const colsFor = (view: TableView, n: number) => {
  const idx = `${Math.max(32, String(n).length * 8 + 12)}px`;
  return view === 'points' ? `${idx} minmax(0, 1fr) minmax(0, 1.08fr) 64px 16px 50px` : `${idx} 50px 64px minmax(0, 1fr) minmax(0, 0.9fr) 80px 28px`;
};

export interface PointTableProps {
  hs: HaulString;
  defaults: Pick<CircuitParams, 'speedLimitKmh' | 'rrPct'>;
  index: HeightIndex | null;
  onPaste: () => void;
}

export function PointTable({ hs, defaults, index, onPaste }: PointTableProps) {
  const setStringPoints = useApp(st => st.setStringPoints);
  const select = useApp(st => st.select);
  const setHover = useApp(st => st.setHover);
  const selIdx = useApp(st => (st.selection.kind === 'string' && st.selection.id === hs.id ? st.selection.pointIndex : undefined));
  const hovIdx = useApp(st => (st.hover.kind === 'string' && st.hover.id === hs.id ? st.hover.pointIndex : undefined));
  const [view, setView] = useState<TableView>(() => {
    try { return (localStorage.getItem('haulage.tableView') as TableView) || 'points'; } catch { return 'points'; }
  });
  useEffect(() => { try { localStorage.setItem('haulage.tableView', view); } catch { /* ignore */ } }, [view]);
  const [pending, setPending] = useState<{ i: number; z: number; dz: number } | null>(null);
  useEffect(() => { setPending(null); }, [hs.id]);

  const pts = hs.points;
  const segs = useMemo(() => segmentsOf(pts), [pts]);
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  const locked = !!hs.locked;

  const commit = useCallback((next: StringPoint[], label: string) => { if (!locked) setStringPoints(hs.id, next, label); }, [hs.id, locked, setStringPoints]);
  const onXYZ = useCallback((i: number, patch: { e?: number; n?: number; z?: number }) => {
    const cur = ptsRef.current;
    const next = withXYZ(cur, i, patch, patch.z === undefined ? false : undefined);
    commit(next, patch.z !== undefined ? 'Edit RL' : 'Move point');
    if (patch.z === undefined && index) {
      const p = next[i];
      const z = heightAt(index, p.e, p.n);
      if (z != null && Math.abs(z - p.z) > 0.02) setPending({ i, z, dz: z - p.z });
      else setPending(null);
    }
  }, [commit, index]);
  const onSeg = useCallback((i: number, patch: Parameters<typeof withSegOverride>[2]) => commit(withSegOverride(ptsRef.current, i, patch), 'Edit segment'), [commit]);
  const onStop = useCallback((i: number, on: boolean) => commit(withStop(ptsRef.current, i, on), on ? 'Add stop sign' : 'Remove stop sign'), [commit]);
  const onInsert = useCallback((i: number) => {
    commit(insertAfter(ptsRef.current, i), 'Insert point');
    select({ kind: 'string', id: hs.id, pointIndex: i + 1 });
  }, [commit, hs.id, select]);
  const onDelete = useCallback((i: number) => {
    if (ptsRef.current.length <= 2) return;
    commit(removeAt(ptsRef.current, i), 'Delete point');
    select({ kind: 'string', id: hs.id, pointIndex: Math.min(i, ptsRef.current.length - 2) });
  }, [commit, hs.id, select]);
  const onPick = useCallback((i: number) => select({ kind: 'string', id: hs.id, pointIndex: i }), [hs.id, select]);
  const onHover = useCallback((i: number) => setHover({ kind: 'string', id: hs.id, pointIndex: i }), [hs.id, setHover]);

  // virtualisation
  const n = pts.length;
  const virtual = n > VIRTUAL_OVER;
  const visRows = Math.min(n, 15);
  const viewH = visRows * ROW_H;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_H) - 10) : 0;
  const end = virtual ? Math.min(n, Math.ceil((scrollTop + viewH) / ROW_H) + 10) : n;

  // keep the selected row in view
  useEffect(() => {
    const el = scroller.current;
    if (selIdx == null || !el) return;
    const top = selIdx * ROW_H, bottom = top + ROW_H;
    const vTop = el.scrollTop, vBot = el.scrollTop + el.clientHeight - ROW_H; // minus sticky header
    if (top < vTop) el.scrollTop = top;
    else if (bottom > vBot) el.scrollTop = bottom - el.clientHeight + ROW_H + ROW_H * 2;
  }, [selIdx]);

  const dropped = segs.filter(x => x.dropped).length;
  const cols = colsFor(view, n);
  const snapped = pts.filter(p => p.snapped).length;

  return (
    <>
      <div className={s.tBar}>
        <Segmented<TableView> small value={view} onChange={setView} style={{ width: 196 }}
          options={[{ value: 'points', label: 'Points' }, { value: 'segments', label: 'Segments' }]} />
        <span className={s.gap} />
        <Button size="sm" variant="ghost" icon="table" onClick={onPaste} disabled={locked}>Paste XYZ</Button>
      </div>
      {pending && pending.i < n && (
        <Callout tone="info" icon="snap" title={`Point ${pending.i + 1} moved in plan`}
          action={<>
            <Button size="sm" variant="primary" icon="snap" onClick={() => { commit(withXYZ(ptsRef.current, pending.i, { z: pending.z }, true), 'Re-snap point'); setPending(null); }}>Re-snap RL</Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Keep {num(pts[pending.i].z, 2)}</Button>
          </>}>
          The surface is {num(Math.abs(pending.dz), 2)} m {pending.dz > 0 ? 'above' : 'below'} its RL here ({num(pending.z, 2)} m).
        </Callout>
      )}
      <div className={s.tBox}>
        <div ref={scroller} className={s.tScroll} style={{ height: viewH + ROW_H }} onScroll={virtual ? e => setScrollTop(e.currentTarget.scrollTop) : undefined}
          onMouseLeave={() => { const h = useApp.getState().hover; if (h.kind === 'string' && h.id === hs.id) setHover({ kind: 'none' }); }}>
          <div className={s.tHead} style={{ gridTemplateColumns: cols }}>
            {view === 'points' ? (
              <><span className={s.r}>#</span><span className={s.r}>Easting</span><span className={s.r}>Northing</span><span className={s.r}>RL</span><span className={s.c} title="Snapped to the surface">⊙</span><span /></>
            ) : (
              <><span className={s.r}>#</span><span className={s.r} title="3D length of the segment to the next point">Len m</span><span className={s.c}>Grade</span><span className={s.r} title="Speed limit override (blank = circuit default)">km/h</span><span className={s.r} title="Rolling resistance override (blank = circuit default)">RR %</span><span>Zone</span><span className={s.c} title="Stop sign at this point">Stop</span></>
            )}
          </div>
          <div style={{ height: virtual ? n * ROW_H : undefined, position: 'relative' }}>
            <div style={virtual ? { position: 'absolute', left: 0, right: 0, top: start * ROW_H } : undefined}>
              {pts.slice(start, end).map((p, k) => {
                const i = start + k;
                return (
                  <PointRow key={p.id} i={i} p={p} seg={segs[i]} view={view} cols={cols} last={i === n - 1} sel={selIdx === i} hov={hovIdx === i}
                    defaults={defaults} locked={locked} canDelete={n > 2}
                    onXYZ={onXYZ} onSeg={onSeg} onStop={onStop} onInsert={onInsert} onDelete={onDelete} onPick={onPick} onHover={onHover} />
                );
              })}
            </div>
          </div>
        </div>
        <div className={s.tFoot}>
          <span>{n} points</span>
          {view === 'points'
            ? <span><span className={s.snapDot} style={{ display: 'inline-block', marginRight: 6 }} />{snapped} snapped</span>
            : <span title="Blank override cells use the circuit default">Blank = {num(defaults.speedLimitKmh)} km/h · {num(defaults.rrPct, 1)}%</span>}
          <span className={s.gap} />
          {dropped > 0 && <span className={s.tBad} style={{ fontWeight: 600 }}><Icon name="warning" size={13} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />{dropped} over ±16%</span>}
          {virtual && <span>virtualised</span>}
        </div>
      </div>
    </>
  );
}

interface RowProps {
  i: number;
  p: StringPoint;
  seg?: SegRow;
  view: TableView;
  cols: string;
  last: boolean;
  sel: boolean;
  hov: boolean;
  defaults: Pick<CircuitParams, 'speedLimitKmh' | 'rrPct'>;
  locked: boolean;
  canDelete: boolean;
  onXYZ: (i: number, patch: { e?: number; n?: number; z?: number }) => void;
  onSeg: (i: number, patch: Parameters<typeof withSegOverride>[2]) => void;
  onStop: (i: number, on: boolean) => void;
  onInsert: (i: number) => void;
  onDelete: (i: number) => void;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}

const isControl = (t: EventTarget) => t instanceof HTMLElement && !!t.closest('input,select,button');

const PointRow = memo(function PointRow(props: RowProps) {
  const { i, p, seg, view, cols, last, sel, hov, defaults, locked, canDelete } = props;
  const eff = effectiveSeg(p, defaults);
  const dropTitle = seg?.dropped
    ? `Grade ${(seg.grade * 100).toFixed(1)}% rounds past ±16%: the spreadsheet's speed table has no row for it, so calc.xlsm silently counts this segment as 0 s (distance kept, time dropped). Spreadsheet mode replicates that unless the circuit clamps steep grades to 12/14 km/h; the rimpull model times it with physics.`
    : undefined;
  return (
    <div className={cx(s.tRow, sel && s.tSel, hov && !sel && s.tHov, seg?.dropped && s.tDrop)} style={{ gridTemplateColumns: cols }}
      onMouseEnter={() => props.onHover(i)} onClick={e => { if (!isControl(e.target)) props.onPick(i); }}>
      <span className={s.tIdx}>{i + 1}</span>
      {view === 'points' ? (
        <>
          <CellNum value={p.e} dp={2} step={0.5} disabled={locked} title={`Point ${i + 1} easting`} onChange={v => props.onXYZ(i, { e: v })} />
          <CellNum value={p.n} dp={2} step={0.5} disabled={locked} title={`Point ${i + 1} northing`} onChange={v => props.onXYZ(i, { n: v })} />
          <CellNum value={p.z} dp={2} step={0.1} disabled={locked} title={`Point ${i + 1} RL`} onChange={v => props.onXYZ(i, { z: v })} />
          <span className={s.c} title={p.snapped ? 'RL from the topo surface' : 'RL typed / imported'}><span className={cx(s.snapDot, !p.snapped && s.snapOff)} style={{ display: 'block' }} /></span>
          <span className={s.rowActs}>
              <button type="button" className={s.iconBtn} title="Insert point after" disabled={locked} onClick={() => props.onInsert(i)}><Icon name="plus" size={15} /></button>
              <button type="button" className={cx(s.iconBtn, s.iconBtnDanger)} title="Delete point" disabled={locked || !canDelete} onClick={() => props.onDelete(i)}><Icon name="trash" size={15} /></button>
          </span>
        </>
      ) : last || !seg ? (
        <span className={s.tEnd} style={{ gridColumn: '2 / -1' }}>end of string{p.stop ? ' · stop sign' : ''}</span>
      ) : (
        <>
          <span className={cx(s.tCell, s.r)} style={seg.zero ? { color: 'var(--ink-4)' } : undefined}>{num(seg.dist3d, 1)}</span>
          <span className={s.c}>{seg.zero ? <span className={s.tEnd}>0 m</span> : <GradeChip g={seg.grade} dropped={seg.dropped} title={dropTitle} />}</span>
          <CellNum value={p.seg?.speedLimitKmh ?? null} placeholder={String(defaults.speedLimitKmh)} dp={0} step={5} min={1} max={120} title={`Segment ${i + 1} speed limit (blank = circuit default)`}
            changed={eff.overridden.speed} disabled={locked} onChange={v => props.onSeg(i, { speedLimitKmh: v })} onClear={() => props.onSeg(i, { speedLimitKmh: null })} />
          <CellNum value={p.seg?.rrPct ?? null} placeholder={num(defaults.rrPct, 1)} dp={1} step={0.5} min={0} max={30} title={`Segment ${i + 1} rolling resistance (blank = circuit default)`}
            changed={eff.overridden.rr} disabled={locked} onChange={v => props.onSeg(i, { rrPct: v })} onClear={() => props.onSeg(i, { rrPct: null })} />
          <Select<string> small value={p.seg?.zone ?? ''} onChange={v => props.onSeg(i, { zone: v ? (v as SegmentZone) : null })}
            options={[{ value: '', label: '–' }, ...ZONES.map(z => ({ value: z, label: z[0].toUpperCase() + z.slice(1) }))]} />
          <span className={s.c}>
            <button type="button" className={cx(s.stopBtn, p.stop && s.stopOn)} disabled={locked} title={p.stop ? 'Stop sign (both directions) – click to remove' : 'Add a stop sign at this point'}
              onClick={() => props.onStop(i, !p.stop)}>
              <Icon name="stop" size={16} strokeWidth={p.stop ? 2.2 : 1.7} />
            </button>
          </span>
        </>
      )}
    </div>
  );
});
