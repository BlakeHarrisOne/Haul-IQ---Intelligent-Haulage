import { useApp } from '@/state/store';
import { Chrome, ChromeSep, Ctl, Icon, cx } from '@/ui';
import { CAMERAS, TOOLS } from './defs';
import { setCameraMode } from './commands';
import { sceneFit } from './sceneBridge';
import s from './shell.module.css';

/** Left vertical rail: tools · camera modes · fit. */
export function ToolRail() {
  const tool = useApp(st => st.tool);
  const setTool = useApp(st => st.setTool);
  const camera = useApp(st => st.camera);
  return (
    <Chrome vertical className={cx(s.rail, s.fadeT, s.siteOnly)}>
      {TOOLS.map(t => (
        <Ctl key={t.id} icon={t.icon} on={tool === t.id} onClick={() => setTool(t.id)} tip={t.label} shortcut={t.key} tipSide="right" />
      ))}
      <ChromeSep />
      {CAMERAS.map(c => (
        <Ctl key={c.id} icon={c.icon} on={camera === c.id} onClick={() => setCameraMode(c.id)} tip={`${c.label} camera`} shortcut={c.key} tipSide="right" />
      ))}
      <ChromeSep />
      <Ctl icon="fit" onClick={() => sceneFit()} tip="Fit the site" shortcut="F" tipSide="right" />
    </Chrome>
  );
}

/** A quiet one-line hint next to the rail while a drawing tool is active. */
export function ToolHint() {
  const tool = useApp(st => st.tool);
  const setTool = useApp(st => st.setTool);
  const def = TOOLS.find(t => t.id === tool);
  if (!def || tool === 'select') return null;
  return (
    <div className={cx(s.railHint, s.fadeT, s.siteOnly)} key={tool}>
      <Icon name={def.icon} size={18} style={{ color: 'var(--accent)' }} />
      <span><b>{def.label}</b> · {def.hint}</span>
      <Ctl icon="x" small tip="Back to Select (V)" onClick={() => setTool('select')} />
    </div>
  );
}
