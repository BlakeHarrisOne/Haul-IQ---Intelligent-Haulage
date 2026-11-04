/**
 * Camera rig: orbit / plan / POV / chase, our own controller (Rain Model rig maths, not OrbitControls).
 *  - orbit: drag = orbit about the ground point under the pointer, right/middle (or shift) drag = grab-pan, wheel =
 *    zoom glide to the cursor (τ 115 ms), inertia after release (τ 320 ms), keyboard pan/rotate/zoom, limits that keep
 *    the eye above ground and the target on the site.
 *  - plan: orthographic, north-up; same params with el = 90°, az = 0. Orbit ⇄ plan flies with the log-scale FOV trick
 *    (perspective narrows to 8° while the half-height in view moves on a log scale, then swaps to ortho).
 *  - pov / chase: ride getFollowTarget() with heading/pitch smoothing; drag to glance (POV) or swing (chase).
 *  - every mode change / focus is an eased transition (cubic-bezier(.23,1,.32,1)).
 */
import * as THREE from 'three';
import type { FollowTarget } from '../context';

export type CamMode = 'orbit' | 'plan' | 'pov' | 'chase';

export interface Params { target: THREE.Vector3; dist: number; az: number; el: number; fov: number }
interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number }

const D2R = Math.PI / 180;
export const ORBIT_FOV = 38;
const PLAN_FOV = 8;
const EL_MIN = 5 * D2R, EL_MAX = 89.5 * D2R;
const ZOOM_TAU = 0.115, INERTIA_TAU = 0.32;

/** CSS cubic-bezier easing (x → y). */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(Math.min(1, Math.max(0, t)));
  };
}
export const EASE = bezier(0.23, 1, 0.32, 1);
const EASE_IO = bezier(0.65, 0, 0.35, 1);

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const cloneP = (p: Params): Params => ({ target: p.target.clone(), dist: p.dist, az: p.az, el: p.el, fov: p.fov });

export interface RigHost {
  /** Ground point (scene) under canvas pixel, or null. */
  pickGround(x: number, y: number): THREE.Vector3 | null;
  /** Ground height (scene y) at scene x/z, NaN when off-surface. */
  groundY(x: number, z: number): number;
  follow(): FollowTarget | null;
}

export class CameraRig {
  readonly persp = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 1, 1e5);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e5);
  active: THREE.Camera = this.persp;
  mode: CamMode = 'orbit';
  /** Current orbit/plan parameters. */
  P: Params = { target: new THREE.Vector3(), dist: 1500, az: 28 * D2R, el: 36 * D2R, fov: ORBIT_FOV };
  lastOrbit: Params = cloneP(this.P);
  bounds = new THREE.Box3(new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 100, 500));
  w = 1; h = 1;
  controlsEnabled = true;
  povFov = 70;
  chaseDist = 32;
  chaseHeight = 11;
  /** Bumped when the view changes (for chrome). */
  version = 0;
  /** Screen insets covered by app chrome: fits frame into the remaining rect. */
  safe = { top: 0, right: 0, bottom: 0, left: 0 };
  private homeDist = 0;

  private host: RigHost;
  private tr: null | { kind: 'param'; from: Params; to: Params; t0: number; dur: number; end: CamMode }
    | { kind: 'pose'; from: Pose; to: () => Pose | null; t0: number; dur: number; end: CamMode; after?: () => void } = null;
  private drag: null | { kind: 'rotate' | 'pan' | 'look' | 'swing'; x: number; y: number; pivot: THREE.Vector3; plane: number; lastT: number; moved: number } = null;
  private vAz = 0; private vEl = 0; private vPan = new THREE.Vector3(); private inertiaPivot = new THREE.Vector3();
  private zoomPending = 0; private zoomPivot = new THREE.Vector3();
  private keys = new Set<string>();
  private lookYaw = 0; private lookPitch = 0; private lookRelease = 0;
  private swingYaw = 0; private swingPitch = 0;
  private sHead = 0; private sPitch = 0; private chaseEye = new THREE.Vector3(); private followInit = false;
  private ray = new THREE.Raycaster();
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  private q1 = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private m1 = new THREE.Matrix4();
  private now = 0;

  constructor(host: RigHost) {
    this.host = host;
    this.persp.up.set(0, 1, 0);
  }

  // ─────────────────────────────────────────────────────────── geometry helpers

  /** Write orbit params into a pose. */
  private paramsPose(p: Params, out: Pose): Pose {
    const ce = Math.cos(p.el), se = Math.sin(p.el), sa = Math.sin(p.az), ca = Math.cos(p.az);
    const f = this.v1.set(sa * ce, -se, -ca * ce);
    const r = this.v2.set(ca, 0, sa);
    const u = this.v3.crossVectors(r, f);
    out.pos.copy(p.target).addScaledVector(f, -p.dist);
    this.m1.makeBasis(r, u, this.lb.copy(f).negate());
    out.quat.setFromRotationMatrix(this.m1);
    out.fov = p.fov;
    return out;
  }

  private eyeOf(p: Params, out: THREE.Vector3) {
    const ce = Math.cos(p.el);
    return out.set(p.target.x - Math.sin(p.az) * ce * p.dist, p.target.y + Math.sin(p.el) * p.dist, p.target.z + Math.cos(p.az) * ce * p.dist);
  }

  private planParams(from: Params): Params {
    const h = from.dist * Math.tan((from.fov * D2R) / 2);
    const az0 = Math.round(from.az / (2 * Math.PI)) * 2 * Math.PI;
    return { target: from.target.clone(), dist: h / Math.tan((PLAN_FOV * D2R) / 2), az: az0, el: 90 * D2R, fov: PLAN_FOV };
  }

  diag() { return Math.max(100, Math.hypot(this.bounds.max.x - this.bounds.min.x, this.bounds.max.z - this.bounds.min.z)); }
  private minDist() { return 12; }
  private maxDist() { return this.diag() * 3.2; }

  private constrain(p: Params, plan: boolean) {
    const b = this.bounds, d = this.diag();
    if (plan) { p.el = 90 * D2R; p.fov = PLAN_FOV; }
    else p.el = Math.min(EL_MAX, Math.max(EL_MIN, p.el));
    const planMax = this.maxDist() * (plan ? Math.tan((ORBIT_FOV * D2R) / 2) / Math.tan((PLAN_FOV * D2R) / 2) : 1);
    p.dist = Math.min(planMax, Math.max(this.minDist(), p.dist));
    const mx = (b.max.x - b.min.x) * 0.3 + 50, mz = (b.max.z - b.min.z) * 0.3 + 50;
    p.target.x = Math.min(b.max.x + mx, Math.max(b.min.x - mx, p.target.x));
    p.target.z = Math.min(b.max.z + mz, Math.max(b.min.z - mz, p.target.z));
    p.target.y = Math.min(b.max.y + d * 0.2, Math.max(b.min.y - 60, p.target.y));
    if (!plan) {
      // eye stays above the ground (and above the site's floor outside it)
      const eye = this.eyeOf(p, this.v1);
      let gy = this.host.groundY(eye.x, eye.z);
      if (gy !== gy) gy = b.min.y - 40;
      const need = gy + 3;
      if (eye.y < need) {
        const s = Math.min(1, Math.max(-1, (need - p.target.y) / p.dist));
        p.el = Math.min(EL_MAX, Math.max(p.el, Math.asin(s)));
      }
    }
  }

  // ─────────────────────────────────────────────────────────── public API

  resize(w: number, h: number) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.persp.aspect = this.w / this.h;
    this.persp.updateProjectionMatrix();
    this.version++;
  }

  setBounds(b: THREE.Box3) { this.bounds.copy(b); }

  /** Orbit params that frame a box: bisection on distance so all 8 corners fit, then re-centre the target on the
   *  projected box (perspective makes the near half bigger) and refit. */
  fitParams(box: THREE.Box3, az = this.lastOrbit.az, el = this.lastOrbit.el, margin = 0.86): Params {
    const target = box.getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(ORBIT_FOV, this.w / this.h, 1, 1e7);
    const pose: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: ORBIT_FOV };
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const lo = new THREE.Vector2(), hi = new THREE.Vector2();
    const place = (dist: number) => {
      this.paramsPose({ target, dist, az, el, fov: ORBIT_FOV }, pose);
      cam.position.copy(pose.pos); cam.quaternion.copy(pose.quat); cam.updateMatrixWorld();
      lo.set(Infinity, Infinity); hi.set(-Infinity, -Infinity);
      let behind = false;
      for (const c of corners) {
        const v = this.v2.copy(c).project(cam);
        if (v.z > 1) behind = true;
        lo.x = Math.min(lo.x, v.x); lo.y = Math.min(lo.y, v.y); hi.x = Math.max(hi.x, v.x); hi.y = Math.max(hi.y, v.y);
      }
      return !behind;
    };
    const sr = this.safeNdc();
    const hx = ((sr.x1 - sr.x0) / 2) * margin, hy = ((sr.y1 - sr.y0) / 2) * margin;
    const fits = (dist: number) => place(dist) && (hi.x - lo.x) / 2 <= hx && (hi.y - lo.y) / 2 <= hy;
    let dist = 1000;
    const fwd = new THREE.Vector3(Math.sin(az), 0, -Math.cos(az)), right = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    for (let round = 0; round < 5; round++) {
      let a = Math.log(5), b = Math.log(5e6);
      for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (fits(Math.exp(m))) b = m; else a = m; }
      dist = Math.exp(b);
      place(dist);
      const cx = (lo.x + hi.x) / 2 - sr.cx, cy = (lo.y + hi.y) / 2 - sr.cy;
      if (Math.abs(cx) < 0.01 && Math.abs(cy) < 0.01) break;
      const halfH = dist * Math.tan((ORBIT_FOV * D2R) / 2), halfW = halfH * (this.w / this.h);
      target.addScaledVector(right, cx * halfW).addScaledVector(fwd, (cy * halfH) / Math.max(0.3, Math.sin(el)));
    }
    return { target, dist, az, el, fov: ORBIT_FOV };
  }

  /** The safe rect (screen minus chrome insets) in NDC. */
  safeNdc() {
    const s = this.safe, W = this.w, H = this.h;
    const x0 = -1 + (2 * s.left) / W, x1 = 1 - (2 * s.right) / W, y0 = -1 + (2 * s.bottom) / H, y1 = 1 - (2 * s.top) / H;
    return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  private planFitParams(box: THREE.Box3, margin = 1.08): Params {
    const c = box.getCenter(new THREE.Vector3());
    const sr = this.safeNdc(), a = this.w / this.h;
    const fy = Math.max(0.2, (sr.y1 - sr.y0) / 2), fx = Math.max(0.2, (sr.x1 - sr.x0) / 2);
    const halfH = Math.max((box.max.z - box.min.z) / 2 / fy, (box.max.x - box.min.x) / 2 / (a * fx)) * margin;
    const target = new THREE.Vector3(c.x - sr.cx * halfH * a, c.y, c.z + sr.cy * halfH);
    return { target, dist: halfH / Math.tan((PLAN_FOV * D2R) / 2), az: 0, el: 90 * D2R, fov: PLAN_FOV };
  }

  /** Plan params for leaving the current orbit view: whole site from the overview, else what's under the view centre. */
  private toPlanParams(from: Params): Params {
    if (this.homeDist > 0 && from.dist >= this.homeDist * 0.8) return this.planFitParams(this.bounds);
    const p = cloneP(from);
    const sr = this.safeNdc();
    const g = this.host.pickGround(((sr.cx + 1) / 2) * this.w, ((1 - sr.cy) / 2) * this.h);
    if (g) {
      const eye = this.eyeOf(from, this.v1);
      p.dist = eye.distanceTo(g);
      p.target.copy(g);
    }
    return this.planParams(p);
  }

  /** Frame a box in the current mode (animated unless dur = 0). */
  frame(box: THREE.Box3, dur = 900) {
    if (this.mode === 'pov' || this.mode === 'chase') return;
    const to = this.mode === 'plan' ? this.planFitParams(box) : this.fitParams(box, this.P.az, this.P.el, 0.97);
    if (this.mode === 'orbit') this.lastOrbit = cloneP(to);
    this.tweenParams(to, dur, this.mode);
  }

  /** Immediately set the default overview. */
  home(box: THREE.Box3) {
    // pick the azimuth (10–50°, looking north-east-ish) that frames the site largest: diagonal views fill the free area
    let p = this.fitParams(box, 24 * D2R, 34 * D2R, 0.97);
    let best = p.dist;
    for (let e = 32; e <= 50; e += 6) for (let a = 10; a <= 74; a += 8) {
      const q = this.fitParams(box, a * D2R, e * D2R, 0.97);
      const score = q.dist * (1 + (e - 32) * 0.006) * (1 + Math.abs(a - 26) * 0.002);
      if (score < best) { best = score; p = q; }
    }
    this.P = p; this.lastOrbit = cloneP(p); this.homeDist = p.dist;
    if (this.mode === 'plan') this.P = this.planFitParams(box);
    this.tr = null;
    this.version++;
  }

  private tweenParams(to: Params, dur: number, end: CamMode) {
    const from = cloneP(this.P);
    // shortest azimuth
    to = cloneP(to);
    to.az = from.az + wrapPi(to.az - from.az);
    if (dur <= 0) { this.P = to; this.mode = end; this.tr = null; this.version++; return; }
    this.tr = { kind: 'param', from, to, t0: this.now, dur, end };
  }

  currentPose(out: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: ORBIT_FOV }): Pose {
    if (this.active === this.ortho) {
      return this.paramsPose(this.P, out);
    }
    out.pos.copy(this.persp.position); out.quat.copy(this.persp.quaternion); out.fov = this.persp.fov;
    return out;
  }

  setMode(m: CamMode, dur = 650) {
    if (m === this.mode && !this.tr) return;
    const prev = this.tr ? this.tr.end : this.mode;
    if (m === prev) return;
    this.stopMotion();
    if (prev === 'orbit') this.lastOrbit = cloneP(this.P);
    if (m === 'orbit' || m === 'plan') {
      if (prev === 'orbit' || prev === 'plan') {
        // param flight (log-scale FOV trick); plan always swaps to ortho at the end
        if (this.active === this.ortho) { this.active = this.persp; }
        const to = m === 'plan' ? this.toPlanParams(this.P) : (() => {
          const h = this.P.dist * Math.tan((this.P.fov * D2R) / 2);
          const p = cloneP(this.lastOrbit);
          p.target.copy(this.P.target);
          p.dist = h / Math.tan((ORBIT_FOV * D2R) / 2);
          p.fov = ORBIT_FOV;
          return p;
        })();
        this.tweenParams(to, Math.round(dur * 1.25), m);
      } else {
        // leaving a follow mode: pose flight back to the last orbit (or its plan equivalent)
        const dest = m === 'plan' ? this.planParams(this.lastOrbit) : cloneP(this.lastOrbit);
        const from = this.currentPose();
        const pose: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: ORBIT_FOV };
        this.active = this.persp;
        this.tr = { kind: 'pose', from, to: () => this.paramsPose(dest, pose), t0: this.now, dur: dur * 1.3, end: m, after: () => { this.P = cloneP(dest); } };
      }
    } else {
      const from = this.currentPose();
      this.active = this.persp;
      this.followInit = false;
      this.lookYaw = this.lookPitch = 0;
      this.swingYaw = 0; this.swingPitch = 0;
      const pose: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 };
      this.tr = { kind: 'pose', from, to: () => this.followPose(m, pose, 1 / 60, true), t0: this.now, dur: dur * 1.4, end: m };
    }
    this.mode = m;
    this.version++;
  }

  // ─────────────────────────────────────────────────────────── follow poses

  private followPose(m: CamMode, out: Pose, dt: number, snap = false): Pose | null {
    const t = this.host.follow();
    if (!t) return null;
    if (!this.followInit || snap) { if (!this.followInit) { this.sHead = t.heading; this.sPitch = t.pitch; } }
    const kH = 1 - Math.exp(-dt / 0.14), kP = 1 - Math.exp(-dt / 0.22);
    this.sHead += wrapPi(t.heading - this.sHead) * (this.followInit ? kH : 1);
    this.sPitch += (t.pitch - this.sPitch) * (this.followInit ? kP : 1);
    const h = this.sHead;
    const fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    if (m === 'pov') {
      const e = t.eye;
      out.pos.set(t.position.x - fx * e.back + rx * e.right, t.position.y + e.height, t.position.z - fz * e.back + rz * e.right);
      const yaw = h + this.lookYaw, pitch = this.sPitch * 0.85 + this.lookPitch - 0.035;
      const f = this.v1.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.sin(yaw) * Math.cos(pitch));
      this.lookAtQuat(f, out.quat);
      out.fov = this.povFov;
    } else {
      const yaw = h + this.swingYaw, el = 0.3 + this.swingPitch;
      const bx = Math.cos(yaw), bz = -Math.sin(yaw);
      const want = this.v2.set(
        t.position.x - bx * this.chaseDist * Math.cos(el),
        t.position.y + this.chaseHeight * 0.4 + this.chaseDist * Math.sin(el),
        t.position.z - bz * this.chaseDist * Math.cos(el),
      );
      let gy = this.host.groundY(want.x, want.z);
      if (gy === gy && want.y < gy + 2.5) want.y = gy + 2.5;
      if (!this.followInit) this.chaseEye.copy(want);
      else this.chaseEye.lerp(want, 1 - Math.exp(-dt / 0.28));
      out.pos.copy(this.chaseEye);
      const look = this.v3.set(t.position.x + bx * 8, t.position.y + 3.5, t.position.z + bz * 8);
      this.lookAtQuat(look.sub(out.pos).normalize(), out.quat);
      out.fov = 55;
    }
    this.followInit = true;
    return out;
  }

  private lookAtQuat(f: THREE.Vector3, out: THREE.Quaternion) {
    const r = this.lr.crossVectors(f, this.lup);
    if (r.lengthSq() < 1e-8) r.set(1, 0, 0);
    r.normalize();
    const u = this.lu.crossVectors(r, f).normalize();
    this.m1.makeBasis(r, u, this.lb.copy(f).negate());
    out.setFromRotationMatrix(this.m1);
  }
  private lr = new THREE.Vector3(); private lu = new THREE.Vector3(); private lb = new THREE.Vector3(); private lup = new THREE.Vector3(0, 1, 0);
  private prevPos = new THREE.Vector3(); private prevQ = new THREE.Quaternion();
  private rv1 = new THREE.Vector3(); private rv2 = new THREE.Vector3(); private rv3 = new THREE.Vector3(); private ndc2 = new THREE.Vector2();

  // ─────────────────────────────────────────────────────────── input

  private rayAt(x: number, y: number) {
    this.ray.setFromCamera(this.ndc2.set((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1), this.active);
    return this.ray.ray;
  }

  private planeHit(x: number, y: number, planeY: number, out: THREE.Vector3): THREE.Vector3 | null {
    const r = this.rayAt(x, y);
    if (Math.abs(r.direction.y) < 1e-6) return null;
    const t = (planeY - r.origin.y) / r.direction.y;
    if (t < 0) return null;
    return out.copy(r.origin).addScaledVector(r.direction, t);
  }

  private pivotAt(x: number, y: number): THREE.Vector3 {
    return this.host.pickGround(x, y) ?? this.planeHit(x, y, this.P.target.y, new THREE.Vector3()) ?? this.P.target.clone();
  }

  pointerDown(x: number, y: number, button: number, shift: boolean): boolean {
    if (!this.controlsEnabled) return false;
    this.stopMotion();
    if (this.tr && this.tr.kind === 'param') { this.finishTr(); }
    let kind: 'rotate' | 'pan' | 'look' | 'swing';
    if (this.mode === 'pov') kind = 'look';
    else if (this.mode === 'chase') kind = 'swing';
    else if (this.mode === 'plan') kind = 'pan';
    else kind = button === 0 && !shift ? 'rotate' : 'pan';
    const pivot = this.mode === 'pov' || this.mode === 'chase' ? new THREE.Vector3() : this.pivotAt(x, y);
    this.drag = { kind, x, y, pivot, plane: pivot.y, lastT: this.now, moved: 0 };
    return true;
  }

  pointerMove(x: number, y: number): boolean {
    const d = this.drag;
    if (!d) return false;
    const dx = x - d.x, dy = y - d.y;
    d.x = x; d.y = y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    const dtm = Math.max(1e-3, (performance.now() - d.lastT) / 1000);
    d.lastT = performance.now();
    if (d.kind === 'rotate') {
      const dAz = (dx / this.h) * Math.PI * 1.05, dEl = (dy / this.h) * Math.PI * 0.7;
      this.rotateAbout(d.pivot, dAz, dEl);
      this.vAz = this.vAz * 0.5 + (dAz / dtm) * 0.5; this.vEl = this.vEl * 0.5 + (dEl / dtm) * 0.5;
      this.inertiaPivot.copy(d.pivot);
    } else if (d.kind === 'pan') {
      const before = this.P.target.clone();
      this.grabPan(x, y, dx, dy, d.pivot, d.plane);
      const mv = this.P.target.clone().sub(before);
      this.vPan.multiplyScalar(0.5).addScaledVector(mv, 0.5 / dtm);
    } else if (d.kind === 'look') {
      this.lookYaw -= (dx / this.h) * (this.povFov * D2R);
      this.lookPitch = Math.max(-0.7, Math.min(0.6, this.lookPitch - (dy / this.h) * (this.povFov * D2R)));
      this.lookRelease = 0;
    } else {
      this.swingYaw -= (dx / this.h) * Math.PI;
      this.swingPitch = Math.max(-0.22, Math.min(0.9, this.swingPitch + (dy / this.h) * 1.2));
    }
    this.version++;
    return true;
  }

  pointerUp(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    const idle = (performance.now() - d.lastT) / 1000;
    if (idle > 0.08) { this.vAz = this.vEl = 0; this.vPan.set(0, 0, 0); }
    if (d.kind === 'look') this.lookRelease = 1.4;
    return true;
  }

  get dragging() { return !!this.drag; }

  private rotateAbout(P: THREE.Vector3, dAz: number, dEl: number) {
    const p = this.P;
    const el1 = Math.min(EL_MAX, Math.max(EL_MIN, p.el + dEl));
    const dE = el1 - p.el;
    const az1 = p.az + dAz;
    const eye = this.eyeOf(p, this.rv1);
    const qy = this.q1.setFromAxisAngle(this.lup, -dAz);
    const r = this.rv2.set(Math.cos(az1), 0, Math.sin(az1));
    const qp = this.q2.setFromAxisAngle(r, -dE);
    const q = qp.multiply(qy);
    const ct = this.rv3.copy(p.target).sub(P).applyQuaternion(q).add(P);
    eye.sub(P).applyQuaternion(q).add(P);
    p.target.copy(ct);
    p.az = az1; p.el = el1;
    this.constrain(p, false);
  }

  private grabPan(x: number, y: number, dx: number, dy: number, grab: THREE.Vector3, planeY: number) {
    const p = this.P;
    if (this.active === this.ortho) {
      const mpp = (2 * p.dist * Math.tan((p.fov * D2R) / 2)) / this.h;
      p.target.x -= dx * mpp; p.target.z -= dy * mpp;
    } else {
      const hit = this.planeHit(x, y, planeY, this.v3);
      if (!hit) return;
      const delta = this.v2.copy(grab).sub(hit);
      const lim = p.dist * 0.5;
      if (delta.length() > lim) delta.setLength(lim);
      delta.y = 0;
      p.target.add(delta);
    }
    this.constrain(p, this.mode === 'plan');
  }

  wheel(x: number, y: number, deltaY: number): boolean {
    if (!this.controlsEnabled) return false;
    if (this.mode === 'pov') { this.povFov = Math.max(45, Math.min(85, this.povFov + deltaY * 0.02)); this.version++; return true; }
    if (this.mode === 'chase') { this.chaseDist = Math.max(10, Math.min(260, this.chaseDist * Math.exp(deltaY * 0.0015))); this.version++; return true; }
    if (this.tr && this.tr.kind === 'param') this.finishTr();
    this.vAz = this.vEl = 0; this.vPan.set(0, 0, 0);
    this.zoomPivot.copy(this.pivotAt(x, y));
    this.zoomPending += Math.max(-0.6, Math.min(0.6, deltaY * 0.0016));
    return true;
  }

  dblclick(x: number, y: number): boolean {
    if (this.mode === 'pov' || this.mode === 'chase') { this.lookYaw = this.lookPitch = 0; this.swingYaw = this.swingPitch = 0; return true; }
    const g = this.host.pickGround(x, y);
    if (!g) return false;
    const to = cloneP(this.P);
    to.target.copy(g);
    to.dist = Math.max(this.minDist(), this.P.dist * 0.55);
    this.tweenParams(to, 700, this.mode);
    return true;
  }

  keyDown(code: string): boolean {
    const known = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'PageUp', 'PageDown'];
    if (!known.includes(code)) return false;
    if (this.mode === 'pov' || this.mode === 'chase') return false;
    this.keys.add(code);
    return true;
  }
  keyUp(code: string) { this.keys.delete(code); }
  clearKeys() { this.keys.clear(); }

  stopMotion() { this.vAz = this.vEl = 0; this.vPan.set(0, 0, 0); this.zoomPending = 0; }

  private finishTr() {
    const tr = this.tr;
    if (!tr) return;
    if (tr.kind === 'param') { this.P = cloneP(tr.to); }
    else tr.after?.();
    this.tr = null;
    this.mode = tr.end;
    if (this.mode === 'plan') this.active = this.ortho;
  }

  // ─────────────────────────────────────────────────────────── frame update

  /** Advance the rig; returns true while anything is still moving (keep rendering). */
  update(dt: number, now: number): boolean {
    this.now = now;
    let moving = false;
    const p = this.P;
    // keyboard
    if (this.keys.size && (this.mode === 'orbit' || this.mode === 'plan')) {
      const k = (c: string) => (this.keys.has(c) ? 1 : 0);
      const fwd = k('ArrowUp') + k('KeyW') - k('ArrowDown') - k('KeyS');
      const side = k('ArrowRight') + k('KeyD') - k('ArrowLeft') - k('KeyA');
      const rot = k('KeyE') - k('KeyQ');
      const zoom = k('Minus') + k('NumpadSubtract') - k('Equal') - k('NumpadAdd');
      const tilt = k('PageUp') - k('PageDown');
      const speed = (this.mode === 'plan' ? p.dist * Math.tan((p.fov * D2R) / 2) * 1.2 : p.dist * 0.7) * dt;
      const sa = Math.sin(p.az), ca = Math.cos(p.az);
      p.target.x += (sa * fwd + ca * side) * speed;
      p.target.z += (-ca * fwd + sa * side) * speed;
      if (this.mode === 'orbit') { p.az += rot * dt * 1.2; p.el += tilt * dt * 0.8; }
      if (zoom) p.dist *= Math.exp(zoom * dt * 1.4);
      this.constrain(p, this.mode === 'plan');
      moving = true;
    }
    // zoom glide about the cursor point
    if (Math.abs(this.zoomPending) > 1e-4) {
      const k = 1 - Math.exp(-Math.min(dt, 0.1) / ZOOM_TAU);
      const step = Math.abs(this.zoomPending) < 2e-3 ? this.zoomPending : this.zoomPending * k;
      this.zoomPending -= step;
      let s = Math.exp(step);
      const plan = this.mode === 'plan';
      const before = p.dist;
      p.dist *= s;
      this.constrain(p, plan);
      s = p.dist / before;
      if (Math.abs(s - 1) < 1e-6) this.zoomPending = 0;
      const pv = this.zoomPivot;
      p.target.x = pv.x + (p.target.x - pv.x) * s;
      p.target.z = pv.z + (p.target.z - pv.z) * s;
      if (!plan) p.target.y = pv.y + (p.target.y - pv.y) * s;
      this.constrain(p, plan);
      moving = true;
    }
    // inertia
    if (!this.drag) {
      const k = Math.exp(-dt / INERTIA_TAU), travel = INERTIA_TAU * (1 - k);
      if (Math.abs(this.vAz) + Math.abs(this.vEl) > 0.02) {
        this.rotateAbout(this.inertiaPivot, this.vAz * travel, this.vEl * travel);
        this.vAz *= k; this.vEl *= k; moving = true;
      } else { this.vAz = this.vEl = 0; }
      if (this.vPan.length() > p.dist * 0.004) {
        p.target.addScaledVector(this.vPan, travel);
        this.constrain(p, this.mode === 'plan');
        this.vPan.multiplyScalar(k); moving = true;
      } else this.vPan.set(0, 0, 0);
    }
    // POV glance springs back
    if (this.lookRelease > 0 && !this.drag) {
      this.lookRelease -= dt;
      if (this.lookRelease <= 0) {
        const k = 1 - Math.exp(-dt / 0.45);
        this.lookYaw *= 1 - k; this.lookPitch *= 1 - k;
        if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 1e-3) { this.lookRelease = 1e-6; moving = true; }
        else { this.lookYaw = this.lookPitch = 0; this.lookRelease = 0; }
      } else moving = true;
    }

    // transitions
    const tr = this.tr;
    const pose: Pose = this._pose;
    if (tr) {
      const x = Math.min(1, (now - tr.t0) / tr.dur);
      if (tr.kind === 'param') {
        const e = (tr.end === 'plan') !== (this.mode === 'plan') ? EASE_IO(x) : EASE(x);
        const a = tr.from, b = tr.to;
        const ha = a.dist * Math.tan((a.fov * D2R) / 2), hb = b.dist * Math.tan((b.fov * D2R) / 2);
        p.fov = a.fov + (b.fov - a.fov) * e;
        p.dist = Math.exp(Math.log(ha) + (Math.log(hb) - Math.log(ha)) * e) / Math.tan((p.fov * D2R) / 2);
        p.target.lerpVectors(a.target, b.target, e);
        p.az = a.az + (b.az - a.az) * e;
        p.el = a.el + (b.el - a.el) * e;
        this.active = this.persp;
        this.paramsPose(p, pose);
        if (x >= 1) this.finishTr();
      } else {
        const to = tr.to();
        if (!to) {
          // follow target vanished: hold where we are
          pose.pos.copy(this.persp.position); pose.quat.copy(this.persp.quaternion); pose.fov = this.persp.fov;
          if (x >= 1) this.finishTr();
        } else {
          const e = EASE_IO(x);
          // lift the path a little so long flights arc instead of tunnelling
          const lift = Math.sin(Math.PI * e) * Math.min(400, tr.from.pos.distanceTo(to.pos) * 0.12);
          pose.pos.lerpVectors(tr.from.pos, to.pos, e);
          pose.pos.y += lift;
          pose.quat.slerpQuaternions(tr.from.quat, to.quat, e);
          pose.fov = tr.from.fov + (to.fov - tr.from.fov) * e;
          if (x >= 1) this.finishTr();
        }
        this.active = this.persp;
      }
      moving = true;
    } else if (this.mode === 'pov' || this.mode === 'chase') {
      const fp = this.followPose(this.mode, pose, dt);
      if (fp) {
        const prevPos = this.prevPos.copy(this.persp.position);
        const prevQ = this.prevQ.copy(this.persp.quaternion);
        if (prevPos.distanceToSquared(pose.pos) > 1e-6 || Math.abs(prevQ.dot(pose.quat)) < 0.9999999) moving = true;
      } else {
        pose.pos.copy(this.persp.position); pose.quat.copy(this.persp.quaternion); pose.fov = this.persp.fov;
      }
      this.active = this.persp;
    } else {
      this.paramsPose(p, pose);
      this.active = this.mode === 'plan' ? this.ortho : this.persp;
    }

    // apply
    if (this.active === this.ortho) {
      const halfH = p.dist * Math.tan((PLAN_FOV * D2R) / 2), a = this.w / this.h;
      const o = this.ortho;
      o.left = -halfH * a; o.right = halfH * a; o.top = halfH; o.bottom = -halfH;
      const top = this.bounds.max.y + 3000;
      o.position.set(p.target.x, top, p.target.z);
      this.paramsPose({ target: p.target, dist: 1, az: 0, el: 90 * D2R, fov: PLAN_FOV }, pose);
      o.quaternion.copy(pose.quat);
      o.near = 1; o.far = top - this.bounds.min.y + 3000;
      o.updateProjectionMatrix();
      o.updateMatrixWorld();
    } else {
      const c = this.persp;
      c.position.copy(pose.pos);
      c.quaternion.copy(pose.quat);
      if (c.fov !== pose.fov) c.fov = pose.fov;
      const follow = (this.mode === 'pov' || this.mode === 'chase');
      const above = pose.pos.y - this.bounds.max.y;
      const near = follow && !this.tr ? (this.mode === 'pov' ? 0.25 : 0.8) : Math.min(Math.max(0.5, above * 0.3, p.dist * 0.004), p.dist * 0.25);
      const far = (follow ? 0 : p.dist * 2.5) + this.diag() * 4 + 2000;
      if (Math.abs(c.near - near) > 1e-3 || Math.abs(c.far - far) > 1) { c.near = near; c.far = far; }
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
    }
    if (moving) this.version++;
    return moving;
  }
  private _pose: Pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: ORBIT_FOV };

  get transitioning() { return !!this.tr; }

  /** View heading for the compass: degrees clockwise from north. */
  headingDeg(): number {
    if (this.active === this.ortho) return 0;
    const f = this.v1.set(0, 0, -1).applyQuaternion(this.persp.quaternion);
    if (Math.hypot(f.x, f.z) < 1e-4) {
      const u = this.v2.set(0, 1, 0).applyQuaternion(this.persp.quaternion);
      return (Math.atan2(u.x, -u.z) * 180) / Math.PI;
    }
    return (Math.atan2(f.x, -f.z) * 180) / Math.PI;
  }

  /** Metres per CSS pixel at the view centre's ground point. */
  metersPerPixel(center: THREE.Vector3 | null): number {
    if (this.active === this.ortho) return (this.ortho.top - this.ortho.bottom) / this.h;
    const c = this.persp;
    const d = center ? center.distanceTo(c.position) : this.P.dist;
    return (2 * d * Math.tan((c.fov * D2R) / 2)) / this.h;
  }

  /** Face north keeping tilt (animated). */
  faceNorth() {
    if (this.mode !== 'orbit') return;
    const to = cloneP(this.P);
    to.az = Math.round(this.P.az / (2 * Math.PI)) * 2 * Math.PI;
    this.tweenParams(to, 800, 'orbit');
  }
}
