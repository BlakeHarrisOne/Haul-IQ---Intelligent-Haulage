/**
 * Shift-clock environment: the sun (and moon) at the clock time on screen, independent of the UI theme.
 *
 *  - clock hour = scenario.shift.startHour + timeline.tMin / 60 (wraps at 24 h);
 *  - sun position from a fixed Bowen Basin latitude (−23°) and a November declination (−15°): sunrise ≈ 05:34,
 *    sunset ≈ 18:26, so a 06:00–18:00 day shift opens and closes in low golden light and stays daylit;
 *  - `daylight` blends over civil twilight (−7° … +4° elevation); true night lighting (terrain ≈ ×0.35, stars,
 *    lighting-plant pools, headlights) only when the clock is at night;
 *  - the theme only tints the result: dark = darker backdrop and a dusk-toned (but still daylit) sky by day
 *    (Rain Model's "dark theme: dimmer so the HUD glass reads" rule).
 */
import * as THREE from 'three';
import type { Palette, ThemeName } from './theme';

/** Public, read-only state for modules (cockpit headlights, actors' lamps). */
export interface SceneEnv {
  /** Clock hour on screen (0 ≤ h < 24, fractional). */
  hour: number;
  /** True sun elevation (deg, negative below the horizon) and azimuth (deg clockwise from grid north). */
  sunElDeg: number;
  sunAzDeg: number;
  /** 1 = full day, 0 = night (civil-twilight blend). */
  daylight: number;
  /** 1 − daylight. */
  night: number;
  /** Vehicles should run their headlights (night > 0.4). */
  headlights: boolean;
  /** Unit vector towards the key light (sun by day, moon by night) in scene space (x = E, y = up, z = −N). */
  lightDir: [number, number, number];
  /** UI theme the scene is tinted for. */
  theme: ThemeName;
}

/** Everything the renderer needs for one clock time + theme (linear colours). */
export interface Lighting {
  env: SceneEnv;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  shadowIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  driveZenith: THREE.Color;
  driveHorizon: THREE.Color;
  driveGround: THREE.Color;
  backdrop: THREE.Color;
  glow: THREE.Color;
  sunAmt: number;
  stars: number;
  cloud: number;
  exposure: number;
  /** Terrain albedo multiplier (night ≈ 0.6; the dim moon does the rest). */
  terrainMul: number;
  /** Contour ink + strength for the current light (dark ink by day, light ink at night). */
  ink: THREE.Color;
  inkAlpha: number;
  /** Lighting-plant pools at the working faces (0 by day). */
  plantGlow: number;
}

const D2R = Math.PI / 180;
const LAT = -23 * D2R;
const DEC = -15 * D2R;

/** Wrap an hour to [0, 24). */
export const wrapHour = (h: number) => ((h % 24) + 24) % 24;

/** Sun direction in local ENU (east, north, up) for a solar-clock hour. */
export function sunENU(hour: number, out: [number, number, number] = [0, 0, 1]): [number, number, number] {
  const H = (wrapHour(hour) - 12) * 15 * D2R;
  out[0] = -Math.cos(DEC) * Math.sin(H);
  out[1] = Math.sin(DEC) * Math.cos(LAT) - Math.cos(DEC) * Math.cos(H) * Math.sin(LAT);
  out[2] = Math.sin(DEC) * Math.sin(LAT) + Math.cos(DEC) * Math.cos(H) * Math.cos(LAT);
  return out;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const C = (hex: string) => new THREE.Color(hex);
// day / golden-hour / night references (sRGB hex → linear via THREE.Color)
const DAY = {
  light: { zen: C('#8DB0D6'), hor: C('#E3E8ED'), back: C('#E3E7EB'), dZen: C('#6E9CCB'), dHor: C('#DCE4EB'), dGround: C('#C9C0B0') },
  dark: { zen: C('#3E546E'), hor: C('#7D8794'), back: C('#111821'), dZen: C('#36506E'), dHor: C('#8A929C'), dGround: C('#5C574E') },
};
const GOLD = { hor: C('#F1C9A2'), zen: C('#6F8FB8'), sun: C('#FFB27A') };
const NIGHT = {
  light: { zen: C('#0B1322'), hor: C('#1F2A3C'), back: C('#18202C') },
  dark: { zen: C('#060A12'), hor: C('#18202C'), back: C('#0E141C') },
};
const SUN_NOON = C('#FFF1DC');
const SUN_DUSK_DARK = C('#FFD9AE');
const MOON = C('#AFC2EA');
const HEMI = { daySky: C('#C3D4E9'), dayGround: C('#A39581'), nightSky: C('#3A4E70'), nightGround: C('#1C1A18') };
const INK_DAY = C('#3A3128'), INK_NIGHT = C('#D6E2F2');
const GLOW_DAY = C('#FFE7C2'), GLOW_NIGHT = C('#9DB7E8');

/** Scene-space unit vector for an azimuth (deg cw from north) and elevation (deg). */
export function dirAzEl(azDeg: number, elDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = azDeg * D2R, e = elDeg * D2R;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

/** One allocation-free Lighting object per SceneCore, refilled by `computeLighting`. */
export function makeLighting(): Lighting {
  return {
    env: { hour: 12, sunElDeg: 60, sunAzDeg: 0, daylight: 1, night: 0, headlights: false, lightDir: [0, 1, 0], theme: 'light' },
    sunDir: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(), sunIntensity: 3, shadowIntensity: 0.8,
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0.5,
    skyZenith: new THREE.Color(), skyHorizon: new THREE.Color(), driveZenith: new THREE.Color(), driveHorizon: new THREE.Color(),
    driveGround: new THREE.Color(), backdrop: new THREE.Color(), glow: new THREE.Color(), sunAmt: 1, stars: 0, cloud: 0.32,
    exposure: 1, terrainMul: 1, ink: new THREE.Color(), inkAlpha: 0.4, plantGlow: 0,
  };
}

const enu: [number, number, number] = [0, 0, 1];
const MOON_DIR = dirAzEl(300, 42);
const tmpC = new THREE.Color();

/**
 * Fill `L` for a clock hour and palette. The key light's elevation is clamped to 12–62° for legibility (no pit
 * lost in a 2° shadow at 06:00, some modelling at noon); colours, intensity and the sky glow use the true sun.
 */
export function computeLighting(L: Lighting, hour: number, pal: Palette, theme: ThemeName): Lighting {
  const h = wrapHour(hour);
  sunENU(h, enu);
  const el = Math.asin(Math.max(-1, Math.min(1, enu[2]))) / D2R;
  const az = ((Math.atan2(enu[0], enu[1]) / D2R) + 360) % 360;
  const day = smooth(-7, 4, el);
  const night = 1 - day;
  const gold = day * (1 - smooth(2, 22, el));
  const dark = theme === 'dark';
  const d = pal.def;
  const D = dark ? DAY.dark : DAY.light, N = dark ? NIGHT.dark : NIGHT.light;

  // key light: sun by day (clamped elevation, intensity compensated so flat ground stays about as bright as at noon:
  // a planning view, not a game), moon (fixed, NW high) by night
  const lightEl = Math.min(62, Math.max(24, el));
  const comp = Math.min(1.7, Math.sin(62 * D2R) / Math.sin(lightEl * D2R));
  if (night > 0.5) L.sunDir.copy(MOON_DIR); else dirAzEl(az, lightEl, L.sunDir);
  // sun colour: warm and dim near the horizon; dusk-toned in the dark theme
  L.sunColor.copy(dark ? SUN_DUSK_DARK : SUN_NOON).lerp(GOLD.sun, gold * 0.45);
  if (night > 0.5) L.sunColor.copy(MOON);
  const sunUp = smooth(-3, 9, el);
  const dayI = d.sunIntensity * (dark ? 0.9 : 1) * comp * (0.78 + 0.22 * sunUp);
  // the key light fades to nothing at the sun → moon hand-over (no shadow jump)
  L.sunIntensity = night > 0.5 ? 1.1 * smooth(0.5, 1, night) : dayI * smooth(0.5, 1, day);
  L.shadowIntensity = night > 0.5 ? 0.55 : d.shadowIntensity * (0.6 + 0.4 * sunUp);
  L.hemiSky.copy(HEMI.nightSky).lerp(HEMI.daySky, day);
  L.hemiGround.copy(HEMI.nightGround).lerp(HEMI.dayGround, day);
  L.hemiIntensity = THREE.MathUtils.lerp(0.5, d.hemiIntensity * (dark ? 0.92 : 1) * (1 + 0.25 * gold), day);

  // sky: day → golden hour → night, theme tint
  L.skyZenith.copy(D.zen).lerp(GOLD.zen, gold * (dark ? 0.35 : 0.45));
  L.skyHorizon.copy(D.hor).lerp(GOLD.hor, gold * (dark ? 0.4 : 0.55));
  L.skyZenith.lerp(N.zen, night);
  L.skyHorizon.lerp(N.hor, night);
  L.driveZenith.copy(D.dZen).lerp(GOLD.zen, gold * 0.4).lerp(N.zen, night);
  L.driveHorizon.copy(D.dHor).lerp(GOLD.hor, gold * 0.5).lerp(N.hor, night);
  L.driveGround.copy(D.dGround).lerp(tmpC.copy(N.back).multiplyScalar(1.4), night);
  L.backdrop.copy(D.back).lerp(N.back, night);
  L.glow.copy(GLOW_NIGHT).lerp(GLOW_DAY, day);
  L.sunAmt = day > 0.02 ? (dark ? 0.8 : 1) * sunUp : 0.35;
  L.stars = smooth(0.35, 0.9, night);
  L.cloud = THREE.MathUtils.lerp(0.12, dark ? 0.24 : 0.32, day);
  L.exposure = THREE.MathUtils.lerp(1.05, d.exposure * (dark ? 0.92 : 1), day);
  L.terrainMul = THREE.MathUtils.lerp(0.6, 1, day);
  L.ink.copy(INK_NIGHT).lerp(INK_DAY, day);
  L.inkAlpha = THREE.MathUtils.lerp(0.75, d.inkAlpha, day);
  L.plantGlow = smooth(0.45, 0.95, night);

  const e = L.env;
  e.hour = h; e.sunElDeg = el; e.sunAzDeg = az; e.daylight = day; e.night = night; e.headlights = night > 0.4; e.theme = theme;
  e.lightDir[0] = L.sunDir.x; e.lightDir[1] = L.sunDir.y; e.lightDir[2] = L.sunDir.z;
  return L;
}
