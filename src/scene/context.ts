/**
 * Scene contract between the two scene builders:
 *  - scene CORE (src/scene/core/**, src/scene/index.tsx, src/scene/api.ts): renderer, loop, cameras/controls, lights,
 *    sky/atmosphere, terrain, solids + depletion, section plane, picking, post-processing, screenshots. It creates the
 *    SceneContext and mounts every module listed in src/scene/modules.ts.
 *  - scene ACTORS & TOOLS (src/scene/actors/**, src/scene/strings/**, src/scene/tools/**, src/scene/cockpit/**,
 *    src/scene/modules.ts): haul strings + handles, trucks/loaders/dozers and their animation, drawing/editing tools,
 *    POV cockpit overlay. They only touch the scene through this context.
 * World ↔ scene conversion: core/frame.ts (x = E − E0, y = (Z − Z0)·VE, z = −(N − N0)).
 */
import type * as THREE from 'three';
import type { Frame } from '@/core/frame';
import type { Vec3 } from '@/core/types';

export type PointerKind = 'down' | 'move' | 'up' | 'click' | 'dblclick' | 'leave' | 'wheel' | 'contextmenu';

export interface ScenePointer {
  kind: PointerKind;
  event: PointerEvent | MouseEvent | WheelEvent;
  /** Canvas-relative CSS pixels. */
  x: number;
  y: number;
  /** Normalised device coords (−1..1). */
  ndc: THREE.Vector2;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

/** A pose the POV / chase cameras ride (provided by the actors module for the followed truck). */
export interface FollowTarget {
  /** Scene-space position of the vehicle's ground point under the front axle centre. */
  position: THREE.Vector3;
  /** Heading in scene space, radians (0 = +x / east, positive towards −z / north). */
  heading: number;
  /** Pitch of the vehicle, radians (positive nose-up). */
  pitch: number;
  /**
   * Driver eye offset in the vehicle frame, metres: `height` above the ground, `back` = distance BEHIND `position`
   * (the front-axle ground point) along the heading, `right` = to the right of the centreline (negative = left-hand cab).
   */
  eye: { height: number; back: number; right: number };
  speedKmh: number;
  loaded: boolean;
  label: string;
  /** e.g. 'cat789' | 'hd1500' - lets the cockpit overlay pick a cab shape. */
  cabKind: string;
}

export interface SceneContext {
  three: typeof THREE;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The camera currently rendering (changes with camera mode). */
  camera(): THREE.Camera;
  canvas: HTMLCanvasElement;
  /** A transparent 2D canvas over the WebGL canvas (same CSS size; devicePixelRatio-scaled) for overlays. */
  overlay: HTMLCanvasElement;
  /** A DOM layer over the canvas for HTML labels (pointer-events: none; children may opt in). Hidden by the Labels toggle. */
  labelLayer: HTMLDivElement;
  /**
   * A DOM layer above the labels for tool hints and the POV HUD - never hidden by the Labels toggle.
   * Optional until every core implements it: modules fall back to `labelLayer`.
   */
  hudLayer?: HTMLDivElement;
  frame(): Frame;
  /** Named groups the modules add their objects to. */
  layers: Record<'terrain' | 'solids' | 'strings' | 'actors' | 'tools' | 'labels' | 'fx', THREE.Group>;
  /** Ask for a frame (the loop renders on demand when nothing animates). */
  requestRender(): void;
  /** Keep rendering every frame while `active()` returns true (e.g. playback). Returns an unsubscribe. */
  keepAlive(active: () => boolean): () => void;
  /** Per-frame callback (dt seconds, now ms) - called before each render. Returns an unsubscribe. */
  onFrame(cb: (dt: number, now: number) => void): () => void;
  /** Overlay drawing pass after the 3D render (2D canvas, already cleared and DPR-scaled). */
  onOverlay(cb: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): () => void;
  /** Pointer events, routed to handlers in registration order before camera controls; return true to consume. */
  onPointer(cb: (p: ScenePointer) => boolean | void): () => void;
  /** Keyboard events while the viewport is focused/hovered; return true to consume. */
  onKey(cb: (e: KeyboardEvent) => boolean | void): () => void;
  /** Ray-cast the topo terrain at canvas pixel → world [E, N, Z] (null when off-surface). */
  pickTerrain(x: number, y: number): Vec3 | null;
  /** Ray-cast arbitrary objects at canvas pixel. */
  pick(x: number, y: number, objects: THREE.Object3D[], recursive?: boolean): THREE.Intersection[];
  /** Height of the topo surface at a world plan point (geom height index), null when off-surface. */
  heightAt(e: number, n: number): number | null;
  /** World → canvas pixel (null when behind the camera). */
  project(world: Vec3): { x: number; y: number } | null;
  /** Provide (or clear) the pose the POV / chase cameras follow. Called by the actors module every frame. */
  setFollowTarget(t: FollowTarget | null): void;
  getFollowTarget(): FollowTarget | null;
  /** Temporarily suspend camera mouse controls (e.g. while dragging a vertex). */
  setControlsEnabled(on: boolean): void;
  setCursor(css: string): void;
}

/** A scene module mounts itself on the context and returns its disposer. */
export type SceneModule = (ctx: SceneContext) => () => void;
