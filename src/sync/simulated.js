/**
 * sync/simulated.js — SimulatedOnlineAdapter: online play with no server.
 *
 * It implements the SAME SyncAdapter contract as the future FirebaseAdapter, and
 * the remote seats really do arrive as actions through onRemoteMove() after a
 * latency delay. So the whole online code path — waiting for a seat this device
 * does not own, ordering by `n`, rejecting duplicate deliveries, applying
 * through controller.applyRemoteAction() — is exercised for real in Phase 1.
 * Phase 2 only changes where the actions come from.
 *
 * It plays the part of the SERVER, which is why it owns the action counter: like
 * a Firestore transaction or an RTDB `increment(1)`, it stamps `n` on everything
 * it accepts and ignores whatever number the client guessed. That single stream
 * is what makes a replay deterministic.
 *
 * PHASE 2: keep this file. It stays the practice/offline adapter; pass a
 * FirebaseAdapter instead when the player is signed in and a room exists.
 */

import { chooseMove } from '../engine/ai.js';
import { PHASE, currentPlayer } from '../engine/state.js';
import { ACTION, BaseAdapter, SYNC_STATUS, moveAction, rollAction } from './adapter.js';
import { EVENTS } from '../game/events.js';

export const DEFAULT_LATENCY = Object.freeze({ min: 260, max: 900 });

export class SimulatedOnlineAdapter extends BaseAdapter {
  /**
   * @param {object} o
   * @param {object} o.bus              event bus — how it learns whose turn it is
   * @param {() => object} o.getState   live state accessor
   * @param {number} [o.mySeat]         the seat this device plays
   * @param {() => number} [o.rng]
   * @param {object} [o.latency]        { min, max } in ms
   * @param {string[]} [o.levels]       bot level per seat, for the remote players
   * @param {boolean} [o.spectator]     true = watch only, every seat is remote
   */
  constructor(o) {
    super();
    this.bus = o.bus;
    this.getState = o.getState;
    this.mySeat = Number.isInteger(o.mySeat) ? o.mySeat : 0;
    this.rng = o.rng || Math.random;
    this.latency = { ...DEFAULT_LATENCY, ...(o.latency || {}) };
    this.levels = o.levels || [];
    this.spectator = o.spectator === true;
    this.room = null;

    this.seq = 0; // the server's action counter
    this.log = []; // ordered, deduplicated action log
    this.pending = ''; // "seat:phase" a delivery is already scheduled for
    this.timers = new Set();
    this.unsubs = [];
    this.status = SYNC_STATUS.OFFLINE;
  }

  /* ───────────────────────────── contract ────────────────────────────── */

  async connect(room) {
    this.status = SYNC_STATUS.CONNECTING;
    this.room = room || null;
    await this._wait(this._lag());
    if (this.status !== SYNC_STATUS.CONNECTING) return; // disconnected mid-handshake
    this.status = SYNC_STATUS.ONLINE;
    this._emitPlayers(this.seats());
    this.bus.emit(EVENTS.SYNC_STATUS, { status: this.status, simulated: true, room: this.room });

    // TURN_BEGIN is emitted for every decision point of a seat this device does
    // not own, in both the roll and the move phase, so it is the only hook the
    // adapter needs.
    this.unsubs.push(this.bus.on(EVENTS.TURN_BEGIN, () => this._maybeAct()));
    // The game may have started before the handshake finished (connect() is not
    // awaited), so check once for a turn that is already waiting on us.
    this._maybeAct();
  }

  async disconnect() {
    for (const un of this.unsubs) un();
    this.unsubs.length = 0;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.pending = '';
    await super.disconnect();
    if (this.bus) this.bus.emit(EVENTS.SYNC_STATUS, { status: this.status });
  }

  /**
   * A local action reaches the server. It is renumbered, exactly like a backend
   * assigning the next slot in the log.
   */
  async sendMove(action) {
    if (!action) return;
    this._append({ ...action, n: ++this.seq });
  }

  presence() {
    return {
      status: this.status,
      seats: this.seats(),
      self: this.spectator ? null : this.mySeat,
      simulated: true,
      actions: this.log.length,
    };
  }

  /** This device owns the dice for its own seat — unless it is only watching. */
  isAuthoritative() {
    return !this.spectator;
  }

  isLocalSeat(seat) {
    if (this.spectator) return false;
    return seat === this.mySeat;
  }

  /** Roster in the shape the UI expects. */
  seats() {
    const state = this.getState ? this.getState() : null;
    if (!state || !state.players) return [];
    return state.players.map((p) => ({
      seat: p.id,
      name: p.name,
      colour: p.color,
      connected: true,
      local: this.isLocalSeat(p.id),
    }));
  }

  /** The ordered action log — the same list a replay would consume. */
  history() {
    return this.log.slice();
  }

  /** Small summary for debugging and the HUD. */
  describe() {
    const state = this.getState ? this.getState() : null;
    const player = state && state.players ? currentPlayer(state) : null;
    return {
      status: this.status,
      turn: player ? player.name : '',
      actions: this.log.length,
      spectator: this.spectator,
      room: this.room,
    };
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  _lag() {
    const { min, max } = this.latency;
    return Math.round(min + this.rng() * Math.max(0, max - min));
  }

  _wait(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        this.timers.delete(id);
        resolve();
      }, ms);
      this.timers.add(id);
      if (id && typeof id.unref === 'function') id.unref();
    });
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    if (id && typeof id.unref === 'function') id.unref();
    return id;
  }

  /** Accept an already-numbered action. Used for everything the server stamps. */
  _append(action) {
    this.log.push(action);
    return action;
  }

  /**
   * Accept an inbound action, rejecting a number the log already holds. This is
   * the duplicate-delivery guard a real listener needs: Firestore and RTDB can
   * both replay a write.
   * @returns {boolean} true when it was new
   */
  _record(action) {
    if (!action || typeof action.n !== 'number') return false;
    if (this.log.some((a) => a.n === action.n)) return false;
    this._append(action);
    if (action.n > this.seq) this.seq = action.n;
    return true;
  }

  /** Does a seat this device does not own owe the table an action? */
  _maybeAct() {
    if (this.status !== SYNC_STATUS.ONLINE) return;
    const state = this.getState ? this.getState() : null;
    if (!state || state.phase === PHASE.GAME_OVER) return;
    if (this.isLocalSeat(state.turn)) return;

    const seat = state.turn;
    const phase = state.phase;
    const key = seat + ':' + phase + ':' + this.log.length;
    if (this.pending === key) return; // already on its way
    this.pending = key;
    this._later(() => {
      if (this.pending === key) this.pending = '';
      this._deliver(seat, phase);
    }, this._lag());
  }

  /** Build the action a remote player would have sent, then push it inbound. */
  _deliver(seat, phase) {
    if (this.status !== SYNC_STATUS.ONLINE) return;
    const state = this.getState ? this.getState() : null;
    if (!state || state.phase === PHASE.GAME_OVER) return;
    if (state.turn !== seat || state.phase !== phase) return; // the table moved on

    let action = null;
    if (phase === PHASE.AWAIT_ROLL) {
      action = rollAction(seat, 1 + Math.floor(this.rng() * 6), this.seq + 1);
    } else if (phase === PHASE.AWAIT_MOVE) {
      const level = this.levels[seat] || 'hard';
      const move = chooseMove(state, state.dice, seat, { rng: this.rng, level });
      if (!move) return;
      action = moveAction(seat, move, this.seq + 1);
    }
    if (!action || !this._record(action)) return;
    this._emitRemote(action);
    // Whatever comes next (an extra turn, the following seat) arrives as another
    // TURN_BEGIN, which brings us back to _maybeAct().
  }
}

export function createSimulatedAdapter(o) {
  return new SimulatedOnlineAdapter(o);
}

export { ACTION };
