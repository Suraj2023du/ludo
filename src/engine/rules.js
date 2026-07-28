/**
 * engine/rules.js — PURE Ludo King ruleset.
 *
 * ZERO DOM, ZERO canvas, ZERO imports outside engine/.
 * Every rule is a pure function: (state, input) → (newState, events). The input
 * state is never mutated, which is what makes Phase 2 sync a drop-in: replay the
 * same inputs, get the same state on every device.
 *
 * The full ruleset is documented in README.md ("The ruleset") and every line of
 * it has a test in tests/rules.test.js.
 */

import {
  BASE,
  FINISH,
  MAX_SIX_STREAK,
  PHASE,
  cloneState,
  currentPlayer,
  isSafeAbs,
  onTrack,
  playerDone,
  toAbs,
} from './state.js';

/** Canonical event names. game/events.js re-exports these — engine owns them. */
export const EV = Object.freeze({
  DICE_ROLLED: 'dice:rolled',
  SIX: 'dice:six',
  THREE_SIXES: 'dice:threeSixes',
  NO_MOVES: 'turn:noMoves',
  TURN_CHANGED: 'turn:changed',
  EXTRA_TURN: 'turn:extra',
  TOKEN_EXITED: 'token:exited',
  TOKEN_MOVED: 'token:moved',
  TOKEN_CAPTURED: 'token:captured',
  TOKEN_FINISHED: 'token:finished',
  PLAYER_FINISHED: 'player:finished',
  GAME_OVER: 'game:over',
});

export const MOVE_KIND = Object.freeze({
  EXIT: 'exit',
  ADVANCE: 'advance',
  FINISH: 'finish',
});

/* ──────────────────────────────── legal moves ─────────────────────────────── */

/**
 * All legal moves for the player in turn with the given die value.
 * Pure: does not touch `state`.
 *
 * Moves are de-duplicated by origin square: two tokens sitting on the same
 * square produce identical outcomes, so only one move object is returned
 * (with the lowest token index). Callers may substitute any token standing on
 * that origin — see applyMove().
 *
 * @param {object} state
 * @param {number} [dice] defaults to state.dice
 * @returns {Array<{playerId:number,tokenIndex:number,from:number,to:number,dice:number,
 *                  kind:string,captures:Array,path:number[],safe:boolean}>}
 */
export function legalMoves(state, dice = state ? state.dice : null) {
  const out = [];
  if (!state || state.phase === PHASE.GAME_OVER) return out;
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) return out;

  const player = currentPlayer(state);
  if (!player || playerDone(player)) return out;

  const seenFrom = new Set();
  for (let i = 0; i < player.tokens.length; i++) {
    const from = player.tokens[i];
    if (from === FINISH) continue; // already home
    if (seenFrom.has(from)) continue; // identical origin → identical move

    let to;
    let kind;
    if (from === BASE) {
      if (dice !== 6) continue; // leaving base needs a 6
      to = 0;
      kind = MOVE_KIND.EXIT;
    } else {
      to = from + dice;
      if (to > FINISH) continue; // overshoot → this token cannot move
      kind = to === FINISH ? MOVE_KIND.FINISH : MOVE_KIND.ADVANCE;
    }

    seenFrom.add(from);
    out.push({
      playerId: player.id,
      tokenIndex: i,
      from,
      to,
      dice,
      kind,
      captures: captureTargets(state, player, to),
      path: pathOf(from, to),
      safe: onTrack(to) ? isSafeAbs(toAbs(player.color, to)) : true,
    });
  }
  return out;
}

/** Convenience: does the player in turn have anything to do with this die? */
export function hasLegalMove(state, dice = state ? state.dice : null) {
  return legalMoves(state, dice).length > 0;
}

/**
 * Opponent tokens that would be sent home by landing on `to`.
 * Never returns own-colour tokens, never returns anything on a safe square,
 * never returns anything for home-column / finish destinations.
 */
function captureTargets(state, player, to) {
  if (!onTrack(to)) return [];
  const abs = toAbs(player.color, to);
  if (isSafeAbs(abs)) return []; // safe square → no capture
  const hits = [];
  for (const other of state.players) {
    if (other.id === player.id) continue; // never self-capture
    for (let t = 0; t < other.tokens.length; t++) {
      const rel = other.tokens[t];
      if (!onTrack(rel)) continue;
      if (toAbs(other.color, rel) === abs) {
        hits.push({ playerId: other.id, tokenIndex: t, color: other.color, from: rel, abs });
      }
    }
  }
  return hits;
}

/** Every relative cell the token visits, excluding the origin. Used for animation. */
function pathOf(from, to) {
  if (from === BASE) return [0];
  const path = [];
  for (let p = from + 1; p <= to; p++) path.push(p);
  return path;
}

/* ─────────────────────────────────── rolling ──────────────────────────────── */

/**
 * Apply a die value to the state.
 * Handles the six-streak, the three-six forfeit and the automatic
 * "no legal move → pass" rule.
 *
 * @returns {{state:object, events:Array, moves:Array}}
 */
export function applyRoll(state, value) {
  if (!state) throw new Error('applyRoll: no state');
  if (state.phase !== PHASE.AWAIT_ROLL) {
    throw new Error('applyRoll: phase is "' + state.phase + '", expected awaitRoll');
  }
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error('applyRoll: die value must be 1..6, got ' + value);
  }

  const events = [];
  const ns = cloneState(state);
  const player = currentPlayer(ns);

  ns.rollCount += 1;
  ns.dice = value;
  ns.sixStreak = value === 6 ? ns.sixStreak + 1 : 0;

  events.push({
    type: EV.DICE_ROLLED,
    playerId: player.id,
    color: player.color,
    value,
    sixStreak: ns.sixStreak,
  });

  // Three consecutive sixes → whole turn forfeited, no move allowed.
  if (value === 6 && ns.options.threeSixForfeit && ns.sixStreak >= MAX_SIX_STREAK) {
    events.push({ type: EV.THREE_SIXES, playerId: player.id, color: player.color });
    return { state: endTurn(ns, events, 'threeSixes'), events, moves: [] };
  }

  const moves = legalMoves(ns, value);
  if (moves.length === 0) {
    events.push({ type: EV.NO_MOVES, playerId: player.id, color: player.color, value });
    return { state: endTurn(ns, events, 'noMoves'), events, moves: [] };
  }

  if (value === 6) {
    events.push({ type: EV.SIX, playerId: player.id, color: player.color });
  }
  ns.phase = PHASE.AWAIT_MOVE;
  return { state: ns, events, moves };
}

/* ─────────────────────────────────── moving ───────────────────────────────── */

/**
 * Apply one move. Accepts a full move object from legalMoves(), or a partial
 * `{ tokenIndex }` / `{ from, to }` selector (handy for taps and for remote
 * moves arriving over the Phase 2 SyncAdapter).
 *
 * Throws on anything illegal — the engine is the single source of truth.
 * @returns {{state:object, events:Array}}
 */
export function applyMove(state, move) {
  if (!state) throw new Error('applyMove: no state');
  if (state.phase !== PHASE.AWAIT_MOVE) {
    throw new Error('applyMove: phase is "' + state.phase + '", expected awaitMove');
  }
  if (!move || typeof move !== 'object') throw new Error('applyMove: move is required');

  const actor = currentPlayer(state);
  if (move.playerId !== undefined && move.playerId !== actor.id) {
    throw new Error('applyMove: not player ' + move.playerId + "'s turn");
  }

  // Resolve which physical token is being moved.
  let tokenIndex = move.tokenIndex;
  if (!Number.isInteger(tokenIndex)) {
    if (!Number.isInteger(move.from)) throw new Error('applyMove: tokenIndex or from required');
    tokenIndex = actor.tokens.indexOf(move.from);
  }
  if (tokenIndex < 0 || tokenIndex >= actor.tokens.length) {
    throw new Error('applyMove: bad tokenIndex ' + move.tokenIndex);
  }
  const from = actor.tokens[tokenIndex];

  const legal = legalMoves(state, state.dice);
  const chosen = legal.find(
    (m) => m.from === from && (move.to === undefined || m.to === move.to)
  );
  if (!chosen) {
    throw new Error(
      'applyMove: illegal move (token ' + tokenIndex + ' from ' + from + ' with ' + state.dice + ')'
    );
  }

  const events = [];
  const ns = cloneState(state);
  const player = ns.players[actor.id];

  player.tokens[tokenIndex] = chosen.to;
  ns.moveCount += 1;

  if (chosen.kind === MOVE_KIND.EXIT) {
    events.push({
      type: EV.TOKEN_EXITED,
      playerId: player.id,
      color: player.color,
      tokenIndex,
      to: chosen.to,
    });
  }
  events.push({
    type: EV.TOKEN_MOVED,
    playerId: player.id,
    color: player.color,
    tokenIndex,
    from,
    to: chosen.to,
    path: chosen.path.slice(),
    kind: chosen.kind,
    dice: state.dice,
  });

  // Captures
  for (const hit of chosen.captures) {
    const victim = ns.players[hit.playerId];
    victim.tokens[hit.tokenIndex] = BASE;
    victim.losses += 1;
    player.captures += 1;
    events.push({
      type: EV.TOKEN_CAPTURED,
      byPlayerId: player.id,
      byColor: player.color,
      playerId: hit.playerId,
      color: hit.color,
      tokenIndex: hit.tokenIndex,
      from: hit.from,
      abs: hit.abs,
    });
  }

  // Finishing
  if (chosen.to === FINISH) {
    player.finished += 1;
    events.push({
      type: EV.TOKEN_FINISHED,
      playerId: player.id,
      color: player.color,
      tokenIndex,
      finished: player.finished,
    });
    if (playerDone(player) && !player.rank) {
      ns.ranks.push(player.id);
      player.rank = ns.ranks.length;
      events.push({
        type: EV.PLAYER_FINISHED,
        playerId: player.id,
        color: player.color,
        rank: player.rank,
      });
    }
  }

  // Game ends when at most one player is still unranked; that player takes last place.
  const stillPlaying = ns.players.filter((p) => !p.rank);
  if (stillPlaying.length <= 1) {
    for (const p of stillPlaying) {
      ns.ranks.push(p.id);
      p.rank = ns.ranks.length;
      events.push({ type: EV.PLAYER_FINISHED, playerId: p.id, color: p.color, rank: p.rank });
    }
    ns.phase = PHASE.GAME_OVER;
    ns.dice = null;
    ns.sixStreak = 0;
    events.push({
      type: EV.GAME_OVER,
      ranks: ns.ranks.slice(),
      winner: ns.ranks[0],
      winnerColor: ns.players[ns.ranks[0]].color,
    });
    return { state: ns, events };
  }

  // Extra turn? A 6 or a capture keeps the dice; finishing a token alone does not.
  const rolledSix = state.dice === 6 && ns.options.extraTurnOnSix;
  const captured = chosen.captures.length > 0 && ns.options.extraTurnOnCapture;
  if ((rolledSix || captured) && !playerDone(player)) {
    ns.phase = PHASE.AWAIT_ROLL;
    ns.dice = null; // six streak is intentionally preserved
    events.push({
      type: EV.EXTRA_TURN,
      playerId: player.id,
      color: player.color,
      reason: rolledSix ? 'six' : 'capture',
    });
    return { state: ns, events };
  }

  return { state: endTurn(ns, events, 'moved'), events };
}

/* ────────────────────────────────── turn flow ─────────────────────────────── */

/**
 * Hand the turn to the next player that still has tokens to play.
 * Exported for tests / UI "skip" affordances; applyRoll and applyMove call it
 * internally so callers normally never need it.
 * @returns {{state:object, events:Array}}
 */
export function passTurn(state, reason = 'manual') {
  const events = [];
  return { state: endTurn(cloneState(state), events, reason), events };
}

function endTurn(ns, events, reason) {
  const fromIdx = ns.turn;
  ns.dice = null;
  ns.sixStreak = 0;
  ns.turnCount += 1;
  ns.turn = nextActiveSeat(ns, fromIdx);
  ns.phase = PHASE.AWAIT_ROLL;
  events.push({
    type: EV.TURN_CHANGED,
    from: fromIdx,
    to: ns.turn,
    playerId: ns.players[ns.turn].id,
    color: ns.players[ns.turn].color,
    reason,
  });
  return ns;
}

/** Next seat index that has not finished all four tokens. */
export function nextActiveSeat(state, fromIdx) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (!playerDone(state.players[idx])) return idx;
  }
  return fromIdx;
}

/**
 * The seat that should act next given a raw die value, without mutating —
 * used by the UI to preview "you will lose your turn".
 */
export function wouldPassTurn(state, value) {
  if (value === 6 && state.options.threeSixForfeit && state.sixStreak + 1 >= MAX_SIX_STREAK) {
    return true;
  }
  return !hasLegalMove(state, value);
}
