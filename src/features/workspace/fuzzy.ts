/**
 * Fuzzy matcher for the command palette. Subsequence match (case-insensitive) scored for:
 * word-start hits, consecutive runs, an early first hit and a prefix match; shorter targets win ties.
 * Returns the matched character indices for highlighting.
 */
export interface FuzzyMatch { score: number; indices: number[] }

const isSep = (c: string) => c === ' ' || c === '-' || c === '_' || c === '/' || c === '·' || c === '→' || c === '.' || c === '(' || c === ':';

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  // fast reject
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
  if (j < q.length) return null;

  // dynamic programme over (query char, text position) for the best-scoring alignment
  const n = q.length, m = t.length;
  const NEG = -1e9;
  const score: Float64Array[] = Array.from({ length: n }, () => new Float64Array(m).fill(NEG));
  const from: Int32Array[] = Array.from({ length: n }, () => new Int32Array(m).fill(-1));
  const bonusAt = (i: number) => {
    if (i === 0) return 9;
    const p = text[i - 1];
    if (isSep(p)) return 7;
    const c = text[i];
    if (p === p.toLowerCase() && c !== c.toLowerCase()) return 5; // camelCase hump
    return 0;
  };
  for (let a = 0; a < n; a++) {
    if (q[a] === ' ') {
      // a space in the query matches any separator (or is skipped for free)
      for (let i = 0; i < m; i++) {
        const prev = a === 0 ? 0 : i > 0 ? bestBefore(score[a - 1], i) : NEG;
        if (prev > NEG / 2) { score[a][i] = prev; from[a][i] = -2; }
      }
      continue;
    }
    for (let i = 0; i < m; i++) {
      if (t[i] !== q[a]) continue;
      const base = 1 + bonusAt(i);
      if (a === 0) { score[a][i] = base - Math.min(i, 12) * 0.25; continue; }
      let best = NEG, arg = -1;
      for (let k = 0; k < i; k++) {
        const pv = score[a - 1][k];
        if (pv <= NEG / 2) continue;
        const consecutive = k === i - 1 && from[a - 1][k] !== -2 ? 6 : 0;
        const gap = k === i - 1 ? 0 : Math.min(i - k - 1, 8) * 0.15;
        const v = pv + consecutive - gap;
        if (v > best) { best = v; arg = k; }
      }
      if (arg >= 0) { score[a][i] = best + base; from[a][i] = arg; }
    }
  }
  let end = -1, top = NEG;
  for (let i = 0; i < m; i++) if (score[n - 1][i] > top) { top = score[n - 1][i]; end = i; }
  if (end < 0) return null;
  // backtrack
  const indices: number[] = [];
  let i = end;
  for (let a = n - 1; a >= 0 && i >= 0; a--) {
    if (q[a] === ' ') {
      // walk back to the best cell of the previous query char before i
      if (a > 0) i = argBestBefore(score[a - 1], i);
      continue;
    }
    indices.push(i);
    i = from[a][i];
  }
  indices.reverse();
  let s = top;
  if (t.startsWith(q)) s += 10;
  s -= m * 0.02; // shorter targets first
  return { score: s, indices };
}

function bestBefore(row: Float64Array, i: number) {
  let b = -1e9;
  for (let k = 0; k < i; k++) if (row[k] > b) b = row[k];
  return b;
}
function argBestBefore(row: Float64Array, i: number) {
  let b = -1e9, arg = -1;
  for (let k = 0; k < i; k++) if (row[k] > b) { b = row[k]; arg = k; }
  return arg;
}

/** Filter + rank items; `keys` gives the searchable strings (first is the label used for highlighting). */
export function fuzzyFilter<T>(items: readonly T[], query: string, keys: (it: T) => string[]): { item: T; score: number; indices: number[] }[] {
  if (!query.trim()) return items.map(item => ({ item, score: 0, indices: [] }));
  const out: { item: T; score: number; indices: number[] }[] = [];
  for (const item of items) {
    const ks = keys(item);
    let best: FuzzyMatch | null = null, bestIdx = -1;
    ks.forEach((k, ki) => {
      const r = fuzzyMatch(query, k);
      if (r) {
        const sc = ki === 0 ? r.score : r.score - 3; // label beats keywords
        if (!best || sc > best.score) { best = { score: sc, indices: r.indices }; bestIdx = ki; }
      }
    });
    if (best) out.push({ item, score: (best as FuzzyMatch).score, indices: bestIdx === 0 ? (best as FuzzyMatch).indices : [] });
  }
  return out.sort((a, b) => b.score - a.score);
}
