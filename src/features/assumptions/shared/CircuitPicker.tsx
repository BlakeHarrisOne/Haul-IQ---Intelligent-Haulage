import type { Circuit, Id } from '@/core/types';
import { Dot, Segmented, Select, circuitColor } from '@/ui';

/** Circuit selector: segmented tabs with circuit colours (≤ 5 circuits) or a select for larger scenarios. */
export function CircuitPicker({ circuits, value, onChange }: { circuits: Circuit[]; value: Id | undefined; onChange: (id: Id) => void }) {
  if (!circuits.length) return null;
  if (circuits.length > 5) {
    return <Select value={value ?? circuits[0].id} onChange={onChange} options={circuits.map(c => ({ value: c.id, label: c.name }))} width={280} title="Circuit" />;
  }
  return (
    <Segmented
      value={value ?? circuits[0].id}
      onChange={onChange}
      style={{ width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}
      options={circuits.map(c => ({
        value: c.id,
        title: c.active ? c.name : `${c.name} (inactive)`,
        label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, opacity: c.active ? 1 : 0.6 }}><Dot color={circuitColor(c.color)} />{c.name}</span>,
      }))}
    />
  );
}
