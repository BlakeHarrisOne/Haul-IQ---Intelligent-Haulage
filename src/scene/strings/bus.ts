/**
 * In-process bus shared by the actors / strings / tools / cockpit scene modules mounted on one SceneContext.
 * (They are separate SceneModules; this is how they exchange picking functions, live edit previews and the
 * followed truck's state without touching the store on every frame.)
 */
import type { SceneContext } from '../context';
import type { HaulString, Id, StringPoint } from '@/core/types';
import type { PathTable } from './path';

export type TruckPhase = 'queue' | 'spot' | 'load' | 'haul' | 'dump' | 'return' | 'parked';

/** What the cockpit / truck card need to know about one truck at the current time. */
export interface TruckInfo {
  circuitId: Id;
  truckIndex: number;
  unitId: string;
  phase: TruckPhase;
  speedKmh: number;
  loaded: boolean;
  /** Chainage along the haul string (m, path scale; 0 = dig). */
  chainage: number;
  /** +1 travelling towards the dump, −1 towards the dig, 0 stationary. */
  dir: 1 | -1 | 0;
  /** Seconds until this phase ends. */
  phaseRemainS: number;
  /** Seconds until the truck next reaches the dump (0 while dumping). */
  etaDumpS: number;
  /** Grade under the truck in its direction of travel (fraction). */
  grade: number;
  limit?: string;
  pathLength: number;
  /** Chainage of the next stop sign ahead in the direction of travel, if any. */
  nextStopM?: number;
  stringId?: Id;
  modelName: string;
  materialName?: string;
  /** Screen position of the truck's roof (CSS px), null when off-screen. */
  screen?: { x: number; y: number } | null;
}

export interface StringHit { stringId: Id; pointIndex?: number; segIndex?: number; chainage?: number; distPx: number }

export interface Bus {
  /** Live point overrides while a tool drags / inserts (not yet committed). */
  preview: Map<Id, StringPoint[]>;
  /** Strings drawn by a tool that are not in the scenario yet (draw-tool preview uses its own overlay instead). */
  setPreview(id: Id, pts: StringPoint[] | null): void;
  /** Point index hovered by the edit tool (handles grow a halo). */
  hoverPoint: { stringId: Id; index: number } | null;
  dragPoint: { stringId: Id; index: number } | null;
  /** Picking provided by the strings module (screen space). */
  pickString?: (x: number, y: number, opts?: { tolPx?: number; onlyId?: Id }) => StringHit | null;
  /** Picking provided by the actors module (screen space). */
  pickTruck?: (x: number, y: number) => { circuitId: Id; truckIndex: number } | null;
  /** Path table of a string (respects previews). */
  pathOf?: (id: Id) => PathTable | null;
  /** The followed (POV / chase / selected) truck, published by the actors module each frame. */
  followed: TruckInfo | null;
  /** Called by modules that changed something drawn by another (e.g. preview → strings rebuild). */
  listeners: Set<() => void>;
  emit(): void;
  /** Strings visible in the scene (for snapping). */
  strings(): HaulString[];
}

const buses = new WeakMap<SceneContext, Bus>();

export function busOf(ctx: SceneContext): Bus {
  let b = buses.get(ctx);
  if (!b) {
    const bus: Bus = {
      preview: new Map(),
      setPreview(id, pts) {
        if (pts) bus.preview.set(id, pts); else bus.preview.delete(id);
        bus.emit();
      },
      hoverPoint: null,
      dragPoint: null,
      followed: null,
      listeners: new Set(),
      emit() { for (const l of bus.listeners) l(); ctx.requestRender(); },
      strings: () => [],
    };
    b = bus;
    buses.set(ctx, b);
  }
  return b;
}
