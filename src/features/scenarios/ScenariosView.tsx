import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '@/state/store';
import { num } from '@/core/format';
import { Badge, Button, Check, Ctl, Empty, Icon, MenuButton, Modal, PageHeader, Segmented, TextField, cx, type IconName } from '@/ui';
import { scenarioKpis, type LibraryMeta, type ScenarioKpis } from './db';
import {
  duplicateInLibrary, exportLibraryScenario, importScenarioFile, newScenario, openScenario, removeScenario, renameInLibrary, saveCurrent,
  useLibrary, useScenarioPicks,
} from './library';
import { ago } from './time';
import { docTheme, planThumbnail, type ThumbTheme } from './thumbnail';
import s from './scenarios.module.css';

/** The UI theme on <html data-theme>, live (thumbnails are drawn per theme). */
function useDocTheme(): ThumbTheme {
  const [theme, setTheme] = useState<ThumbTheme>(docTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(docTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

const SAVE_KEYS = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘S' : 'Ctrl+S';

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Kpis({ k }: { k?: ScenarioKpis }) {
  if (!k) return null;
  return (
    <div className={s.kpis}>
      <div className={s.kpi}><span className={s.kpiLab}>Production</span><span className={s.kpiVal}>{num(k.bcmDay)}<i>bcm/d</i></span></div>
      <div className={s.kpi}><span className={s.kpiLab}>Trucks</span><span className={s.kpiVal}>{num(k.trucks)}</span></div>
      <div className={s.kpi}>
        <span className={s.kpiLab}>Lost PT</span>
        <span className={cx(s.kpiVal, k.lostPtHrsShift > 0.25 && s.bad)}>{num(k.lostPtHrsShift, 1)}<i>h/shift</i></span>
      </div>
    </div>
  );
}

function Counts({ m }: { m: Pick<LibraryMeta, 'circuits' | 'strings' | 'assets'> }) {
  const item = (icon: IconName, n: number, label: string) => (
    <span className={s.count} title={`${n} ${label}${n === 1 ? '' : 's'}`}><Icon name={icon} size={16} />{n}</span>
  );
  return <div className={s.counts}>{item('excavator', m.circuits, 'circuit')}{item('string', m.strings, 'haul string')}{item('surface', m.assets, 'surface')}</div>;
}

function Thumb({ src, children, foreign }: { src?: string; children?: ReactNode; foreign?: ThumbTheme }) {
  // a thumbnail saved in the other theme is toned to sit on this one (re-saving redraws it in the current theme)
  return (
    <div className={cx(s.thumb, foreign === 'light' && s.fromLight, foreign === 'dark' && s.fromDark)}>
      {src ? <img src={src} alt="" draggable={false} /> : <div className={s.thumbEmpty}><Icon name="surface" size={28} /></div>}
      {children}
    </div>
  );
}

function ScenarioCard({ m, current, now, theme, onDelete }: { m: LibraryMeta; current: boolean; now: number; theme: ThumbTheme; onDelete: (m: LibraryMeta) => void }) {
  const made = m.thumbnailTheme ?? 'light';
  const picked = useScenarioPicks(st => st.ids.includes(m.id));
  const toggle = useScenarioPicks(st => st.toggle);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(m.name);
  const commitName = () => {
    setRenaming(false);
    const v = name.trim();
    if (v && v !== m.name) renameInLibrary(m.id, v);
    else setName(m.name);
  };
  return (
    <article className={cx(s.card, picked && s.picked)}>
      <button type="button" className={s.thumbBtn} onClick={() => openScenario(m.id)} title={`Open “${m.name}”`}>
        <Thumb src={m.thumbnail} foreign={made !== theme ? made : undefined} />
      </button>
      <label className={s.pick} title="Pick for Compare">
        <Check on={picked} onChange={() => toggle(m.id)} />
        <span>Compare</span>
      </label>
      {current && <span className={s.currentTag}><Badge tone="info" icon="eye">Open now</Badge></span>}
      <div className={s.body}>
        {renaming ? (
          <div onBlur={commitName} onKeyDown={e => { if (e.key === 'Escape') { setName(m.name); setRenaming(false); } }}>
            <TextField value={name} onChange={setName} autoFocus onEnter={commitName} />
          </div>
        ) : (
          <h3 className={s.name} title={m.name} onDoubleClick={() => setRenaming(true)}>{m.name}</h3>
        )}
        <div className={s.meta}>Saved {ago(m.savedAt ?? m.updatedAt, now)}{m.siteName ? ` · ${m.siteName}` : ''}</div>
        <Counts m={m} />
        <Kpis k={m.kpis} />
      </div>
      <footer className={s.foot}>
        <Button size="sm" icon="folder" onClick={() => openScenario(m.id)}>Open</Button>
        <span style={{ flex: 1 }} />
        <MenuButton align="right" up items={[
          { label: 'Rename', icon: 'edit', onSelect: () => setRenaming(true) },
          { label: 'Duplicate', icon: 'copy', onSelect: () => duplicateInLibrary(m.id) },
          { label: 'Export .haiul.json', icon: 'download', onSelect: () => exportLibraryScenario(m.id) },
          { separator: true, label: '' },
          { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => onDelete(m) },
        ]}>
          {(open, t) => <Ctl icon="more" small tip="More" tipSide="up" on={open} onClick={t} />}
        </MenuButton>
      </footer>
    </article>
  );
}

/** The open document, shown first while it has unsaved changes or has never been saved. */
function CurrentCard({ inLibrary }: { inLibrary: boolean }) {
  const scenario = useApp(st => st.scenario);
  const dirty = useApp(st => st.dirty);
  const busy = useLibrary(st => st.busy);
  const k = useMemo(() => scenarioKpis(scenario), [scenario]);
  const theme = useDocTheme();
  const [thumb, setThumb] = useState<string>();
  useEffect(() => {
    // after the sheet has animated in; rasterising a large pit takes a moment
    const t = setTimeout(() => { try { setThumb(planThumbnail(scenario, undefined, undefined, theme)); } catch { /* keep placeholder */ } }, 450);
    return () => clearTimeout(t);
  }, [scenario.assets, scenario.strings, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <article className={cx(s.card, s.currentCard)}>
      <Thumb src={thumb}>
        <div className={s.thumbNote}><Icon name="edit" size={16} />{inLibrary ? 'Unsaved changes' : 'Not saved yet'}</div>
      </Thumb>
      <span className={s.currentTag}><Badge tone="info" icon="eye">Open now</Badge></span>
      <div className={s.body}>
        <h3 className={s.name} title={scenario.name}>{scenario.name}</h3>
        <div className={s.meta}>{dirty ? 'Edited this session' : 'Opened this session'}{scenario.site?.name ? ` · ${scenario.site.name}` : ''}</div>
        <Counts m={{ circuits: scenario.circuits.length, strings: scenario.strings.length, assets: scenario.assets.length }} />
        <Kpis k={k} />
      </div>
      <footer className={s.foot}>
        <Button size="sm" variant="primary" icon="save" disabled={busy} onClick={() => saveCurrent()}>Save to library</Button>
        <span style={{ flex: 1 }} />
        <span className={s.hint}>{SAVE_KEYS}</span>
      </footer>
    </article>
  );
}

export function ScenariosView() {
  const { items, loaded, error, refresh } = useLibrary();
  const scenario = useApp(st => st.scenario);
  const dirty = useApp(st => st.dirty);
  const picks = useScenarioPicks(st => st.ids);
  const clearPicks = useScenarioPicks(st => st.clear);
  const setView = useApp(st => st.setView);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [confirm, setConfirm] = useState<LibraryMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const theme = useDocTheme();

  useEffect(() => { refresh(); }, [refresh]);

  const inLibrary = items.some(m => m.id === scenario.id);
  const showCurrent = (dirty || !inLibrary) && (scenario.assets.length > 0 || scenario.strings.length > 0 || scenario.circuits.length > 0);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = needle ? items.filter(m => `${m.name} ${m.siteName ?? ''} ${m.description ?? ''}`.toLowerCase().includes(needle)) : items;
    return sort === 'name' ? [...f].sort((a, b) => a.name.localeCompare(b.name)) : f;
  }, [items, q, sort]);
  const validPicks = picks.filter(id => items.some(m => m.id === id));

  return (
    <div className={s.view}>
      <PageHeader eyebrow="Library" icon="folder" title="Scenarios"
        desc="Saved in this browser on this computer. Export a .haiul.json to share one or move it to another machine." />
      <div className={s.toolbar}>
        <span className={s.search}>
          <Icon name="search" size={18} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search scenarios" aria-label="Search scenarios" />
        </span>
        <Segmented small value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'name', label: 'Name' }]} />
        <span style={{ flex: 1 }} />
        {validPicks.length > 0 && (
          <span className={s.picks}>
            {validPicks.length} picked
            <Button size="sm" variant="ghost" onClick={clearPicks}>Clear</Button>
          </span>
        )}
        <Button icon="compare" variant={validPicks.length >= 2 ? 'primary' : 'secondary'} disabled={validPicks.length < 2}
          title={validPicks.length < 2 ? 'Tick “Compare” on two or more scenarios' : undefined}
          onClick={() => setView('compare')}>
          Compare selected
        </Button>
        <Button icon="upload" onClick={() => fileRef.current?.click()}>Import file</Button>
        <Button icon="plus" onClick={() => newScenario()}>New</Button>
        <input ref={fileRef} type="file" accept=".json,.haiul.json,application/json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) importScenarioFile(f); e.target.value = ''; }} />
      </div>

      {error && <div className={s.error}><Icon name="warning" size={18} />{error}</div>}

      {loaded && !list.length && !showCurrent ? (
        <div className={s.emptyWrap}>
          <Empty icon="folder" title={q ? 'No scenarios match' : 'No saved scenarios yet'}
            action={!q && (
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <Button variant="primary" icon="save" onClick={() => saveCurrent()} disabled={!scenario.assets.length && !scenario.circuits.length}>Save current</Button>
                <Button icon="upload" onClick={() => fileRef.current?.click()}>Import .haiul.json</Button>
              </div>
            )}>
            {q ? 'Try another name.' : `Scenarios you save (${SAVE_KEYS}) are kept in this browser on this computer. Export a .haiul.json to share one or move it to another machine.`}
          </Empty>
        </div>
      ) : (
        <div className={s.grid}>
          {showCurrent && !q && <CurrentCard inLibrary={inLibrary} />}
          {list.map(m => <ScenarioCard key={m.id} m={m} current={m.id === scenario.id} now={now} theme={theme} onDelete={setConfirm} />)}
        </div>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)} width={440} title="Delete scenario?"
        sub={confirm ? `“${confirm.name}” will be removed from this computer. This cannot be undone.` : undefined}
        footer={<>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="primary" icon="trash" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
            onClick={() => { if (confirm) removeScenario(confirm.id); setConfirm(null); }}>Delete</Button>
        </>}>
        <div style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>Tip: export a .haiul.json first if you might want it back.</div>
      </Modal>
    </div>
  );
}
