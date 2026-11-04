/**
 * Scene palettes for the light (day, "survey plot on a seamless backdrop") and dark (night, moonlit) themes.
 * Colours are sRGB hex; THREE.Color linearises them (ColorManagement), so uniforms receive linear values.
 * Backdrop == sky horizon so the model sits on an infinite cyclorama with no visible horizon line.
 */
import * as THREE from 'three';

export type ThemeName = 'light' | 'dark';

export interface PaletteDef {
  skyZenith: string;
  skyHorizon: string;
  /** Ground plane / horizon backdrop (display colour, not tone mapped). */
  backdrop: string;
  /** Lower-horizon "driving" sky for POV/chase. */
  driveZenith: string;
  driveHorizon: string;
  /** Ground far away in POV (fog-matched). */
  driveGround: string;
  sun: string;
  sunIntensity: number;
  sunAzDeg: number;
  sunElDeg: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  exposure: number;
  // terrain albedo
  tLow: string;
  tMid: string;
  tHigh: string;
  tBatter: string;
  tFloor: string;
  tVeg: string;
  ink: string;
  inkAlpha: number;
  gridInk: string;
  gridAlpha: number;
  // skirt strata
  topsoil: string;
  weathered: string;
  rockA: string;
  rockB: string;
  coal: string;
  // ground contact shadow
  contact: number;
  stars: number;
  /** Warm lighting-plant pools at the working faces (night). */
  plantGlow: number;
  glow: string;
  shadowIntensity: number;
  /** Label/overlay ink (2D canvas, CSS). */
  overlayInk: string;
  overlayHalo: string;
}

export const PALETTES: Record<ThemeName, PaletteDef> = {
  light: {
    skyZenith: '#8DB0D6',
    skyHorizon: '#E3E8ED',
    backdrop: '#E3E7EB',
    driveZenith: '#6E9CCB',
    driveHorizon: '#DCE4EB',
    driveGround: '#C9C0B0',
    sun: '#FFF1DC',
    sunIntensity: 3.3,
    sunAzDeg: 240,
    sunElDeg: 36,
    hemiSky: '#C3D4E9',
    hemiGround: '#A39581',
    hemiIntensity: 0.48,
    exposure: 0.96,
    tLow: '#968E81',
    tMid: '#CABDA6',
    tHigh: '#DED3C0',
    tBatter: '#8D806E',
    tFloor: '#73757A',
    tVeg: '#A9A68A',
    ink: '#4A3F33',
    inkAlpha: 0.38,
    gridInk: '#3B4A5C',
    gridAlpha: 0.06,
    topsoil: '#6E5643',
    weathered: '#B8925F',
    rockA: '#ABA190',
    rockB: '#8F8676',
    coal: '#2B2A2B',
    contact: 0.34,
    stars: 0,
    plantGlow: 0,
    glow: '#FFE7C2',
    shadowIntensity: 0.82,
    overlayInk: '#3A3F47',
    overlayHalo: 'rgba(255,255,255,0.7)',
  },
  dark: {
    skyZenith: '#060A12',
    skyHorizon: '#18202C',
    backdrop: '#111821',
    driveZenith: '#070C16',
    driveHorizon: '#1E2836',
    driveGround: '#1A1F26',
    sun: '#B9CCF2',
    sunIntensity: 3.0,
    sunAzDeg: 222,
    sunElDeg: 33,
    hemiSky: '#3A4E70',
    hemiGround: '#1C1A18',
    hemiIntensity: 0.95,
    exposure: 1.05,
    tLow: '#6E6A64',
    tMid: '#A49C90',
    tHigh: '#B9B1A4',
    tBatter: '#7C7468',
    tFloor: '#4A4845',
    tVeg: '#7D7C68',
    ink: '#D6E2F2',
    inkAlpha: 0.5,
    gridInk: '#9FB6D6',
    gridAlpha: 0.045,
    topsoil: '#5A4838',
    weathered: '#977A58',
    rockA: '#8E887D',
    rockB: '#736E65',
    coal: '#151516',
    contact: 0.55,
    stars: 1,
    plantGlow: 1,
    glow: '#9DB7E8',
    shadowIntensity: 0.7,
    overlayInk: '#E9EDF2',
    overlayHalo: 'rgba(10,14,20,0.8)',
  },
};

export interface Palette {
  def: PaletteDef;
  c: Record<string, THREE.Color>;
}

const cache = new Map<ThemeName, Palette>();
export function palette(name: ThemeName): Palette {
  let p = cache.get(name);
  if (!p) {
    const def = PALETTES[name];
    const c: Record<string, THREE.Color> = {};
    for (const [k, v] of Object.entries(def)) if (typeof v === 'string' && v.startsWith('#')) c[k] = new THREE.Color(v);
    p = { def, c };
    cache.set(name, p);
  }
  return p;
}

export function currentTheme(): ThemeName {
  if (typeof document === 'undefined') return 'light';
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Calls back on <html data-theme> changes (and OS scheme changes when no explicit theme). Returns an unsubscribe. */
export function watchTheme(cb: (t: ThemeName) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  let last = currentTheme();
  const fire = () => { const t = currentTheme(); if (t !== last) { last = t; cb(t); } };
  const mo = new MutationObserver(fire);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener('change', fire);
  return () => { mo.disconnect(); mq?.removeEventListener('change', fire); };
}
