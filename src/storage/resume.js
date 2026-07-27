/**
 * storage/resume.js — "Resume last game?" support.
 *
 * Stores the serialized engine state (versioned JSON) plus the little bit of
 * setup the UI needs to rebuild the screen. Because the snapshot is exactly
 * engine/state.js#serialize output, Phase 2 can push the same blob to Firestore.
 */

import { deserialize, serialize } from '../engine/state.js';
import { createStore } from './prefs.js';

const KEY = 'ludoBattle.resume.v1';
/** Older than this and we do not offer to resume. */
export const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export function createResume() {
  const store = createStore(KEY);

  return {
    /** Persist a snapshot. Called on every state change (cheap: one JSON write). */
    save(state, meta = {}) {
      if (!state || state.phase === 'gameOver') return false;
      try {
        return store.write({
          v: 1,
          at: Date.now(),
          state: serialize(state),
          meta,
        });
      } catch (err) {
        return false;
      }
    },

    /** @returns {{state:object, meta:object, at:number}|null} */
    load() {
      const raw = store.read();
      if (!raw || raw.v !== 1 || !raw.state) return null;
      if (Date.now() - (raw.at || 0) > MAX_AGE_MS) {
        store.remove();
        return null;
      }
      try {
        const state = deserialize(raw.state);
        if (state.phase === 'gameOver') {
          store.remove();
          return null;
        }
        return { state, meta: raw.meta || {}, at: raw.at };
      } catch (err) {
        store.remove(); // corrupt or from an unsupported schema
        return null;
      }
    },

    has() {
      return this.load() !== null;
    },

    /** Short human summary for the resume prompt. */
    describe() {
      const saved = this.load();
      if (!saved) return null;
      const s = saved.state;
      const mode = s.mode;
      const names = s.players.map((p) => p.name).join(', ');
      const done = s.players.reduce((n, p) => n + p.finished, 0);
      return { mode, names, turnCount: s.turnCount, finished: done, at: saved.at, players: s.players.length };
    },

    clear() {
      store.remove();
    },

    get persistent() {
      return store.ok;
    },
  };
}
