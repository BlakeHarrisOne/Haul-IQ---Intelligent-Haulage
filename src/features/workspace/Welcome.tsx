import { useMemo } from 'react';
import { useApp } from '@/state/store';
import { num } from '@/core/format';
import { ago, discardRecovery, openScenario, restoreRecovery, useLibrary } from '@/features/scenarios';
import { Button, Icon } from '@/ui';
import { MOD } from './defs';
import { cmdLoadDemo } from './actions';
import { pickFiles, pickMeshes, pickScenarioFile } from './importer';
import { useNow } from './hooks';
import { useShellUi } from './uiStore';
import w from './welcome.module.css';

/** Deterministic topographic contours drawn behind the welcome card (a quiet survey-plot ground). */
function Contours() {
  const paths = useMemo(() => {
    const hills = [{ x: 0.2, y: 0.28, r: 0.05, n: 9, ph: 0.3 }, { x: 0.82, y: 0.7, r: 0.04, n: 11, ph: 1.7 }, { x: 0.62, y: 0.12, r: 0.03, n: 6, ph: 2.9 }];
    const out: string[] = [];
    for (const h of hills) {
      for (let k = 0; k < h.n; k++) {
        const R = h.r + k * 0.034;
        let d = '';
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          const wob = 1 + 0.16 * Math.sin(3 * a + h.ph + k * 0.35) + 0.09 * Math.sin(5 * a - h.ph * 1.3 + k * 0.2) + 0.05 * Math.sin(9 * a + k);
          const x = (h.x + Math.cos(a) * R * wob * 1.25) * 1600, y = (h.y + Math.sin(a) * R * wob) * 1000;
          d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        out.push(d + 'Z');
      }
    }
    return out;
  }, []);
  return (
    <svg className={w.contours} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d, i) => <path key={i} d={d} strokeWidth={i % 5 === 4 ? 1.4 : 0.8} />)}
    </svg>
  );
}

/** The empty state: shown over the stage while the scenario has no surfaces. */
export function Welcome() {
  const items = useLibrary(st => st.items);
  const recovery = useLibrary(st => st.recovery);
  const demoLoading = useShellUi(st => st.demoLoading);
  const setView = useApp(st => st.setView);
  const now = useNow();
  const recent = items.slice(0, 4);
  return (
    <div className={w.wrap}>
      <Contours />
      <div className={w.card} role="dialog" aria-label="Start a scenario">
        <div className={w.head}>
          <div className={w.eyebrow}><Icon name="sparkle" size={16} />Haulage planning, every number traced</div>
          <h2 className={w.title}>Plan the haul. <em>See the shift.</em></h2>
          <p className={w.lede}>
            Bring in a Vulcan pit surface and your dig and dump solids, draw the haul, and hAIul SIM sizes the fleet,
            plays the shift and shows the lost PT – with the working behind every figure. Files stay on this computer.
          </p>
        </div>
        {recovery && (
          <div className={w.recover}>
            <Icon name="warning" size={18} />
            <span style={{ flex: 1 }}>Unsaved work found: <b>{recovery.scenario.name}</b> · {ago(recovery.at, now)}</span>
            <Button size="sm" onClick={() => discardRecovery()}>Discard</Button>
            <Button size="sm" variant="primary" onClick={() => restoreRecovery()}>Restore</Button>
          </div>
        )}
        <div className={w.body}>
          <button type="button" className={w.demo} onClick={() => { void cmdLoadDemo(); }} disabled={demoLoading}>
            <span className={w.demoIco}><Icon name={demoLoading ? 'spin' : 'sparkle'} size={24} strokeWidth={2} className={demoLoading ? w.spinning : undefined} /></span>
            <span>
              <div className={w.tTitle}>{demoLoading ? 'Building the demo pit…' : 'Open the demo site'}</div>
              <div className={w.tSub}>A Queensland strip coal pit with three circuits, a day shift and a crew roster – explore everything.</div>
            </span>
            <Icon name="right" className={w.go} />
          </button>
          <div className={w.tiles}>
            <button type="button" className={w.tile} onClick={() => pickFiles('.00t', false)}>
              <Icon name="surface" size={28} />
              <span style={{ minWidth: 0 }}><div className={w.tTitle}>Pit surface</div><div className={w.tSub}>Vulcan .00t</div></span>
            </button>
            <button type="button" className={w.tile} onClick={pickMeshes}>
              <Icon name="solid" size={28} />
              <span style={{ minWidth: 0 }}><div className={w.tTitle}>Dig &amp; dump solids</div><div className={w.tSub}>Vulcan .00t</div></span>
            </button>
            <button type="button" className={w.tile} onClick={pickScenarioFile}>
              <Icon name="folder" size={28} />
              <span style={{ minWidth: 0 }}><div className={w.tTitle}>Saved scenario</div><div className={w.tSub}>.haiul.json file</div></span>
            </button>
          </div>
          <div className={w.drop}>or drop files anywhere on the window</div>
        </div>
        {recent.length > 0 && (
          <div className={w.recent}>
            <div className={w.recentHead}>
              Recent
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" iconRight="right" onClick={() => setView('scenarios')}>All scenarios</Button>
            </div>
            {recent.map(m => (
              <button key={m.id} type="button" className={w.rItem} onClick={() => { void openScenario(m.id); }}>
                {m.thumbnail ? <img className={w.rThumb} src={m.thumbnail} alt="" /> : <span className={w.rThumb} />}
                <span style={{ minWidth: 0 }}>
                  <div className={w.rName}>{m.name}</div>
                  <div className={w.rMeta}>Saved {ago(m.savedAt ?? m.updatedAt, now)} · {m.circuits} circuits · {m.strings} strings</div>
                </span>
                {m.kpis && <span className={w.rKpi}>{num(m.kpis.bcmDay)} <i>bcm/d</i><br />{num(m.kpis.trucks)} <i>trucks</i></span>}
              </button>
            ))}
          </div>
        )}
        <div className={w.foot}>
          <span><span className={w.kbd}>{MOD}</span><span className={w.kbd}>K</span> commands</span>
          <span style={{ marginLeft: 10 }}><span className={w.kbd}>?</span> shortcuts</span>
          <span style={{ flex: 1 }} />
          <span>Nothing leaves this computer.</span>
        </div>
      </div>
    </div>
  );
}
