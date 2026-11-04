/**
 * Live rear-view mirrors for the driver's seat (POV only): each mirror glass of the followed truck shows a small
 * render-target view looking back along the truck's flank (convex-mirror field of view, mirrored left ↔ right), so the
 * driver sees the tray, the rear duals and the road and trucks behind - HRL's cab has no mirror image at all.
 *
 * Cost control: 144 × 360 px targets, one mirror re-rendered per frame (they alternate), at most every 45 ms, and only
 * while the camera is in the seat. The shadow map is reused (the core refreshes it), nothing else is rebuilt.
 */
import * as THREE from 'three';
import type { TruckGeoms } from './vehicle';

const RT_W = 144, RT_H = 360;
const MIN_INTERVAL_MS = 45;

export class CabMirrors {
  private readonly group = new THREE.Group();
  private readonly cam = new THREE.PerspectiveCamera(34, RT_W / RT_H, 0.3, 3000);
  private rts: THREE.WebGLRenderTarget[] = [];
  private planes: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[] = [];
  private geomKey = '';
  private turn = 0;
  private last = -1e9;
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpT = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();

  constructor(parent: THREE.Object3D, private readonly renderer: THREE.WebGLRenderer) {
    this.group.name = 'cab-mirrors';
    this.group.visible = false;
    parent.add(this.group);
  }

  private ensure(g: TruckGeoms) {
    const key = g.mirrors.map(m => m.pos.join(',')).join('|');
    if (key === this.geomKey) return;
    this.clear();
    this.geomKey = key;
    const half = this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    for (const m of g.mirrors) {
      const rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { type: half, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      const geo = new THREE.PlaneGeometry(m.w * 0.96, m.h * 0.96);
      // a mirror: flip left ↔ right
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      geo.rotateY(-Math.PI / 2);                       // face the driver (local −x)
      geo.translate(m.pos[0] - 0.006, m.pos[1], m.pos[2]);
      // glass reflects ~85 %; a faint blue-grey tint so it still reads as glass
      const mat = new THREE.MeshBasicMaterial({ map: rt.texture, color: new THREE.Color(0.8, 0.83, 0.86), fog: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.rts.push(rt); this.planes.push(mesh); this.mats.push(mat);
    }
  }

  /**
   * Place the mirror glasses on the followed truck (pose matrix `M`, local truck axes) and refresh one mirror view.
   * Call before the main render.
   */
  update(M: THREE.Matrix4, g: TruckGeoms, scene: THREE.Scene, now: number) {
    this.ensure(g);
    this.group.visible = true;
    for (const p of this.planes) { p.matrix.copy(M); p.matrixWorldNeedsUpdate = true; }
    if (!this.rts.length || now - this.last < MIN_INTERVAL_MS) return;
    this.last = now;
    const i = this.turn++ % this.rts.length;
    const m = g.mirrors[i];
    // eye just behind the glass, looking back along the flank, turned a little outward and down
    this.tmpP.set(m.pos[0] - 0.09, m.pos[1], m.pos[2]).applyMatrix4(M);
    this.tmpT.set(m.pos[0] - 1.09, m.pos[1] - 0.065, m.pos[2] + m.outward * 0.11).applyMatrix4(M);
    this.cam.position.copy(this.tmpP);
    this.cam.up.set(0, 1, 0).transformDirection(this.tmpM.extractRotation(M));
    this.cam.lookAt(this.tmpT);
    this.cam.updateMatrixWorld();
    const prev = this.renderer.getRenderTarget();
    this.group.visible = false;
    try {
      this.renderer.setRenderTarget(this.rts[i]);
      this.renderer.render(scene, this.cam);
    } finally {
      this.renderer.setRenderTarget(prev);
      this.group.visible = true;
    }
  }

  hide() { this.group.visible = false; }

  private clear() {
    for (const p of this.planes) { this.group.remove(p); p.geometry.dispose(); }
    for (const m of this.mats) m.dispose();
    for (const rt of this.rts) rt.dispose();
    this.rts = []; this.planes = []; this.mats = [];
    this.geomKey = '';
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
