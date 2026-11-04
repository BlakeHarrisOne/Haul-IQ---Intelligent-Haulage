/**
 * Ear-clipping triangulation of a polygon with holes (2D).
 *
 * Holes are joined to the outer ring by bridge edges (from each hole's right-most vertex to a visible
 * outer vertex), turning the polygon into one weakly-simple ring that is then ear-clipped. Ear tests use a
 * uniform bucket grid of the ring vertices for large rings, so caps of a few thousand vertices stay fast.
 * Degenerate input (collinear runs, touching rings) is handled by a forced-clip fallback that always
 * terminates.
 */
import { ringArea } from './polyline';

interface Node {
  i: number;       // global vertex index
  x: number;
  y: number;
  prev: Node;
  next: Node;
  removed: boolean;
}

/**
 * Triangulates rings[0] (outer) minus rings[1..] (holes).
 * @param rings flat [x0, y0, x1, y1, …] rings in any orientation; vertex indices number the rings'
 *   vertices consecutively (ring 0 first)
 * @returns triangle indices (3 per triangle), counter-clockwise
 */
export function triangulatePolygon(rings: ReadonlyArray<ArrayLike<number>>): number[] {
  const out: number[] = [];
  if (!rings.length || rings[0].length < 6) return out;
  let base = 0;
  const outer = makeRing(rings[0], base, true);
  base += rings[0].length >> 1;
  const holes: Node[] = [];
  for (let h = 1; h < rings.length; h++) {
    if (rings[h].length >= 6) {
      const r = makeRing(rings[h], base, false);
      if (r) holes.push(rightmost(r));
    }
    base += rings[h].length >> 1;
  }
  if (!outer) return out;
  holes.sort((a, b) => b.x - a.x);
  let start = outer;
  for (const h of holes) start = bridgeHole(h, start);
  earClip(start, out);
  return out;
}

function makeRing(flat: ArrayLike<number>, base: number, ccw: boolean): Node | null {
  const n = flat.length >> 1;
  const area = ringArea(flat);
  const forward = area >= 0 === ccw;
  let head: Node | null = null, last: Node | null = null;
  for (let k = 0; k < n; k++) {
    const i = forward ? k : n - 1 - k;
    const x = flat[i * 2], y = flat[i * 2 + 1];
    if (last && last.x === x && last.y === y) continue; // drop consecutive duplicates
    const node = { i: base + i, x, y, removed: false } as Node;
    if (!head) { head = node; node.prev = node; node.next = node; }
    else { node.prev = last!; node.next = head; last!.next = node; head.prev = node; }
    last = node;
  }
  if (head && last && last !== head && last.x === head.x && last.y === head.y) remove(last);
  return head && head.next !== head && head.next.next !== head ? head : null;
}

function remove(n: Node): void {
  n.prev.next = n.next; n.next.prev = n.prev; n.removed = true;
}

function rightmost(start: Node): Node {
  let best = start, p = start.next;
  while (p !== start) { if (p.x > best.x || (p.x === best.x && p.y < best.y)) best = p; p = p.next; }
  return best;
}

const cross = (a: Node, b: Node, c: Node) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Joins a (CW) hole to the (CCW) outer ring via its right-most vertex m. Returns a node on the merged ring. */
function bridgeHole(m: Node, outer: Node): Node {
  // cast a ray from m towards +x; find the nearest edge crossing it
  let p = outer, qx = Infinity, hit: Node | null = null;
  do {
    const a = p, b = p.next;
    if ((a.y <= m.y && b.y >= m.y) || (b.y <= m.y && a.y >= m.y)) {
      if (a.y !== b.y) {
        const x = a.x + ((m.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (x >= m.x && x < qx) { qx = x; hit = a.x > b.x ? a : b; if (x === m.x) break; }
      } else if (Math.max(a.x, b.x) >= m.x) {
        const x = Math.max(m.x, Math.min(a.x, b.x));
        if (x < qx) { qx = x; hit = a.x < b.x ? a : b; }
      }
    }
    p = p.next;
  } while (p !== outer);
  if (!hit) hit = nearestNode(m, outer);
  // a reflex vertex inside triangle (m, ray hit, hit) may block the view: choose the one at the smallest angle
  const tx = qx === Infinity ? hit.x : qx;
  let best = hit, bestTan = Infinity;
  p = outer;
  do {
    if (p !== hit && p.x >= m.x && inTriAny(m.x, m.y, tx, m.y, hit.x, hit.y, p.x, p.y) && cross(p.prev, p, p.next) <= 0) {
      const tan = Math.abs(m.y - p.y) / Math.max(p.x - m.x, 1e-300);
      if (tan < bestTan || (tan === bestTan && p.x > best.x)) { bestTan = tan; best = p; }
    }
    p = p.next;
  } while (p !== outer);
  return splitBridge(best, m);
}

function nearestNode(m: Node, ring: Node): Node {
  let best = ring, bd = Infinity, p = ring;
  do { const d = (p.x - m.x) ** 2 + (p.y - m.y) ** 2; if (d < bd) { bd = d; best = p; } p = p.next; } while (p !== ring);
  return best;
}

/** Inserts the bridge a ↔ b: a → b … (hole) … b' → a' → a.next … */
function splitBridge(a: Node, b: Node): Node {
  const a2 = { i: a.i, x: a.x, y: a.y, removed: false } as Node;
  const b2 = { i: b.i, x: b.x, y: b.y, removed: false } as Node;
  const an = a.next, bp = b.prev;
  a.next = b; b.prev = a;
  a2.next = an; an.prev = a2;
  b2.next = a2; a2.prev = b2;
  bp.next = b2; b2.prev = bp;
  return a;
}

function inTriAny(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return pointInTri(ax, ay, bx, by, cx, cy, px, py) || pointInTri(ax, ay, cx, cy, bx, by, px, py);
}

function pointInTri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
}

/** Bucket grid over ring nodes for fast "any vertex inside this ear?" tests. */
class NodeGrid {
  private cells: Node[][];
  private x0: number; private y0: number; private inv: number; private nx: number; private ny: number;
  constructor(start: Node, count: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, p = start;
    do { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; p = p.next; } while (p !== start);
    const side = Math.max(1, Math.ceil(Math.sqrt(count / 2)));
    const size = Math.max(x1 - x0, y1 - y0, 1e-12) / side;
    this.x0 = x0; this.y0 = y0; this.inv = 1 / size;
    this.nx = Math.floor((x1 - x0) * this.inv) + 1; this.ny = Math.floor((y1 - y0) * this.inv) + 1;
    this.cells = Array.from({ length: this.nx * this.ny }, () => []);
    p = start;
    do { this.cells[this.cell(p.x, p.y)].push(p); p = p.next; } while (p !== start);
  }
  private ix(x: number) { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) * this.inv))); }
  private iy(y: number) { return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.y0) * this.inv))); }
  private cell(x: number, y: number) { return this.iy(y) * this.nx + this.ix(x); }
  /** True when a live, reflex node (other than the ear's own or coincident ones) lies inside the ear. */
  blocked(a: Node, b: Node, c: Node): boolean {
    const i0 = this.ix(Math.min(a.x, b.x, c.x)), i1 = this.ix(Math.max(a.x, b.x, c.x));
    const j0 = this.iy(Math.min(a.y, b.y, c.y)), j1 = this.iy(Math.max(a.y, b.y, c.y));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (const p of this.cells[j * this.nx + i]) if (insideEar(p, a, b, c)) return true;
    }
    return false;
  }
}

function insideEar(p: Node, a: Node, b: Node, c: Node): boolean {
  if (p.removed || p === a || p === b || p === c) return false;
  if ((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y) || (p.x === c.x && p.y === c.y)) return false;
  return pointInTri(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && cross(p.prev, p, p.next) <= 0;
}

function isEarLinear(a: Node, b: Node, c: Node): boolean {
  let p = c.next;
  while (p !== a) { if (insideEar(p, a, b, c)) return false; p = p.next; }
  return true;
}

const same = (a: Node, b: Node) => a.x === b.x && a.y === b.y;

function earClip(start: Node, out: number[]): void {
  let count = 0, p = start;
  do { count++; p = p.next; } while (p !== start);
  const grid = count > 64 ? new NodeGrid(start, count) : null;
  // mode 0: clip convex, unobstructed ears; mode 1 (after a full fruitless pass): clip any convex vertex
  // and drop collinear ones, so degenerate rings still terminate
  let ear = start, stop = start, mode = 0;
  while (count > 2) {
    const a = ear.prev, b = ear, c = ear.next;
    const cr = cross(a, b, c);
    let action = 0; // 1 = clip and emit, 2 = drop without a triangle
    if (cr > 0) {
      if (mode === 1 || !(grid ? grid.blocked(a, b, c) : !isEarLinear(a, b, c))) action = 1;
    } else if (cr === 0 && (mode === 1 || same(a, b) || same(b, c))) action = 2;
    if (action) {
      if (action === 1) out.push(a.i, b.i, c.i);
      remove(b); count--;
      ear = c; stop = c; mode = 0;
      continue;
    }
    ear = c;
    if (ear === stop) { if (mode === 1) break; mode = 1; }
  }
}
