/**
 * meta/tournament.js — tournament arenas: one entry fee, a few lives, and your
 * best score of the session on a leaderboard.
 *
 * Pure meta logic: money, scoring, ranking and persistence. NO DOM, NO canvas,
 * and nothing about how a game is played — the arena only ever sees the result
 * of a finished table.
 *
 * Phase 2: `board()` is the one function a real backend replaces. Everything
 * else (entry, lives, scoring, prize brackets) is authoritative client state
 * that Cloud Functions should re-verify before paying out.
 */

import { COIN } from './wallet.js';

const HOUR = 3600000;

/**
 * Prize brackets, paid when the arena session ends. `upto` is inclusive, so the
 * first bracket a rank falls into wins.
 */
const PRIZES = Object.freeze([
  { upto: 1, factor: 8 },
  { upto: 3, factor: 4 },
  { upto: 10, factor: 2 },
  { upto: 25, factor: 1 },
]);

export const ARENAS = Object.freeze([
  {
    id: 'allDay',
    titleKey: 'tour.all',
    subKey: 'tour.ranking',
    entry: 50000,
    seats: 4,
    lives: 3,
    durationMs: 24 * HOUR,
    field: 40,
  },
  {
    id: 'blitz',
    titleKey: 'tour.blitz',
    subKey: 'tour.blitzSub',
    entry: 10000,
    seats: 2,
    lives: 5,
    durationMs: 2 * HOUR,
    field: 24,
  },
]);

export function arenaById(id) {
  return ARENAS.find((a) => a.id === id) || ARENAS[0];
}

/** Points for finishing a table. Winning matters most, but effort counts. */
export const RANK_POINTS = Object.freeze([500, 250, 120, 60]);

/**
 * Score one finished table.
 * @param {object} r { rank, players, finished, captures, turns }
 * @returns {number}
 */
export function scoreGame(r = {}) {
  const rank = Math.max(1, Math.min(4, Number(r.rank) || 4));
  const base = RANK_POINTS[rank - 1];
  const home = (Number(r.finished) || 0) * 40;
  const kills = (Number(r.captures) || 0) * 25;
  // A short win is worth more than a long one, but never less than the base.
  const turns = Number(r.turns) || 0;
  const speed = rank === 1 && turns > 0 ? Math.max(0, Math.round((120 - Math.min(120, turns)) * 2.5)) : 0;
  return base + home + kills + speed;
}

/**
 * Deterministic score for a simulated rival, so the table does not reshuffle
 * every time the screen repaints.
 */
function rivalScore(player, arena, salt) {
  const seed = hash(player.id + ':' + arena.id + ':' + salt);
  const spread = arena.id === 'blitz' ? 900 : 1500;
  return 260 + Math.floor((seed % 1000) / 1000 * spread) + Math.min(600, (player.level || 1) * 12);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {object} o { save, bus, wallet, account, social, now }
 */
export function createTournament(o) {
  const { save, wallet, account, social } = o;
  const bus = o.bus || null;
  const now = o.now || (() => Date.now());
  const data = save.get('tournament');

  const emit = (name, payload) => {
    if (bus) bus.emit(name, payload);
  };

  function blank() {
    return { entered: false, lives: 0, best: 0, games: 0, startedAt: 0, endsAt: 0, salt: 0 };
  }

  /** Live session for an arena, expiring itself when the clock runs out. */
  function session(arenaId) {
    const arena = arenaById(arenaId);
    if (!data[arena.id]) {
      data[arena.id] = blank(arena);
      save.touch('tournament');
    }
    return data[arena.id];
  }

  function timeLeft(arenaId) {
    const s = session(arenaId);
    if (!s.entered) return 0;
    return Math.max(0, s.endsAt - now());
  }

  function expired(arenaId) {
    const s = session(arenaId);
    return s.entered && timeLeft(arenaId) <= 0;
  }

  const api = {
    ARENAS,
    arenaById,
    scoreGame,

    /** Read-only snapshot for the UI. */
    state(arenaId) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      return {
        arena,
        entered: !!s.entered,
        lives: s.lives,
        best: s.best,
        games: s.games,
        endsAt: s.endsAt,
        msLeft: timeLeft(arena.id),
        expired: expired(arena.id),
        canPlay: !!s.entered && s.lives > 0 && timeLeft(arena.id) > 0,
      };
    },

    /**
     * Pay the entry fee and open a session.
     * @returns {boolean} false when the player cannot cover it
     */
    enter(arenaId) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      if (s.entered && timeLeft(arena.id) > 0) return true;
      if (!wallet.spend(COIN, arena.entry, 'tournament:' + arena.id)) return false;
      const at = now();
      data[arena.id] = {
        entered: true,
        lives: arena.lives,
        best: 0,
        games: 0,
        startedAt: at,
        endsAt: at + arena.durationMs,
        salt: at,
      };
      save.touch('tournament');
      emit('tour:entered', { arena: arena.id, entry: arena.entry, lives: arena.lives });
      return true;
    },

    /**
     * Spend a life to start a game.
     * @returns {boolean} false when there is nothing left to spend
     */
    useLife(arenaId) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      if (!s.entered || s.lives <= 0 || timeLeft(arena.id) <= 0) return false;
      s.lives -= 1;
      save.touch('tournament');
      emit('tour:lives', { arena: arena.id, lives: s.lives });
      return true;
    },

    /** An extra life, e.g. after a rewarded video. */
    addLife(arenaId, count = 1) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      if (!s.entered) return 0;
      s.lives += count;
      save.touch('tournament');
      emit('tour:lives', { arena: arena.id, lives: s.lives });
      return s.lives;
    },

    /**
     * Record a finished table. Only your best score of the session counts.
     * @returns {{score:number, best:number, improved:boolean}}
     */
    submit(arenaId, result) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      const score = scoreGame(result);
      s.games += 1;
      const improved = score > s.best;
      if (improved) s.best = score;
      save.touch('tournament');
      if (account && score > 0) account.addXp(Math.round(score / 20), 'tournament');
      emit('tour:score', { arena: arena.id, score, best: s.best, improved, lives: s.lives });
      return { score, best: s.best, improved };
    },

    /**
     * The leaderboard: rivals plus you, sorted. Deterministic per session, so it
     * only moves when a score actually changes.
     */
    board(arenaId) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      const pool = social ? social.pool().slice(0, arena.field) : [];
      const rows = pool.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        frame: p.frame,
        level: p.level,
        score: rivalScore(p, arena, s.salt || 0),
        isMe: false,
      }));
      const me = social ? social.me() : { id: 'me', name: 'You', level: 1 };
      rows.push({
        id: me.id,
        name: me.name,
        avatar: me.avatar,
        frame: me.frame,
        level: me.level,
        score: s.best,
        isMe: true,
      });
      rows.sort((a, b) => b.score - a.score || (a.isMe ? 1 : 0) - (b.isMe ? 1 : 0));
      rows.forEach((row, i) => {
        row.rank = i + 1;
        row.prize = api.prizeFor(arena.id, row.rank);
      });
      return rows;
    },

    /** Where you stand right now. */
    myRank(arenaId) {
      const row = api.board(arenaId).find((r) => r.isMe);
      return row ? row.rank : 0;
    },

    /** Coins a rank is worth when the arena closes. */
    prizeFor(arenaId, rank) {
      const arena = arenaById(arenaId);
      for (const bracket of PRIZES) {
        if (rank <= bracket.upto) return arena.entry * bracket.factor;
      }
      return 0;
    },

    /**
     * Close an expired session and pay the prize for the final rank.
     * @returns {{closed:boolean, rank:number, prize:number}}
     */
    settle(arenaId) {
      const arena = arenaById(arenaId);
      const s = session(arena.id);
      if (!s.entered || timeLeft(arena.id) > 0) return { closed: false, rank: 0, prize: 0 };
      const rank = s.games > 0 ? api.myRank(arena.id) : 0;
      const prize = s.games > 0 ? api.prizeFor(arena.id, rank) : 0;
      if (prize > 0) wallet.earn(COIN, prize, 'tournament-prize:' + arena.id);
      data[arena.id] = blank(arena);
      save.touch('tournament');
      emit('tour:closed', { arena: arena.id, rank, prize });
      return { closed: true, rank, prize };
    },

    /** Tests and debugging only. */
    _session: session,
  };

  return api;
}
