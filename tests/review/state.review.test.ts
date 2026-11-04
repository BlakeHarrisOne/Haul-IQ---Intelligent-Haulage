/**
 * Independent review: src/state/** (store undo/redo).
 */
import { describe, expect, it, vi } from 'vitest';
import { useApp, emptyScenario } from '@/state/store';

describe('review: store.commit', () => {
  it('R-STATE-1 a no-op commit (fn returns the same scenario) must not push history or wipe redo', () => {
    vi.useFakeTimers();
    const st = useApp.getState();
    st.replaceScenario(emptyScenario('A'), { markClean: true });
    useApp.getState().commit('rename', s => ({ ...s, name: 'B' }));
    useApp.getState().undo();                      // back to A, redo holds "rename"
    expect(useApp.getState().future.length).toBe(1);
    const pastBefore = useApp.getState().past.length;
    // a handler that decides nothing changed returns its input unchanged
    useApp.getState().commit('noop', s => s);
    const after = useApp.getState();
    // Expected: no-op ignored (the guard `if (next === prev) return` is meant for this)
    expect(after.past.length).toBe(pastBefore);
    expect(after.future.length).toBe(1);           // redo of "rename" still available
    expect(after.dirty).toBe(false);
    vi.useRealTimers();
  });
});
