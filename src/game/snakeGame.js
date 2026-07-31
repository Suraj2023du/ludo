/**
 * game/snakeGame.js — the Snakes & Ladders turn loop.
 *
 * Same shape as game/controller.js: it owns the live state, consumes the pure
 * engine, and publishes everything through the bus. No DOM, no canvas — visual
 * timing is injected as an animator whose methods return promises, so a test can
 * run the identical loop instantly.
 *
 * Events are namespaced `snake:*` and deliberately do NOT reuse the Ludo event
 * names, so both games can share one bus without one wiring up the other's
 * screens or resume snapshot.
 */

import {
  SEV,
  SNAKE_PHASE,
  applySnakeRoll,
  createSnakeState,
  currentSnakePlayer,
  rollSnakeDie,
} from '../engine/snakes.js';
import { EVENTS } from './events.js';

/** Milliseconds at "normal" speed. */
export const SNAKE_TIMING = Object.freeze({
  diceRoll: 520,
  hop: 120, // per cell walked
  jump: 520, // sliding down a snake / climbing a ladder
  botThink: 620,
  turnGap: 220,
  blocked: 700,
});

export const SNAKE_EVENTS = Object.freeze({
  STARTED: 'snake:started',
  STATE: 'snake:state',
  TURN: 'snake:turn',
  ROLL_START: 'snake:rollStart',
  ENDED: 'snake:ended',
});

const SPEED = Object.freeze({ slow: 1.5, normal: 1, fast: 0.55 });

/**
 * @param {object} opts { state | setup, bus, rng, timing }
 */
export function createSnakeController(opts) {
  const bus = opts.bus;
  const rng = opts.rng || Math.random;

  let state = opts.state || createSnakeState(opts.setup || {});
  let timing = { ...SNAKE_TIMING, ...(opts.timing || {}) };
  let animator = {};
  let running = false;
  let paused = false;
  let destroyed = false;
  let started = false;
  let awaitingHuman = false;
  const timers = new Set();

  function wait(ms) {
    if (!ms || ms <= 0 || destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        timers.delete(id);
        resolve();
      }, ms);
      timers.add(id);
    });
  }

  function setState(next, reason) {
    state = next;
    bus.emit(SNAKE_EVENTS.STATE, { state, reason });
  }

  /* ─────────────────────────────── the pump ───────────────────────────── */

  async function pump() {
    if (running || destroyed) return;
    running = true;
    try {
      while (!destroyed && !paused) {
        if (state.phase === SNAKE_PHASE.GAME_OVER) return;
        const player = currentSnakePlayer(state);

        if (player.type === 'bot') {
          awaitingHuman = false;
          bus.emit(SNAKE_EVENTS.TURN, { player, playerId: player.id, bot: true });
          await wait(timing.botThink);
          if (destroyed || paused) return;
          await performRoll();
          continue;
        }

        awaitingHuman = true;
        bus.emit(SNAKE_EVENTS.TURN, { player, playerId: player.id, bot: false });
        return; // wait for api.roll()
      }
    } finally {
      running = false;
    }
  }

  /* ─────────────────────────────── rolling ────────────────────────────── */

  async function performRoll(forced) {
    if (destroyed || state.phase === SNAKE_PHASE.GAME_OVER) return;
    awaitingHuman = false;
    const player = currentSnakePlayer(state);
    const value = Number.isInteger(forced) ? forced : rollSnakeDie(rng);

    bus.emit(SNAKE_EVENTS.ROLL_START, { playerId: player.id, color: player.color, value });
    await (animator.roll ? animator.roll(value, player) : wait(timing.diceRoll));
    if (destroyed) return;

    const res = applySnakeRoll(state, value);
    setState(res.state, 'roll');

    // Replay the engine's events in order, pausing for each animation so sound,
    // haptics and pixels stay together.
    for (const ev of res.events) {
      if (destroyed) return;
      bus.emit(ev.type, ev);
      if (ev.type === SEV.MOVED) {
        await (animator.walk ? animator.walk(ev) : wait(Math.abs(ev.to - ev.from) * timing.hop));
      } else if (ev.type === SEV.CLIMBED || ev.type === SEV.BITTEN) {
        await (animator.jump ? animator.jump(ev) : wait(timing.jump));
      } else if (ev.type === SEV.BLOCKED) {
        bus.emit(EVENTS.TOAST, { key: 'snake.exact', vars: { n: ev.need }, kind: 'info' });
        await wait(timing.blocked);
      } else if (ev.type === SEV.GAME_OVER) {
        bus.emit(SNAKE_EVENTS.ENDED, ev);
      }
    }
    if (!destroyed) await wait(timing.turnGap);
  }

  /* ────────────────────────────── public api ──────────────────────────── */

  const api = {
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    get timing() {
      return { ...timing };
    },

    /** Is the local human allowed to press the dice right now? */
    canRoll() {
      if (destroyed || paused) return false;
      if (state.phase !== SNAKE_PHASE.AWAIT_ROLL) return false;
      return currentSnakePlayer(state).type === 'human' && awaitingHuman;
    },

    start() {
      if (started || destroyed) return api;
      started = true;
      bus.emit(SNAKE_EVENTS.STARTED, { state });
      pump();
      return api;
    },

    roll() {
      if (!api.canRoll()) return false;
      (async () => {
        await performRoll();
        await pump();
      })();
      return true;
    },

    /** Deterministic roll, for tests and for replaying a log. */
    force(value) {
      if (destroyed || state.phase === SNAKE_PHASE.GAME_OVER) return false;
      (async () => {
        await performRoll(value);
        await pump();
      })();
      return true;
    },

    pause() {
      if (paused || destroyed) return;
      paused = true;
    },

    resume() {
      if (!paused || destroyed) return;
      paused = false;
      pump();
    },

    setAnimator(next) {
      animator = next || {};
      return api;
    },

    setTiming(next) {
      timing = { ...timing, ...(next || {}) };
      return api;
    },

    setSpeed(speed) {
      const f = SPEED[speed] || 1;
      const scaled = {};
      for (const k of Object.keys(SNAKE_TIMING)) scaled[k] = Math.round(SNAKE_TIMING[k] * f);
      timing = scaled;
      return api;
    },

    kick() {
      pump();
      return api;
    },

    destroy() {
      destroyed = true;
      paused = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };

  return api;
}
