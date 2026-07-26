/**
 * sync/local.js — LocalAdapter: the Phase 1 default.
 *
 * Everything happens on this device, so "the network" is a loopback: actions are
 * echoed back on a microtask so the controller exercises exactly the same code
 * path it will use with Firebase in Phase 2. Every seat is local and this device
 * is always authoritative (it owns the dice).
 */

import { BaseAdapter, SYNC_STATUS } from './adapter.js';

export class LocalAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.echo] echo local actions back through onRemoteMove
   *        (off by default: the controller already applied them locally)
   */
  constructor(opts = {}) {
    super();
    this.echo = opts.echo === true;
    this.log = [];
    this.status = SYNC_STATUS.OFFLINE;
  }

  async connect() {
    this.status = SYNC_STATUS.ONLINE;
    this._emitPlayers([]);
    return undefined;
  }

  async disconnect() {
    this.status = SYNC_STATUS.OFFLINE;
    this.log.length = 0;
    return super.disconnect();
  }

  /** Records the action (handy for replay/debug) and optionally echoes it. */
  async sendMove(action) {
    this.log.push(action);
    if (this.echo) Promise.resolve().then(() => this._emitRemote(action));
  }

  presence() {
    return { status: this.status, seats: [], self: null, local: true, actions: this.log.length };
  }

  isAuthoritative() {
    return true; // this device rolls the dice
  }

  isLocalSeat() {
    return true; // every seat is played here (human or bot)
  }

  /** Full action list — replaying it reproduces the game exactly. */
  history() {
    return this.log.slice();
  }
}

/** Convenience factory. */
export function createLocalAdapter(opts) {
  return new LocalAdapter(opts);
}
