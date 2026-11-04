import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeLighting, makeLighting, sunENU } from './environment';
import { palette } from './theme';
import { LabelService } from './labels';
import { CarveAtlas } from './carve';
import { HeightGrid } from './heightGrid';
import { makeFrame } from '@/core/frame';

describe('shift-clock environment', () => {
  const L = makeLighting();
  it('opens the 06:00 day shift in low but real daylight, high sun at noon', () => {
    computeLighting(L, 6, palette('light'), 'light');
    expect(L.env.sunElDeg).toBeGreaterThan(2);
    expect(L.env.sunElDeg).toBeLessThan(12);
    expect(L.env.daylight).toBe(1);
    expect(L.env.headlights).toBe(false);
    expect(L.env.sunAzDeg).toBeGreaterThan(60);
    expect(L.env.sunAzDeg).toBeLessThan(130); // morning sun in the east
    computeLighting(L, 12, palette('light'), 'light');
    expect(L.env.sunElDeg).toBeGreaterThan(70);
  });
  it('is night only when the clock is at night, whatever the theme', () => {
    computeLighting(L, 22, palette('light'), 'light');
    expect(L.env.daylight).toBe(0);
    expect(L.env.headlights).toBe(true);
    expect(L.stars).toBeGreaterThan(0.9);
    expect(L.terrainMul).toBeLessThan(0.7);
    computeLighting(L, 9.5, palette('dark'), 'dark');
    expect(L.env.daylight).toBe(1);
    expect(L.env.night).toBe(0);
    expect(L.stars).toBe(0);
  });
  it('southern-hemisphere sun is north of the zenith at noon', () => {
    const v = sunENU(12);
    expect(v[1]).toBeGreaterThan(0);
    expect(Math.abs(v[0])).toBeLessThan(1e-9);
  });
});

/** Minimal DOM stand-ins (the placer only touches style / dataset / parent / size). */
function fakeEl(w: number, h: number): HTMLElement {
  return { style: {} as CSSStyleDeclaration, dataset: {} as DOMStringMap, parentElement: null, offsetWidth: w, offsetHeight: h } as unknown as HTMLElement;
}
function fakeLayer(): HTMLElement {
  const layer = { appendChild(el: { parentElement: unknown }) { el.parentElement = layer; return el; } };
  return layer as unknown as HTMLElement;
}

describe('label service', () => {
  const cam = new THREE.OrthographicCamera(-500, 500, 500, -500, 1, 5000);
  cam.position.set(0, 1000, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const frame = makeFrame([0, 0, 0], 1);
  const ins = { top: 0, right: 0, bottom: 0, left: 0 };
  const rect = (el: HTMLElement) => {
    const m = /translate3d\((-?\d+)px,(-?\d+)px/.exec(el.style.transform as string);
    return m ? { x: +m[1], y: +m[2], w: el.offsetWidth, h: el.offsetHeight } : null;
  };

  it('places by priority and hides (never overlaps) what has no room', () => {
    const svc = new LabelService(fakeLayer(), () => {});
    const els = [fakeEl(400, 300), fakeEl(400, 300), fakeEl(400, 300)];
    svc.upsert({ id: 'chip', world: [0, 0, 0], el: els[0], priority: 20 });
    svc.upsert({ id: 'sel', world: [0, 0, 0], el: els[1], priority: 100 });
    svc.upsert({ id: 'pin', world: [0, 0, 0], el: els[2], priority: 40 });
    svc.place(cam, 1000, 1000, ins, frame);
    expect(els[1].style.visibility).toBe('visible');
    const shown = els.filter(e => e.style.visibility === 'visible').map(rect);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i]!, b = shown[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
  });

  it('keeps labels inside the safe rect and hides removed ones', () => {
    const svc = new LabelService(fakeLayer(), () => {});
    const el = fakeEl(120, 24);
    svc.upsert({ id: 'edge', world: [490, 0, 0], el, priority: 50 });
    svc.place(cam, 1000, 1000, { top: 0, right: 100, bottom: 0, left: 0 }, frame);
    const r = rect(el);
    if (el.style.visibility === 'visible') expect(r!.x + r!.w).toBeLessThanOrEqual(900);
    svc.remove('edge');
    expect(el.style.visibility).toBe('hidden');
  });
});

describe('carve atlas', () => {
  it('rasterises a solid and stores its live plane', () => {
    // a 20 × 10 × 5 m box at local x 0..20, north 0..10, z 0..5
    const v = [[0, 0, 0], [20, 0, 0], [20, 0, -10], [0, 0, -10], [0, 5, 0], [20, 5, 0], [20, 5, -10], [0, 5, -10]];
    const positions = new Float32Array(v.flat());
    const index = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    const atlas = new CarveAtlas();
    atlas.build([{ id: 'b', kind: 'dig', local: { positions, index, min: [0, 0, -10], max: [20, 5, 0] }, volume: 1000 }]);
    expect(atlas.uniforms.uSN.value).toBe(1);
    atlas.setPlane('b', [1, 0, 0], 7, 2);
    const p = (atlas.uniforms.uSPlane.value as THREE.Vector4[])[0];
    expect([p.x, p.y, p.z, p.w]).toEqual([1, 0, 0, 7]);
    expect((atlas.uniforms.uSInfo.value as THREE.Vector4[])[0].x).toBe(1);
    atlas.setPlane('b', [1, 0, 0], 7, 2, false);
    expect((atlas.uniforms.uSInfo.value as THREE.Vector4[])[0].x).toBe(0);
  });
});

describe('smoothed heights', () => {
  it('leaves a planar surface planar away from the edges', () => {
    const g = new HeightGrid(0, 0, 1, 12, 8);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) g.h[j * 12 + i] = 0.05 * i + 0.02 * j;
    const s = g.smoothed(2);
    for (let j = 2; j < 6; j++) for (let i = 2; i < 10; i++) expect(s[j * 12 + i]).toBeCloseTo(0.05 * i + 0.02 * j, 5);
  });
});
