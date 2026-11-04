/**
 * Chains plane–mesh intersection segments into polylines and closed loops.
 *
 * Each segment has two ends (end id 2s and 2s + 1); every end carries the key of the mesh edge it lies on
 * (crossing points on the same edge are the same point). Ends with equal keys are joined. Traversal is
 * undirected, so meshes with inconsistent winding still chain; a third use of a key (non-manifold edge)
 * is left unjoined.
 */

/** One chained polyline: the end ids of its vertices in order. */
export interface SegmentChain {
  ends: number[];
  closed: boolean;
}

/**
 * @param keys key per segment end (length 2·nSeg); equal keys denote the same point
 */
export function chainSegments(keys: ArrayLike<number>, nSeg: number): SegmentChain[] {
  const partner = new Int32Array(nSeg * 2).fill(-1);
  const first = new Map<number, number>();
  for (let e = 0; e < nSeg * 2; e++) {
    const k = keys[e];
    const f = first.get(k);
    if (f === undefined) first.set(k, e);
    else if (f >= 0) { partner[e] = f; partner[f] = e; first.set(k, -1); }
  }
  const used = new Uint8Array(nSeg);
  const chains: SegmentChain[] = [];
  for (let s = 0; s < nSeg; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const fwd: number[] = [2 * s, 2 * s + 1];
    let cur = 2 * s + 1, closed = false;
    for (;;) {
      const nx = partner[cur];
      if (nx < 0) break;
      const seg = nx >> 1;
      if (used[seg]) { if (seg === s) closed = true; break; }
      used[seg] = 1;
      cur = nx ^ 1;
      fwd.push(cur);
    }
    if (closed) {
      fwd.pop(); // the last exit coincides with the first entry
      chains.push({ ends: fwd, closed: true });
      continue;
    }
    const back: number[] = [];
    cur = 2 * s;
    for (;;) {
      const p = partner[cur];
      if (p < 0) break;
      const seg = p >> 1;
      if (used[seg]) break;
      used[seg] = 1;
      cur = p ^ 1;
      back.push(cur);
    }
    back.reverse();
    chains.push({ ends: back.concat(fwd), closed: false });
  }
  return chains;
}
