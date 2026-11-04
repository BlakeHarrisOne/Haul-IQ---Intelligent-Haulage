/** Inspector for a selected haul string: identity, metrics, linked circuits, actions, point table, paste. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HaulString, Scenario, StringPoint } from '@/core/types';
import { useApp } from '@/state/store';
import { useResults } from '@/state/derived';
import { Badge, Button, CardBody, CardHead, Ctl, Empty, Icon, Kpi, Modal, MenuButton, Section, cx, uiStyles } from '@/ui';
import { grade as fmtGrade, num, signed } from '@/core/format';
import { nowIso, uid } from '@/core/ids';
import { densify, parseStringsText, reversePoints, simplify3d, snapPoints, toCsv, toDataDump, toDxf3dPolyline } from '@/geom';
import { GLOBAL_DEFAULTS, chainagesOf, circuitsUsingString, segmentsOf, stringStats } from './model';
import { topoIndex } from './geo';
import { PointTable } from './PointTable';
import { BackButton, Callout, GradeChip, StatusBadge, copyText, downloadText, safeFileName } from './parts';
import s from './haulage.module.css';

const SOURCE_LABEL: Record<HaulString['source'], string> = { drawn: 'Drawn', imported: 'Imported', 'auto-route': 'Auto-route', demo: 'Demo' };

export function StringEditor({ id }: { id: string }) {
  const scenario = useApp(st => st.scenario);
  const hs = scenario.strings.find(x => x.id === id);
  const select = useApp(st => st.select);
  if (!hs) {
    return (
      <>
        <CardHead title={<span className={s.headTitle}><BackButton onClick={() => select({ kind: 'none' })} /><span>Haul string</span></span>} />
        <CardBody><Empty icon="string" title="String not found">It may have been deleted.</Empty></CardBody>
      </>
    );
  }
  return <Editor hs={hs} scenario={scenario} />;
}

function Editor({ hs, scenario }: { hs: HaulString; scenario: Scenario }) {
  const select = useApp(st => st.select);
  const commit = useApp(st => st.commit);
  const updateString = useApp(st => st.updateString);
  const setStringPoints = useApp(st => st.setStringPoints);
  const removeString = useApp(st => st.removeString);
  const toast = useApp(st => st.toast);
  const pointIndex = useApp(st => (st.selection.kind === 'string' && st.selection.id === hs.id ? st.selection.pointIndex : undefined));
  const results = useResults();
  const [pasting, setPasting] = useState(false);

  const stats = useMemo(() => stringStats(hs.points), [hs.points]);
  const chain = useMemo(() => chainagesOf(hs.points), [hs.points]);
  const segs = useMemo(() => segmentsOf(hs.points), [hs.points]);
  const linked = circuitsUsingString(scenario, hs.id);
  const main = linked.find(c => c.haulStringId === hs.id) ?? linked[0];
  const defaults = main?.params ?? GLOBAL_DEFAULTS;
  const index = topoIndex(scenario);
  const dig = scenario.assets.find(a => a.id === hs.digId), dump = scenario.assets.find(a => a.id === hs.dumpId);

  const reverse = () => {
    const pts = reversePoints(hs.points);
    commit('Reverse string', sc => ({ ...sc, strings: sc.strings.map(x => (x.id === hs.id ? { ...x, points: pts, digId: x.dumpId, dumpId: x.digId, updatedAt: nowIso() } : x)) }));
    toast('ok', `Reversed ${hs.name}: now runs ${dump?.name ?? 'end'} → ${dig?.name ?? 'start'}`);
  };
  const resnap = () => {
    if (!index) { toast('warn', 'No topo surface to snap to - import or load one first.'); return; }
    const next = snapPoints(index, hs.points);
    let moved = 0, max = 0, off = 0;
    next.forEach((p, i) => { const d = Math.abs(p.z - hs.points[i].z); if (d > 1e-3) moved++; max = Math.max(max, d); if (!p.snapped) off++; });
    setStringPoints(hs.id, next, 'Re-snap to surface');
    toast(off ? 'warn' : 'ok', `Re-snapped ${hs.points.length - off} points · ${moved} moved, max ${num(max, 2)} m${off ? ` · ${off} off the surface` : ''}`);
  };
  const densify25 = () => {
    const next = densify(index, hs.points, 25);
    const added = next.length - hs.points.length;
    if (!added) { toast('info', 'No segment is longer than 25 m.'); return; }
    setStringPoints(hs.id, next, 'Densify 25 m');
    toast('ok', `Added ${added} points (≤ 25 m spacing${index ? ', snapped to surface' : ''})`);
  };
  const simplify = () => {
    const next = simplify3d(hs.points, 0.25);
    const removed = hs.points.length - next.length;
    if (!removed) { toast('info', 'Nothing to simplify within 0.25 m.'); return; }
    setStringPoints(hs.id, next, 'Simplify string');
    toast('ok', `Removed ${removed} points within 0.25 m (3D)`);
  };
  const exportItems = [
    { label: 'Export', header: true },
    { label: 'CSV (E, N, Z)', icon: 'download' as const, onSelect: () => downloadText(`${safeFileName(hs.name)}.csv`, toCsv(hs), 'text/csv') },
    { label: 'DXF 3D polyline', icon: 'download' as const, hint: 'Deswik / Vulcan', onSelect: () => {
      // invalid vertices are skipped (reported in warnings); a string left with < 2 valid points throws
      const warnings: string[] = [];
      try {
        downloadText(`${safeFileName(hs.name)}.dxf`, toDxf3dPolyline(hs, { warnings }), 'application/dxf');
        if (warnings.length) toast('warn', warnings.join(' · '));
      } catch (e) { toast('error', e instanceof Error ? e.message : String(e)); }
    } },
    { label: 'Copy for Data Dump', icon: 'copy' as const, hint: 'E ⇥ N ⇥ RL', onSelect: async () => toast((await copyText(toDataDump(hs))) ? 'ok' : 'error', `Copied ${hs.points.length} rows - paste at Data Dump!A2`) },
    { separator: true, label: '' },
    { label: hs.locked ? 'Unlock string' : 'Lock string', icon: (hs.locked ? 'unlock' : 'lock') as 'lock' | 'unlock', onSelect: () => updateString(hs.id, { locked: !hs.locked }) },
    { label: 'Delete string', icon: 'trash' as const, danger: true, onSelect: () => { removeString(hs.id); select({ kind: 'none' }); toast('info', `Deleted ${hs.name}`); } },
  ];

  const firstDrop = segs.find(x => x.dropped);
  const sp = pointIndex != null ? hs.points[pointIndex] : undefined;

  return (
    <>
      <CardHead
        title={<span className={s.headTitle}><BackButton label="Overview" onClick={() => select({ kind: 'none' })} /><span className={s.lineKey} style={{ background: hs.color, flex: 'none' }} /><span>{hs.name}</span></span>}
        actions={<>
          {hs.locked && <Badge tone="na" icon="lock">Locked</Badge>}
          <MenuButton items={exportItems} align="right">{(open, toggle) => <Ctl icon="more" small tip="Export & more" on={open} onClick={toggle} />}</MenuButton>
        </>}
      />
      <CardBody>
        <div className={s.sub}>
          <b>{SOURCE_LABEL[hs.source]}</b>
          <span className={s.dotSep}>{dig?.name ?? 'start'} → {dump?.name ?? 'end'}</span>
          <span className={s.dotSep}>edited {new Date(hs.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
        </div>
        <NameRow hs={hs} />

        <div className={s.kpis}>
          <Kpi size="sm" label="Length" value={num(stats.lengthM)} unit="m" delta={`${num(stats.planM)} m plan`} deltaTone="na" />
          <Kpi size="sm" label="Rise" value={signed(stats.riseM, 1)} unit="m" delta={`RL ${num(stats.startZ, 1)} → ${num(stats.endZ, 1)}`} deltaTone="na" />
          <Kpi size="sm" label="Fall" value={signed(-stats.fallM, 1)} unit="m" delta={`${num(stats.points)} points`} deltaTone="na" />
          <Kpi size="sm" label="Net grade" value={fmtGrade(stats.netGrade, 1)} delta={`mean |g| ${num(stats.meanAbsGrade * 100, 1)}%`} deltaTone="na" />
          <Kpi size="sm" label="Max up" value={fmtGrade(stats.maxUp, 1)} deltaTone={stats.maxUp > 0.1 ? 'bad' : 'na'} delta={stats.maxUp > 0.1 ? 'over 10 %' : 'loaded uphill'} />
          <Kpi size="sm" label="Max down" value={fmtGrade(stats.maxDown, 1)} deltaTone={stats.maxDown < -0.1 ? 'bad' : 'na'} delta={stats.maxDown < -0.1 ? 'over 10 %' : 'loaded downhill'} />
        </div>

        {stats.droppedCount > 0 && (
          <Callout tone="bad" title={`${stats.droppedCount} segment${stats.droppedCount > 1 ? 's' : ''} steeper than ±16 % (${num(stats.droppedM, 1)} m)`}
            action={firstDrop && <Button size="sm" onClick={() => select({ kind: 'string', id: hs.id, pointIndex: firstDrop.i })}>Show first · point {firstDrop.i + 1}</Button>}>
            The workbook's speed table stops at ±16 %, so calc.xlsm silently counts these at 0 s while keeping their distance (spreadsheet mode replicates this unless the circuit clamps steep grades). Usually a vertical step in the string - re-snap or simplify it.
          </Callout>
        )}

        {sp && pointIndex != null && (
          <Section title={`Point ${pointIndex + 1} of ${hs.points.length}`} actions={<button type="button" className={s.link} style={{ fontSize: 12 }} onClick={() => select({ kind: 'string', id: hs.id })}>Clear</button>}>
            <div className={s.kpis} style={{ paddingTop: 6 }}>
              <Kpi size="sm" label="Chainage" value={num(chain[pointIndex], 1)} unit="m" />
              <Kpi size="sm" label="RL" value={num(sp.z, 2)} unit="m" delta={sp.snapped ? 'snapped' : 'typed'} deltaTone={sp.snapped ? 'ok' : 'na'} />
              <div className={s.fig}>
                <span className={s.figLab}>Grade in / out</span>
                <span className={s.figVal} style={{ gap: 4, marginTop: 2 }}>
                  {segs[pointIndex - 1] ? <GradeChip g={segs[pointIndex - 1].grade} dropped={segs[pointIndex - 1].dropped} /> : <span className={s.tNa}>start</span>}
                  {segs[pointIndex] ? <GradeChip g={segs[pointIndex].grade} dropped={segs[pointIndex].dropped} /> : <span className={s.tNa}>end</span>}
                </span>
              </div>
            </div>
          </Section>
        )}

        <Section title={`Circuits on this string · ${linked.length}`}>
          {linked.length === 0 && <div className={s.sub} style={{ padding: '2px 16px 6px' }}>Not used by a circuit yet.</div>}
          {linked.map(c => {
            const r = results[c.id];
            return (
              <button key={c.id} type="button" className={cx(s.lRow, s.lRowWide)} onClick={() => select({ kind: 'circuit', id: c.id })}>
                <span className={s.cDot} style={{ background: c.color, justifySelf: 'center' }} />
                <span className={s.lName}>{c.name}<span className={s.lHint}>{c.haulStringId === hs.id ? 'main haul' : 'alternative'}</span></span>
                <span className={s.lVal}>{r?.ok && c.haulStringId === hs.id ? `${num(r.cycleMin, 1)} min` : ''}</span>
                <span>{r?.ok && c.haulStringId === hs.id ? <StatusBadge status={r.assigned.status} short /> : <Icon name="right" size={16} style={{ color: 'var(--ink-3)' }} />}</span>
              </button>
            );
          })}
        </Section>

        <Section title="Edit">
          <div className={s.actionGrid}>
            <Button size="sm" icon="reverse" onClick={reverse} disabled={hs.locked} title="Swap dig and dump ends">Reverse</Button>
            <Button size="sm" icon="snap" onClick={resnap} disabled={hs.locked || !index} title={index ? 'Set every RL from the topo surface' : 'No topo surface loaded'}>Re-snap</Button>
            <Button size="sm" icon="insert" onClick={densify25} disabled={hs.locked} title="Add points so no segment is longer than 25 m">Densify 25 m</Button>
            <Button size="sm" icon="vertex" onClick={simplify} disabled={hs.locked} title="Remove points within 0.25 m (3D Douglas–Peucker)">Simplify 0.25 m</Button>
          </div>
          <PointTable hs={hs} defaults={defaults} index={index} onPaste={() => setPasting(true)} />
        </Section>
      </CardBody>
      {pasting && <PasteModal hs={hs} onClose={() => setPasting(false)} />}
    </>
  );
}

function NameRow({ hs }: { hs: HaulString }) {
  const updateString = useApp(st => st.updateString);
  const [name, setName] = useState(hs.name);
  const [color, setColor] = useState(hs.color);
  useEffect(() => { setName(hs.name); setColor(hs.color); }, [hs.id, hs.name, hs.color]);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commitName = () => { const v = name.trim(); if (v && v !== hs.name) updateString(hs.id, { name: v }); else setName(hs.name); };
  return (
    <div style={{ display: 'flex', gap: 8, padding: '10px 16px 0' }}>
      <span className={uiStyles.inputWrap} style={{ flex: 1 }}>
        <input className={uiStyles.input} value={name} aria-label="String name" onChange={e => setName(e.target.value)} onBlur={commitName}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(hs.name); (e.target as HTMLInputElement).blur(); } }} />
      </span>
      <input type="color" className={s.colorInput} value={toHex(color)} title="String colour" aria-label="String colour"
        onChange={e => { const v = e.target.value; setColor(v); clearTimeout(t.current); t.current = setTimeout(() => updateString(hs.id, { color: v }), 350); }} />
    </div>
  );
}

const toHex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map(x => x + x).join('')}` : '#0a6fe6');

// ─────────────────────────────────────────────────────────────── paste XYZ

function PasteModal({ hs, onClose }: { hs: HaulString; onClose: () => void }) {
  const setStringPoints = useApp(st => st.setStringPoints);
  const toast = useApp(st => st.toast);
  const scenario = useApp(st => st.scenario);
  const [text, setText] = useState('');
  const [snap, setSnap] = useState(false);
  useEffect(() => {
    navigator.clipboard?.readText?.().then(t => { if (t && /\d/.test(t)) setText(v => v || t); }).catch(() => { /* permission denied: user pastes */ });
  }, []);
  const parsed = useMemo(() => (text.trim() ? parseStringsText(text) : undefined), [text]);
  const first0 = parsed?.strings[0];
  const count = first0?.points.length ?? 0;
  const index = topoIndex(scenario);
  const toPoints = (): StringPoint[] => {
    const pts = (first0?.points ?? []).map(([e, n, z]) => ({ id: uid('pt'), e, n, z, snapped: false } as StringPoint));
    return snap && index ? snapPoints(index, pts) : pts;
  };
  const apply = (mode: 'replace' | 'append') => {
    const pts = toPoints();
    const next = mode === 'replace' ? pts : [...hs.points, ...pts];
    setStringPoints(hs.id, next, mode === 'replace' ? 'Paste points (replace)' : 'Paste points (append)');
    toast('ok', `${mode === 'replace' ? 'Replaced with' : 'Appended'} ${pts.length} points`);
    onClose();
  };
  const first = first0?.points[0], last = first0?.points[count - 1];
  return (
    <Modal open title="Paste XYZ rows" sub="Easting, Northing, RL per row - from Deswik / Vulcan string properties, the workbook's Data Dump, or CSV. Headers and titles are skipped."
      onClose={onClose} width={620}
      footer={<>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 'auto', fontSize: 13.5, color: index ? 'var(--ink-2)' : 'var(--ink-4)' }}>
          <input type="checkbox" checked={snap} disabled={!index} onChange={e => setSnap(e.target.checked)} /> Snap RL to surface
        </label>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={count < 1 || !!hs.locked} onClick={() => apply('append')}>Append {count || ''}</Button>
        <Button variant="primary" disabled={count < 2 || !!hs.locked} onClick={() => apply('replace')}>Replace {hs.points.length} with {count || '…'}</Button>
      </>}>
      <textarea className={s.paste} value={text} onChange={e => setText(e.target.value)} placeholder={'236494.145\t7051413.661\t294.728\n236508.147\t7051402.300\t295.098\n…'} autoFocus spellCheck={false} />
      <div className={s.pasteInfo}>
        {parsed ? (
          <>
            <span><b>{count}</b> points{first0 ? ` · ${first0.name}` : ''}</span>
            {parsed.strings.length > 1 && <span className={s.tWarn}>{parsed.strings.length} strings found - using the first</span>}
            {first && last && <span className={s.num}>{num(first[0], 1)}, {num(first[1], 1)} → {num(last[0], 1)}, {num(last[1], 1)}</span>}
            {parsed.warnings.slice(0, 3).map((w, k) => <span key={k} className={cx(s.tWarn)} style={{ flexBasis: '100%' }}>{w}</span>)}
          </>
        ) : <span className={s.muted}>Nothing pasted yet.</span>}
      </div>
    </Modal>
  );
}
