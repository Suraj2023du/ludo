/**
 * engine/snakes.js — Snakes & Ladders, as a pure engine.
 *
 * ZERO DOM, ZERO canvas, ZERO imports outside engine/. JSON-serializable.
 * Same contract as engine/rules.js: every function takes a state and returns a
 * NEW state plus an ordered event list. Nothing here mutates its input, so a
 * replay of the same rolls always produces the same board.
 *
 * Board model
 *   cell 0   = off the board (everyone starts here)
 *   cell 1   = bottom-left, numbering snakes left→right, then right→left one row
 *              up (boustrophedon), so cell 100 is top-left
 *   cell 100 = the finish
 *
 * A single token per player means a player never has a choice to make: the roll
 * IS the move. That is why there is no legalMoves()/applyMove() pair here — the
 * only decision in the game is whose turn it is.
 */

export const SNAKES_SCHEMA_VERSION = 1;

export const BOARD_SIZE = 10;
export const LAST_CELL = 100;
export const OFF_BOARD = 0;

/** The classic board. Ladders climb, snakes bite. */
export const LADDERS = Object.freeze({
  1: 38,
  4: 14,
  9: 31,
  21: 42,
  28: 84,
  36: 44,
  51: 67,
  71: 91,
  80: 100,
});

export const SNAKES = Object.freeze({
  16: 6,
  47: 26,
  49: 11,
  56: 53,
  62: 19,
  64: 60,
  87: 24,
  93: 73,
  95: 75,
  98: 78,
});

export const SNAKE_PHASE = Object.freeze({
  AWAIT_ROLL: 'awaitRoll',
  GAME_OVER: 'gameOver',
});

/** Event types. Namespaced so they can share a bus with the Ludo events. */
export const SEV = Object.freeze({
  ROLLED: 'snake:rolled',
  MOVED: 'snake:moved',
  BLOCKED: 'snake:blocked',
  CLIMBED: 'snake:climbed',
  BITTEN: 'snake:bitten',
  FINISHED: 'snake:finished',
  TURN_PASSED: 'snake:turnPassed',
  EXTRA_TURN: 'snake:extraTurn',
  GAME_OVER: 'snake:gameOver',
});

export const DEFAULT_SNAKE_OPTIONS = Object.freeze({
  /** You must roll the exact number to land on 100. */
  exactFinish: true,
  /** Rolling a 6 gives you another turn. */
  extraTurnOnSix: true,
  /**
   * How many 6s in a row before the extra turn stops (0 = unlimited). The move
   * itself still counts: unlike Ludo, Snakes & Ladders does not void the roll,
   * it only takes the bonus turn away.
   */
  maxSixesInARow: 3,
});

/* ─────────────────────────────── geometry ──────────────────────────────── */

/**
 * Grid position of a cell, in board coordinates where (0,0) is the BOTTOM-LEFT.
 * @param {number} cell 1..100
 * @returns {{col:number, row:number}}
 */
export function cellToGrid(cell) {
  const n = Math.max(1, Math.min(LAST_CELL, Math.round(cell))) - 1;
  const row = Math.floor(n / BOARD_SIZE);
  const along = n % BOARD_SIZE;
  // odd rows run right→left
  const col = row % 2 === 0 ? along : BOARD_SIZE - 1 - along;
  return { col, row };
}

/** Inverse of cellToGrid. */
export function gridToCell(col, row) {
  const along = row % 2 === 0 ? col : BOARD_SIZE - 1 - col;
  return row * BOARD_SIZE + along + 1;
}

/** The jump a cell triggers, or null. */
export function jumpAt(cell) {
  if (LADDERS[cell]) return { kind: 'ladder', to: LADDERS[cell] };
  if (SNAKES[cell]) return { kind: 'snake', to: SNAKES[cell] };
  return null;
}

/** Every jump as a list, handy for drawing and for tests. */
export function allJumps() {
  const out = [];
  for (const from of Object.keys(LADDERS)) out.push({ kind: 'ladder', from: Number(from), to: LADDERS[from] });
  for (const from of Object.keys(SNAKES)) out.push({ kind: 'snake', from: Number(from), to: SNAKES[from] });
  return out.sort((a, b) => a.from - b.from);
}

/* ──────────────────────────────── state ────────────────────────────────── */

/**
 * @param {object} config { id, createdAt, players:[{name,color,type,botLevel}], startingPlayer, options }
 */
export function createSnakeState(config = {}) {
  const players = (config.players || []).map((p, i) => ({
    id: i,
    name: p.name || 'Player ' + (i + 1),
    color: p.color || ['red', 'green', 'yellow', 'blue'][i % 4],
    type: p.type === 'bot' ? 'bot' : 'human',
    botLevel: p.botLevel || 'hard',
    cell: OFF_BOARD,
    rank: 0,
    climbs: 0,
    bites: 0,
    sixes: 0,
    moves: 0,
  }));
  if (players.length < 2) throw new Error('snakes: need at least 2 players');

  const start = Number.isInteger(config.startingPlayer) ? config.startingPlayer : 0;
  return {
    v: SNAKES_SCHEMA_VERSION,
    id: config.id || 's' + Date.now().toString(36),
    game: 'snakes',
    createdAt: Number.isFinite(config.createdAt) ? config.createdAt : Date.now(),
    players,
    turn: Math.max(0, Math.min(players.length - 1, start)),
    dice: 0,
    sixStreak: 0,
    phase: SNAKE_PHASE.AWAIT_ROLL,
    rollCount: 0,
    turnCount: 1,
    ranks: [],
    options: { ...DEFAULT_SNAKE_OPTIONS, ...(config.options || {}) },
  };
}

export function currentSnakePlayer(state) {
  return state.players[state.turn];
}

/** Deep copy. States are always JSON-safe, which is what makes this valid. */
function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

/** Seat of the next player who has not finished yet. */
function nextSeat(state, from) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const seat = (from + step) % n;
    if (state.players[seat].rank === 0) return seat;
  }
  return from;
}

/** Everyone still playing, in board order. */
export function activePlayers(state) {
  return state.players.filter((p) => p.rank === 0);
}

export function isSnakeGameOver(state) {
  return state.phase === SNAKE_PHASE.GAME_OVER;
}

/**
 * Where a roll would take a player, before any jump.
 * @returns {{to:number, blocked:boolean}} blocked = the roll cannot be played
 */
export function targetOf(state, cell, value) {
  const raw = cell + value;
  if (raw === LAST_CELL) return { to: LAST_CELL, blocked: false };
  if (raw > LAST_CELL) {
    // Overshoot: bounce back off the finish unless an exact roll is required.
    if (state.options.exactFinish) return { to: cell, blocked: true };
    return { to: LAST_CELL - (raw - LAST_CELL), blocked: false };
  }
  return { to: raw, blocked: false };
}

/**
 * Play one roll for the player in turn.
 * @param {object} state
 * @param {number} value 1..6
 * @returns {{state:object, events:object[]}}
 */
export function applySnakeRoll(state, value) {
  if (state.phase !== SNAKE_PHASE.AWAIT_ROLL) {
    throw new Error('snakes: not waiting for a roll');
  }
  const die = Math.max(1, Math.min(6, Math.round(value)));
  const next = clone(state);
  const events = [];
  const seat = next.turn;
  const player = next.players[seat];

  next.dice = die;
  next.rollCount += 1;
  if (die === 6) {
    player.sixes += 1;
    next.sixStreak += 1;
  } else {
    next.sixStreak = 0;
  }
  events.push({ type: SEV.ROLLED, seat, playerId: seat, value: die, name: player.name });

  const limit = next.options.maxSixesInARow;
  const forfeited = limit > 0 && next.sixStreak >= limit;

  const { to, blocked } = targetOf(next, player.cell, die);

  if (blocked) {
    events.push({
      type: SEV.BLOCKED,
      seat,
      playerId: seat,
      cell: player.cell,
      need: LAST_CELL - player.cell,
      value: die,
    });
  } else if (to !== player.cell) {
    const from = player.cell;
    player.cell = to;
    player.moves += 1;
    events.push({ type: SEV.MOVED, seat, playerId: seat, from, to, value: die });

    const jump = jumpAt(to);
    if (jump) {
      const landed = jump.to;
      player.cell = landed;
      if (jump.kind === 'ladder') {
        player.climbs += 1;
        events.push({ type: SEV.CLIMBED, seat, playerId: seat, from: to, to: landed });
      } else {
        player.bites += 1;
        events.push({ type: SEV.BITTEN, seat, playerId: seat, from: to, to: landed });
      }
    }

    if (player.cell === LAST_CELL) {
      player.rank = next.ranks.length + 1;
      next.ranks.push(seat);
      events.push({ type: SEV.FINISHED, seat, playerId: seat, rank: player.rank, name: player.name });
    }
  }

  // The game ends when only one player is left running.
  const still = next.players.filter((p) => p.rank === 0);
  if (still.length <= 1) {
    for (const last of still) {
      last.rank = next.ranks.length + 1;
      next.ranks.push(last.id);
    }
    next.phase = SNAKE_PHASE.GAME_OVER;
    next.dice = die;
    const winnerSeat = next.ranks[0];
    events.push({
      type: SEV.GAME_OVER,
      winner: winnerSeat,
      winnerName: next.players[winnerSeat].name,
      ranks: next.ranks.slice(),
      turns: next.turnCount,
    });
    return { state: next, events };
  }

  // Another turn for a 6 — unless this was the third in a row, or the roll just
  // finished the player off the board.
  const keepsTurn =
    die === 6 && next.options.extraTurnOnSix && !forfeited && player.rank === 0 && !blocked;

  if (keepsTurn) {
    events.push({ type: SEV.EXTRA_TURN, seat, playerId: seat, value: die });
  } else {
    if (forfeited) next.sixStreak = 0;
    const to2 = nextSeat(next, seat);
    next.turn = to2;
    next.turnCount += 1;
    next.sixStreak = 0;
    events.push({
      type: SEV.TURN_PASSED,
      from: seat,
      to: to2,
      forfeited,
      playerId: to2,
      name: next.players[to2].name,
    });
  }

  return { state: next, events };
}

/**
 * Roll for the player in turn using an injected generator.
 * @param {() => number} rng
 */
export function rollSnakeDie(rng = Math.random) {
  return 1 + Math.floor(rng() * 6);
}

/* ───────────────────────────── serialization ───────────────────────────── */

export function serializeSnakeState(state) {
  return clone(state);
}

/**
 * @returns {object|null} null when the payload is unusable
 */
export function deserializeSnakeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.game !== 'snakes') return null;
  if (raw.v !== SNAKES_SCHEMA_VERSION) return null;
  if (!Array.isArray(raw.players) || raw.players.length < 2) return null;
  const state = clone(raw);
  state.options = { ...DEFAULT_SNAKE_OPTIONS, ...(state.options || {}) };
  return state;
}

/* ──────────────────────────────── audit ────────────────────────────────── */

/**
 * Board sanity, used by the tests and callable in the field.
 * @returns {string[]} problems found (empty means the board is legal)
 */
export function auditBoard() {
  const problems = [];
  const heads = Object.keys(SNAKES).map(Number);
  const feet = Object.keys(LADDERS).map(Number);

  for (const from of feet) {
    if (LADDERS[from] <= from) problems.push('ladder ' + from + ' does not climb');
    if (from === 1 && LADDERS[from] > LAST_CELL) problems.push('ladder ' + from + ' leaves the board');
    if (LADDERS[from] > LAST_CELL) problems.push('ladder ' + from + ' overshoots the finish');
  }
  for (const from of heads) {
    if (SNAKES[from] >= from) problems.push('snake ' + from + ' does not bite downwards');
    if (SNAKES[from] < 1) problems.push('snake ' + from + ' leaves the board');
  }
  for (const cell of heads) {
    if (LADDERS[cell]) problems.push('cell ' + cell + ' is both a snake head and a ladder foot');
  }
  // A jump must never land on another jump: that would chain forever.
  for (const jump of allJumps()) {
    if (jumpAt(jump.to)) problems.push('jump from ' + jump.from + ' lands on another jump at ' + jump.to);
  }
  if (SNAKES[LAST_CELL]) problems.push('the finish cannot be a snake head');
  return problems;
}
