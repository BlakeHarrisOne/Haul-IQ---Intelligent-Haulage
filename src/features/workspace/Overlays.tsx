import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Icon, Modal, TextField } from '@/ui';
import { buildCommands, SHORTCUT_GROUPS, type Command } from './commands';
import { fuzzyFilter } from './fuzzy';
import { importFiles } from './importer';
import { useShellUi, ui } from './uiStore';
import p from './palette.module.css';
import s from './shell.module.css';

const keyParts = (k: string) => (k.length > 1 && /^(⌘|Ctrl)/.test(k) ? [k.startsWith('⌘') ? '⌘' : 'Ctrl', ...k.replace(/^(⌘|Ctrl)/, '').split('')] : [k]);

function Highlight({ text, idx }: { text: string; idx: number[] }) {
  if (!idx.length) return <>{text}</>;
  const set = new Set(idx);
  const out: ReactElement[] = [];
  let run = '', on = false;
  const flush = (k: number) => { if (run) out.push(on ? <mark key={k}>{run}</mark> : <Fragment key={k}>{run}</Fragment>); run = ''; };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== on) { flush(i); on = hit; }
    run += text[i];
  }
  flush(text.length);
  return <>{out}</>;
}

// ── command palette (⌘K) ─────────────────────────────────────────────────────────────────────────
export function CommandPalette() {
  const open = useShellUi(st => st.paletteOpen);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cmds = useMemo(() => (open ? buildCommands() : []), [open]);
  const results = useMemo(() => {
    const r = fuzzyFilter(cmds, q, c => [c.title, c.group, ...(c.keywords ?? [])], c => c.rank ?? 0);
    return q.trim() ? r.slice(0, 60) : r;
  }, [cmds, q]);
  useEffect(() => { if (open) { setQ(''); setActive(0); requestAnimationFrame(() => inputRef.current?.focus()); } }, [open]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  if (!open) return null;
  const close = () => ui().set({ paletteOpen: false });
  const run = (c: Command | undefined) => { if (!c || c.disabled) return; close(); setTimeout(() => c.run(), 0); };
  // group only when browsing (empty query); ranked flat list while searching
  let lastGroup = '';
  return createPortal(
    <div className={p.scrim} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className={p.panel} role="dialog" aria-label="Command palette">
        <div className={p.inputRow}>
          <Icon name="search" size={20} />
          <input ref={inputRef} className={p.input} value={q} placeholder="Type a command, view, circuit or string…" aria-label="Search commands"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(results[active]?.item); }
              else if (e.key === 'Escape') { e.preventDefault(); close(); }
            }} />
          <span className={p.kbd}>esc</span>
        </div>
        <div className={p.list} ref={listRef} role="listbox">
          {!results.length && <div className={p.none}>No command matches “{q}”.</div>}
          {results.map((r, i) => {
            const c = r.item;
            const header = !q.trim() && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <Fragment key={c.id}>
                {header && <div className={p.group}>{header}</div>}
                <button type="button" data-i={i} role="option" aria-selected={i === active} disabled={c.disabled}
                  className={`${p.item} ${i === active ? p.active : ''}`} onMouseMove={() => setActive(i)} onClick={() => run(c)}>
                  {c.icon && <Icon name={c.icon} size={18} />}
                  {c.color && <span className={p.dot} style={{ background: c.color }} />}
                  <span className={p.title}><Highlight text={c.title} idx={r.indices} /></span>
                  {q.trim() && <Badge tone="na">{c.group}</Badge>}
                  {c.shortcut && <span className={p.keys}>{keyParts(c.shortcut).map((k, j) => <span key={j} className={p.kbd}>{k}</span>)}</span>}
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className={p.foot}>
          <span><span className={p.kbd}>↑</span><span className={p.kbd}>↓</span>move</span>
          <span><span className={p.kbd}>↵</span>run</span>
          <span style={{ marginLeft: 'auto' }}>{results.length} commands</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── shortcuts sheet (?) ──────────────────────────────────────────────────────────────────────────
export function ShortcutsSheet() {
  const open = useShellUi(st => st.shortcutsOpen);
  return (
    <Modal open={open} onClose={() => ui().set({ shortcutsOpen: false })} width={880} title="Keyboard shortcuts"
      sub="Single keys work whenever you are not typing in a field.">
      <div className={p.sheetGrid}>
        {SHORTCUT_GROUPS.map(g => (
          <div key={g.title} className={p.sGroup}>
            <div className={p.sTitle}>{g.title}</div>
            {g.items.map(it => (
              <div key={it.label} className={p.sRow}>
                <span>{it.label}</span>
                <span className={p.keys}>{it.keys.map((k, i) => <span key={i} className={p.kbd}>{k}</span>)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className={p.mouse}>
        <b>Mouse.</b> Left-drag to orbit, right-drag to pan, wheel to zoom towards the cursor. In Draw, click to add points on the surface and
        double-click or press Enter to finish. In Edit, drag a point to move it; click a segment to insert one.
        <b> Keys.</b> Arrows pan, Shift+←/→ orbit, + and − zoom, F fits the site, N faces north.
      </div>
    </Modal>
  );
}

// ── prompt / confirm dialogs ─────────────────────────────────────────────────────────────────────
export function Dialogs() {
  const prompt = useShellUi(st => st.prompt);
  const confirm = useShellUi(st => st.confirm);
  const [v, setV] = useState('');
  useEffect(() => { if (prompt) setV(prompt.value); }, [prompt]);
  const submit = () => { const val = v.trim(); if (!val || !prompt) return; ui().set({ prompt: undefined }); prompt.onSubmit(val); };
  return (
    <>
      <Modal open={!!prompt} onClose={() => ui().set({ prompt: undefined })} width={480} title={prompt?.title ?? ''} sub={prompt?.sub}
        footer={<><Button onClick={() => ui().set({ prompt: undefined })}>Cancel</Button><Button variant="primary" disabled={!v.trim()} onClick={submit}>{prompt?.okLabel}</Button></>}>
        <div onFocus={e => (e.target as HTMLInputElement).select?.()}><TextField value={v} onChange={setV} autoFocus onEnter={submit} /></div>
      </Modal>
      <Modal open={!!confirm} onClose={() => ui().set({ confirm: undefined })} width={460} title={confirm?.title ?? ''} sub={confirm?.sub}
        footer={<>
          <Button onClick={() => ui().set({ confirm: undefined })}>Cancel</Button>
          <Button variant="primary" style={confirm?.danger ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : undefined}
            onClick={() => { const c = confirm; ui().set({ confirm: undefined }); c?.onOk(); }}>{confirm?.okLabel}</Button>
        </>}>
        <span />
      </Modal>
    </>
  );
}

// ── full-window drop target ──────────────────────────────────────────────────────────────────────
export function useDropTarget() {
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ui().set({ dragging: true }); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ui().set({ dragging: false }); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; ui().set({ dragging: false });
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop);
    };
  }, []);
}

export function DropOverlay() {
  const dragging = useShellUi(st => st.dragging);
  if (!dragging) return null;
  return (
    <div className={s.drop}>
      <div className={s.dropBox}>
        <span className={s.dropIco}><Icon name="upload" size={30} /></span>
        <div className={s.dropTitle}>Drop to add to the scenario</div>
        <div style={{ color: 'var(--ink-2)' }}>Files are read on this computer – nothing is uploaded.</div>
        <div className={s.dropTypes}>
          <Badge tone="info" icon="surface">Surfaces .00t</Badge>
          <Badge tone="info" icon="solid">Dig / dump solids .00t</Badge>
          <Badge tone="info" icon="string">Strings .str .csv .txt</Badge>
          <Badge tone="info" icon="file">Scenario .haiul.json</Badge>
        </div>
      </div>
    </div>
  );
}
