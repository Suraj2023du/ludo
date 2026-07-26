/**
 * game/events.js — the single event bus.
 *
 * EVERY game event flows through here. Rendering, HUD, audio, haptics,
 * persistence and (Phase 2) chat / presence / analytics all subscribe; nobody
 * reaches into the engine or mutates state.
 *
 *   bus.on('token:captured', fn)   // one event
 *   bus.onAny((type, payload) => ...)  // firehose (useful for logging/analytics)
 *
 * Engine event names are re-exported from engine/rules.js so there is exactly
 * one source of truth for the strings.
 */

import { EV } from '../engine/rules.js';

/** Engine events + app-level events. Phase 2 adds its own under `sync:`/`chat:`. */
export const EVENTS = Object.freeze({
  // ── engine (emitted verbatim from rules.js) ──
  DICE_ROLLED: EV.DICE_ROLLED,
  SIX: EV.SIX,
  THREE_SIXES: EV.THREE_SIXES,
  NO_MOVES: EV.NO_MOVES,
  TURN_CHANGED: EV.TURN_CHANGED,
  EXTRA_TURN: EV.EXTRA_TURN,
  TOKEN_EXITED: EV.TOKEN_EXITED,
  TOKEN_MOVED: EV.TOKEN_MOVED,
  TOKEN_CAPTURED: EV.TOKEN_CAPTURED,
  TOKEN_FINISHED: EV.TOKEN_FINISHED,
  PLAYER_FINISHED: EV.PLAYER_FINISHED,
  GAME_OVER: EV.GAME_OVER,

  // ── controller / app ──
  GAME_STARTED: 'game:started',
  GAME_RESUMED: 'game:resumedGame',
  STATE_CHANGED: 'state:changed',
  TURN_BEGIN: 'turn:begin',
  ROLL_START: 'dice:rollStart',
  MOVES_AVAILABLE: 'moves:available',
  MOVES_CLEARED: 'moves:cleared',
  MOVE_REJECTED: 'moves:rejected',
  PAUSED: 'game:paused',
  RESUMED: 'game:resumed',
  ABORTED: 'game:aborted',
  TOAST: 'ui:toast',
  PASS_DEVICE: 'ui:passDevice',

  // ── Phase 2 reserved (documented so nobody invents new strings) ──
  SYNC_STATUS: 'sync:status',
  SYNC_PLAYERS: 'sync:players',
  SYNC_REMOTE_ACTION: 'sync:remoteAction',
  CHAT_MESSAGE: 'chat:message',
});

/**
 * Create an event bus.
 * Listeners are called in subscription order; a throwing listener is reported
 * but never breaks the emit loop (a broken HUD must not freeze the game).
 */
export function createEventBus({ onError } = {}) {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @type {Set<Function>} */
  const anyListeners = new Set();

  const report =
    onError ||
    ((err, type) => {
      if (typeof console !== 'undefined') console.error('[bus] listener failed for ' + type, err);
    });

  function on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.on: handler must be a function');
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(fn);
    return () => off(type, fn); // unsubscribe
  }

  function once(type, fn) {
    const un = on(type, (payload) => {
      un();
      fn(payload);
    });
    return un;
  }

  function off(type, fn) {
    const set = listeners.get(type);
    if (set) {
      set.delete(fn);
      if (set.size === 0) listeners.delete(type);
    }
  }

  function onAny(fn) {
    anyListeners.add(fn);
    return () => anyListeners.delete(fn);
  }

  function emit(type, payload = {}) {
    const set = listeners.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload, type);
        } catch (err) {
          report(err, type);
        }
      }
    }
    for (const fn of [...anyListeners]) {
      try {
        fn(type, payload);
      } catch (err) {
        report(err, type);
      }
    }
  }

  /** Emit a batch of engine events ({type, ...payload} objects). */
  function emitAll(events) {
    for (const ev of events || []) emit(ev.type, ev);
  }

  function clear() {
    listeners.clear();
    anyListeners.clear();
  }

  function count(type) {
    return type ? (listeners.get(type) || { size: 0 }).size : listeners.size;
  }

  return { on, once, off, onAny, emit, emitAll, clear, count, EVENTS };
}
