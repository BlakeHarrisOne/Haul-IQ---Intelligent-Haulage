/**
 * Materials with bank densities and swell from the workbook's Transcale studies (spec 01 §7.3):
 * BCM density = t/LCM × 1.2 (ActiveRoute!AD4 "Swelled to get bank density"), so swell = 1.2 lcm/bcm for all.
 */
import type { Material } from '@/core/types';

export const DEFAULT_MATERIALS: Material[] = [
  { id: 'OB', name: 'Overburden', bankDensity: 1.728, swell: 1.2, color: '#9C7A54' },
  { id: 'CL', name: 'Coal', bankDensity: 1.176, swell: 1.2, color: '#2A2B30' },
  { id: 'IB', name: 'Interburden', bankDensity: 1.944, swell: 1.2, color: '#B59572' },
  { id: 'PT', name: 'Parting', bankDensity: 1.956, swell: 1.2, color: '#7D6A58' },
];

/** Where each density comes from (for CalcStep / Assumptions sources). */
export const MATERIAL_SOURCES: Record<string, string> = {
  OB: 'Transcale 2025 (789D custom tray) Overburden 1.44 t/LCM × 1.2 = 1.728 t/bcm (ActiveRoute!AJ8)',
  CL: 'Transcale 2025 MA1 Coal 0.98 t/LCM × 1.2 = 1.176 t/bcm (ActiveRoute!AJ9)',
  IB: 'Transcale 2024 Cat 789C Interburden 1.62 t/LCM × 1.2 = 1.944 t/bcm (ActiveRoute!AD10)',
  PT: 'Transcale 2025 Parting 1.63 t/LCM × 1.2 = 1.956 t/bcm (ActiveRoute!AJ7)',
};
