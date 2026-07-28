/**
 * game/timer.js — per-turn countdown with auto-play on timeout.
 *
 * No DOM. Lives outside engine/ on purpose: the engine has no concept of time.
 * The HUD draws the ring by listening to 'timer:tick'; this module only decides
 * when time runs out and then plays the bot's choice through the normal
 * controller path, so events, sounds and animations are identical to a human move.
 */

import { chooseMove } from '../engine/ai.js';
import { PHASE, PLAYER_TYPE, currentPlayer } from '../engine/state.js';
import { EV } from '../engine/rules.js';
import { EVENTS } from './events.js';

export const TIMER_OPTIONS = Object.freeze([0, 15, 30]);
export const DEFAULT_SECONDS = 0; // 0 = off

/**
 * @param {object} o { controller, bus, seconds, rng, onExpire }
 */
export function createTurnTimer(o) {
  const { controller, bus } = o;
  let seconds = Number.isFinite(o.seconds) ? o.seconds : DEFAULT_SECONDS;
  const rng = o.rng || Math.random;

  let deadline = 0;
  let handle = 0;
  let armedFor = -1; // seat the clock is running for
  let stopped = false;

  const enabled = () => seconds > 0;

  function clear() {
    if (handle) clearInterval(handle);
    handle = 0;
    armedFor = -1;
    deadline = 0;
  }

  function announce(left) {
    bus.emit('timer:tick', {
      seat: armedFor,
      left,
      total: seconds,
      ratio: seconds ? Math.max(0, left / seconds) : 0,
      running: armedFor >= 0,
    });
  }

  /** Time is up: play something legal so the table never stalls. */
  function expire() {
    const state = controller.state;
    clear();
    announce(0);
    if (stopped || state.phase === PHASE.GAME_OVER) return;

    bus.emit(EVENTS.TOAST, { key: 'game.autoPlayed', kind: 'warn' });
    if (o.onExpire) o.onExpire(state.turn);

    if (controller.canRoll()) {
      controller.roll();
      return;
    }
    if (controller.canMove()) {
      const move = chooseMove(state, state.dice, state.turn, { rng, level: 'normal' });
      const fallback = controller.currentMoves()[0];
      controller.selectMove(move || fallback);
    }
  }

  /** Start (or restart) the clock for the seat in turn, if it needs one. */
  function arm() {
    if (stopped || !enabled()) return;
    const state = controller.state;
    if (!state || state.phase === PHASE.GAME_OVER) {
      clear();
      return;
    }
    const player = currentPlayer(state);
    // Bots move on their own schedule; only local humans get a clock.
    if (!player || player.type !== PLAYER_TYPE.HUMAN) {
      clear();
      announce(0);
      return;
    }
    if (controller.paused) return;

    armedFor = state.turn;
    deadline = Date.now() + seconds * 1000;
    if (handle) clearInterval(handle);
    handle = setInterval(() => {
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      announce(left);
      if (left <= 0) expire();
    }, 250);
    if (handle && typeof handle.unref === 'function') handle.unref();
    announce(seconds);
  }

  /* The clock restarts whenever the player's options change. */
  bus.on(EVENTS.TURN_BEGIN, arm);
  bus.on(EVENTS.MOVES_AVAILABLE, arm);
  bus.on(EV.TOKEN_MOVED, () => {
    clear();
    announce(0);
  });
  bus.on(EV.GAME_OVER, () => {
    clear();
    announce(0);
  });
  bus.on(EVENTS.PAUSED, () => {
    if (handle) clearInterval(handle);
    handle = 0;
  });
  bus.on(EVENTS.RESUMED, arm);
  bus.on(EVENTS.ABORTED, () => {
    stopped = true;
    clear();
  });

  return {
    arm,
    get seconds() {
      return seconds;
    },
    setSeconds(next) {
      seconds = Number.isFinite(next) ? Math.max(0, next) : 0;
      clear();
      if (enabled()) arm();
      else announce(0);
      return seconds;
    },
    get running() {
      return armedFor >= 0;
    },
    get left() {
      return armedFor >= 0 ? Math.max(0, (deadline - Date.now()) / 1000) : 0;
    },
    stop() {
      stopped = true;
      clear();
      announce(0);
    },
    /** Test hook: fire the timeout immediately. */
    forceExpire: expire,
  };
}
