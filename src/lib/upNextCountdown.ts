// The "Up next" prompt's state machine (Auto-Play Next roadmap, Phase 4).
//
// Separated from the panel that renders it because the failure that matters is
// a timing one: a countdown that keeps ticking after Cancel starts a book the
// listener declined, and one that can fire twice opens two sessions. Both are
// invisible in a component test and obvious in a reducer.

export type CountdownStatus = 'counting' | 'playing' | 'cancelled';

export interface CountdownState {
  status: CountdownStatus;
  secondsLeft: number;
}

export type CountdownAction =
  | { type: 'start'; seconds: number }
  | { type: 'tick' }
  | { type: 'play-now' }
  | { type: 'cancel' };

export function startCountdown(seconds: number): CountdownState {
  return { status: 'counting', secondsLeft: Math.max(0, Math.round(seconds)) };
}

/** `playing` is terminal: the caller starts playback on entering it, so any
 *  further action must leave it alone — a late tick or a second click on
 *  "Play now" must not produce a second start. */
export function countdownReducer(state: CountdownState, action: CountdownAction): CountdownState {
  if (action.type === 'start') return startCountdown(action.seconds);
  // Once resolved (played or cancelled) the prompt is over; nothing reopens it
  // but a new `start`.
  if (state.status !== 'counting') return state;

  switch (action.type) {
    case 'tick': {
      const secondsLeft = state.secondsLeft - 1;
      return secondsLeft <= 0
        ? { status: 'playing', secondsLeft: 0 }
        : { status: 'counting', secondsLeft };
    }
    case 'play-now':
      return { status: 'playing', secondsLeft: 0 };
    case 'cancel':
      return { status: 'cancelled', secondsLeft: state.secondsLeft };
  }
}
