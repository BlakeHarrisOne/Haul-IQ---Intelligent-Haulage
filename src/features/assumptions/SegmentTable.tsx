import { useMemo, useState } from 'react';
import type { CircuitResult, LimitReason, SegmentResult } from '@/core/types';
import { num } from '@/core/format';
import { Badge, Button, Card, CardHead, gradeColor, Icon } from '@/ui';
import { excelRound } from './shared/excel';
import s from './assumptions.module.css';

export const REASON: Record<LimitReason, string> = {
  rimpull: 'rimpull', retarder: 'retarder', 'speed-limit': 'limit', 'top-speed': 'top speed', table: 'table', 'table-out-of-range': 'dropped',
};
export const REASON_LONG: Record<LimitReason, string> = {
  rimpull: 'Rimpull-limited: the engine/transmission cannot pull faster on this effective grade',
  retarder: 'Retarder-limited: continuous braking power caps the descent speed',
  'speed-limit': 'Speed limit (segment / zone / global cap)',
  'top-speed': 'Truck top speed',
  table: 'Grade → max-speed lookup table (workbook Travel Time!P3:T35)',
  'table-out-of-range': 'Grade outside the ±16 % table: the workbook VLOOKUP returns "" and the segment time is dropped (counted as 0 s)',
};

type Key = 'i' | 'chain' | 'dist' | 'grade' | 'vL' | 'tL' | 'vE' | 'tE';
const get: Record<Key, (x: SegmentResult) => number> = {
  i: x => x.i, chain: x => x.chainageM, dist: x => x.dist3dM, grade: x => x.grade, vL: x => x.speedLoadedKmh, tL: x => x.timeLoadedS, vE: x => x.speedEmptyKmh, tE: x => x.timeEmptyS,
};

export const pctStr = (g: number, dp = 1) => `${g > 0 ? '+' : g < 0 ? '−' : ''}${num(Math.abs(g) * 100, dp)}`;

function GradeCell({ g }: { g: number }) {
  return <span className={s.gradeChip}><span className={s.gradeBar} style={{ background: gradeColor(g) }} aria-hidden />{pctStr(g, 2)}</span>;
}

function Reason({ r }: { r: LimitReason }) {
  return <span className={`${s.reason} ${r === 'table-out-of-range' ? s.reasonBad : ''}`} title={REASON_LONG[r]}>{REASON[r]}</span>;
}

export function SegmentTable({ result, onExport }: { result: CircuitResult; onExport: () => void }) {
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'i', dir: 1 });
  const rows = useMemo(() => [...result.segments].sort((a, b) => (get[sort.k](a) - get[sort.k](b)) * sort.dir), [result.segments, sort]);
  const tot = useMemo(() => {
    const d = result.segments.reduce((a, x) => a + x.dist3dM, 0);
    const tl = result.segments.reduce((a, x) => a + x.timeLoadedS, 0);
    const te = result.segments.reduce((a, x) => a + x.timeEmptyS, 0);
    const dropped = result.segments.filter(x => x.limitLoaded === 'table-out-of-range' || x.limitEmpty === 'table-out-of-range');
    return { d, tl, te, dropped, droppedM: dropped.reduce((a, x) => a + x.dist3dM, 0) };
  }, [result.segments]);
  const th = (k: Key, label: string, col?: string, cls?: string) => (
    <th className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort(o => ({ k, dir: o.k === k ? (o.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{col && <span className={s.reason} style={{ marginLeft: 4, fontFamily: 'var(--font-mono)' }}>{col}</span>}
        {sort.k === k && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={12} />}
      </button>
    </th>
  );
  const sheet = result.speedModel === 'spreadsheet';
  return (
    <Card>
      <CardHead
        title="Segment travel times"
        sub={`${result.segments.length} segments · ${sheet ? "the workbook's Travel Time sheet" : 'rimpull / retarder model'}`}
        icon="table"
        actions={<>
          {tot.dropped.length > 0 && <Badge tone="bad" icon="warning" title={REASON_LONG['table-out-of-range']}>{tot.dropped.length} dropped · {num(tot.droppedM, 1)} m</Badge>}
          <Button size="sm" icon="download" onClick={onExport}>CSV</Button>
        </>}
      />
      <div className={s.tableScroll}>
        <table className={s.segTable}>
          <thead>
            <tr>
              {th('i', '#', undefined, s.l)}
              {th('chain', 'Chainage m')}
              {th('dist', 'Dist 3D m', 'A')}
              {th('grade', 'Grade %', 'B')}
              <th title="ROUND(grade, 2) — the exact-match key of the workbook VLOOKUP">ROUND(g,2) %</th>
              {th('vL', 'Loaded km/h', 'C', s.sepL)}
              {th('tL', 'Loaded s', 'D')}
              {th('vE', 'Empty km/h', 'L', s.sepL)}
              {th('tE', 'Empty s', 'M')}
            </tr>
          </thead>
          <tbody>
            {rows.map(x => {
              const dropped = x.limitLoaded === 'table-out-of-range' || x.limitEmpty === 'table-out-of-range';
              return (
                <tr key={x.i} className={dropped ? s.dropped : undefined}>
                  <td className={s.l}>{x.i + 1}{x.zone && <span className={s.reason}>{x.zone}</span>}</td>
                  <td>{num(x.chainageM, 1)}</td>
                  <td>{num(x.dist3dM, 2)}</td>
                  <td><GradeCell g={x.grade} /></td>
                  <td className={s.subtle}>{pctStr(excelRound(x.grade, 2), 0)}</td>
                  <td className={s.sepL}>{num(x.speedLoadedKmh, 1)}<Reason r={x.limitLoaded} /></td>
                  <td>{x.limitLoaded === 'table-out-of-range' && x.timeLoadedS === 0 ? <span className={s.reasonBad}>""</span> : num(x.timeLoadedS, 2)}</td>
                  <td className={s.sepL}>{num(x.speedEmptyKmh, 1)}<Reason r={x.limitEmpty} /></td>
                  <td>{x.limitEmpty === 'table-out-of-range' && x.timeEmptyS === 0 ? <span className={s.reasonBad}>""</span> : num(x.timeEmptyS, 2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className={s.l}>Σ</td>
              <td className={s.subtle}>{num(result.lengthM, 1)}</td>
              <td>{num(tot.d, 2)}</td>
              <td className={s.subtle}>{pctStr((result.riseM - result.fallM) / (tot.d || 1), 2)}</td>
              <td />
              <td className={s.sepL}><span className={s.subtle}>avg</span> {num(tot.tl > 0 ? (tot.d / tot.tl) * 3.6 : 0, 1)}</td>
              <td title="Travel Time!F15 → ActiveRoute!C4">{num(tot.tl, 2)}</td>
              <td className={s.sepL}><span className={s.subtle}>avg</span> {num(tot.te > 0 ? (tot.d / tot.te) * 3.6 : 0, 1)}</td>
              <td title="Travel Time!H15 → ActiveRoute!C5">{num(tot.te, 2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
