import { describe, expect, it } from 'vitest';
import { fmtGrade, fmtLen, legReadout, lineReduce, nextName, snapTo, type ClickLine } from './machine';

const P = (e: number, n: number, z = 0) => ({ e, n, z });

describe('lineReduce (draw / measure click-points)', () => {
  const empty: ClickLine = { pts: [], done: false };

  it('adds points, ignores a second click on the same spot, finishes on double-click', () => {
    let s = lineReduce(empty, { type: 'click', p: P(0, 0) }).state;
    s = lineReduce(s, { type: 'click', p: P(0.3, 0) }).state;      // the double-click's second click
    expect(s.pts).toHaveLength(1);
    expect(lineReduce(s, { type: 'dblclick' }).action).toBeNull(); // needs ≥ 2 points
    s = lineReduce(s, { type: 'click', p: P(50, 0) }).state;
    const r = lineReduce(s, { type: 'dblclick' });
    expect(r.action).toBe('finish');
    expect(r.state.done).toBe(true);
  });

  it('Backspace drops the last point, Enter finishes, Esc cancels then exits', () => {
    let s = lineReduce(empty, { type: 'click', p: P(0, 0) }).state;
    s = lineReduce(s, { type: 'click', p: P(10, 0) }).state;
    s = lineReduce(s, { type: 'click', p: P(20, 0) }).state;
    s = lineReduce(s, { type: 'backspace' }).state;
    expect(s.pts).toHaveLength(2);
    expect(lineReduce(s, { type: 'enter' }).action).toBe('finish');
    const c = lineReduce(s, { type: 'escape' });
    expect(c.action).toBe('cancel');
    expect(c.state.pts).toHaveLength(0);
    expect(lineReduce(c.state, { type: 'escape' }).action).toBe('exit');
  });

  it('a click after finishing starts a new line', () => {
    const done: ClickLine = { pts: [P(0, 0), P(5, 5)], done: true };
    const s = lineReduce(done, { type: 'click', p: P(9, 9) }).state;
    expect(s.done).toBe(false);
    expect(s.pts).toEqual([P(9, 9)]);
  });
});

describe('readouts and helpers', () => {
  it('leg readout: grade is rise over plan run', () => {
    const r = legReadout(P(0, 0, 100), P(30, 40, 104));
    expect(r.plan).toBeCloseTo(50);
    expect(r.grade).toBeCloseTo(0.08);
    expect(r.d3).toBeCloseTo(Math.hypot(50, 4));
    expect(r.rl).toBe(104);
  });

  it('snaps to the nearest candidate inside the radius', () => {
    const c = [{ e: 0, n: 0, id: 'a' }, { e: 50, n: 0, id: 'b' }];
    expect(snapTo(P(40, 5), c, 60)?.id).toBe('b');
    expect(snapTo(P(200, 0), c, 60)).toBeNull();
  });

  it('names new strings without collisions', () => {
    expect(nextName([])).toBe('String 1');
    expect(nextName(['EX09 → S51', 'String 2'])).toBe('String 3');
    expect(nextName(['a', 'b', 'c'])).toBe('String 4');
  });

  it('formats lengths and grades', () => {
    expect(fmtLen(8.25)).toBe('8.3 m');
    expect(fmtLen(1234)).toBe('1.23 km');
    expect(fmtGrade(0.0812)).toBe('+8.1 %');
    expect(fmtGrade(-0.1)).toBe('−10.0 %');
    expect(fmtGrade(0)).toBe('0.0 %');
  });
});
