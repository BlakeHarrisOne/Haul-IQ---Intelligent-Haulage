/**
 * Default 12 h day-shift profile (spec 04 §D.1, [EST], all editable). Weighted stops total 120 min, so the fleet
 * has 600 productive minutes = 10 PT h per shift = 20 PT h/day over 2 shifts (the workbook's I34).
 */
import type { ShiftProfile } from '@/core/types';

export function defaultShiftProfile(): ShiftProfile {
  return {
    name: 'Day shift',
    startHour: 6,
    lengthH: 12,
    events: [
      { id: 'ev-prestart', label: 'Shift change & prestart', kind: 'prestart', startMin: 0, durMin: 30, fleetStopFraction: 1 },
      { id: 'ev-crib1', label: 'Crib 1', kind: 'crib', startMin: 180, durMin: 30, fleetStopFraction: 1 },
      { id: 'ev-fuel', label: 'Fuel & lube (rolling, ~15 min per truck)', kind: 'fuel', startMin: 270, durMin: 60, fleetStopFraction: 0.25 },
      { id: 'ev-crib2', label: 'Crib 2', kind: 'crib', startMin: 420, durMin: 30, fleetStopFraction: 1 },
      { id: 'ev-parkup', label: 'End-of-shift park-up', kind: 'changeover', startMin: 705, durMin: 15, fleetStopFraction: 1 },
    ],
  };
}
