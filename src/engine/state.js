/**
 * engine/state.js — PURE game state + board topology.
 * ZERO DOM, ZERO canvas, ZERO imports outside engine/. JSON-serializable.
 *
 * Position model ("rel", relative to the token's own colour):
 *   -1 = base · 0..50 = shared ring (0 = start, 50 = HOME_ENTRY)
 *   51..56 = private home column (56 = FINISH, the centre)
 *   abs = (START_ABS[colour] + rel) % 52   → used for capture/collision
 * See README.md for the full table.
 */

export const SCHEMA_VERSION = 1;

/** Turn order is always this clockwise order (matches board geometry). */
export const COLORS = ['red', 'green', 'yellow', 'blue'];

export const TOKENS_PER_PLAYER = 4;

/** Shared ring size. */
export const TRACK_LEN = 52;
/** Steps inside the private home column, including the centre finish cell. */
export const HOME_LEN = 6;
/** Last shared-ring relative index (the cell you turn off into the home column). */
export const HOME_ENTRY = 50;
/** Relative index of the centre finish. */
export const FINISH = HOME_ENTRY + HOME_LEN; // 56
/** Sentinel for "token is still in the base". */
export const BASE = -1;

/**
 * Absolute ring index of each colour's start square.
 * Derived from the 15x15 cross geometry (13 ring cells per quadrant).
 * red → left arm home column, green → top, yellow → right, blue → bottom.
 */
export const START_ABS = Object.freeze({ red: 0, green: 13, yellow: 26, blue: 39 });

/** The 4 star (universally safe) squares — 8 cells after each start square. */
export const STAR_ABS = Object.freeze([8, 21, 34, 47]);

/** All 8 safe squares: 4 coloured start squares + 4 stars. */
export const SAFE_ABS = Object.freeze([0, 8, 13, 21, 26, 34, 39, 47]);

export const PHASE = Object.freeze({
  AWAIT_ROLL: 'awaitRoll',
  AWAIT_MOVE: 'awaitMove',
  GAME_OVER: 'gameOver',
});

export const MODE = Object.freeze({
  VS_COMPUTER: 'vsComputer',
  PASS_PLAY: 'passPlay',
  QUICK_MATCH: 'quickMatch',
});

export const PLAYER_TYPE = Object.freeze({ HUMAN: 'human', BOT: 'bot' });

/** Maximum consecutive sixes before the turn is forfeited. */
export const MAX_SIX_STREAK = 3;

/* ─────────────────────────── topology helpers ─────────────────────────── */

/** @returns {boolean} true when the token has not left its base. */
export const inBase = (rel) => rel === BASE;

/** @returns {boolean} true when the token stands on the shared ring. */
export const onTrack = (rel) => rel >= 0 && rel <= HOME_ENTRY;

/** @returns {boolean} true when the token is inside its private home column. */
export const inHomeColumn = (rel) => rel > HOME_ENTRY && rel < FINISH;

/** @returns {boolean} true when the token reached the centre. */
export const isHome = (rel) => rel === FINISH;

/** Absolute ring index for a colour-relative track position. */
export function toAbs(color, rel) {
  if (!onTrack(rel)) return -1;
  return (START_ABS[color] + rel) % TRACK_LEN;
}

/** Colour-relative position for an absolute ring index (may be > HOME_ENTRY). */
export function toRel(color, abs) {
  return (abs - START_ABS[color] + TRACK_LEN) % TRACK_LEN;
}

/** Is this absolute ring cell a safe square (start square or star)? */
export function isSafeAbs(abs) {
  return SAFE_ABS.indexOf(abs) !== -1;
}

/** Is the given colour-relative position a safe spot (safe ring cell or home)? */
export function isSafeRel(color, rel) {
  if (rel === BASE) return true;
  if (!onTrack(rel)) return true; // home column is private, hence safe
  return isSafeAbs(toAbs(color, rel));
}

/**
 * Distance still to travel to finish.
 * Base counts as a full lap + 1 so "furthest token" heuristics behave.
 */
export function distanceToHome(rel) {
  if (rel === BASE) return FINISH + 1;
  return FINISH - rel;
}

/* ───────────────────────────── deterministic RNG ───────────────────────── */

/**
 * Small deterministic PRNG (mulberry32). Not part of the state — dice rolling
 * lives outside the engine so remote (Phase 2) rolls can be injected instead.
 * @param {number} seed
 * @returns {() => number} float in [0,1)
 */
export function createRng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roll a die with an injectable RNG (pure w.r.t. the rng argument). */
export function rollDie(rng = Math.random) {
  return 1 + Math.floor(rng() * 6);
}

/* ─────────────────────────────── state factory ─────────────────────────── */

/**
 * @typedef {Object} PlayerConfig
 * @property {string} color   one of COLORS
 * @property {string} [name]
 * @property {'human'|'bot'} [type]
 * @property {'easy'|'normal'|'hard'} [botLevel]
 */

/**
 * @typedef {Object} GameConfig
 * @property {string} mode
 * @property {PlayerConfig[]} players
 * @property {number} [startingPlayer] index into the (colour-sorted) player list
 * @property {Object} [options]
 * @property {string} [id]
 */

const DEFAULT_OPTIONS = Object.freeze({
  /** Ludo King grants another turn when you capture an opponent. */
  extraTurnOnCapture: true,
  /** Rolling a 6 grants another turn. */
  extraTurnOnSix: true,
  /** Three consecutive sixes forfeits the whole turn. */
  threeSixForfeit: true,
});

/**
 * Build a brand-new, fully deterministic game state.
 * @param {GameConfig} config
 */
export function createInitialState(config) {
  if (!config || !Array.isArray(config.players)) {
    throw new Error('createInitialState: config.players is required');
  }
  const raw = config.players;
  if (raw.length < 2 || raw.length > 4) {
    throw new Error('createInitialState: 2 to 4 players required, got ' + raw.length);
  }
  const seen = new Set();
  for (const p of raw) {
    if (COLORS.indexOf(p.color) === -1) {
      throw new Error('createInitialState: unknown colour "' + p.color + '"');
    }
    if (seen.has(p.color)) {
      throw new Error('createInitialState: duplicate colour "' + p.color + '"');
    }
    seen.add(p.color);
  }

  // Seat order always follows board geometry (clockwise), never input order.
  const sorted = raw.slice().sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color));

  const players = sorted.map((p, i) => ({
    id: i,
    color: p.color,
    name: (p.name && String(p.name).trim()) || defaultName(p.color),
    type: p.type === PLAYER_TYPE.BOT ? PLAYER_TYPE.BOT : PLAYER_TYPE.HUMAN,
    botLevel: p.botLevel || 'hard',
    tokens: new Array(TOKENS_PER_PLAYER).fill(BASE),
    finished: 0,
    rank: 0, // 0 = still playing, otherwise 1..4
    captures: 0,
    losses: 0,
  }));

  const start = clampInt(config.startingPlayer, 0, players.length - 1, 0);

  return {
    v: SCHEMA_VERSION,
    id: config.id || 'g' + Date.now().toString(36),
    mode: config.mode || MODE.VS_COMPUTER,
    createdAt: Number.isFinite(config.createdAt) ? config.createdAt : Date.now(),
    players,
    turn: start,
    dice: null,
    sixStreak: 0,
    phase: PHASE.AWAIT_ROLL,
    ranks: [], // player ids, in finishing order
    turnCount: 0,
    rollCount: 0,
    moveCount: 0,
    options: { ...DEFAULT_OPTIONS, ...(config.options || {}) },
  };
}

function defaultName(color) {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/* ───────────────────────────── clone / accessors ───────────────────────── */

/** Structural clone of a game state (fast, allocation-minimal, JSON-safe). */
export function cloneState(state) {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, tokens: p.tokens.slice() })),
    ranks: state.ranks.slice(),
    options: { ...state.options },
  };
}

/** The player whose turn it is. */
export function currentPlayer(state) {
  return state.players[state.turn];
}

export function playerByColor(state, color) {
  return state.players.find((p) => p.color === color) || null;
}

/** Has this player brought all tokens home? */
export function playerDone(player) {
  return player.finished >= TOKENS_PER_PLAYER;
}

export function isGameOver(state) {
  return state.phase === PHASE.GAME_OVER;
}

/**
 * Every token currently standing on the given absolute ring cell.
 * @returns {{playerId:number, tokenIndex:number, color:string}[]}
 */
export function tokensAtAbs(state, abs) {
  const out = [];
  for (const p of state.players) {
    for (let i = 0; i < p.tokens.length; i++) {
      const rel = p.tokens[i];
      if (onTrack(rel) && toAbs(p.color, rel) === abs) {
        out.push({ playerId: p.id, tokenIndex: i, color: p.color });
      }
    }
  }
  return out;
}

/** Final standings, best first. Players still playing sort last. */
export function standings(state) {
  return state.players
    .slice()
    .sort((a, b) => {
      const ra = a.rank || 99;
      const rb = b.rank || 99;
      if (ra !== rb) return ra - rb;
      if (b.finished !== a.finished) return b.finished - a.finished;
      return progressOf(a) - progressOf(b) > 0 ? -1 : 1;
    })
    .map((p) => ({ id: p.id, name: p.name, color: p.color, rank: p.rank, finished: p.finished }));
}

/** Sum of forward progress of all a player's tokens (0 .. 4*FINISH). */
export function progressOf(player) {
  let sum = 0;
  for (const rel of player.tokens) sum += rel === BASE ? 0 : rel + 1;
  return sum;
}

/* ─────────────────────── serialize / deserialize (v1) ──────────────────── */

/**
 * Serialize to a compact JSON string. Versioned so Phase 2 stored documents
 * can be migrated instead of thrown away.
 */
export function serialize(state) {
  return JSON.stringify(toJSON(state));
}

/** Plain-object snapshot (what a DB document would hold). */
export function toJSON(state) {
  return {
    v: SCHEMA_VERSION,
    id: state.id,
    mode: state.mode,
    createdAt: state.createdAt,
    turn: state.turn,
    dice: state.dice,
    sixStreak: state.sixStreak,
    phase: state.phase,
    ranks: state.ranks.slice(),
    turnCount: state.turnCount,
    rollCount: state.rollCount,
    moveCount: state.moveCount,
    options: { ...state.options },
    players: state.players.map((p) => ({
      id: p.id,
      color: p.color,
      name: p.name,
      type: p.type,
      botLevel: p.botLevel,
      tokens: p.tokens.slice(),
      finished: p.finished,
      rank: p.rank,
      captures: p.captures,
      losses: p.losses,
    })),
  };
}

/**
 * Rebuild a state from a JSON string or plain object produced by serialize().
 * Throws on unknown/unsupported schema versions.
 */
export function deserialize(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object') throw new Error('deserialize: not an object');
  const migrated = migrate(data);
  validate(migrated);
  return {
    v: SCHEMA_VERSION,
    id: migrated.id,
    mode: migrated.mode,
    createdAt: migrated.createdAt,
    turn: migrated.turn,
    dice: migrated.dice === undefined ? null : migrated.dice,
    sixStreak: migrated.sixStreak || 0,
    phase: migrated.phase,
    ranks: (migrated.ranks || []).slice(),
    turnCount: migrated.turnCount || 0,
    rollCount: migrated.rollCount || 0,
    moveCount: migrated.moveCount || 0,
    options: { ...DEFAULT_OPTIONS, ...(migrated.options || {}) },
    players: migrated.players.map((p, i) => ({
      id: typeof p.id === 'number' ? p.id : i,
      color: p.color,
      name: p.name || defaultName(p.color),
      type: p.type === PLAYER_TYPE.BOT ? PLAYER_TYPE.BOT : PLAYER_TYPE.HUMAN,
      botLevel: p.botLevel || 'hard',
      tokens: p.tokens.slice(),
      finished: p.finished || 0,
      rank: p.rank || 0,
      captures: p.captures || 0,
      losses: p.losses || 0,
    })),
  };
}

/** Future-proofing hook: upgrade older documents to SCHEMA_VERSION. */
function migrate(data) {
  const v = data.v || 0;
  if (v === SCHEMA_VERSION) return data;
  if (v === 0) {
    // Pre-versioned snapshots never shipped; treat as v1 shape.
    return { ...data, v: SCHEMA_VERSION };
  }
  throw new Error('deserialize: unsupported schema version ' + v);
}

function validate(data) {
  if (!Array.isArray(data.players) || data.players.length < 2) {
    throw new Error('deserialize: invalid players');
  }
  for (const p of data.players) {
    if (COLORS.indexOf(p.color) === -1) throw new Error('deserialize: bad colour ' + p.color);
    if (!Array.isArray(p.tokens) || p.tokens.length !== TOKENS_PER_PLAYER) {
      throw new Error('deserialize: bad token array');
    }
    for (const rel of p.tokens) {
      if (!Number.isInteger(rel) || rel < BASE || rel > FINISH) {
        throw new Error('deserialize: token out of range ' + rel);
      }
    }
  }
  if (!Number.isInteger(data.turn) || data.turn < 0 || data.turn >= data.players.length) {
    throw new Error('deserialize: bad turn index');
  }
  const phases = Object.values(PHASE);
  if (phases.indexOf(data.phase) === -1) throw new Error('deserialize: bad phase ' + data.phase);
}

/**
 * Consistency check used by tests / the simulation harness.
 * @returns {string[]} list of violations (empty = state is legal)
 */
export function auditState(state) {
  const errs = [];
  if (state.v !== SCHEMA_VERSION) errs.push('bad version');
  if (!state.players || state.players.length < 2) errs.push('bad player count');
  if (state.turn < 0 || state.turn >= state.players.length) errs.push('turn out of range');
  if (Object.values(PHASE).indexOf(state.phase) === -1) errs.push('bad phase');
  if (state.dice !== null && (state.dice < 1 || state.dice > 6)) errs.push('bad dice ' + state.dice);
  if (state.sixStreak < 0 || state.sixStreak > MAX_SIX_STREAK) errs.push('bad sixStreak');

  const occupancy = new Map(); // abs -> Set(colors)
  for (const p of state.players) {
    if (p.tokens.length !== TOKENS_PER_PLAYER) errs.push(p.color + ': token count');
    let done = 0;
    for (const rel of p.tokens) {
      if (!Number.isInteger(rel)) errs.push(p.color + ': non-integer token ' + rel);
      else if (rel < BASE || rel > FINISH) errs.push(p.color + ': token out of range ' + rel);
      if (rel === FINISH) done++;
      if (onTrack(rel)) {
        const abs = toAbs(p.color, rel);
        if (!occupancy.has(abs)) occupancy.set(abs, new Set());
        occupancy.get(abs).add(p.color);
      }
    }
    if (done !== p.finished) errs.push(p.color + ': finished mismatch ' + p.finished + '!=' + done);
    if (p.rank < 0 || p.rank > state.players.length) errs.push(p.color + ': bad rank');
    if (p.rank > 0 && done !== TOKENS_PER_PLAYER && state.phase !== PHASE.GAME_OVER) {
      errs.push(p.color + ': ranked without finishing');
    }
  }

  // Two different colours may only share a cell when that cell is safe.
  for (const [abs, colors] of occupancy) {
    if (colors.size > 1 && !isSafeAbs(abs)) {
      errs.push('illegal co-occupancy at ' + abs + ' by ' + [...colors].join('+'));
    }
  }

  // ranks must be a prefix-consistent list of unique ids
  const uniq = new Set(state.ranks);
  if (uniq.size !== state.ranks.length) errs.push('duplicate ranks');
  state.ranks.forEach((pid, i) => {
    const p = state.players[pid];
    if (!p) errs.push('rank references unknown player ' + pid);
    else if (p.rank !== i + 1) errs.push('rank order mismatch for ' + p.color);
  });
  return errs;
}
