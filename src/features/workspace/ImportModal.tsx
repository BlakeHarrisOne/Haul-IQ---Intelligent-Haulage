import { useMemo } from 'react';
import { useApp } from '@/state/store';
import { num } from '@/core/format';
import type { AssetRole, DepletionMode } from '@/core/types';
import { Badge, Button, Check, Ctl, Field, Icon, Modal, NumberField, Segmented, Select, TextField, cx, type IconName } from '@/ui';
import { commitImport, DEFAULT_MATERIALS, pickFiles, pickMeshes, pickStrings, refreshWarnings, ROLE_COLORS, SWATCHES } from './importer';
import type { ImportItem } from './importTypes';
import { useShellUi, ui } from './uiStore';
import m from './import.module.css';

const ROLES: { value: AssetRole; label: string }[] = [
  { value: 'topo', label: 'Topo' }, { value: 'dig', label: 'Dig' }, { value: 'dump', label: 'Dump' }, { value: 'design', label: 'Design' }, { value: 'other', label: 'Other' },
];
const DEPLETION: { value: DepletionMode; label: string }[] = [
  { value: 'face-advance', label: 'Face advance' }, { value: 'bench-down', label: 'Bench down' }, { value: 'bottom-up', label: 'Fill bottom-up' },
];
const ROLE_ICON: Record<AssetRole, IconName> = { topo: 'surface', dig: 'dig', dump: 'dump', design: 'road', other: 'layers' };

const fmtBytes = (b: number) => (b > 1e6 ? `${num(b / 1e6, 1)} MB` : `${num(b / 1e3, 0)} kB`);

function patch(key: string, p: Partial<ImportItem>, recheck = false) {
  const upd = (i: ImportItem): ImportItem => (recheck ? refreshWarnings({ ...i, ...p }) : { ...i, ...p });
  ui().set({ importItems: ui().importItems.map(i => (i.key === key ? upd(i) : i)) });
}

function Readout({ label, value, unit, title }: { label: string; value: string; unit?: string; title?: string }) {
  return <div className={m.ro} title={title}><div className={m.roLab}>{label}</div><div className={m.roVal}>{value}{unit && <i>{unit}</i>}</div></div>;
}

function ItemCard({ it }: { it: ImportItem }) {
  const materials = useApp(st => st.scenario.materials);
  const mats = materials.length ? materials : DEFAULT_MATERIALS;
  const st = it.stats;
  const block = it.role === 'dig' || it.role === 'dump';
  return (
    <div className={cx(m.item, !it.include && it.status === 'ready' && m.off)}>
      <div className={m.itemHead}>
        <Check on={it.include} onChange={v => patch(it.key, { include: v })} title="Include in the import" />
        <span className={m.kindIco} style={{ background: it.color }}><Icon name={ROLE_ICON[it.role]} size={20} strokeWidth={2} /></span>
        <div className={m.nameCol}>
          <TextField value={it.name} onChange={v => patch(it.key, { name: v })} small />
          <span className={m.fileName}>{it.fileName} · {fmtBytes(it.sizeBytes)}{it.ms != null ? ` · read in ${num(it.ms)} ms` : ''}</span>
        </div>
        {it.status === 'ready' && (
          <Badge tone={it.kind === 'solid' ? 'info' : 'na'} icon={it.kind === 'solid' ? 'solid' : 'surface'}
            title={it.kind === 'solid' ? 'Closed: every edge is shared by two triangles' : 'Open triangulation'}>
            {it.kind === 'solid' ? 'Closed solid' : 'Surface'}
          </Badge>
        )}
        {it.status === 'ready' && (
          <Segmented<AssetRole> small value={it.role} options={ROLES} style={{ width: 330 }}
            onChange={role => patch(it.key, {
              role,
              color: role === 'dig' ? (mats.find(x => x.id === it.materialId)?.color ?? ROLE_COLORS.dig) : ROLE_COLORS[role],
              depletionMode: role === 'dump' ? 'bottom-up' : role === 'dig' ? 'face-advance' : it.depletionMode,
            }, true)} />
        )}
        <Ctl icon="x" small tip="Remove" onClick={() => ui().set({ importItems: ui().importItems.filter(x => x.key !== it.key) })} />
      </div>
      {it.status === 'reading' && <div className={m.reading}><Icon name="clock" size={16} />Reading the triangulation…<span className={m.bar} /></div>}
      {it.status === 'error' && <div className={m.err}><Icon name="warning" size={18} />{it.error}</div>}
      {it.status === 'ready' && st && (
        <>
          <div className={m.readouts}>
            <Readout label="Triangles" value={num(st.triangleCount)} title={`${num(st.vertexCount)} vertices`} />
            <Readout label="Plan area" value={num(st.planArea / 10_000, 1)} unit="ha" />
            {st.closed && st.volume != null
              ? <Readout label="Volume" value={st.volume > 1e6 ? num(st.volume / 1e6, 2) : num(st.volume)} unit={st.volume > 1e6 ? 'M bcm' : 'bcm'} />
              : <Readout label="RL range" value={`${num(st.bbox.min[2], 0)}–${num(st.bbox.max[2], 0)}`} unit="m" />}
            <Readout label="Centroid E · N" value={`${num(st.centroid[0], 0)} · ${num(st.centroid[1], 0)}`} title={`RL ${num(st.centroid[2], 1)} m`} />
            <Readout label="Extent" value={`${num(st.bbox.max[0] - st.bbox.min[0], 0)} × ${num(st.bbox.max[1] - st.bbox.min[1], 0)}`} unit="m" />
          </div>
          <div className={m.opts}>
            {block && (
              <>
                <Field label="Material">
                  <Select value={it.materialId} width={150} onChange={v => patch(it.key, { materialId: v, color: it.role === 'dig' ? (mats.find(x => x.id === v)?.color ?? it.color) : it.color })}
                    options={mats.map(x => ({ value: x.id, label: `${x.id} · ${x.name}` }))} />
                </Field>
                <Field label={it.role === 'dig' ? 'Depletion' : 'Fill'}>
                  <Select<DepletionMode> value={it.depletionMode} width={150} onChange={v => patch(it.key, { depletionMode: v })} options={DEPLETION} />
                </Field>
                {it.depletionMode === 'face-advance' && (
                  <Field label="Advance azimuth">
                    <NumberField value={it.advanceAzimuthDeg} onChange={v => patch(it.key, { advanceAzimuthDeg: ((v % 360) + 360) % 360 })} unit="°" dp={0} step={15} width={110} />
                  </Field>
                )}
              </>
            )}
            <Field label="Colour">
              <div className={m.swatches}>
                {SWATCHES.map(c => (
                  <button key={c} type="button" className={cx(m.sw, it.color.toLowerCase() === c.toLowerCase() && m.swOn)} style={{ background: c }}
                    onClick={() => patch(it.key, { color: c })} aria-label={`Colour ${c}`} />
                ))}
                <input type="color" className={m.colorInput} value={it.color} onChange={e => patch(it.key, { color: e.target.value })} title="Custom colour" />
              </div>
            </Field>
          </div>
          {it.warnings.length > 0 && (
            <div className={m.warns}>
              {it.warnings.map((w, i) => <div key={i} className={m.warn}><Icon name="warning" size={16} />{w.replace(/^Reader: /, '')}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StringsPreview() {
  const imp = useShellUi(st => st.stringsImport);
  if (!imp) return null;
  return (
    <div className={m.tableWrap}>
      <div className={m.tableHead}>
        <Icon name="string" size={18} style={{ color: 'var(--accent)' }} />
        {imp.strings.length} strings from {imp.fileName}
        <span style={{ flex: 1 }} />
        <Ctl icon="x" small tip="Remove" onClick={() => ui().set({ stringsImport: undefined })} />
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className={m.table}>
          <thead><tr><th>Name</th><th className={m.r}>Points</th><th className={m.r}>Length</th><th className={m.r}>RL range</th><th className={m.r}>Start E · N</th></tr></thead>
          <tbody>
            {imp.strings.map(s => {
              let len = 0, zmin = Infinity, zmax = -Infinity;
              s.points.forEach((p, i) => {
                zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z);
                if (i) { const q = s.points[i - 1]; len += Math.hypot(p.e - q.e, p.n - q.n, p.z - q.z); }
              });
              const p0 = s.points[0];
              return (
                <tr key={s.id}>
                  <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />{s.name}</td>
                  <td className={m.r}>{s.points.length}</td>
                  <td className={m.r}>{num(len)} m</td>
                  <td className={m.r}>{s.points.length ? `${num(zmin, 1)}–${num(zmax, 1)}` : '–'}</td>
                  <td className={m.r}>{p0 ? `${num(p0.e, 0)} · ${num(p0.n, 0)}` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {imp.warnings.length > 0 && <div className={m.warns}>{imp.warnings.map((w, i) => <div key={i} className={m.warn}><Icon name="warning" size={16} />{w}</div>)}</div>}
    </div>
  );
}

export function ImportModal() {
  const open = useShellUi(st => st.importOpen);
  const items = useShellUi(st => st.importItems);
  const strings = useShellUi(st => st.stringsImport);
  const hasAssets = useApp(st => st.scenario.assets.length > 0);
  const summary = useMemo(() => {
    const ready = items.filter(i => i.status === 'ready' && i.include).length;
    const reading = items.filter(i => i.status === 'reading').length;
    const errors = items.filter(i => i.status === 'error').length;
    const warns = items.filter(i => i.status === 'ready' && i.include && i.warnings.length).length;
    return { ready, reading, errors, warns };
  }, [items]);
  const close = () => ui().set({ importOpen: false, importItems: [], stringsImport: undefined });
  const canAdd = summary.ready > 0 || !!strings;
  const n = summary.ready + (strings ? strings.strings.length : 0);
  return (
    <Modal open={open} onClose={close} width={960}
      title={hasAssets ? 'Add to the scenario' : 'Load the pit'}
      sub="Surfaces, solids and strings stay on this computer. Closed triangulations are detected as solids; choose what each file is."
      footer={<>
        <span className={m.footNote}>
          {summary.reading > 0 && <><Icon name="clock" size={16} />Reading {summary.reading}…</>}
          {summary.reading === 0 && summary.errors > 0 && <><Icon name="warning" size={16} />{summary.errors} could not be read</>}
          {summary.reading === 0 && !summary.errors && summary.warns > 0 && <><Icon name="warning" size={16} />{summary.warns} with notes – check before adding</>}
          {summary.reading === 0 && !summary.errors && !summary.warns && canAdd && <><Icon name="tick" size={16} style={{ color: 'var(--ok)' }} />Ready</>}
        </span>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="plus" disabled={!canAdd} onClick={() => commitImport()}>
          {n > 1 ? `Add ${n} to scenario` : 'Add to scenario'}
        </Button>
      </>}>
      <div className={m.adders}>
        <button type="button" className={m.adder} onClick={() => pickFiles('.00t', false)}>
          <Icon name="surface" size={26} /><span><div className={m.aTitle}>Pit surface</div><div className={m.aSub}>Vulcan .00t</div></span>
        </button>
        <button type="button" className={m.adder} onClick={pickMeshes}>
          <Icon name="solid" size={26} /><span><div className={m.aTitle}>Dig &amp; dump solids</div><div className={m.aSub}>Vulcan .00t · several at once</div></span>
        </button>
        <button type="button" className={m.adder} onClick={pickStrings}>
          <Icon name="string" size={26} /><span><div className={m.aTitle}>Haul strings</div><div className={m.aSub}>.str · .csv · .txt</div></span>
        </button>
      </div>
      {items.length > 0 && <div className={m.list}>{items.map(it => <ItemCard key={it.key} it={it} />)}</div>}
      <StringsPreview />
    </Modal>
  );
}
