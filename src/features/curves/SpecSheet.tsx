import { Badge, Card, CardHead, Icon } from '@/ui';
import { QUALITY_LABEL, qualityTone, sourcesOf, specRows, libraryProvenance } from './oem';
import type { TruckX } from './physics';
import c from './curves.module.css';

/** Spec sheet with per-field provenance (OEM / OEM-derived / 3rd party / estimated) and source links. */
export function SpecSheet({ t, color }: { t: TruckX; color: string }) {
  const rows = specRows(t);
  const src = sourcesOf(t);
  const est = rows.filter(r => r.quality === 'estimated').length;
  return (
    <Card>
      <CardHead title={t.name} sub="spec sheet" icon="truck" actions={<Badge tone={est ? 'warn' : 'ok'} icon={est ? 'warning' : 'tick'}>{est} estimated</Badge>} />
      <table className={c.specTable}>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>
                <div className={c.specVal} style={{ whiteSpace: 'normal' }}>{r.value}</div>
                {r.note && <div className={c.specNote} title={r.note}>{r.note}</div>}
              </td>
              <td><Badge tone={qualityTone(r.quality)} title={qualityTitle(r.quality)}>{QUALITY_LABEL[r.quality]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.estimationMethod && (
        <details className={c.method}>
          <summary>How the estimated curves were built</summary>
          <p style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>{t.estimationMethod}</p>
          {libraryProvenance() && <p style={{ margin: '6px 0 0', color: 'var(--ink-3)' }}>{libraryProvenance()}</p>}
        </details>
      )}
      {src.length > 0 && (
        <>
          <div style={{ padding: '4px 16px 4px', fontSize: 12, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>Sources</div>
          <ul className={c.sources}>
            {[...new Set(src.map(x => x.field))].map(field => (
              <li key={field}>
                <span className={c.srcField}>{field}</span>
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                  {src.filter(x => x.field === field).map((x, i) => x.url
                    ? <a key={i} href={x.url} target="_blank" rel="noreferrer noopener" title={x.url}>{x.title}<Icon name="external" size={12} /></a>
                    : <span key={i}>{x.title}</span>)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div style={{ height: 4, background: color, opacity: 0.9 }} aria-hidden />
    </Card>
  );
}

function qualityTitle(q: string) {
  switch (q) {
    case 'oem': return 'Read from an OEM / OEM-dealer spec sheet (captured from web extracts; verify against the PDF page)';
    case 'oem_derived': return 'Arithmetic on OEM values';
    case 'third_party': return 'Spec aggregator, dealer listing or hire company';
    case 'estimated': return 'Estimated by the documented method (docs/spec/04 §G.2) — calibrate before committing a plan';
    default: return 'Provenance not recorded';
  }
}
