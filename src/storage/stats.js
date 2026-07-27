/**
 * storage/stats.js — per-mode lifetime stats in localStorage.
 * games played / wins / current streak / best streak / captures / podiums.
 */

import { createStore } from './prefs.js';

const KEY = 'ludoBattle.stats.v1';

const EMPTY_MODE = Object.freeze({
  games: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
  captures: 0,
  losses: 0,
  podiums: 0, // top-half finishes
  lastPlayed: 0,
});

export function createStats() {
  const store = createStore(KEY);
  let data = normalize(store.read());

  function normalize(raw) {
    const out = { v: 1, modes: {} };
    if (raw && raw.modes) {
      for (const [mode, m] of Object.entries(raw.modes)) {
        out.modes[mode] = { ...EMPTY_MODE, ...m };
      }
    }
    return out;
  }

  function forMode(mode) {
    if (!data.modes[mode]) data.modes[mode] = { ...EMPTY_MODE };
    return data.modes[mode];
  }

  return {
    /** Stats for one mode (a copy). */
    get(mode) {
      return { ...forMode(mode) };
    },

    /** Every mode's stats, plus a rolled-up total. */
    all() {
      const modes = {};
      let total = { ...EMPTY_MODE };
      for (const [mode, m] of Object.entries(data.modes)) {
        modes[mode] = { ...m };
        total.games += m.games;
        total.wins += m.wins;
        total.captures += m.captures;
        total.losses += m.losses;
        total.podiums += m.podiums;
        total.bestStreak = Math.max(total.bestStreak, m.bestStreak);
      }
      return { modes, total };
    },

    /**
     * Record a finished game.
     * @param {string} mode
     * @param {object} result { won:boolean, rank:number, players:number, captures:number, losses:number }
     */
    record(mode, result) {
      const m = forMode(mode);
      m.games += 1;
      m.captures += result.captures || 0;
      m.losses += result.losses || 0;
      m.lastPlayed = Date.now();
      if (result.won) {
        m.wins += 1;
        m.streak += 1;
        m.bestStreak = Math.max(m.bestStreak, m.streak);
      } else {
        m.streak = 0;
      }
      if (result.rank && result.players && result.rank <= Math.ceil(result.players / 2)) {
        m.podiums += 1;
      }
      store.write(data);
      return { ...m };
    },

    winRate(mode) {
      const m = forMode(mode);
      return m.games ? m.wins / m.games : 0;
    },

    reset() {
      data = { v: 1, modes: {} };
      store.write(data);
    },

    get persistent() {
      return store.ok;
    },
  };
}
