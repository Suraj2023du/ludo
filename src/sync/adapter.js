/**
 * sync/adapter.js — the transport seam between the game and "the network".
 *
 * PHASE 1 uses LocalAdapter (sync/local.js): everything happens on one device.
 * PHASE 2 (Google AI Studio + Firebase) implements FirebaseAdapter with the very
 * same interface and passes it to createController(). NOTHING in engine/ changes.
 *
 * ── CONTRACT ─────────────────────────────────────────────────────────────────
 * An "action" is the only thing that ever crosses the wire. It is plain JSON:
 *
 *   { t: 'roll', seat: 0, value: 6,            n: 12, at: 1720000000000 }
 *   { t: 'move', seat: 0, tokenIndex: 2, to: 8, n: 13, at: 1720000000001 }
 *
 *   t     'roll' | 'move'
 *   seat  index into state.players (NOT a uid — the room maps uid → seat)
 *   n     monotonically increasing action counter, used to reject duplicates
 *         and to order actions deterministically
 *
 * Because engine/rules.js is pure, replaying the same ordered action list on
 * any device produces a byte-identical state (proved by
 * tests/sim.test.js → "identical seeds replay identically").
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {Object} SyncAdapter
 * @property {(room?: object) => Promise<void>} connect
 * @property {() => Promise<void>} disconnect
 * @property {(action: object) => Promise<void>} sendMove   broadcast a local action
 * @property {(cb: (action: object) => void) => (() => void)} onRemoteMove
 * @property {(cb: (players: object[]) => void) => (() => void)} onPlayersChanged
 * @property {() => object} presence   { status, seats, self }
 * @property {() => boolean} isAuthoritative  true when this device owns the dice
 * @property {(seat: number) => boolean} isLocalSeat  can this device act for the seat?
 */

export const SYNC_STATUS = Object.freeze({
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  ONLINE: 'online',
  ERROR: 'error',
});

export const ACTION = Object.freeze({ ROLL: 'roll', MOVE: 'move' });

/**
 * Runtime shape check — call it in Phase 2 right after constructing
 * FirebaseAdapter to fail fast instead of debugging silent no-ops.
 * @param {SyncAdapter} adapter
 */
export function assertAdapter(adapter) {
  const required = [
    'connect',
    'disconnect',
    'sendMove',
    'onRemoteMove',
    'onPlayersChanged',
    'presence',
    'isAuthoritative',
    'isLocalSeat',
  ];
  const missing = required.filter((k) => typeof adapter?.[k] !== 'function');
  if (missing.length) {
    throw new Error('SyncAdapter is missing: ' + missing.join(', '));
  }
  return adapter;
}

/** Build a well-formed roll action. */
export function rollAction(seat, value, n) {
  return { t: ACTION.ROLL, seat, value, n, at: Date.now() };
}

/** Build a well-formed move action. */
export function moveAction(seat, move, n) {
  return { t: ACTION.MOVE, seat, tokenIndex: move.tokenIndex, to: move.to, n, at: Date.now() };
}

/**
 * Base class with the no-op defaults. Extending it is optional — any object
 * satisfying the contract works.
 */
export class BaseAdapter {
  constructor() {
    this.status = SYNC_STATUS.OFFLINE;
    this._remote = new Set();
    this._players = new Set();
  }

  async connect() {
    this.status = SYNC_STATUS.ONLINE;
  }

  async disconnect() {
    this.status = SYNC_STATUS.OFFLINE;
    this._remote.clear();
    this._players.clear();
  }

  async sendMove() {}

  onRemoteMove(cb) {
    this._remote.add(cb);
    return () => this._remote.delete(cb);
  }

  onPlayersChanged(cb) {
    this._players.add(cb);
    return () => this._players.delete(cb);
  }

  presence() {
    return { status: this.status, seats: [], self: null };
  }

  isAuthoritative() {
    return true;
  }

  isLocalSeat() {
    return true;
  }

  /** Protected: push an inbound action to subscribers. */
  _emitRemote(action) {
    for (const cb of [...this._remote]) cb(action);
  }

  /** Protected: push a roster change to subscribers. */
  _emitPlayers(players) {
    for (const cb of [...this._players]) cb(players);
  }
}
