/** Static definitions shared by the chrome, keyboard map, command palette and shortcuts sheet. */
import type { CameraMode, ToolId, ViewId } from '@/state/store';
import type { IconName } from '@/ui';

export interface ViewDef { id: ViewId; label: string; short: string; icon: IconName; key: string; title: string; description: string }
export const VIEWS: ViewDef[] = [
  { id: 'site', label: 'Site', short: 'Site', icon: 'surface', key: '1', title: 'Site', description: 'The pit in 3D: surfaces, solids, haul strings, trucks and the shift.' },
  { id: 'assumptions', label: 'Assumptions', short: 'Assumptions', icon: 'assumptions', key: '2', title: 'Assumptions', description: 'Every input and every calculation step, with its source and the spreadsheet cell it mirrors.' },
  { id: 'curves', label: 'Truck curves', short: 'Curves', icon: 'curve', key: '3', title: 'Truck curves', description: 'OEM rimpull and retarder envelopes, the grade–speed tables, and where each haul segment sits on them.' },
  { id: 'compare', label: 'Compare', short: 'Compare', icon: 'compare', key: '4', title: 'Compare', description: 'Scenarios side by side: production, fleet, cycle times, lost PT and crew.' },
  { id: 'manning', label: 'Manning', short: 'Manning', icon: 'crew', key: '5', title: 'Manning', description: 'Crew required by rule for each circuit, against the operators on shift.' },
  { id: 'priority', label: 'Priority', short: 'Priority', icon: 'priority', key: '6', title: 'Priority', description: 'Trucks and crew allocated by circuit priority – what runs, what is reduced or parked, and what it costs.' },
  { id: 'scenarios', label: 'Scenarios', short: 'Scenarios', icon: 'folder', key: '7', title: 'Scenarios', description: 'Saved in this browser on this computer. Export a .haiul.json to share one or move it to another machine.' },
];

export interface ToolDef { id: ToolId; label: string; icon: IconName; key: string; hint: string }
export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', icon: 'select', key: 'V', hint: 'Pick surfaces, strings, points and trucks' },
  { id: 'draw', label: 'Draw haul string', icon: 'string', key: 'D', hint: 'Click to add points on the surface · double-click or Enter to finish' },
  { id: 'edit', label: 'Edit points', icon: 'vertex', key: 'E', hint: 'Drag, insert or delete points of the selected string' },
  { id: 'route', label: 'Auto-route', icon: 'route', key: 'R', hint: 'Click the dig, then the dump – least-cost path over the surface' },
  { id: 'section', label: 'Section', icon: 'section', key: 'X', hint: 'Click A then B for a vertical cross-section' },
  { id: 'measure', label: 'Measure', icon: 'measure', key: 'M', hint: 'Click points for distance and grade' },
];

export interface CameraDef { id: CameraMode; label: string; icon: IconName; key: string; hint: string }
export const CAMERAS: CameraDef[] = [
  { id: 'orbit', label: 'Orbit', icon: 'orbit', key: 'O', hint: 'Free 3D camera' },
  { id: 'plan', label: 'Plan', icon: 'plan', key: 'T', hint: 'Top-down plan view' },
  { id: 'pov', label: 'Driver POV', icon: 'pov', key: 'P', hint: 'Ride in the cab of a truck' },
  { id: 'chase', label: 'Chase', icon: 'chase', key: 'C', hint: 'Follow a truck from behind' },
];

export interface LayerDef { id: string; label: string; icon: IconName; hint: string }
export const SHOW_LAYERS: LayerDef[] = [
  { id: 'contours', label: 'Contours', icon: 'rings', hint: 'Contour lines on the surface' },
  { id: 'grade', label: 'Grade', icon: 'grade', hint: 'Colour haul strings by grade' },
  { id: 'solids', label: 'Solids', icon: 'solid', hint: 'Dig and dump solids' },
  { id: 'trucks', label: 'Trucks', icon: 'truck', hint: 'Trucks, loaders and dozers' },
  { id: 'labels', label: 'Labels', icon: 'pin', hint: 'Names in the scene' },
];

export const SPEEDS = [1, 2, 5, 12, 30, 60, 120];

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
