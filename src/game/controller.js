/**
 * game/controller.js — the turn loop.
 *
 * The controller is the ONLY owner of the live state. It consumes engine/rules.js
 * (pure) and publishes everything through the event bus. It knows nothing about
 * the DOM or canvas: visual timing is injected as an "animator" whose methods
 * return promises, so tests can run the very same loop instantly.
 *
 *   human turn  → emit TURN_BEGIN → wait for controller.roll() / selectToken()
 *   bot turn    → think → roll → think → move   (all awaited, all animated)
 *   remote turn → wait for adapter.onRemoteMove (Phase 2)
 *
 * Nothing here mutates a state object; every transition goes through
 * applyRoll() / applyMove() and replaces the reference.
 */

import { PHASE, PLAYER_TYPE, currentPlayer, rollDie } from '../engine/state.js';
import { EV, applyMove, applyRoll, legalMoves } from '../engine/rules.js';
import { chooseMove } from '../engine/ai.js';
import { EVENTS } from './events.js';
import { ACTION, moveAction, rollAction } from '../sync/adapter.js';

/** Milliseconds, at "normal" animation speed. */
export const DEFAULT_TIMING = Object.freeze({
  diceRoll: 560, // dice spin
  step: 110, // per board cell (spec: ~110ms, eased)
  capture: 380, // captured token flying back to base
  finish: 260,
  botThink: 620, // bot "thinking" pause before it rolls
  botMove: 380, // bot pause between roll and move
  pass: 800, // how long a "no moves" toast holds the game
  turnGap: 160,
});

export const SPEED_FACTOR = Object.freeze({ slow: 1.5, normal: 1, fast: 0.55 });

const noop = () => { };

/**
 * @param {object} opts
 * @param {object} opts.state    initial state from createInitialState/deserialize
 * @param {object} opts.bus      event bus (game/events.js)
 * @param {object} [opts.adapter] SyncAdapter (Phase 1: LocalAdapter)
 * @param {() => number} [opts.rng]
 * @param {object} [opts.timing]
 * @param {boolean} [opts.autoMoveSingle] auto-play when only one move is legal
 */
export function createController(opts) {
  const bus = opts.bus;
  const adapter = opts.adapter || null;
  const rng = opts.rng || Math.random;
  const autoMoveSingle = opts.autoMoveSingle !== false;

  let state = opts.state;
  let timing = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  let animator = {};
  let gate = null; // async hook before a NEW human seat acts (pass & play)
  let lastGatedSeat = -1;

  let running = false; // the pump is inside an async sequence
  let paused = false;
  let destroyed = false;
  let started = false;
  let awaitingHuman = false;
  let actionSeq = 0;
  const timers = new Set();
  let unsubRemote = noop;

  /* ─────────────────────────────── plumbing ─────────────────────────────── */

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
    bus.emit(EVENTS.STATE_CHANGED, { state, reason });
  }

  function seatIsLocal(seat) {
    if (!adapter || typeof adapter.isLocalSeat !== 'function') return true;
    return adapter.isLocalSeat(seat) !== false;
  }

  async function send(action) {
    if (!adapter || typeof adapter.sendMove !== 'function') return;
    try {
      await adapter.sendMove(action);
    } catch (err) {
      bus.emit(EVENTS.SYNC_STATUS, { status: 'error', error: String(err) });
    }
  }

  /* ─────────────────────────────── the pump ─────────────────────────────── */

  async function pump() {
    if (running || destroyed) return;
    running = true;
    try {
      while (!destroyed && !paused) {
        if (state.phase === PHASE.GAME_OVER) {
          bus.emit(EVENTS.MOVES_CLEARED, {});
          return;
        }

        const player = currentPlayer(state);

        // Not our device's seat (Phase 2 online play): idle until an action arrives.
        if (!seatIsLocal(state.turn)) {
          awaitingHuman = false;
          bus.emit(EVENTS.TURN_BEGIN, { player, playerId: player.id, remote: true });
          return;
        }

        if (state.phase === PHASE.AWAIT_ROLL) {
          // Pass-and-play privacy screen: only when the seat actually changes.
          if (gate && player.type === PLAYER_TYPE.HUMAN && lastGatedSeat !== state.turn) {
            lastGatedSeat = state.turn;
            await gate(player, state);
            if (destroyed || paused) return;
          }

          if (player.type === PLAYER_TYPE.BOT) {
            lastGatedSeat = state.turn;
            bus.emit(EVENTS.TURN_BEGIN, { player, playerId: player.id, bot: true });
            await wait(timing.botThink);
            if (destroyed || paused) return;
            await performRoll();
            continue;
          }

          awaitingHuman = true;
          bus.emit(EVENTS.TURN_BEGIN, { player, playerId: player.id, bot: false });
          return; // wait for controller.roll()
        }

        if (state.phase === PHASE.AWAIT_MOVE) {
          const moves = legalMoves(state, state.dice);

          if (player.type === PLAYER_TYPE.BOT) {
            await wait(timing.botMove);
            if (destroyed || paused) return;
            const move = chooseMove(state, state.dice, state.turn, { rng, level: player.botLevel });
            await performMove(move || moves[0]);
            continue;
          }

          if (moves.length === 1 && autoMoveSingle) {
            bus.emit(EVENTS.MOVES_AVAILABLE, {
              moves,
              playerId: player.id,
              dice: state.dice,
              auto: true,
            });
            await wait(Math.round(timing.turnGap * 1.5));
            if (destroyed || paused) return;
            await performMove(moves[0]);
            continue;
          }

          awaitingHuman = true;
          bus.emit(EVENTS.MOVES_AVAILABLE, { moves, playerId: player.id, dice: state.dice });
          return; // wait for controller.selectToken()
        }

        return; // unknown phase — never happens, but never spin either
      }
    } finally {
      running = false;
    }
  }

  /* ──────────────────────────────── rolling ─────────────────────────────── */

  async function performRoll(forcedValue, fromRemote = false) {
    if (destroyed || state.phase !== PHASE.AWAIT_ROLL) return;
    awaitingHuman = false;
    const seat = state.turn;
    const player = currentPlayer(state);
    const value = Number.isInteger(forcedValue) ? forcedValue : rollDie(rng);

    bus.emit(EVENTS.MOVES_CLEARED, {});
    bus.emit(EVENTS.ROLL_START, { playerId: player.id, color: player.color, value });

    // Spin first, reveal the result second — that is what makes it feel physical.
    await (animator.roll ? animator.roll(value, player) : wait(timing.diceRoll));
    if (destroyed) return;

    const res = applyRoll(state, value);
    setState(res.state, 'roll');
    bus.emitAll(res.events);

    if (!fromRemote) await send(rollAction(seat, value, ++actionSeq));

    const kinds = res.events.map((e) => e.type);
    // Toasts carry a translation key: the controller never speaks a language.
    if (kinds.includes(EV.THREE_SIXES)) {
      bus.emit(EVENTS.TOAST, { key: 'game.threeSix', kind: 'warn' });
      await wait(timing.pass);
    } else if (kinds.includes(EV.NO_MOVES)) {
      bus.emit(EVENTS.TOAST, { key: 'game.noMoves', vars: { name: player.name }, kind: 'info' });
      await wait(timing.pass);
    }
  }

  /* ──────────────────────────────── moving ──────────────────────────────── */

  async function performMove(move, fromRemote = false) {
    if (destroyed || !move || state.phase !== PHASE.AWAIT_MOVE) return;
    awaitingHuman = false;
    const seat = state.turn;
    bus.emit(EVENTS.MOVES_CLEARED, {});

    const res = applyMove(state, move);
    setState(res.state, 'move');
    if (!fromRemote) await send(moveAction(seat, move, ++actionSeq));

    // Replay the engine's event list in order, pausing for each animation so the
    // sound, the haptics and the pixels stay in sync.
    for (const ev of res.events) {
      if (destroyed) return;
      bus.emit(ev.type, ev);
      if (ev.type === EV.TOKEN_MOVED) {
        await (animator.move ? animator.move(ev) : wait(ev.path.length * timing.step));
      } else if (ev.type === EV.TOKEN_CAPTURED) {
        await (animator.capture ? animator.capture(ev) : wait(timing.capture));
      } else if (ev.type === EV.TOKEN_FINISHED) {
        await (animator.finish ? animator.finish(ev) : wait(timing.finish));
      }
    }
    if (!destroyed) await wait(timing.turnGap);
  }

  /* ───────────────────────────── public surface ─────────────────────────── */

  const api = {
    /** Live state (read-only by convention — never mutate it). */
    get state() {
      return state;
    },
    get paused() {
      return paused;
    },
    get timing() {
      return { ...timing };
    },

    /** Legal moves for the player in turn, or [] when it is not move time. */
    currentMoves() {
      return state.phase === PHASE.AWAIT_MOVE ? legalMoves(state, state.dice) : [];
    },

    /** Is the local human allowed to press the dice right now? */
    canRoll() {
      if (destroyed || paused || state.phase !== PHASE.AWAIT_ROLL) return false;
      if (!seatIsLocal(state.turn)) return false;
      return currentPlayer(state).type === PLAYER_TYPE.HUMAN && awaitingHuman;
    },

    /** Is the local human expected to pick a token right now? */
    canMove() {
      if (destroyed || paused || state.phase !== PHASE.AWAIT_MOVE) return false;
      if (!seatIsLocal(state.turn)) return false;
      return currentPlayer(state).type === PLAYER_TYPE.HUMAN && awaitingHuman;
    },

    start() {
      if (started || destroyed) return api;
      started = true;
      if (adapter && typeof adapter.onRemoteMove === 'function') {
        unsubRemote = adapter.onRemoteMove((action) => api.applyRemoteAction(action));
      }
      bus.emit(EVENTS.GAME_STARTED, { state });
      pump();
      return api;
    },

    /** Human pressed the dice. */
    roll() {
      if (!api.canRoll()) return false;
      (async () => {
        await performRoll();
        await pump();
      })();
      return true;
    },

    /** Human tapped a token (index within the current player's 4 tokens). */
    selectToken(tokenIndex) {
      if (!api.canMove()) return false;
      const move = api.currentMoves().find((m) => m.from === state.players[state.turn].tokens[tokenIndex]);
      if (!move) {
        bus.emit(EVENTS.MOVE_REJECTED, { tokenIndex, reason: 'no-legal-move' });
        return false;
      }
      return api.selectMove({ ...move, tokenIndex });
    },

    /** Human picked a concrete move object. */
    selectMove(move) {
      if (!api.canMove() || !move) return false;
      (async () => {
        await performMove(move);
        await pump();
      })();
      return true;
    },

    /** Inbound action from another device (Phase 2). */
    async applyRemoteAction(action) {
      if (destroyed || !action) return;
      bus.emit(EVENTS.SYNC_REMOTE_ACTION, action);
      try {
        if (action.t === ACTION.ROLL) {
          if (state.turn !== action.seat) return;
          await performRoll(action.value, true);
        } else if (action.t === ACTION.MOVE) {
          if (state.turn !== action.seat) return;
          await performMove({ tokenIndex: action.tokenIndex, to: action.to }, true);
        }
      } catch (err) {
        bus.emit(EVENTS.MOVE_REJECTED, { action, reason: String(err) });
      }
      await pump();
    },

    pause() {
      if (paused || destroyed) return;
      paused = true;
      bus.emit(EVENTS.PAUSED, { state });
    },

    resume() {
      if (!paused || destroyed) return;
      paused = false;
      bus.emit(EVENTS.RESUMED, { state });
      // A gated seat must be re-confirmed after a pause.
      pump();
    },

    /** Animation hooks (render layer). Every method returns a promise. */
    setAnimator(next) {
      animator = next || {};
      return api;
    },

    /** Async gate before a NEW human seat plays — the pass-the-phone screen. */
    setGate(fn) {
      gate = typeof fn === 'function' ? fn : null;
      return api;
    },

    /** Re-arm the gate so the next human turn shows the privacy screen again. */
    resetGate() {
      lastGatedSeat = -1;
      return api;
    },

    setTiming(next) {
      timing = { ...timing, ...(next || {}) };
      return api;
    },

    /** Apply a speed preset ('slow' | 'normal' | 'fast'). */
    setSpeed(speed) {
      const f = SPEED_FACTOR[speed] || 1;
      const scaled = {};
      for (const k of Object.keys(DEFAULT_TIMING)) scaled[k] = Math.round(DEFAULT_TIMING[k] * f);
      timing = scaled;
      return api;
    },

    /** Kick the loop (after resume/rehydrate). */
    kick() {
      pump();
      return api;
    },

    destroy() {
      destroyed = true;
      paused = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      unsubRemote();
      unsubRemote = noop;
      bus.emit(EVENTS.ABORTED, {});
    },
  };

  return api;
}
