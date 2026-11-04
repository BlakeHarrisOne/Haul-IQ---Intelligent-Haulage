/**
 * Haulage feature - PUBLIC ENTRY (owner: haulage agent).
 *
 *  HaulageInspector  right-hand panel content (renders its own CardHead / CardBody; the shell provides the glass card)
 *  ProfileStrip      long section of the selected string / circuit, docked full width (~200 px); fills its parent
 *  SectionPanel      vertical section A→B while store.section is set (renders nothing otherwise); fills its parent
 */
import type { ReactElement } from 'react';
import { useApp } from '@/state/store';
import { Overview } from './Overview';
import { CircuitCard } from './CircuitCard';
import { StringEditor } from './StringEditor';
import { AssetCard } from './AssetCard';
import { TruckCard } from './TruckCard';

export { ProfileStrip } from './ProfileStrip';
export { SectionPanel } from './SectionPanel';

export function HaulageInspector(): ReactElement {
  const sel = useApp(st => st.selection);
  switch (sel.kind) {
    case 'circuit': return <CircuitCard key={sel.id} id={sel.id} />;
    case 'string': return <StringEditor key={sel.id} id={sel.id} />;
    case 'asset': return <AssetCard key={sel.id} id={sel.id} />;
    case 'truck': return <TruckCard key={`${sel.circuitId}:${sel.truckIndex}`} circuitId={sel.circuitId} truckIndex={sel.truckIndex} />;
    default: return <Overview />;
  }
}
