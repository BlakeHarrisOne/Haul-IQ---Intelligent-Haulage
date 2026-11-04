/** Inspector for a selected surface / solid: display, statistics, dig/dump block properties, circuits using it. */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { AssetRole, BlockProps, DepletionMode, MeshAsset } from '@/core/types';
import { useApp } from '@/state/store';
import { useResults } from '@/state/derived';
import { Badge, CardBody, CardHead, Empty, Field, Icon, Kpi, NumberField, Range, Section, Segmented, Select, Toggle } from '@/ui';
import { num } from '@/core/format';
import { circuitsUsingAsset } from './model';
import { BackButton, StatusBadge } from './parts';
import s from './haulage.module.css';

const ROLES: { value: AssetRole; label: string }[] = [
  { value: 'topo', label: 'Topo' }, { value: 'dig', label: 'Dig' }, { value: 'dump', label: 'Dump' }, { value: 'design', label: 'Design' }, { value: 'other', label: 'Other' },
];
const MODES: { value: DepletionMode; label: string; title: string }[] = [
  { value: 'face-advance', label: 'Face advance', title: 'The face moves along the advance azimuth' },
  { value: 'bench-down', label: 'Bench down', title: 'Mined top-down in benches' },
  { value: 'bottom-up', label: 'Bottom up', title: 'Filled from the floor up (dumps)' },
];

export function AssetCard({ id }: { id: string }) {
  const scenario = useApp(st => st.scenario);
  const a = scenario.assets.find(x => x.id === id);
  const select = useApp(st => st.select);
  if (!a) {
    return (
      <>
        <CardHead title={<span className={s.headTitle}><BackButton onClick={() => select({ kind: 'none' })} /><span>Surface</span></span>} />
        <CardBody><Empty icon="solid" title="Not found">It may have been removed.</Empty></CardBody>
      </>
    );
  }
  return <Body a={a} />;
}

function Body({ a }: { a: MeshAsset }) {
  const scenario = useApp(st => st.scenario);
  const select = useApp(st => st.select);
  const updateAsset = useApp(st => st.updateAsset);
  const results = useResults();
  const st = a.stats;
  const used = circuitsUsingAsset(scenario, a.id);
  const isBlock = a.role === 'dig' || a.role === 'dump';
  const block: BlockProps = a.block ?? { materialId: scenario.materials[0]?.id ?? 'OB', depletionMode: a.role === 'dump' ? 'bottom-up' : 'face-advance', advanceAzimuthDeg: 0 };
  const setBlock = (p: Partial<BlockProps>) => updateAsset(a.id, { block: { ...block, ...p } });
  const size = [st.bbox.max[0] - st.bbox.min[0], st.bbox.max[1] - st.bbox.min[1], st.bbox.max[2] - st.bbox.min[2]];

  // opacity: live preview locally, commit after the drag settles (one undo step)
  const [op, setOp] = useState(a.opacity);
  useEffect(() => setOp(a.opacity), [a.opacity]);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <>
      <CardHead
        title={<span className={s.headTitle}><BackButton label="Overview" onClick={() => select({ kind: 'none' })} /><Icon name={a.kind === 'solid' ? 'solid' : 'surface'} size={18} style={{ color: a.color, flex: 'none' }} /><span>{a.name}</span></span>}
        actions={<Badge tone={st.closed ? 'ok' : 'na'} icon={st.closed ? 'tick' : undefined}>{st.closed ? 'Closed solid' : 'Open surface'}</Badge>}
      />
      <CardBody>
        <div className={s.sub}>
          <b>{a.fileName ?? a.source}</b><span className={s.dotSep}>{num(st.triangleCount)} triangles</span><span className={s.dotSep}>{num(st.vertexCount)} vertices</span>
        </div>
        <Section title="Display">
          <div className={s.setup}>
            <div className={s.full}>
              <Field label="Role"><Segmented<AssetRole> small value={a.role} onChange={v => updateAsset(a.id, { role: v })} options={ROLES} /></Field>
            </div>
            <Field label="Colour">
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" className={s.colorInput} value={/^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#8e949c'} onChange={e => updateAsset(a.id, { color: e.target.value })} aria-label="Colour" />
                <Toggle on={a.visible} onChange={v => updateAsset(a.id, { visible: v })} label="Visible" />
              </span>
            </Field>
            <Field label={<>Opacity <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>{Math.round(op * 100)}%</span></>}>
              <Range value={Math.round(op * 100)} min={5} max={100} onChange={v => { setOp(v / 100); clearTimeout(t.current); t.current = setTimeout(() => updateAsset(a.id, { opacity: v / 100 }), 250); }} />
            </Field>
          </div>
        </Section>

        <Section title="Statistics">
          <div className={s.kpis}>
            {a.kind === 'solid' && <Kpi size="sm" label="Volume" value={st.volume != null ? num(st.volume) : '–'} unit="bcm" />}
            <Kpi size="sm" label="Plan area" value={num(st.planArea / 10000, 2)} unit="ha" />
            <Kpi size="sm" label="Height" value={num(size[2], 1)} unit="m" delta={`RL ${num(st.bbox.min[2], 1)}–${num(st.bbox.max[2], 1)}`} deltaTone="na" />
            {a.kind !== 'solid' && <Kpi size="sm" label="Boundary edges" value={num(st.boundaryEdges)} />}
          </div>
          <div className={s.statGrid}>
            <Kpi size="sm" label="Centroid E / N" value={<span style={{ fontSize: 14 }}>{num(st.centroid[0], 1)} / {num(st.centroid[1], 1)}</span>} />
            <Kpi size="sm" label="Centroid RL" value={num(st.centroid[2], 2)} unit="m" />
            <Kpi size="sm" label="Extent E × N" value={<span style={{ fontSize: 14 }}>{num(size[0])} × {num(size[1])}</span>} unit="m" />
            <Kpi size="sm" label="Triangles" value={num(st.triangleCount)} delta={st.closed ? 'watertight' : `${num(st.boundaryEdges)} open edges`} deltaTone={st.closed ? 'ok' : 'na'} />
          </div>
        </Section>

        {isBlock && (
          <Section title={a.role === 'dig' ? 'Dig block' : 'Dump'}>
            <div className={s.setup}>
              <Field label="Material">
                <Select value={block.materialId} onChange={v => setBlock({ materialId: v })}
                  options={scenario.materials.length ? scenario.materials.map(m => ({ value: m.id, label: m.name })) : [{ value: block.materialId, label: block.materialId }]} />
              </Field>
              <Field label="Planned volume" hint={block.plannedBcm != null ? `Solid ${num(st.volume ?? 0)} bcm` : 'Blank = solid volume'}>
                <NumberField value={block.plannedBcm ?? null} placeholder={st.volume != null ? num(st.volume) : '—'} unit="bcm" dp={0} step={1000} min={0}
                  changed={block.plannedBcm != null} onChange={v => setBlock({ plannedBcm: v })} onClear={() => setBlock({ plannedBcm: undefined })} />
              </Field>
              <div className={s.full}>
                <Field label="Depletion"><Segmented<DepletionMode> small value={block.depletionMode} onChange={v => setBlock({ depletionMode: v })} options={MODES} /></Field>
              </div>
            </div>
            <div className={s.dialRow}>
              <AzimuthDial deg={block.advanceAzimuthDeg} onChange={v => setBlock({ advanceAzimuthDeg: v })} disabled={block.depletionMode !== 'face-advance'} />
              <Field label={block.depletionMode === 'face-advance' ? 'Face advance azimuth' : 'Azimuth (face advance only)'} hint={compass(block.advanceAzimuthDeg)}>
                <NumberField value={block.advanceAzimuthDeg} unit="° grid" dp={0} step={5} min={0} max={360} onChange={v => setBlock({ advanceAzimuthDeg: ((v % 360) + 360) % 360 })} />
              </Field>
            </div>
          </Section>
        )}

        <Section title={`Used by · ${used.length}`}>
          {used.length === 0 && <div className={s.sub} style={{ padding: '2px 16px 6px' }}>{isBlock ? 'No circuit digs from or dumps to this yet.' : 'Surfaces are used for snapping, profiles and sections.'}</div>}
          {used.map(c => {
            const r = results[c.id];
            return (
              <button key={c.id} type="button" className={`${s.lRow} ${s.lRowWide}`} onClick={() => select({ kind: 'circuit', id: c.id })}>
                <span className={s.cDot} style={{ background: c.color, justifySelf: 'center' }} />
                <span className={s.lName}>{c.name}<span className={s.lHint}>{c.digId === a.id ? 'digs here' : 'dumps here'}</span></span>
                <span className={s.lVal}>{r?.ok ? `${num(r.assigned.bcmPerDay)} bcm/d` : ''}</span>
                <span>{r?.ok ? <StatusBadge status={r.assigned.status} short /> : null}</span>
              </button>
            );
          })}
        </Section>
      </CardBody>
    </>
  );
}

const compass = (deg: number) => {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return `Advancing towards ${names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]}`;
};

/** Small draggable compass dial (degrees clockwise from grid north). */
function AzimuthDial({ deg, onChange, disabled }: { deg: number; onChange: (v: number) => void; disabled?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? deg;
  const fromEvent = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const v = Math.round((((a % 360) + 360) % 360) / 5) * 5;
    return v === 360 ? 0 : v;
  };
  const rad = (shown * Math.PI) / 180;
  const R = 26, cx = 32, cy = 32;
  const tip = [cx + Math.sin(rad) * (R - 4), cy - Math.cos(rad) * (R - 4)];
  return (
    <svg ref={ref} className={s.dial} viewBox="0 0 64 64" style={disabled ? { opacity: 0.45, cursor: 'default' } : undefined}
      onPointerDown={e => { if (disabled) return; (e.target as Element).setPointerCapture(e.pointerId); setLive(fromEvent(e)); }}
      onPointerMove={e => { if (live != null) setLive(fromEvent(e)); }}
      onPointerUp={() => { if (live != null) { onChange(live); setLive(null); } }}
      role="slider" aria-label="Advance azimuth" aria-valuemin={0} aria-valuemax={359} aria-valuenow={shown}>
      <circle cx={cx} cy={cy} r={R + 4} fill="var(--surface-2)" stroke="var(--hair)" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i * 15 * Math.PI) / 180, l = i % 6 === 0 ? 5 : 2.5;
        return <line key={i} x1={cx + Math.sin(a) * (R + 2)} y1={cy - Math.cos(a) * (R + 2)} x2={cx + Math.sin(a) * (R + 2 - l)} y2={cy - Math.cos(a) * (R + 2 - l)} stroke="var(--ink-4)" strokeWidth={i % 6 === 0 ? 1.4 : 1} />;
      })}
      <text x={cx} y={12.5} textAnchor="middle" style={{ font: '650 8px var(--font)', fill: 'var(--ink-2)' }}>N</text>
      <line x1={cx} y1={cy} x2={tip[0]} y2={tip[1]} stroke="var(--accent)" strokeWidth={2.4} strokeLinecap="round" />
      <path d={arrowHead(cx, cy, rad, R - 2)} fill="var(--accent)" />
      <circle cx={cx} cy={cy} r={3} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
    </svg>
  );
}
function arrowHead(cx: number, cy: number, a: number, r: number) {
  const tx = cx + Math.sin(a) * r, ty = cy - Math.cos(a) * r;
  const l = 7, w = 4.2;
  const bx = tx - Math.sin(a) * l, by = ty + Math.cos(a) * l;
  const px = Math.cos(a) * w, py = Math.sin(a) * w;
  return `M${tx},${ty}L${bx + px},${by + py}L${bx - px},${by - py}Z`;
}
