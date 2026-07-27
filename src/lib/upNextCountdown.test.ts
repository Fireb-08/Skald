// The "Up next" countdown (Auto-Play Next roadmap, Phase 4). Every case here is
// a way the prompt could start a book the listener did not ask for, or start it
// twice — which is why the machine is testable at all.
import { describe, expect, it } from 'vitest';
import { countdownReducer as reduce, startCountdown } from './upNextCountdown';

describe('countdown', () => {
  it('counts down and plays when it reaches zero', () => {
    let st = startCountdown(3);
    expect(st).toEqual({ status: 'counting', secondsLeft: 3 });
    st = reduce(st, { type: 'tick' });
    st = reduce(st, { type: 'tick' });
    expect(st).toEqual({ status: 'counting', secondsLeft: 1 });
    st = reduce(st, { type: 'tick' });
    expect(st).toEqual({ status: 'playing', secondsLeft: 0 });
  });

  it('short-circuits on "Play now"', () => {
    const st = reduce(startCountdown(10), { type: 'play-now' });
    expect(st).toEqual({ status: 'playing', secondsLeft: 0 });
  });

  it('stops everything on cancel', () => {
    let st = reduce(startCountdown(5), { type: 'cancel' });
    expect(st.status).toBe('cancelled');
    // A tick already in flight when Cancel was clicked must not resurrect it —
    // this is the case that would start a declined book.
    st = reduce(st, { type: 'tick' });
    st = reduce(st, { type: 'tick' });
    st = reduce(st, { type: 'tick' });
    st = reduce(st, { type: 'tick' });
    st = reduce(st, { type: 'tick' });
    expect(st.status).toBe('cancelled');
    // Nor may a late "Play now" from a double-click.
    expect(reduce(st, { type: 'play-now' }).status).toBe('cancelled');
  });

  it('reaches "playing" exactly once', () => {
    // The caller starts playback on entering `playing`; a second entry would
    // open a second session for the same book.
    let st = reduce(startCountdown(1), { type: 'tick' });
    expect(st.status).toBe('playing');
    const after = [
      reduce(st, { type: 'tick' }),
      reduce(st, { type: 'play-now' }),
      reduce(st, { type: 'cancel' }),
    ];
    for (const next of after) expect(next).toBe(st); // identity: no re-entry
    st = reduce(st, { type: 'tick' });
    expect(st.secondsLeft).toBe(0);
  });

  it('restarts cleanly for the next item', () => {
    const done = reduce(startCountdown(2), { type: 'cancel' });
    expect(reduce(done, { type: 'start', seconds: 10 })).toEqual({ status: 'counting', secondsLeft: 10 });
  });

  it('never starts negative, and rounds a stored fraction', () => {
    expect(startCountdown(-5)).toEqual({ status: 'counting', secondsLeft: 0 });
    expect(startCountdown(9.6)).toEqual({ status: 'counting', secondsLeft: 10 });
    // A zero-second start plays on the first tick rather than hanging.
    expect(reduce(startCountdown(0), { type: 'tick' }).status).toBe('playing');
  });
});
