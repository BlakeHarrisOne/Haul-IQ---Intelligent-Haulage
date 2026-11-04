/**
 * Geometry-module types shared by src/geom/** and src/io/** (re-exported from '@/geom').
 * Units: metres; world coordinates are site grid [E, N, Z] unless a name says otherwise.
 */
import type { Vec3 } from '@/core/types';

/** Plan point [E, N] in metres. */
export type Vec2 = [number, number];

/** Anything with world coordinates as named fields (StringPoint satisfies it). */
export interface XYZ { e: number; n: number; z: number }

/**
 * Regular height grid (raster). Node (i, j) sits at (x0 + i·dx, y0 + j·dx) and its height is z[j·nx + i]
 * in metres RL; NaN marks nodes off the surface.
 */
export interface Grid {
  /** Easting of node column 0 (m). */
  x0: number;
  /** Northing of node row 0 (m). */
  y0: number;
  /** Node spacing in both directions (m). */
  dx: number;
  nx: number;
  ny: number;
  /** Heights (m RL), row-major by northing; NaN = no surface. */
  z: Float32Array;
}

/**
 * A plane in world coordinates: points p with normal·p = constant.
 * `normal` should be unit length (functions normalise it when it is not).
 * The FRONT side is normal·p > constant, the BACK side normal·p < constant.
 */
export interface Plane { normal: Vec3; constant: number }
